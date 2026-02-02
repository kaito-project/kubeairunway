# KubeFoundry Unified CRD Abstraction

## Design Document

**Status:** Draft
**Author:** Sertac Ozercan
**Date:** January 2026
**Last Updated:** February 2, 2026

---

## 1. Executive Summary

This document proposes the introduction of a unified KubeFoundry Custom Resource Definition (CRD) that abstracts the underlying inference providers (KAITO, Dynamo, KubeRay). Users will deploy a `ModelDeployment` custom resource, and a KubeFoundry controller will reconcile this into the appropriate provider-specific resources.

### Goals
- Provide a single, unified API for deploying LLM inference workloads
- Abstract provider-specific complexity from end users
- Enable provider migration without changing the user-facing resource
- Centralize status aggregation and lifecycle management
- Support future provider additions without user-facing API changes

### Non-Goals
- Replacing provider-specific CRDs (they will still exist)
- Supporting all possible provider-specific features in the unified API
- Auto-migration between providers (manual trigger only)
- Performance-based autoscaling (HPA/KEDA replica scaling - deferred to future version)
- Adopting existing provider resources
- Multi-model serving (LoRA adapters)

---

## 2. Behavior Changes

> **Important:** This section documents significant changes from previous KubeFoundry behavior.

### 2.1 Controller Required

KubeFoundry now requires the controller to be installed in the cluster before deployments can be created.

**Before:**
- `kubefoundry` binary generated and applied provider manifests directly
- Worked immediately with just kubeconfig access

**After:**
- `kubefoundry` binary creates `ModelDeployment` CRDs
- Controller (running in-cluster) reconciles CRDs into provider resources
- Must run `kubefoundry controller install` before first use

**Option A: Using the CLI**
```bash
$ kubefoundry controller install
Installing kubefoundry-controller...
  - CRDs: ModelDeployment
  - Deployment: kubefoundry-controller
  - RBAC: ServiceAccount, ClusterRole, ClusterRoleBinding
Done. Controller running in namespace kubefoundry-system.

$ kubefoundry start
Starting UI at http://localhost:3000
```

**Option B: Using kubectl directly**
```bash
# One-command install
kubectl apply -f https://raw.githubusercontent.com/kubefoundry/kubefoundry/main/manifests/install.yaml

# Or with kustomize for customization
kubectl apply -k https://github.com/kubefoundry/kubefoundry/manifests
```

**Upgrading the controller:**
```bash
# Option A: CLI
$ kubefoundry controller upgrade

# Option B: kubectl (re-apply latest manifests)
kubectl apply -f https://raw.githubusercontent.com/kubefoundry/kubefoundry/main/manifests/install.yaml
```

If controller isn't installed:
```bash
$ kubefoundry start
Error: kubefoundry-controller not found in cluster.
Run 'kubefoundry controller install' first.
```

### 2.2 TypeScript Binary Role Change

| Function                    | Before                       | After                                                     |
| --------------------------- | ---------------------------- | --------------------------------------------------------- |
| Generate provider manifests | Yes                          | No (controller does this)                                 |
| Apply provider CRDs         | Yes                          | No (controller does this)                                 |
| Parse provider status       | Yes                          | No (reads ModelDeployment.status)                         |
| Web UI                      | Yes                          | Yes (unchanged)                                           |
| Create deployments          | Direct to provider           | Creates ModelDeployment CRD                               |
| Install controller          | Applies controller manifests | Applies controller manifests (also available via kubectl) |

### 2.3 Manifest Generation Location

All manifest generation logic moves from TypeScript to the Go controller. The TypeScript codebase no longer contains provider-specific manifest templates.

### 2.4 KubeRay Requires Explicit Selection

KubeRay is never auto-selected by the provider selection algorithm. Users must explicitly specify `provider.name: kuberay` to use it.

**Rationale:**
- KubeRay's primary differentiator is autoscaling via Ray Serve, which is out of scope for v1alpha1
- KubeRay requires more setup knowledge and Ray-specific configuration
- Auto-selecting KubeRay could confuse users who aren't familiar with Ray

**Usage:**
```yaml
spec:
  provider:
    name: kuberay  # Must be explicit - will not be auto-selected
```

---

## 3. Architecture

### 3.1 System Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     User's Machine                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              kubefoundry binary (TypeScript)                │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │ │
│  │  │   Web UI     │  │   CLI        │  │ Controller       │  │ │
│  │  │              │  │   Commands   │  │ Installer        │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │ │
│  └────────────────────────────┬────────────────────────────────┘ │
└───────────────────────────────┼──────────────────────────────────┘
                                │ kubeconfig
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│                         K8s Cluster                                │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              kubefoundry-controller (Go)                     │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │  │
│  │  │ Reconciler   │  │  Manifest    │  │ Status           │   │  │
│  │  │              │  │  Generators  │  │ Aggregation      │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ ModelDeployment │  │ Provider CRDs   │  │ Pods/Services   │   │
│  │ CRDs            │  │ (Dynamo/KAITO)  │  │                 │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
User Config → ModelDeployment CRD → KubeFoundry Controller → Provider CRD → Provider Operator → Pods/Services
                     ↓
              Status Aggregation
