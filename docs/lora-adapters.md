# LoRA Adapter Support

## Overview

[LoRA (Low-Rank Adaptation)](https://arxiv.org/abs/2106.09685) adapters allow you to serve multiple fine-tuned model variants from a single GPU-loaded base model. Instead of deploying separate instances for each fine-tuned task — each consuming its own GPU memory — you load one base model and dynamically apply lightweight adapter weights at inference time.

This dramatically reduces resource costs when serving many specialized tasks (code review, SQL generation, summarization, etc.) since adapters are typically only a few megabytes compared to the multi-gigabyte base model. KubeAIRunway manages LoRA adapters as a first-class field on `ModelDeployment`, handling the provider-specific plumbing automatically.

## Quick Start

Deploy a base model with two LoRA adapters:

```yaml
apiVersion: kubeairunway.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: llama3-multitask
spec:
  model:
    id: "meta-llama/Llama-3.1-8B-Instruct"
  adapters:
    - source: "hf://user/sql-lora-adapter"
    - source: "hf://user/code-review-adapter"
  resources:
    gpu:
      count: 1
```

The controller configures the selected provider to load both adapters alongside the base model. Clients select an adapter by specifying its name in the `model` field of the OpenAI-compatible API request.

## Adapter Specification

Adapters are defined under `spec.adapters[]` on a `ModelDeployment`:

| Field | Required | Description |
|---|---|---|
| `name` | No | Custom short name for the adapter. If omitted, derived from the source URI (e.g., `hf://user/sql-lora-adapter` → `sql-lora-adapter`). |
| `source` | Yes | URI pointing to the adapter weights. Uses `hf://` scheme for HuggingFace adapter repos (e.g., `hf://user/my-adapter`). |

## Custom Names

By default, adapter names are derived from the source URI. You can set explicit short names for cleaner API calls:

```yaml
spec:
  adapters:
    - name: sql
      source: "hf://user/sql-lora-adapter"
    - name: code
      source: "hf://user/code-review-adapter"
```

Clients then reference the adapter by its short name:

```bash
curl http://${ENDPOINT}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "sql", "messages": [{"role": "user", "content": "Write a query to find all users"}]}'
```

## Engine Tuning

Use `spec.engine.args` to pass LoRA-specific tuning parameters to the inference engine:

```yaml
spec:
  engine:
    args:
      max-lora-rank: "128"
      max-loras: "16"
```

| Arg | Description |
|---|---|
| `max-lora-rank` | Maximum LoRA rank supported. Higher values support more expressive adapters but use more memory. |
| `max-loras` | Maximum number of LoRA adapters that can be loaded simultaneously. |

These arguments are passed directly to the underlying engine (e.g., vLLM `--max-lora-rank`, `--max-loras`). Available arguments depend on the engine; refer to the engine documentation for the full list.

## Provider Behavior

Each provider translates `spec.adapters[]` into its native mechanism:

| Provider | Mechanism |
|---|---|
| KAITO | Maps to `inference.adapters` on Workspace CRD |
| KubeRay | Injects `--enable-lora` + `--lora-modules` into engine args |
| Dynamo | Creates `DynamoModel` CRDs + enables LoRA env vars |

> **Note:** The provider handles all LoRA-specific configuration automatically. You only need to specify adapters on the `ModelDeployment`.

## Gateway Integration

When [Gateway API Inference Extension](gateway.md) is available, KubeAIRunway automatically creates `InferenceObjective` resources for each adapter. This enables the gateway to route requests to the correct adapter based on the `model` field in the request body, providing intelligent load balancing and routing across adapter-specific endpoints.

## Limitations

- **Source schemes:** Only `hf://` (HuggingFace) is currently supported. OCI registry, S3, and PVC sources are planned for future releases.
- **llamacpp engine:** LoRA adapters are not yet supported with the `llamacpp` engine.
- **Web UI:** Adapter management through the Web UI is not yet available.

## See also

- [CRD Reference](crd-reference.md)
- [Providers](providers.md)
- [Gateway Integration](gateway.md)
