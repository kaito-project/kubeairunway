# CRD Reference

## ModelDeployment
Unified API for deploying ML models.

```yaml
apiVersion: kubeairunway.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: my-model
  namespace: default
spec:
  model:
    id: "Qwen/Qwen3-0.6B"       # HuggingFace model ID
    source: huggingface          # huggingface or custom
  engine:
    type: vllm                   # vllm, sglang, trtllm, llamacpp (optional, auto-selected)
    contextLength: 32768
    trustRemoteCode: false
  provider:
    name: ""                     # Optional: explicit provider selection
  serving:
    mode: aggregated             # aggregated or disaggregated
  resources:
    gpu:
      count: 1
      type: "nvidia.com/gpu"
  scaling:
    replicas: 1
```

## InferenceProviderConfig
Cluster-scoped resource for provider registration. Each provider controller self-registers its `InferenceProviderConfig` at startup, declaring capabilities, selection rules, and installation info:

```yaml
apiVersion: kubeairunway.ai/v1alpha1
kind: InferenceProviderConfig
metadata:
  name: dynamo
spec:
  capabilities:
    engines: [vllm, sglang, trtllm]
    servingModes: [aggregated, disaggregated]
    gpuSupport: true
    cpuSupport: false
  selectionRules:
    - condition: "spec.serving.mode == 'disaggregated'"
      priority: 100
  installation:
    description: "NVIDIA Dynamo for GPU-accelerated inference"
    defaultNamespace: dynamo-system
    helmRepos:
      - name: nvidia-dynamo
        url: https://helm.ngc.nvidia.com/nvidia/ai-dynamo
    helmCharts:
      - name: dynamo-crds
        chart: https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-0.7.1.tgz
        version: "0.7.1"
        namespace: default
      - name: dynamo-platform
        chart: https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-0.7.1.tgz
        version: "0.7.1"
        namespace: dynamo-system
        createNamespace: true
    steps:
      - title: Install Dynamo CRDs
        command: "helm install dynamo-crds ..."
        description: Install the Dynamo custom resource definitions
status:
  ready: true
  version: "0.7.1"
```

## See also

- [Architecture Overview](architecture.md)
- [Controller Architecture](controller-architecture.md)
