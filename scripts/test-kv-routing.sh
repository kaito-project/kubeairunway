#!/usr/bin/env bash
# test-kv-routing.sh — measure prefix/KV-cache hit numbers against any
# OpenAI-compatible chat-completions endpoint.
#
# What it measures (works against any OpenAI-compatible server):
#   1. Cold vs warm latency for N distinct long prompts.
#        Phase 1 sends N prompts concurrently (creates queue pressure so a
#        KV-aware router has to distribute across workers); phase 2 re-sends
#        them sequentially so each warm hit gets a clean measurement window.
#   2. Per-response `usage.prompt_tokens_details.cached_tokens` — the
#        canonical client-visible signal that the server reused KV blocks
#        for the prompt prefix. Reported by vLLM (≥0.6), OpenAI, SGLang,
#        and other OpenAI-compatible servers. If a server doesn't return
#        this field, the script falls back to latency speedup as the signal.
#
# Optional Kubernetes mode (--kube-namespace + --kube-worker-label):
#   - Attributes each request to a worker pod by snapshotting
#     vllm:prompt_tokens_total on each worker before/after the request and
#     picking the pod whose counter increased. Requires vLLM workers and
#     `kubectl exec` access. Without this, the script is purely client-side.
#   - Reports each pod's cumulative "Prefix cache hit rate" line scraped
#     from worker logs after the run.
#
# Usage examples:
#   # Pure client-side, any endpoint
#   ./test-kv-routing.sh -e http://localhost:8000 -m Qwen/Qwen3-0.6B
#
#   # OpenAI / hosted endpoint with API key
#   ./test-kv-routing.sh -e https://api.openai.com -m gpt-4o-mini -k "$OPENAI_API_KEY"
#
#   # Custom routing header (e.g. for GAIE / Inference Gateway)
#   ./test-kv-routing.sh -e http://gateway:8000 -m Qwen/Qwen3-0.6B \
#     -H "X-Gateway-Model-Name: Qwen/Qwen3-0.6B"
#
#   # Kubernetes mode: also attribute requests to vLLM worker pods
#   ./test-kv-routing.sh -e http://gateway:8000 -m Qwen/Qwen3-0.6B \
#     --kube-namespace <namespace> --kube-worker-label app=qwen3-worker
#
# Flags (env-var equivalents in parentheses):
#   -e, --endpoint URL          (ENDPOINT)        Required. Base URL, no /v1 suffix.
#   -m, --model NAME            (MODEL)           Required. Model identifier.
#   -k, --api-key KEY           (API_KEY)         Optional bearer token.
#   -n, --num-prompts N         (NUM_PROMPTS)     1-4 distinct prompt families [4].
#   -t, --max-tokens N          (MAX_TOKENS)      Response max_tokens [16].
#   -H, --header "Name: value"  (repeatable)      Extra HTTP header.
#   --kube-namespace NS         (KUBE_NAMESPACE)  Optional, enables pod attribution.
#   --kube-worker-label LABEL   (KUBE_WORKER_LABEL) e.g. "app=foo" or
#                                                 "nvidia.com/dynamo-graph-deployment-name=qwen-agg".
#   --kube-metrics-port PORT    (KUBE_METRICS_PORT) Worker metrics port [9090].
#
# Requires: bash, curl, jq, bc (and kubectl in Kubernetes mode).

set -euo pipefail

# ── Defaults ───────────────────────────────────────────────────────────
ENDPOINT="${ENDPOINT:-}"
MODEL="${MODEL:-}"
API_KEY="${API_KEY:-}"
NUM_PROMPTS="${NUM_PROMPTS:-4}"
MAX_TOKENS="${MAX_TOKENS:-16}"
EXTRA_HEADERS=()
KUBE_NAMESPACE="${KUBE_NAMESPACE:-}"
KUBE_WORKER_LABEL="${KUBE_WORKER_LABEL:-}"
KUBE_METRICS_PORT="${KUBE_METRICS_PORT:-9090}"

usage() { sed -n '2,50p' "$0"; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--endpoint)        ENDPOINT="$2"; shift 2 ;;
    -m|--model)           MODEL="$2"; shift 2 ;;
    -k|--api-key)         API_KEY="$2"; shift 2 ;;
    -n|--num-prompts)     NUM_PROMPTS="$2"; shift 2 ;;
    -t|--max-tokens)      MAX_TOKENS="$2"; shift 2 ;;
    -H|--header)          EXTRA_HEADERS+=("$2"); shift 2 ;;
    --kube-namespace)     KUBE_NAMESPACE="$2"; shift 2 ;;
    --kube-worker-label)  KUBE_WORKER_LABEL="$2"; shift 2 ;;
    --kube-metrics-port)  KUBE_METRICS_PORT="$2"; shift 2 ;;
    -h|--help)            usage ;;
    *)                    echo "unknown arg: $1" >&2; usage 1 ;;
  esac
done

