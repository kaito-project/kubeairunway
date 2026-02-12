# Providers

## Provider Selection

When `spec.provider.name` is omitted, the controller auto-selects a provider using CEL-based selection rules from `InferenceProviderConfig` resources. Each provider declares rules with priorities; the highest-priority match wins.

**Default selection behavior** (with built-in providers):

```
IF gpu.count == 0 OR resources.gpu is omitted:
    → KAITO (only CPU provider)

IF engine == "trtllm" OR engine == "sglang":
    → Dynamo (only provider supporting these engines)

IF engine == "llamacpp":
    → KAITO (only llamacpp provider)

IF mode == "disaggregated":
    → Dynamo (best disaggregated support)

DEFAULT (GPU + vllm + aggregated):
    → Dynamo (GPU inference default)
```

**Note:** KubeRay is never auto-selected. Users must explicitly set `provider.name: kuberay`.

The selection reason is recorded in `status.provider.selectedReason` for observability.

### Provider Capability Matrix

| Criteria          | KAITO   | Dynamo        | KubeRay            |
| ----------------- | ------- | ------------- | ------------------ |
| CPU inference     | **Yes** | No            | No                 |
| GPU inference     | Yes     | **Yes**       | Yes                |
| vLLM engine       | Yes     | **Yes**       | Yes                |
| sglang engine     | No      | **Yes**       | No                 |
| trtllm engine     | No      | **Yes**       | No                 |
| llamacpp engine   | **Yes** | No            | No                 |
| Disaggregated P/D | No      | **Yes**       | Yes                |
| Auto-selection    | Yes     | Yes (default) | No (explicit only) |

## Provider Abstraction

KubeAIRunway supports two deployment methods, both using the provider abstraction pattern:

### CRD-Based Deployment (Recommended)
Users create `ModelDeployment` CRs, and the controller + provider controllers handle the rest:
- Automatic provider selection based on capabilities
- Unified status reporting
- Provider-agnostic lifecycle management

### Web UI Deployment
The Web UI backend reads provider information (capabilities, installation steps, Helm charts) from `InferenceProviderConfig` CRDs in the cluster. It can trigger Helm-based provider installation and creates `ModelDeployment` CRs for model deployment, which are then handled by the controller and provider controllers.

### Supported Providers

| Provider      | Upstream CRD          | Status      | Description                                                                    |
| ------------- | --------------------- | ----------- | ------------------------------------------------------------------------------ |
| NVIDIA Dynamo | DynamoGraphDeployment | ✅ Available | High-performance GPU inference with KV-cache routing and disaggregated serving |
| KubeRay       | RayService            | ✅ Available | Ray-based distributed inference with autoscaling                               |
| KAITO         | Workspace             | ✅ Available | Flexible inference with vLLM (GPU) or llama.cpp (CPU/GPU)                      |

### KAITO Provider

The KAITO provider enables flexible inference with multiple backends:

- **vLLM Mode**: GPU inference using vLLM engine with full HuggingFace model support
- **Pre-made GGUF**: Ready-to-deploy quantized models from `ghcr.io/kaito-project/aikit/*`
- **HuggingFace GGUF**: Run any GGUF model from HuggingFace directly (no build required)
- **CPU/GPU Flexibility**: llama.cpp models can run on CPU nodes (no GPU required) or GPU nodes

| Mode             | Engine    | Compute | Use Case                         |
| ---------------- | --------- | ------- | -------------------------------- |
| vLLM             | vLLM      | GPU     | High-performance GPU inference   |
| Pre-made GGUF    | llama.cpp | CPU/GPU | Ready-to-deploy quantized models |
| HuggingFace GGUF | llama.cpp | CPU/GPU | Run any HuggingFace GGUF model   |

#### Build Infrastructure

For HuggingFace GGUF models, KAITO uses in-cluster image building:

```
┌────────────────┐     ┌──────────────┐     ┌─────────────────┐
│  HuggingFace   │────▶│  BuildKit    │────▶│  In-Cluster     │
│  GGUF Model    │     │  (K8s Driver)│     │  Registry       │
└────────────────┘     └──────────────┘     └─────────────────┘
                                                    │
                                                    ▼
                                            ┌─────────────────┐
                                            │  KAITO Pod      │
                                            │  (llama.cpp)    │
                                            └─────────────────┘
```

#### Related Services

- **RegistryService** (`backend/src/services/registry.ts`): Manages in-cluster registry
- **BuildKitService** (`backend/src/services/buildkit.ts`): Manages BuildKit builder
- **AikitService** (`backend/src/services/aikit.ts`): Handles GGUF image building

---

## See also

- [Architecture Overview](architecture.md)
- [Controller Architecture](controller-architecture.md)
- [CRD Reference](crd-reference.md)