```

### 3.3 Existing Providers

| Provider | CRD                     | API Group             | Primary Use Case                      |
| -------- | ----------------------- | --------------------- | ------------------------------------- |
| KAITO    | `Workspace`             | `kaito.sh/v1beta1`    | CPU/GPU flexible with GGUF, vLLM      |
| Dynamo   | `DynamoGraphDeployment` | `nvidia.com/v1alpha1` | High-perf GPU with vLLM/sglang/trtllm |
| KubeRay  | `RayService`            | `ray.io/v1`           | Scalable serving with Ray Serve       |

---

## 4. Detailed Design

### 4.1 ModelDeployment CRD

```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: my-llm
  namespace: default
  annotations:
    # Optional: pause reconciliation for debugging
    kubefoundry.ai/reconcile-paused: "false"
spec:
  # Model specification (required)
  model:
    id: "meta-llama/Llama-3.1-8B-Instruct"  # HuggingFace model ID (or path for custom)
    servedName: "llama-3.1-8b"               # API-facing model name (optional, defaults to model ID basename)
    source: "huggingface"                    # huggingface | custom (pre-loaded in image)

  # Provider selection (optional - auto-selected if not specified)
  provider:
    name: "dynamo"                           # dynamo | kaito | kuberay
    # Provider-specific overrides (optional escape hatch, see Section 4.15)
    overrides: {}
      # Dynamo example:
      # routerMode: "kv"
      # frontend: { replicas: 2, resources: { cpu: "4", memory: "8Gi" } }
      #
      # KubeRay example:
      # head: { resources: { cpu: "4", memory: "8Gi" }, rayStartParams: { "num-cpus": "0" } }

  # Inference engine configuration
  engine:
    type: "vllm"                             # vllm | sglang | trtllm | llamacpp

    # Universal options (apply to all engines, mapped to engine-specific flags)
    contextLength: 8192                      # vllm: --max-model-len, sglang: --context-length, llamacpp: --ctx-size

    # HuggingFace-specific (vllm, sglang only - N/A for llamacpp/gguf)
    trustRemoteCode: false

    # Engine-specific options (use args for full control)
    # Schema: map[string]string - all values are strings
    # These are passed directly to the engine and vary by type:
    #   vllm:    --enforce-eager, --enable-prefix-caching, --gpu-memory-utilization, --quantization
    #   sglang:  --disable-cuda-graph, --disable-radix-cache, --mem-fraction-static, --quantization
    #   trtllm:  enable_block_reuse, kv_cache_config
    #   llamacpp: --cache-type-k, --cache-type-v, --ctx-size
    args: {}  # e.g., { "quantization": "awq", "gpu-memory-utilization": "0.9" }

  # Serving mode
  serving:
    mode: "aggregated"                       # aggregated | disaggregated
    # Note: routerMode moved to provider.overrides (Dynamo-specific)

  # Scaling configuration
  scaling:
    replicas: 1                              # For aggregated mode
    # For disaggregated mode (spec.resources not allowed, use per-component)
    # Note: Frontend/head component uses controller defaults; customize via provider.overrides
    prefill:
      replicas: 1
      gpus: 1
      memory: "64Gi"                         # Required for disaggregated
    decode:
      replicas: 1
      gpus: 1
      memory: "64Gi"                         # Required for disaggregated

  # Resource requirements (GPU inferred from gpu.count > 0)
  resources:
    gpu:
      count: 1
      # Optional: GPU resource name (defaults to nvidia.com/gpu, override for AMD/Intel)
      type: "nvidia.com/gpu"
    memory: "32Gi"
    cpu: "4"

  # Container customization
  image: ""                                  # Optional: custom container image
  env: []                                    # Optional: environment variables
    # - name: VLLM_LOGGING_LEVEL
    #   value: DEBUG

  # Pod metadata propagation
  podTemplate:
    metadata:
      labels: {}                             # Labels for created pods
      annotations: {}                        # Annotations for created pods

  # Secrets
  secrets:
    huggingFaceToken: "hf-token-secret"      # K8s secret name

  # Optional: Node targeting
  nodeSelector: {}
  tolerations: []

status:
  # Unified status
  phase: "Running"                           # Pending | Deploying | Running | Failed | Terminating
  message: "Deployment is healthy"           # Extracted from provider status

  # Provider information
  provider:
    name: "dynamo"
    resourceName: "my-llm"
    resourceKind: "DynamoGraphDeployment"
    selectedReason: "default → dynamo (GPU inference default)"  # Explains auto-selection

  # Replica status
  replicas:
    desired: 1
    ready: 1
    available: 1

  # Service endpoint
  endpoint:
    service: "my-llm-frontend"
    port: 8000

  # Conditions (Kubernetes-style)
  conditions:
    - type: "Ready"
      status: "True"
      lastTransitionTime: "2026-01-30T10:00:00Z"
      reason: "DeploymentReady"
      message: "All replicas are ready"
    - type: "ProviderResourceCreated"
      status: "True"
      lastTransitionTime: "2026-01-30T09:55:00Z"
      reason: "ResourceCreated"
      message: "DynamoGraphDeployment created successfully"

  # Observed generation for controller
  observedGeneration: 1
