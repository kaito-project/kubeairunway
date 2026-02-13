# KubeAIRunway

<img src="./frontend/public/logo.png" alt="KubeAIRunway Logo" width="200">

Deploy and manage large language models on Kubernetes — no YAML required.

KubeAIRunway gives you a web UI and a unified Kubernetes CRD (`ModelDeployment`) to deploy models across multiple inference providers. Browse [HuggingFace](https://huggingface.co/), pick a model, click deploy.

## Highlights

- 🚀 **One-Click Deploy** — Browse models, check GPU fit, and deploy from the UI
- 🎯 **Unified CRD** — Single `ModelDeployment` API across all providers
- 🔧 **Multiple Engines** — [vLLM](https://github.com/vllm-project/vllm), [SGLang](https://github.com/sgl-project/sglang), [TensorRT-LLM](https://github.com/NVIDIA/TensorRT-LLM), [llama.cpp](https://github.com/ggml-org/llama.cpp)
- 📈 **Live Monitoring** — Real-time status, logs, and Prometheus metrics
- 💰 **Cost Estimation** — GPU pricing and capacity guidance
- 🔌 **Headlamp Plugin** — Full-featured [Headlamp](https://headlamp.dev/) dashboard plugin

## Supported Providers

| Provider | Description |
| --- | --- |
| [**NVIDIA Dynamo**](https://github.com/ai-dynamo/dynamo) | GPU-accelerated inference with aggregated or disaggregated serving |
| [**KubeRay**](https://github.com/ray-project/kuberay) | Ray-based distributed inference |
| [**KAITO**](https://github.com/kaito-project/kaito) | vLLM (GPU) and llama.cpp (CPU/GPU) support |

## Quick Start

### Prerequisites

- Kubernetes cluster with `kubectl` configured
- `helm` CLI installed
- GPU nodes with NVIDIA drivers (KAITO also supports CPU-only)

### Option A: Run Locally

Download the [latest release](https://github.com/kaito-project/kubeairunway/releases) and run:

```bash
./kubeairunway
```

Open **http://localhost:3001**

> **macOS:** Remove quarantine if needed: `xattr -dr com.apple.quarantine kubeairunway`

### Option B: Deploy to Kubernetes

```bash
kubectl apply -f https://raw.githubusercontent.com/kaito-project/kubeairunway/main/deploy/kubernetes/kubeairunway.yaml
kubectl port-forward -n kubeairunway-system svc/kubeairunway 3001:80
```

Open **http://localhost:3001** — see [deployment docs](deploy/kubernetes/README.md) for more options.

### Getting Started

1. **Install a provider** — Go to the Installation page and install your preferred provider via Helm
2. **Connect HuggingFace** — Sign in via Settings → HuggingFace (required for gated models)
3. **Deploy a model** — Browse the catalog, pick a model, configure, and deploy
4. **Monitor** — Track status, stream logs, and view metrics on the Deployments page

### Access Your Model

Deployed models expose an OpenAI-compatible API:

```bash
kubectl port-forward svc/<deployment-name> 8000:8000 -n <namespace>
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "<model-name>", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## ModelDeployment CRD

```yaml
apiVersion: kubeairunway.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: my-model
spec:
  model:
    id: "Qwen/Qwen3-0.6B"
```

The controller automatically selects the best engine and provider, creates provider-specific resources, and reports unified status. See [CRD Reference](docs/crd-reference.md) for details.

## Documentation

| Topic | Link |
| --- | --- |
| Architecture | [docs/architecture.md](docs/architecture.md) |
| CRD Reference | [docs/crd-reference.md](docs/crd-reference.md) |
| Providers | [docs/providers.md](docs/providers.md) |
| Observability | [docs/observability.md](docs/observability.md) |
| Development | [docs/development.md](docs/development.md) |
| Kubernetes Deployment | [deploy/kubernetes/README.md](deploy/kubernetes/README.md) |
| Headlamp Plugin | [docs/headlamp-plugin.md](docs/headlamp-plugin.md) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup. We also accept [AI-assisted prompt requests](CONTRIBUTING.md#ai-assisted-contributions--prompt-requests).