[[ -z "$ENDPOINT" ]] && { echo "ERROR: --endpoint (or ENDPOINT env) is required" >&2; exit 1; }
[[ -z "$MODEL"    ]] && { echo "ERROR: --model (or MODEL env) is required" >&2; exit 1; }
if ! [[ "$NUM_PROMPTS" =~ ^[1-4]$ ]]; then
  echo "ERROR: --num-prompts must be 1-4 (got: $NUM_PROMPTS)" >&2; exit 1
fi

ENDPOINT="${ENDPOINT%/}"  # strip trailing slash

KUBE_MODE=0
if [[ -n "$KUBE_NAMESPACE" && -n "$KUBE_WORKER_LABEL" ]]; then
  KUBE_MODE=1
elif [[ -n "$KUBE_NAMESPACE$KUBE_WORKER_LABEL" ]]; then
  echo "ERROR: --kube-namespace and --kube-worker-label must be set together" >&2; exit 1
fi

echo "==> Configuration"
echo "    endpoint:    $ENDPOINT"
echo "    model:       $MODEL"
echo "    prompts:     $NUM_PROMPTS"
echo "    max-tokens:  $MAX_TOKENS"
echo "    auth:        $([[ -n "$API_KEY" ]] && echo yes || echo no)"
echo "    kube-mode:   $([[ $KUBE_MODE -eq 1 ]] && echo 'ns='"$KUBE_NAMESPACE"' label='"$KUBE_WORKER_LABEL" || echo off)"

# ── Worker pod discovery (Kubernetes mode only) ───────────────────────
WORKERS=""
if [[ $KUBE_MODE -eq 1 ]]; then
  WORKERS=$(kubectl get pods -n "$KUBE_NAMESPACE" -l "$KUBE_WORKER_LABEL" \
    --field-selector=status.phase=Running \
    -o jsonpath='{.items[*].metadata.name}' 2>/dev/null | tr ' ' '\n' || true)

  if [[ -z "$WORKERS" ]]; then
    echo "WARNING: no Running pods matched -n $KUBE_NAMESPACE -l $KUBE_WORKER_LABEL" >&2
    echo "         Continuing in client-only mode." >&2
    KUBE_MODE=0
  else
    NUM_WORKERS=$(echo "$WORKERS" | wc -w | tr -d ' ')
    echo
    echo "==> Found $NUM_WORKERS worker pod(s):"
    for w in $WORKERS; do echo "      - $w"; done
    if [[ "$NUM_WORKERS" -lt 2 ]]; then
      echo "WARNING: only $NUM_WORKERS worker(s) — KV-aware routing needs ≥2 to make"
      echo "         a meaningful routing decision; you'll only see on-pod caching."
    fi
  fi
fi

SINCE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ── Worker metrics scraping (Kubernetes mode only) ────────────────────
get_prompt_tokens() {
  local pod="$1"
  kubectl exec -n "$KUBE_NAMESPACE" "$pod" -c main -- \
    curl -s "localhost:${KUBE_METRICS_PORT}/metrics" 2>/dev/null \
    | grep '^vllm:prompt_tokens_total' \
    | grep -oE '[0-9.]+$' || echo "0"
}

snapshot_tokens() {
  local tmpdir="$1" prefix="$2"
  [[ $KUBE_MODE -eq 0 ]] && return
  for w in $WORKERS; do
    get_prompt_tokens "$w" > "$tmpdir/${prefix}.before.$w"
  done
}

detect_pod() {
  local label="$1" tmpdir="$2"
  if [[ $KUBE_MODE -eq 0 ]]; then echo "n/a" > "$tmpdir/$label.pod"; return; fi
  sleep 1  # let metrics flush
  local pod_name="unknown" max_delta=0
  for w in $WORKERS; do
    local after_tok before_tok delta
    after_tok=$(get_prompt_tokens "$w")
    before_tok=$(cat "$tmpdir/$label.before.$w" 2>/dev/null || echo "0")
    delta=$(echo "$after_tok - $before_tok" | bc 2>/dev/null || echo "0")
    if (( $(echo "$delta > $max_delta" | bc 2>/dev/null) )); then
      max_delta="$delta"; pod_name="$w"
    fi
  done
  echo "$pod_name" > "$tmpdir/$label.pod"
}