```

### 4.2 Example Transformations

This section shows how `ModelDeployment` resources are transformed into provider-specific CRDs.

#### Example 1: GPU Deployment → Dynamo (Auto-selected)

**ModelDeployment (user creates):**
```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: llama-8b
  namespace: default
spec:
  model:
    id: "meta-llama/Llama-3.1-8B-Instruct"
    source: "huggingface"
  engine:
    type: "vllm"
    contextLength: 8192
  serving:
    mode: "aggregated"
  scaling:
    replicas: 1
  resources:
    gpu:
      count: 1
    memory: "32Gi"
  secrets:
    huggingFaceToken: "hf-token"
```

**DynamoGraphDeployment (controller creates):**
```yaml
apiVersion: nvidia.com/v1alpha1
kind: DynamoGraphDeployment
metadata:
  name: llama-8b
  namespace: default
  ownerReferences:
    - apiVersion: kubefoundry.ai/v1alpha1
      kind: ModelDeployment
      name: llama-8b
      controller: true
spec:
  backendFramework: vllm
  services:
    Frontend:
      componentType: frontend
      dynamoNamespace: llama-8b
      replicas: 1
      envFromSecret: hf-token
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
    VllmWorker:
      componentType: worker
      dynamoNamespace: llama-8b
      replicas: 1
      envFromSecret: hf-token
      resources:
        limits:
          gpu: "1"
          memory: "32Gi"
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
          command: ["/bin/sh", "-c"]
          args: ["python3 -m dynamo.vllm --model meta-llama/Llama-3.1-8B-Instruct --max-model-len 8192"]
```

**Status after reconciliation:**
```yaml
status:
  phase: "Running"
  provider:
    name: "dynamo"
    resourceName: "llama-8b"
    resourceKind: "DynamoGraphDeployment"
    selectedReason: "default → dynamo (GPU inference default)"
  endpoint:
    service: "llama-8b-frontend"
    port: 8000
```

#### Example 2: CPU Deployment (GGUF) → KAITO (Auto-selected)

**ModelDeployment (user creates):**
```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: gemma-cpu
  namespace: default
spec:
  model:
    id: "google/gemma-3-1b-it-qat-q8_0-gguf"
    source: "huggingface"
  engine:
    type: "llamacpp"
  serving:
    mode: "aggregated"
  scaling:
    replicas: 1
  resources:
    gpu:
      count: 0  # No GPU - triggers KAITO selection
    memory: "16Gi"
    cpu: "8"
  image: "ghcr.io/sozercan/llama-cpp-runner:latest"
```

**Workspace (controller creates):**
```yaml
apiVersion: kaito.sh/v1beta1
kind: Workspace
metadata:
  name: gemma-cpu
  namespace: default
  ownerReferences:
    - apiVersion: kubefoundry.ai/v1alpha1
      kind: ModelDeployment
      name: gemma-cpu
      controller: true
  labels:
    kubefoundry.ai/model-source: huggingface
resource:
  count: 1
  labelSelector:
    matchLabels:
      kubernetes.io/os: linux
inference:
  template:
    spec:
      containers:
        - name: model
          image: ghcr.io/sozercan/llama-cpp-runner:latest
          args: ["huggingface://google/gemma-3-1b-it-qat-q8_0-gguf/gemma-3-1b-it-q8_0.gguf", "--address=:5000"]
          ports:
            - containerPort: 5000
          resources:
            requests:
              memory: "16Gi"
              cpu: "8"
```

**Status after reconciliation:**
```yaml
status:
  phase: "Running"
  provider:
    name: "kaito"
    resourceName: "gemma-cpu"
    resourceKind: "Workspace"
    selectedReason: "no GPU requested → kaito (only CPU provider)"
  endpoint:
    service: "gemma-cpu"
    port: 80
```

#### Example 3: Disaggregated P/D with KV Routing → Dynamo

**ModelDeployment (user creates):**
```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: llama-70b-pd
  namespace: default
spec:
  model:
    id: "meta-llama/Llama-3.1-70B-Instruct"
    source: "huggingface"
  provider:
    name: "dynamo"
    overrides:
      routerMode: "kv"                    # KV cache routing (Dynamo-specific)
      frontend:                           # Optional: customize router (uses defaults if omitted)
        replicas: 2
        resources:
          cpu: "4"
          memory: "8Gi"
  engine:
    type: "vllm"
  serving:
    mode: "disaggregated"
  scaling:
    # Frontend/head not specified here - configured via provider.overrides or uses defaults
    prefill:
      replicas: 2
      gpus: 4
      memory: "128Gi"
    decode:
      replicas: 4
      gpus: 2
      memory: "64Gi"
  # Note: spec.resources is not allowed in disaggregated mode
  secrets:
    huggingFaceToken: "hf-token"
```

**DynamoGraphDeployment (controller creates):**
```yaml
apiVersion: nvidia.com/v1alpha1
kind: DynamoGraphDeployment
metadata:
  name: llama-70b-pd
  namespace: default
  ownerReferences:
    - apiVersion: kubefoundry.ai/v1alpha1
      kind: ModelDeployment
      name: llama-70b-pd
      controller: true
spec:
  backendFramework: vllm
  services:
    Frontend:
      componentType: frontend
      dynamoNamespace: llama-70b-pd
      replicas: 2                          # From overrides.frontend.replicas
      router-mode: kv                      # From overrides.routerMode
      envFromSecret: hf-token
      resources:
        requests:
          cpu: "4"                         # From overrides.frontend.resources.cpu
          memory: "8Gi"                    # From overrides.frontend.resources.memory
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
    VllmPrefillWorker:
      componentType: worker
      subComponentType: prefill
      dynamoNamespace: llama-70b-pd
      replicas: 2
      envFromSecret: hf-token
      resources:
        limits:
          gpu: "4"
          memory: "128Gi"  # From scaling.prefill.memory
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
          command: ["/bin/sh", "-c"]
          args: ["python3 -m dynamo.vllm --model meta-llama/Llama-3.1-70B-Instruct --is-prefill-worker"]
    VllmDecodeWorker:
      componentType: worker
      subComponentType: decode
      dynamoNamespace: llama-70b-pd
      replicas: 4
      envFromSecret: hf-token
      resources:
        limits:
          gpu: "2"
          memory: "64Gi"   # From scaling.decode.memory
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
          command: ["/bin/sh", "-c"]
          args: ["python3 -m dynamo.vllm --model meta-llama/Llama-3.1-70B-Instruct"]
```

**Status after reconciliation:**
```yaml
status:
  phase: "Running"
  provider:
    name: "dynamo"
    resourceName: "llama-70b-pd"
    resourceKind: "DynamoGraphDeployment"
    selectedReason: "explicit provider selection"
  replicas:
    desired: 6  # 2 prefill + 4 decode
    ready: 6
  endpoint:
    service: "llama-70b-pd-frontend"
    port: 8000
```

### 4.3 Controller Reconciliation Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                    Reconciliation Loop                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Receive ModelDeployment event                               │
│                      │                                          │
│                      ▼                                          │
│  2. Check for pause annotation                                  │
│     - If kubefoundry.ai/reconcile-paused: "true", skip         │
│                      │                                          │
│                      ▼                                          │
│  3. Validate spec against schema (webhook)                      │
│     - Check model ID format                                     │
│     - Validate engine/provider compatibility                    │
│     - Check resource requirements                               │
│                      │                                          │
│                      ▼                                          │
│  4. Select/validate provider                                    │
│     - If explicit: use specified provider                       │
│     - If auto: run selection algorithm                          │
│     - Record selectedReason in status                           │
│                      │                                          │
│                      ▼                                          │
│  5. Detect installed provider CRD version                       │
│     - Query API for available versions                          │
│     - Generate manifest for detected version                    │
│                      │                                          │
│                      ▼                                          │
│  6. Generate provider-specific manifest                         │
│     - Transform unified spec to provider format                 │
│     - Apply provider overrides if specified                     │
│     - Set owner reference to ModelDeployment                    │
│                      │                                          │
│                      ▼                                          │
│  7. Create/Update provider resource                             │
│     - Apply manifest to cluster                                 │
│     - Handle conflicts/updates                                  │
│     - Reconcile drift (overwrite direct edits)                  │
│                      │                                          │
│                      ▼                                          │
│  8. Watch provider resource status                              │
│     - Extract meaningful error messages                         │
│     - Map provider status to unified status                     │
│     - Update ModelDeployment.status                             │
│                      │                                          │
│                      ▼                                          │
│  9. Handle deletion (finalizers)                                │
│     - Delete provider resource                                  │
│     - Wait for cleanup (with timeout)                           │
│     - Remove finalizer after 5-10 min timeout if stuck          │
│     - Emit warning event if force-removed                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 Provider Selection Algorithm

The controller auto-selects a provider when `spec.provider.name` is omitted.

**GPU default behavior:** If `resources.gpu` is omitted entirely, it is treated as `gpu.count: 0` (CPU-only), which selects KAITO.

```
IF gpu.count == 0 OR resources.gpu is omitted:
    return KAITO
    reason: "no GPU requested → kaito (only CPU provider)"

IF engine == "trtllm" OR engine == "sglang":
    return Dynamo
    reason: "engine={engine} → dynamo (only {engine} provider)"

IF engine == "llamacpp":
    return KAITO
    reason: "engine=llamacpp → kaito (only llamacpp provider)"

IF mode == "disaggregated":
    return Dynamo
    reason: "mode=disaggregated → dynamo (best disaggregated support)"

DEFAULT:
    return Dynamo
    reason: "default → dynamo (GPU inference default)"