# ── Request firing ────────────────────────────────────────────────────
fire_request() {
  local label="$1" prompt="$2" tmpdir="$3"
  local headers=( -H 'Content-Type: application/json' )
  [[ -n "$API_KEY" ]] && headers+=( -H "Authorization: Bearer $API_KEY" )
  local h
  if [[ ${#EXTRA_HEADERS[@]} -gt 0 ]]; then
    for h in "${EXTRA_HEADERS[@]}"; do headers+=( -H "$h" ); done
  fi

  jq -nc \
      --arg model "$MODEL" \
      --arg prompt "$prompt" \
      --argjson max_tokens "$MAX_TOKENS" \
      '{model: $model, max_tokens: $max_tokens, temperature: 0,
        messages: [{role: "user", content: $prompt}]}' \
    | curl -sS -X POST "$ENDPOINT/v1/chat/completions" \
        "${headers[@]}" \
        -d @- \
        -o "$tmpdir/$label.body" \
        -w '%{time_total}' > "$tmpdir/$label.latency"
}

send_request() {
  local label="$1" prompt="$2" tmpdir="$3"
  echo
  echo "==> Sending $label"
  snapshot_tokens "$tmpdir" "$label"
  fire_request "$label" "$prompt" "$tmpdir"
  detect_pod "$label" "$tmpdir"
  printf "    latency: %ss   pod: %s\n" \
    "$(cat "$tmpdir/$label.latency")" "$(cat "$tmpdir/$label.pod")"
}

# Extract usage fields from a response body. Returns "0" if missing.
field() {
  local body="$1" path="$2"
  jq -r "(${path}) // 0" "$body" 2>/dev/null || echo "0"
}

# ── Prompts ───────────────────────────────────────────────────────────
# Long, distinct prompts so prefill dominates total latency and warm-vs-cold
# delta is unmistakable. PROMPTS share no meaningful prefix beyond the chat
# template, so each prompt's hit/miss is independent of the others.
PROMPT_NAMES=("A" "B" "C" "D")

read -r -d '' PROMPT_A << 'PROMPT_EOF' || true
You are a distributed systems expert. I need an exhaustive technical explanation covering all of the following topics in a single, cohesive response. Be extremely thorough — for each topic, include the full protocol specification, correctness invariants, failure modes, and performance characteristics.

1. The Raft consensus algorithm:
   a. Leader election: Explain the state machine (follower, candidate, leader), randomized election timeouts and why they prevent split-vote livelock, the RequestVote RPC including term comparison and log-up-to-date check, what happens when two candidates start an election simultaneously, and how a candidate handles receiving an AppendEntries from a valid leader during its election. Explain the role of the pre-vote extension and why it prevents disruptions from partitioned servers rejoining.
   b. Log replication: Explain how the leader maintains nextIndex and matchIndex per follower, the AppendEntries RPC including the consistency check (prevLogIndex, prevLogTerm), the fast log backtracking optimization (conflictIndex, conflictTerm), batching of entries, and flow control. Explain how the leader decides when an entry is committed (majority matchIndex), and the subtle rule that a leader cannot commit entries from previous terms using the current term's commit index — illustrate this with the specific counterexample from Section 5.4.2 of the Raft paper where committing old-term entries leads to safety violations.
   c. Persistence and crash recovery: Which state must be persisted before responding to any RPC (currentTerm, votedFor, log[])? Why is votedFor persistence critical for safety? What happens if a server crashes after persisting a vote but before sending the response?
   d. Cluster membership changes: Explain the joint consensus approach, the single-server change simplification, and the safety argument for why at most one configuration change can be pending at a time. Explain the AddServer and RemoveServer RPCs and the leadership transfer extension.
   e. Log compaction and snapshots: Explain how snapshots replace prefix segments of the log, the InstallSnapshot RPC, and the interaction between snapshots and slow followers that fall behind.
   f. Linearizable reads: Explain the three approaches — leader leases with clock assumptions, read-index with a heartbeat round, and log-reads where the read is appended to the log. Analyze the trade-offs of each.

2. The Viewstamped Replication Revisited protocol:
   a. Normal operation: Explain the role of the primary, the op-number, commit-number, and view-number. How does the primary assign op-numbers, broadcast Prepare messages, collect PrepareOk responses, and advance the commit point? How do backups apply committed operations to their state machines?
   b. View change: Explain the StartViewChange and DoViewChange messages in detail. How does the new primary determine the correct log state from the set of DoViewChange messages it receives? What is the significance of the view-number in each DoViewChange? Explain the subtle case where the new primary's log is shorter than a backup's log — how is this resolved safely?
   c. Recovery: Explain the Recovery and RecoveryResponse protocol that allows a crashed replica to rejoin. Why must the recovering replica obtain a new nonce? Why must it wait for a response from the current primary specifically, not just any replica?
   d. Reconfiguration: Explain the epoch-based reconfiguration mechanism, including the StartEpoch message and how it interacts with in-progress view changes.

3. Chain Replication and CRAQ:
   a. Basic chain replication: Explain the topology (head, intermediate nodes, tail), write propagation from head to tail, read serving at the tail only, and why this gives strong consistency. Analyze the steady-state latency (write latency = chain length * inter-node RTT, read latency = 1 RTT to tail) and throughput characteristics (write throughput limited by slowest link, read throughput scales with tail capacity only).
   b. Failure handling: Explain how the chain master detects and handles head failure (promote successor), tail failure (predecessor becomes tail, re-sends pending writes), and mid-chain failure (predecessor links to successor, re-sends in-flight writes). Explain the "sent" vs "received" bookkeeping that makes mid-chain repair correct.
   c. CRAQ (Chain Replication with Apportioned Queries): Explain the clean/dirty version distinction, how any replica can serve reads for clean objects (all versions committed), and how dirty reads require a version check against the tail. Analyze how this improves read throughput by distributing reads across all replicas while maintaining strong consistency.
   d. Chain replication for transactions: Explain the Sinfonia mini-transaction protocol that uses chain replication for individual items, and how TAPIR combines this with inconsistent replication for cross-shard transactions.

4. Comparison across all three protocols, analyzing: (a) read and write latency in the common case and under contention, (b) behavior during asymmetric network partitions where the leader/primary/head can reach some replicas but not others, (c) the exact conditions under which each protocol becomes unavailable (minority partition, simultaneous failures exceeding f in a 2f+1 cluster), (d) reconfiguration complexity and whether it requires stopping all operations, (e) suitability for geo-distributed deployments where inter-replica RTT is 50-200ms, and (f) how each protocol handles slow replicas (one node 10x slower than others) without sacrificing availability.

Be precise and technical. Include pseudocode for all key protocol steps.
PROMPT_EOF

read -r -d '' PROMPT_B << 'PROMPT_EOF' || true
You are a database internals expert. I need an exhaustive technical explanation covering all of the following topics in a single, cohesive response. Be extremely thorough — for each topic, include the full algorithm specification, correctness invariants, failure modes, and performance characteristics.

1. Write-Ahead Logging (WAL) and ARIES recovery:
   a. WAL fundamentals: Explain the write-ahead logging protocol — why the log record for a modification must be flushed to stable storage before the modified data page can be written. Define the WAL record structure: LSN (Log Sequence Number), prevLSN (linking records for the same transaction), transactionID, pageID, offset, before-image, after-image. Explain physiological logging (physical-to-a-page, logical-within-a-page) and why it reduces log volume compared to pure physical logging while avoiding the complications of pure logical logging during undo.
   b. Buffer pool interaction: Explain the pageLSN stored on each data page, the flushedLSN maintained by the log manager, and the no-force/steal buffer management policy that ARIES enables. Explain why the steal policy (allowing dirty pages to be written before commit) requires undo capability, and why the no-force policy (not requiring all dirty pages to be flushed at commit) requires redo capability. Explain the checkpoint protocol: begin_checkpoint, end_checkpoint, the active transaction table (ATT), and the dirty page table (DPT).
   c. ARIES recovery algorithm: Explain the three passes in complete detail. Analysis pass: scan forward from the last checkpoint's begin_checkpoint LSN, reconstruct the ATT and DPT, identify the starting point for redo (minimum recLSN in DPT). Redo pass: scan forward from the redo starting point, for each redo-able log record check whether the page's pageLSN is less than the record's LSN (if so, re-apply the action and update pageLSN). Undo pass: process the loser transactions (those in ATT at end of analysis that did not commit), undo their actions in reverse LSN order using the prevLSN chain, and write CLRs (Compensation Log Records) for each undone action. Explain why CLRs have an undoNextLSN that points past the record being compensated, and how this prevents repeated undo work if the system crashes during recovery.
   d. Group commit: Explain how the log manager batches multiple transaction commits into a single fsync to amortize I/O cost, the trade-off between commit latency and throughput, and how the commit queue and wake-up mechanism work. Explain the interaction with write-behind (asynchronous page flushing) and how the buffer pool's page cleaner coordinates with the WAL flush position.
   e. WAL in modern systems: Explain how WBL (Write-Behind Logging) in NVM-aware databases (e.g., Peloton) inverts the traditional approach by flushing dirty pages first and using the log only for undo. Explain the SILK approach for reducing WAL I/O interference with data I/O on SSDs.

2. Multi-Version Concurrency Control (MVCC) in depth:
   a. Append-only / copy-on-write MVCC (PostgreSQL model): Explain how each UPDATE creates a new physical tuple version in the heap, linked via the t_ctid chain. Explain the visibility rules using xmin, xmax, and the CLOG (commit log). Explain VACUUM — why it is necessary (dead tuples accumulate), how it identifies reclaimable tuples, the FREEZE operation that prevents transaction ID wraparound, and the autovacuum launcher/worker architecture. Explain the HOT (Heap-Only Tuple) optimization that avoids index updates when the new tuple fits on the same page and no indexed column changes.
   b. Undo-log MVCC (InnoDB model): Explain how the latest version lives in-place in the clustered index, with previous versions reconstructed from the undo log (rollback segment). Explain the purge system that reclaims undo log entries once no active transaction can need them. Explain the read view (consistent snapshot) mechanism: the list of active transaction IDs at snapshot creation time, and the visibility algorithm that checks whether a row's trx_id is committed and visible to the snapshot.
   c. Snapshot Isolation (SI): Formally define SI using the "First-Committer-Wins" rule. Explain the write skew anomaly with the classic doctor-on-call example (two doctors each check that the other is on call, then both go off call). Explain why SI is not serializable and give the exact characterization of the anomalies SI permits (the dangerous structure is two consecutive rw-anti-dependency edges forming a cycle).
   d. Serializable Snapshot Isolation (SSI): Explain how SSI tracks rw-anti-dependencies between concurrent transactions (both incoming and outgoing), detects dangerous structures (two consecutive rw-anti-dependencies involving a pivot transaction), and aborts one of the involved transactions to break the cycle. Explain the false positive rate and the heuristics used to reduce unnecessary aborts (e.g., the committed transaction optimization, the read-only transaction optimization).
   e. MVCC for non-relational systems: Explain how FoundationDB implements MVCC using its ordered key-value store with versionstamp keys, and how CockroachDB's MVCC layer uses hybrid-logical clocks (HLC) to timestamp versions and resolve clock skew across nodes.

3. B-Tree and B+Tree concurrency in depth:
   a. Basic B+Tree structure: Explain the distinction between B-trees and B+trees (data in leaf nodes only), the search algorithm, and the properties maintained by splits and merges. Explain the fill factor, the difference between leaf splits (redistribute keys) and internal node splits (push up the middle key), and the cascading nature of splits.
   b. Latch-coupling (crabbing): Explain the protocol for concurrent traversal — acquire latch on child before releasing latch on parent. For read operations: shared latches, released immediately on the way down. For write operations: exclusive latches, held until it is confirmed that no split/merge will propagate upward (safe node = node that will not split or merge after the insertion/deletion). Explain why you release all ancestor latches once you reach a safe node.
   c. Optimistic latching (B-link trees): Explain Lehman and Yao's B-link tree that adds right-link pointers and high-key values to handle concurrent splits. Explain the "move right" protocol when a search reaches a node that has been split. Explain the optimistic write path: traverse with read latches only, latch the leaf exclusively, and if a split propagates, restart from the root with pessimistic latch-coupling.
   d. Latch-free approaches: Explain the Bw-tree (used in SQL Server Hekaton and Azure Cosmos DB): the mapping table that provides indirection between logical and physical page pointers, delta chains that represent modifications without in-place updates, page consolidation that merges deltas into a new base page, and the structure modification protocol using CAS on the mapping table. Explain the OLFIT (Optimistic Latch-Free Index Traversal) approach using version numbers. Explain the ART (Adaptive Radix Tree) and how it achieves concurrency with optimistic lock coupling.
   e. Modern optimizations: Explain FAST (Fast Architecture Sensitive Tree) and its use of SIMD for intra-node search, cache-line-conscious node sizing, and the effect of hardware prefetching on B-tree traversal performance. Explain how persistent memory (Intel Optane) affects B-tree design — the need for 8-byte atomic writes, cache line flush ordering (CLWB + SFENCE), and the WORT (Write Optimal Radix Tree) design.

4. Compare the trade-offs in depth: (a) WAL-based recovery vs shadow paging (copy-on-write with page table swap) — analyze space amplification, recovery time, steady-state write amplification, and interaction with the buffer pool; (b) append-only MVCC vs undo-log MVCC — analyze heap bloat and vacuum overhead vs undo log management and purge overhead, and the impact on index maintenance; (c) latch-based B-trees vs latch-free approaches — analyze throughput under high contention (>64 cores), tail latency from latch convoys, memory management challenges (epoch-based reclamation in latch-free structures), and the engineering complexity trade-off; (d) how modern NVMe SSDs (with 4K page size, ~10us latency, ~1M IOPS) and persistent memory (~300ns latency, byte-addressable) fundamentally change the balance between compute and I/O in all three areas.

Be precise and technical. Include pseudocode for all key algorithm steps.
PROMPT_EOF

read -r -d '' PROMPT_C << 'PROMPT_EOF' || true
You are a networking expert. I need an exhaustive technical explanation covering all of the following topics in a single, cohesive response. Be extremely thorough — for each topic, include the full protocol specification, correctness invariants, failure modes, and performance characteristics.

1. TCP congestion control in depth:
   a. Classic TCP Reno and NewReno: Explain slow start (exponential growth of cwnd until ssthresh), congestion avoidance (additive increase of cwnd by 1 MSS per RTT), fast retransmit (triple duplicate ACK triggers retransmit without waiting for RTO), and fast recovery (NewReno's partial ACK handling that avoids re-entering slow start). Explain the AIMD (Additive Increase Multiplicative Decrease) principle and why it converges to fairness. Derive the TCP throughput equation: throughput ≈ (MSS/RTT) * (1/sqrt(p)) where p is the loss probability.
   b. TCP CUBIC: Explain the cubic function W(t) = C(t-K)^3 + W_max, where K = cbrt(W_max * beta / C), and how it produces concave growth after a loss (fast recovery toward W_max) followed by convex probing (aggressive growth beyond W_max). Explain the TCP-friendly region that ensures CUBIC doesn't starve Reno flows. Explain hystart++ for improved slow-start exit detection using ACK train and delay increase signals.
   c. BBR (Bottleneck Bandwidth and Round-trip propagation time): Explain the four phases — Startup (exponential probing for bandwidth), Drain (reduce inflight to BDP), ProbeBW (steady-state with 1.25x/0.75x gain cycling), and ProbeRTT (periodic cwnd drain to measure minimum RTT). Explain the BBR model: delivery_rate estimation, RTprop tracking with a 10-second window, and the inflight cap at 2*BDP. Explain BBRv2 improvements: loss-aware bandwidth probing, explicit congestion signaling, and the ecn_alpha parameter.
   d. QUIC and multipath: Explain how QUIC implements congestion control per-path, the interaction between stream-level flow control and connection-level flow control, and how 0-RTT resumption affects congestion state. Explain MPQUIC's path scheduling algorithms (round-robin, lowest-RTT, redundant) and how they interact with per-path congestion controllers.

2. Software-defined networking and programmable dataplanes:
   a. OpenFlow and the SDN control plane: Explain the match-action pipeline in OpenFlow switches, the flow table structure (priority, match fields, instructions, counters, timeouts), the role of the controller (reactive vs proactive flow installation), and the consistency challenges when updating distributed flow tables. Explain the Frenetic/NetKAT approach to provably correct network updates using two-phase commit.
   b. P4 and programmable ASICs: Explain the P4 language model — parser, match-action pipeline, deparser — and how it maps to the PISA (Protocol-Independent Switch Architecture) with configurable parser graph, multiple match-action stages, and stateful ALUs. Explain P4Runtime for control-plane interaction. Explain the constraints of hardware targets: limited stages, TCAM width, stateful memory per stage, and recirculation as an escape hatch.
   c. eBPF/XDP for programmable host networking: Explain the eBPF verifier (bounded loops, memory safety, helper function interface), the XDP hook point (before sk_buff allocation for zero-copy fast path), TC hook (after sk_buff for full protocol access), and the map abstraction for state sharing between eBPF programs and userspace. Explain Cilium's use of eBPF for Kubernetes networking: per-pod policy enforcement, service load balancing via BPF_MAP_TYPE_LRU_HASH, and transparent encryption using IPsec or WireGuard in eBPF.

3. Modern load balancing at scale:
   a. L4 load balancing: Explain Maglev's consistent hashing (the lookup table construction algorithm, disruption score minimization, and connection draining on backend changes). Explain ECMP-based DSR (Direct Server Return) where the load balancer only sees the SYN and the backend responds directly. Explain the interaction with TCP connection tracking and the need for consistent hashing to handle asymmetric routing.
   b. L7 load balancing and service mesh: Explain Envoy's architecture — the listener/filter chain model, the HCM (HTTP Connection Manager), route tables, cluster managers, and the xDS API (LDS, RDS, CDS, EDS, SDS) for dynamic configuration. Explain the ext_proc filter and how it enables external processing (as used by Gateway API Inference Extension). Explain the circuit breaking, outlier detection, and retry budget mechanisms.

4. Compare: (a) loss-based vs delay-based vs model-based congestion control under bufferbloat, (b) hardware vs software dataplanes for latency-sensitive workloads, (c) L4 vs L7 load balancing for long-lived streaming connections like LLM inference.

Be precise and technical. Include pseudocode for all key algorithm steps.
PROMPT_EOF

read -r -d '' PROMPT_D << 'PROMPT_EOF' || true
You are an operating systems expert. I need an exhaustive technical explanation covering all of the following topics in a single, cohesive response. Be extremely thorough — for each topic, include the full algorithm specification, correctness invariants, failure modes, and performance characteristics.

1. Virtual memory and page table management:
   a. Multi-level page tables: Explain the 4-level (PGD, PUD, PMD, PTE) and 5-level page table structures used in x86-64 Linux. Explain the trade-offs between page table depth and memory overhead. Explain huge pages (2MB and 1GB) and transparent huge pages (THP) — the khugepaged kernel thread, compaction, and the split/collapse lifecycle. Explain the performance implications: TLB coverage (a single 2MB TLB entry covers 512x more memory than a 4KB entry), page walk cost reduction, and the defragmentation overhead.
   b. TLB management: Explain the TLB hierarchy (L1 iTLB, L1 dTLB, L2 STLB), TLB shootdown via IPI (inter-processor interrupt) for maintaining coherence across cores, and the PCID (Process Context ID) optimization that avoids full TLB flushes on context switch. Explain ASID (Address Space ID) on ARM64 and how it differs from PCID. Explain the performance cost of TLB shootdowns in NUMA systems where IPI latency crosses socket boundaries.
   c. Memory-mapped I/O and page fault handling: Explain the Linux page fault path — do_page_fault, handle_mm_fault, the distinction between minor faults (page in page cache, just needs PTE update) and major faults (page must be read from disk). Explain demand paging, copy-on-write (COW) fork semantics, and the userfaultfd mechanism for userspace page fault handling (used by live migration and garbage collectors).
   d. IOMMU and device memory: Explain how the IOMMU (VT-d on Intel, AMD-Vi) provides DMA remapping for device isolation, the IOMMU page table structure, and the VFIO framework for safe device passthrough to VMs and containers. Explain the interaction between IOMMU and GPU memory management (unified virtual addressing, page migration between CPU and GPU).

2. Process scheduling on modern hardware:
   a. CFS (Completely Fair Scheduler): Explain the red-black tree of virtual runtime (vruntime), the calculation of time slices from task weight and sched_latency, the pick_next_task algorithm, and the sleeper fairness adjustment. Explain the bandwidth controller for CFS (cfs_bandwidth: quota, period, hierarchical enforcement) and how it interacts with container cgroups.
   b. EEVDF (Earliest Eligible Virtual Deadline First): Explain the recent Linux replacement for CFS — the virtual deadline calculation (vd = ve + (request/weight)), the eligibility check (ve ≤ V where V is the server virtual time), and why EEVDF provides better latency guarantees than CFS for interactive workloads. Explain the lag metric and how it prevents starvation.
   c. Real-time scheduling: Explain SCHED_FIFO, SCHED_DEADLINE (CBS: Constant Bandwidth Server with (runtime, deadline, period) parameters), and the admission control test (sum of runtime_i/period_i ≤ total CPU capacity). Explain priority inversion and the priority inheritance protocol (PI mutex). Explain the PREEMPT_RT patch set and its approach to making all spinlocks preemptible.
   d. NUMA-aware scheduling: Explain the NUMA balancing algorithm — periodic page scanning via the NUMA hinting fault mechanism (temporarily unmapping pages to detect access patterns), the automatic NUMA page migration policy, and the task placement heuristics that try to co-locate tasks with their memory. Explain the challenges with memory-intensive workloads where migration overhead exceeds the NUMA locality benefit.

3. File systems and storage stack:
   a. Ext4 journaling: Explain the JBD2 (Journaling Block Device 2) layer — the three journaling modes (journal, ordered, writeback), the transaction lifecycle (running → committing → committed → checkpoint), and the journal recovery procedure. Explain delayed allocation and how it interacts with the journal.
   b. Btrfs copy-on-write: Explain the B-tree structure (metadata trees, extent trees, checksum trees), the COW mechanism for both metadata and data, snapshots as cheap tree clones (sharing all blocks, diverging on write), and the balance/scrub/defrag maintenance operations. Explain the RAID implementation (RAID1/5/6 at the filesystem level, stripe tree for RAID5/6) and the known write hole problem in RAID5.
   c. io_uring: Explain the submission queue (SQ) and completion queue (CQ) ring buffer design, the io_uring_enter syscall, SQPOLL mode for busy-polling without syscalls, and fixed file/buffer registration for zero-copy I/O. Explain the performance comparison with libaio and synchronous I/O for NVMe devices at queue depth 1 and queue depth 128.

4. Compare: (a) 4KB vs huge pages for database workloads (TLB miss rate vs memory waste), (b) CFS vs EEVDF for latency-sensitive containers, (c) ext4 vs btrfs for container overlay filesystems (performance, snapshot cost, stability).

Be precise and technical. Include pseudocode for all key algorithm steps.
PROMPT_EOF

# Random nonce prepended to each prompt so re-runs see a fresh prefix.
# MUST be at the START of the prompt — prefix caching keys on the prompt
# prefix, so a trailing nonce only invalidates the last block(s) and lets
# a previous run's cache make subsequent "cold" requests look like hits.
PROMPTS=()
for i in $(seq 0 $((NUM_PROMPTS - 1))); do
  name="${PROMPT_NAMES[$i]}"
  base_var="PROMPT_${name}"
  nonce="session-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  PROMPTS+=("[Session nonce: ${nonce}]

${!base_var}")
done

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# ── Phase 1: cold (concurrent) ───────────────────────────────────────
echo
echo "==> Phase 1: sending $NUM_PROMPTS cold request(s) concurrently..."
if [[ $KUBE_MODE -eq 1 ]]; then
  for w in $WORKERS; do get_prompt_tokens "$w" > "$TMPDIR/batch1.before.$w"; done
fi

for i in $(seq 0 $((NUM_PROMPTS - 1))); do
  fire_request "${PROMPT_NAMES[$i]}1" "${PROMPTS[$i]}" "$TMPDIR" &
done
wait

for i in $(seq 0 $((NUM_PROMPTS - 1))); do
  lbl="${PROMPT_NAMES[$i]}1"
  printf "    %s latency: %ss\n" "$lbl" "$(cat "$TMPDIR/$lbl.latency")"
done

if [[ $KUBE_MODE -eq 1 ]]; then
  sleep 1
  echo
  echo "    Worker token deltas from cold batch:"
  for w in $WORKERS; do
    before=$(cat "$TMPDIR/batch1.before.$w")
    after=$(get_prompt_tokens "$w")
    delta=$(echo "$after - $before" | bc 2>/dev/null || echo "0")
    printf "      [%s] +%s tokens\n" "$w" "$delta"
  done
fi

# ── Phase 2: warm (sequential) ──────────────────────────────────────
echo
echo "==> Phase 2: sending warm requests sequentially..."
for i in $(seq 0 $((NUM_PROMPTS - 1))); do
  send_request "${PROMPT_NAMES[$i]}2" "${PROMPTS[$i]}" "$TMPDIR"
done

# Attribute cold to same pod as warm (KV router picks same worker for same prompt).
if [[ $KUBE_MODE -eq 1 ]]; then
  for i in $(seq 0 $((NUM_PROMPTS - 1))); do
    n="${PROMPT_NAMES[$i]}"
    cp "$TMPDIR/${n}2.pod" "$TMPDIR/${n}1.pod"
  done
fi

# ── Wait for vLLM to flush cumulative prefix-cache-hit log line (Kube only) ──
if [[ $KUBE_MODE -eq 1 ]]; then
  echo
  echo "==> Waiting for worker metrics to flush (up to 20s)..."
  for _ in $(seq 1 20); do
    seen=0
    for w in $WORKERS; do
      if kubectl logs -n "$KUBE_NAMESPACE" "$w" --since-time="$SINCE" 2>/dev/null \
           | grep -q 'Prefix cache hit rate'; then
        seen=1; break
      fi
    done
    [[ $seen -eq 1 ]] && break
    sleep 1
  done
fi

# ── Report ──────────────────────────────────────────────────────────
echo
echo "========================================================================"
echo "  KV / prefix cache test results"
echo "========================================================================"

# Header
if [[ $KUBE_MODE -eq 1 ]]; then
  printf "  %-4s  %-9s  %-9s  %-9s  %-9s  %s\n" \
    "req" "latency" "prompt" "cached" "hit%" "pod"
else
  printf "  %-4s  %-9s  %-9s  %-9s  %s\n" \
    "req" "latency" "prompt" "cached" "hit%"
fi

total_cached=0
total_prompt=0
sum_speedup="0"
families=0

for i in $(seq 0 $((NUM_PROMPTS - 1))); do
  n="${PROMPT_NAMES[$i]}"
  for round in 1 2; do
    lbl="${n}${round}"
    body="$TMPDIR/$lbl.body"
    lat=$(cat "$TMPDIR/$lbl.latency" 2>/dev/null || echo "?")
    p_tok=$(field "$body" '.usage.prompt_tokens')
    c_tok=$(field "$body" '.usage.prompt_tokens_details.cached_tokens')
    if [[ "$p_tok" =~ ^[0-9]+$ && "$p_tok" -gt 0 ]]; then
      hit=$(echo "scale=1; $c_tok * 100 / $p_tok" | bc 2>/dev/null || echo "0")
    else
      hit="?"
    fi
    if [[ $KUBE_MODE -eq 1 ]]; then
      pod=$(cat "$TMPDIR/$lbl.pod" 2>/dev/null || echo "?")
      printf "  %-4s  %-9s  %-9s  %-9s  %-9s  %s\n" \
        "$lbl" "${lat}s" "$p_tok" "$c_tok" "${hit}%" "$pod"
    else
      printf "  %-4s  %-9s  %-9s  %-9s  %s\n" \
        "$lbl" "${lat}s" "$p_tok" "$c_tok" "${hit}%"
    fi
    if [[ "$round" == "2" ]]; then
      total_cached=$(echo "$total_cached + $c_tok" | bc)
      total_prompt=$(echo "$total_prompt + $p_tok" | bc)
    fi
  done
  # Speedup A1 vs A2
  l1=$(cat "$TMPDIR/${n}1.latency" 2>/dev/null || echo "0")
  l2=$(cat "$TMPDIR/${n}2.latency" 2>/dev/null || echo "0")
  if [[ "$l2" != "0" ]]; then
    speedup=$(echo "scale=2; $l1 / $l2" | bc 2>/dev/null || echo "0")
    sum_speedup=$(echo "$sum_speedup + $speedup" | bc)
    families=$((families + 1))
  fi
done

echo
echo "  Aggregate (warm requests):"
if [[ "$total_prompt" != "0" ]]; then
  agg_hit=$(echo "scale=1; $total_cached * 100 / $total_prompt" | bc)
  printf "    cached / prompt:  %s / %s  (%s%%)\n" "$total_cached" "$total_prompt" "$agg_hit"
fi
if [[ "$families" -gt 0 ]]; then
  avg_speedup=$(echo "scale=2; $sum_speedup / $families" | bc)
  printf "    avg cold/warm speedup:  %sx\n" "$avg_speedup"
fi

if [[ $KUBE_MODE -eq 1 ]]; then
  echo
  echo "  Worker prefix cache hit rates since $SINCE:"
  for w in $WORKERS; do
    hit=$(kubectl logs -n "$KUBE_NAMESPACE" "$w" --since-time="$SINCE" 2>/dev/null \
            | grep -oE 'Prefix cache hit rate: [0-9.]+%' | tail -1 || true)
    printf "    [%s] %s\n" "$w" "${hit:-(no metrics flushed yet)}"
  done
fi

echo "========================================================================"
echo
echo "Notes:"
echo "  - 'cached' is usage.prompt_tokens_details.cached_tokens from the"
echo "    response body; servers that don't populate this field show 0."
echo "    A high warm 'hit%' alongside a >1x speedup is the strongest signal."
echo "  - For meaningful KV-aware *routing* numbers (vs single-pod caching),"
echo "    run against an endpoint with ≥2 worker replicas."