```

**Note:** KubeRay is never auto-selected. Users must explicitly specify `provider.name: kuberay` to use it.

### 4.5 Provider Capability Matrix

| Criteria                   | KAITO   | Dynamo        | KubeRay                     |
| -------------------------- | ------- | ------------- | --------------------------- |
| CPU inference              | **Yes** | No            | No                          |
| GPU inference              | Yes     | **Yes**       | Yes                         |
| vLLM engine                | Yes     | **Yes**       | Yes                         |
| sglang engine              | No      | **Yes**       | No                          |
| trtllm engine              | No      | **Yes**       | No                          |
| llamacpp engine            | **Yes** | No            | No                          |
| GGUF models                | **Yes** | No            | No                          |
| Disaggregated P/D          | No      | **Yes**       | Yes                         |
| KV routing (via overrides) | No      | **Yes**       | Yes (via RayService config) |
| Auto-selection             | Yes     | Yes (default) | No (explicit only)          |

### 4.6 Drift Detection and Reconciliation

The controller enforces the ModelDeployment spec on the provider resource.

**Default behavior:** If someone directly edits the provider resource (e.g., `kubectl edit dynamographdeployment my-llm`), the controller will overwrite those changes on the next reconciliation.

**Pause annotation:** To temporarily disable reconciliation for debugging:
```yaml
metadata:
  annotations:
    kubefoundry.ai/reconcile-paused: "true"
```

### 4.7 Finalizer Handling

The controller uses finalizers to ensure cleanup. If the provider operator is unavailable:

1. Controller attempts cleanup for 5-10 minutes
2. After timeout, controller removes finalizer with warning event
3. Orphaned provider resources may remain (logged for manual cleanup)

**Manual escape (immediate):**
```bash
kubectl patch modeldeployment my-llm --type=merge \
  -p '{"metadata":{"finalizers":[]}}'
```

### 4.8 Owner References and Garbage Collection

The KubeFoundry controller sets `ownerReferences` on created provider resources:

```yaml
# Provider resource (e.g., DynamoGraphDeployment)
metadata:
  ownerReferences:
    - apiVersion: kubefoundry.ai/v1alpha1
      kind: ModelDeployment
      name: my-llm
      uid: abc-123
      controller: true
      blockOwnerDeletion: true
```

This ensures:
- Deleting `ModelDeployment` automatically deletes the provider resource
- Provider resources cannot be accidentally orphaned
- Clear ownership hierarchy in the cluster

### 4.9 Status Mapping

The controller extracts meaningful error messages from provider status.

| Provider | Provider Status            | Unified Phase | Message Extraction           |
| -------- | -------------------------- | ------------- | ---------------------------- |
| KAITO    | `WorkspaceSucceeded: True` | Running       | -                            |
| KAITO    | `InferenceReady: False`    | Deploying     | Extract condition message    |
| KAITO    | Error condition            | Failed        | Extract error from condition |
| Dynamo   | `state: successful`        | Running       | -                            |
| Dynamo   | `state: deploying`         | Deploying     | -                            |
| Dynamo   | `state: failed`            | Failed        | Extract from status.message  |
| KubeRay  | `serviceStatus: Running`   | Running       | -                            |
| KubeRay  | `serviceStatus: Pending`   | Pending       | -                            |
| KubeRay  | `serviceStatus: Failed`    | Failed        | Extract from serveStatuses   |

### 4.10 Dynamic CRD Version Detection

The controller dynamically detects installed provider CRD versions:

1. On startup and periodically, query the Kubernetes API for available CRDs
2. For each provider, determine the installed version (e.g., `kaito.sh/v1beta1` vs `kaito.sh/v1`)
3. Generate manifests targeting the detected version
4. Log warnings if expected CRDs are missing

This prevents breakage when providers release new CRD versions.

### 4.11 Update Semantics

When a user updates a `ModelDeployment` spec, the controller handles changes based on field type:

**Identity fields (trigger delete + recreate):**
- `model.id` - Changing the model fundamentally changes the deployment
- `engine.type` - Changing inference engine requires new containers
- `provider.name` - Changing provider requires different resource type

> **Warning:** Changing identity fields causes brief downtime as the provider resource is deleted and recreated. In-flight requests will fail during this window.

**Config fields (in-place update):**
- `scaling.replicas` - Can be updated without recreation
- `env` - Environment variable changes
- `resources` - Memory/CPU adjustments
- `engine.args` - Engine parameter tuning
- `nodeSelector`, `tolerations` - Scheduling constraints

The controller patches the provider resource in place for config field changes. If the provider operator rejects an update (e.g., due to its own immutable field constraints), the error is surfaced in `ModelDeployment.status`.

### 4.12 Label Propagation

Labels from `ModelDeployment.metadata.labels` are selectively propagated:

- **To provider resource:** Only labels with `kubefoundry.ai/` prefix are copied
- **To pods:** Use `spec.podTemplate.metadata.labels` for pod-level labels
- **Controller-managed:** The controller always adds `kubefoundry.ai/managed-by: kubefoundry`

This prevents accidental conflicts with provider-managed labels while allowing KubeFoundry-specific labels to flow through.

### 4.13 Secret Handling

The `secrets.huggingFaceToken` field accepts a Kubernetes secret name (string). The controller passes this to provider resources using `envFromSecret`, which injects all keys from the secret as environment variables.

```yaml
secrets:
  huggingFaceToken: "my-hf-secret"  # Secret name only (not secretKeyRef)
```

Users should create secrets with the keys expected by the runtime (e.g., `HF_TOKEN`).

### 4.14 Endpoint Access

The controller creates ClusterIP services only. Users are responsible for external access:

```yaml
status:
  endpoint:
    service: "my-llm-frontend"  # ClusterIP service
    port: 8000
```

**Accessing the endpoint:**
- **Local development:** `kubectl port-forward svc/my-llm-frontend 8000:8000`
- **Production:** Create Ingress, Gateway, or LoadBalancer service separately

LoadBalancer/Ingress configuration is deferred to future versions to keep the initial scope focused.

### 4.15 Provider Overrides Reference

The `provider.overrides` field is an untyped `map[string]interface{}` that allows provider-specific configuration. The controller interprets known keys at runtime.

**Schema:** `map[string]interface{}` (flexible, no compile-time validation)

#### Dynamo Overrides

| Key                         | Type   | Description                                           | Default       |
| --------------------------- | ------ | ----------------------------------------------------- | ------------- |
| `routerMode`                | string | Request routing strategy: `kv`, `round-robin`, `none` | `round-robin` |
| `frontend.replicas`         | int    | Number of frontend/router pods                        | `1`           |
| `frontend.resources.cpu`    | string | CPU request for frontend                              | `"2"`         |
| `frontend.resources.memory` | string | Memory request for frontend                           | `"4Gi"`       |

**Example:**
```yaml
provider:
  name: "dynamo"
  overrides:
    routerMode: "kv"
    frontend:
      replicas: 2
      resources:
        cpu: "4"
        memory: "8Gi"
```

#### KubeRay Overrides

| Key                     | Type              | Description                      | Default |
| ----------------------- | ----------------- | -------------------------------- | ------- |
| `head.resources.cpu`    | string            | CPU request for Ray head node    | `"2"`   |
| `head.resources.memory` | string            | Memory request for Ray head node | `"4Gi"` |
| `head.rayStartParams`   | map[string]string | Ray head start parameters        | `{}`    |

**Example:**
```yaml
provider:
  name: "kuberay"
  overrides:
    head:
      resources:
        cpu: "4"
        memory: "8Gi"
      rayStartParams:
        dashboard-host: "0.0.0.0"
        num-cpus: "0"
```

#### KAITO Overrides

KAITO currently has no supported overrides (aggregated mode only, no separate router component).

#### Override Behavior

- **Unknown keys are ignored** - Controller logs a warning but continues
- **Invalid types cause reconciliation failure** - Error surfaced in `ModelDeployment.status`
- **Defaults apply when omitted** - Only specify what you need to customize

---

## 5. Implementation Plan

### Phase 1: Controller and All Providers (MVP)

**Scope:**
- Go controller with Kubebuilder
- ModelDeployment CRD with new fields (`image`, `env`, `podTemplate.metadata`)
- All three providers (Dynamo, KAITO, KubeRay)
- Auto-provider selection with `selectedReason`
- Minimal validating webhook (engine↔provider compatibility, required fields)
- Status aggregation with extracted error messages
- Drift reconciliation with pause annotation
- Finalizer timeout handling
- Dynamic CRD version detection

**Controller Structure (Go + Kubebuilder):**
```
kubefoundry-controller/
├── api/
│   └── v1alpha1/
│       ├── modeldeployment_types.go
│       ├── modeldeployment_webhook.go
│       └── zz_generated.deepcopy.go
├── controllers/
│   └── modeldeployment_controller.go
├── pkg/
│   ├── providers/
│   │   ├── interface.go
│   │   ├── dynamo/
│   │   │   ├── transformer.go
│   │   │   └── status.go
│   │   ├── kaito/
│   │   │   ├── transformer.go
│   │   │   └── status.go
│   │   └── kuberay/
│   │       ├── transformer.go
│   │       └── status.go
│   ├── selection/
│   │   └── algorithm.go
│   └── version/
│       └── detector.go
├── config/
│   ├── crd/
│   ├── rbac/
│   └── webhook/
├── main.go
└── Dockerfile
```

**Deliverables:**
- `kubefoundry controller install` installs controller and CRDs
- Published manifests at `manifests/install.yaml` for CLI-free installation
- Kustomize base at `manifests/` for customization
- `kubectl apply -f modeldeployment.yaml` creates provider deployment
- Status reflects provider state with meaningful error messages
- Deletion cleans up provider resources (with timeout fallback)

### Phase 2: Advanced Features

**Scope:**
- Dry-run capability (`kubefoundry.ai/dry-run: "true"` annotation)
- Provider migration support
- Metrics and observability
- Conversion webhooks for future API versions

### Phase 3: Production Hardening

**Scope:**
- Leader election for HA
- Rate limiting and backoff
- Comprehensive error handling
- E2E testing suite

---

## 6. Controller Implementation

### 6.1 Technology Choice: Go + Kubebuilder

The controller is implemented in Go using Kubebuilder.

**Rationale:**
- Native controller-runtime patterns (workqueues, informers, leader election)
- Efficient watch mechanisms
- Strong typing with CRD code generation
- Industry standard for Kubernetes operators
- Better resource efficiency than alternatives

**Trade-offs:**
- Separate codebase from TypeScript UI
- Manifest generation logic must be reimplemented in Go
- Team needs Go expertise

### 6.2 TypeScript Binary Changes

The TypeScript binary becomes a thin client:

| Function           | Implementation                            |
| ------------------ | ----------------------------------------- |
| Web UI             | Unchanged                                 |
| Create deployment  | Creates `ModelDeployment` CRD via K8s API |
| Show status        | Reads `ModelDeployment.status`            |
| Delete deployment  | Deletes `ModelDeployment` CRD             |
| Install controller | Applies controller manifests              |
| Upgrade controller | Updates controller deployment image       |

**Removed from TypeScript:**
- Provider manifest generation (Dynamo, KAITO, KubeRay templates)
- Direct provider CRD application
- Provider-specific status parsing

### 6.3 Controller Upgrades

When upgrading the KubeFoundry controller:

**Upgrade process:**
```bash
# Option A: CLI upgrade
kubefoundry controller upgrade

# Option B: kubectl
kubectl apply -f https://raw.githubusercontent.com/kubefoundry/kubefoundry/main/manifests/install.yaml
```

**Behavior during upgrade:**
- Controller deployment performs a rolling update (no downtime)
- Existing `ModelDeployment` resources continue to function
- In-flight reconciliations complete with the old controller, then new controller takes over
- Provider resources are not disrupted during controller upgrade

**CRD updates:**
- New controller versions may include updated CRD schemas
- CRD updates are applied automatically by `controller upgrade` or manifest apply
- Existing resources remain valid (new fields have defaults)
- Breaking CRD changes only occur between API versions (e.g., v1alpha1 → v1beta1)

**Rollback:**
```bash
# Rollback to previous version
kubectl rollout undo deployment/kubefoundry-controller -n kubefoundry-system
```

**Version compatibility:**
- Controller version is independent of provider operator versions
- Controller detects provider CRD versions dynamically (see Section 4.10)
- Minimum supported Kubernetes version: 1.26+ (required for CEL validation and server-side apply improvements)

---

## 7. API Versioning Strategy

### Version Progression

1. **v1alpha1** - Initial release
   - Experimental API
   - Breaking changes allowed
   - No stability guarantees

2. **v1beta1** - Stabilization
   - Feature complete
   - Breaking changes with deprecation warnings
   - Migration tooling provided

3. **v1** - Stable
   - No breaking changes
   - Long-term support
   - Backward compatibility required

### Conversion Webhooks

When moving between versions, conversion webhooks will handle:
- Field renames
- Structural changes
- Default value updates

---

## 8. Validation Webhook

The controller includes a validating admission webhook (Phase 1).

### Validation Rules

| Rule                                                                | Error Message                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `engine: sglang` with `provider: kaito`                             | "KAITO does not support sglang engine"                           |
| `engine: trtllm` with `provider: kaito`                             | "KAITO does not support trtllm engine"                           |
| `engine: llamacpp` with `provider: dynamo`                          | "Dynamo does not support llamacpp engine"                        |
| `gpu.count: 0` with `provider: dynamo`                              | "Dynamo requires GPU (set resources.gpu.count > 0)"              |
| `gpu.count: 0` with `provider: kuberay`                             | "KubeRay requires GPU (set resources.gpu.count > 0)"             |
| `mode: disaggregated` with `provider: kaito`                        | "KAITO does not support disaggregated mode"                      |
| `mode: disaggregated` with `spec.resources`                         | "Disaggregated mode requires per-component resources in scaling" |
| `mode: disaggregated` without `scaling.prefill` or `scaling.decode` | "Disaggregated mode requires scaling.prefill and scaling.decode" |
| Provider CRD not installed (webhook only)                           | "Provider '{name}' CRD not installed in cluster"                 |
| Missing `engine.type`                                               | "engine.type is required"                                        |
| Missing `model.id`                                                  | "model.id is required"                                           |

**Note:** If the webhook is not available (e.g., during initial setup), provider CRD validation occurs at reconciliation time. The controller will accept the resource and retry until the provider CRD is installed, setting `status.phase: Pending` with a descriptive message.

---

## 9. Observability

### Metrics

```
# Controller metrics
kubefoundry_modeldeployment_total{namespace, phase}
kubefoundry_reconciliation_duration_seconds{provider}
kubefoundry_reconciliation_errors_total{provider, error_type}
kubefoundry_provider_selection{provider, reason}

# Deployment metrics
kubefoundry_deployment_replicas{name, namespace, state}
kubefoundry_deployment_phase{name, namespace, phase}
```

### Events

```yaml
Events:
  Type    Reason              Message
  ----    ------              -------
  Normal  ProviderSelected    Selected provider 'dynamo': default → dynamo (GPU inference default)
  Normal  ResourceCreated     Created DynamoGraphDeployment 'my-llm'
  Warning SecretNotFound      Secret 'hf-token-secret' not found in namespace 'default'
  Warning ProviderError       Provider resource in error state: insufficient GPUs
  Warning DriftDetected       Provider resource was modified directly, reconciling
  Warning FinalizerTimeout    Finalizer removed after timeout, provider resource may be orphaned
```

---

## 10. Security Considerations

### RBAC Requirements

```yaml
# Controller ServiceAccount permissions
rules:
  - apiGroups: ["kubefoundry.ai"]
    resources: ["modeldeployments", "modeldeployments/status"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["kaito.sh"]
    resources: ["workspaces"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["nvidia.com"]
    resources: ["dynamographdeployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["ray.io"]
    resources: ["rayservices"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["apiextensions.k8s.io"]
    resources: ["customresourcedefinitions"]
    verbs: ["get", "list"]  # For dynamic version detection
```

### Secret Handling

- Controller never reads secret contents
- Only passes secret references to provider resources
- HuggingFace tokens stay in K8s secrets

---

## 11. Testing Strategy

### Unit Tests
- Manifest transformation logic per provider
- Status mapping and error extraction
- Provider selection algorithm
- Schema validation
- CRD version detection

### Integration Tests
- Controller reconciliation with mock K8s API
- Owner reference handling
- Finalizer behavior and timeout
- Drift detection and reconciliation
- Webhook validation

### E2E Tests
- Full deployment lifecycle per provider
- Error recovery scenarios
- Controller restart resilience

---

## 12. Out of Scope (v1alpha1)

The following features are explicitly out of scope for the initial release:

| Feature                               | Reason                                                                                                                                   | Future Consideration                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Performance-based autoscaling         | Replica scaling based on metrics (HPA/KEDA). Not to be confused with cluster autoscaling (Karpenter). Only KubeRay supports it natively. | v1alpha2+ with KEDA/HPA integration |
| Multi-model serving (LoRA)            | Complex, vLLM-specific                                                                                                                   | Future version if demand exists     |
| Adoption of existing resources        | Adds ownership conflict complexity                                                                                                       | May add with explicit opt-in        |
| Resource presets (small/medium/large) | Adds indirection without clear value                                                                                                     | Docs provide recommended values     |
| GGUF auto-detection                   | Magic detection has edge cases                                                                                                           | Users specify `engine: llamacpp`    |
| Quantization field                    | Can use `engine.args.quantization`                                                                                                       | Evaluate based on usage patterns    |

---

## 13. Alternatives Considered

### Alternative 1: No Abstraction

Keep the current direct-to-provider approach.

**Rejected because:**
- Users need provider-specific knowledge
- No unified lifecycle management
- Difficult to add features across providers

### Alternative 2: TypeScript Controller

Implement controller in TypeScript to reuse existing code.

**Rejected because:**
- Less efficient watch mechanisms
- No native controller-runtime patterns
- Would need to rewrite to Go eventually for production

### Alternative 3: Helm Chart Abstraction

Use Helm charts with values-based provider selection.

**Rejected because:**
- No runtime status aggregation
- Complex templating for conditional resources
- No controller for lifecycle management

### Alternative 4: Local Binary with Embedded Controller

Run controller logic in the local kubefoundry binary instead of in-cluster.

**Rejected because:**
- No high availability (laptop closes, reconciliation stops)
- Partial state if binary crashes mid-deployment
- Would still need in-cluster controller for production use

---

## 14. Engine-Specific Parameter Reference

Since each inference engine has different parameter names and defaults, the unified API abstracts common concepts while providing an escape hatch via `engine.args`.

### 14.1 Context Length

| Engine       | Parameter           | Default       |
| ------------ | ------------------- | ------------- |
| vLLM         | `--max-model-len`   | Model default |
| SGLang       | `--context-length`  | Model default |
| TensorRT-LLM | Build-time config   | -             |
| llama.cpp    | `--ctx-size` / `-c` | Model max     |

### 14.2 Trust Remote Code

| Engine       | Parameter             | Default |
| ------------ | --------------------- | ------- |
| vLLM         | `--trust-remote-code` | `false` |
| SGLang       | `--trust-remote-code` | `false` |
| TensorRT-LLM | Build-time            | -       |
| llama.cpp    | N/A                   | -       |

### 14.3 Quantization (via engine.args)

| Engine       | Parameter        | Values                     |
| ------------ | ---------------- | -------------------------- |
| vLLM         | `--quantization` | awq, gptq, squeezellm, fp8 |
| SGLang       | `--quantization` | awq, gptq, squeezellm, fp8 |
| TensorRT-LLM | Build-time       | -                          |
| llama.cpp    | N/A              | Built into GGUF file       |

Example:
```yaml
engine:
  type: vllm
  args:
    quantization: "awq"
```

### 14.4 GPU Memory Utilization (via engine.args)

| Engine       | Parameter                  | Default  |
| ------------ | -------------------------- | -------- |
| vLLM         | `--gpu-memory-utilization` | `0.9`    |
| SGLang       | `--mem-fraction-static`    | `0.88`   |
| TensorRT-LLM | KvCacheConfig              | -        |
| llama.cpp    | `--cache-ram`              | 8192 MiB |

---

## 15. References

- [Kubernetes Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/)
- [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime)
- [Kubebuilder Book](https://book.kubebuilder.io/)
- [KAITO CRD Spec](https://github.com/kaito-project/kaito)
- [Dynamo CRD Spec](https://github.com/ai-dynamo/dynamo)
- [KubeRay CRD Spec](https://github.com/ray-project/kuberay)

### Engine Documentation
- [vLLM Engine Arguments](https://docs.vllm.ai/en/stable/configuration/engine_args/)
- [SGLang Server Arguments](https://docs.sglang.io/advanced_features/server_arguments.html)
- [TensorRT-LLM KV Cache Reuse](https://nvidia.github.io/TensorRT-LLM/advanced/kv-cache-reuse.html)
- [llama.cpp Server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
