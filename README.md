# KubeFoundry

<img src="./frontend/public/logo.png" alt="KubeFoundry Logo" width="200">

A web-based platform for deploying and managing large language models on Kubernetes with support for multiple inference providers.

## Features

- 🕸️ **Web UI**: Modern interface for all deployment and management tasks
- 📦 **Model Catalog**: Browse curated models or search the entire HuggingFace Hub
- 🔍 **Smart Filtering**: Automatically filters models by architecture compatibility
- 📊 **GPU Capacity Warnings**: Visual indicators showing if models fit your cluster's GPU memory
- ⚡ **Autoscaler Integration**: Detects cluster autoscaling and provides capacity guidance
- 🧠 **AI Configurator**: NVIDIA AI Configurator integration for optimal inference settings
- 🚀 **One-Click Deploy**: Configure and deploy models without writing YAML
- 📈 **Live Dashboard**: Monitor deployments with auto-refresh and status tracking
- 📝 **Real-Time Logs**: Stream container logs directly from the UI
- 📊 **Deployment Metrics**: View Prometheus metrics for running deployments (in-cluster)
- 🔌 **Multi-Provider Support**: Extensible architecture supporting multiple inference runtimes
- 🔧 **Multiple Engines**: vLLM, SGLang, and TensorRT-LLM (via NVIDIA Dynamo)
- 📥 **Installation Wizard**: Install providers via Helm directly from the UI
- 🛠️ **Complete Uninstall**: Clean uninstallation with optional CRD removal
- 🎨 **Dark Theme**: Modern dark UI with provider-specific accents

## Supported Providers

| Provider          | Status      | Description                                                        |
| ----------------- | ----------- | ------------------------------------------------------------------ |
| **NVIDIA Dynamo** | ✅ Available | GPU-accelerated inference with aggregated or disaggregated serving |
| **KubeRay**       | ✅ Available | Ray-based distributed inference                                    |
| **KAITO**         | ✅ Available | Flexible inference with vLLM (GPU) and llama.cpp (CPU/GPU) support |

## Prerequisites

- Kubernetes cluster with `kubectl` configured
- `helm` CLI installed
- GPU nodes with NVIDIA drivers (for GPU-accelerated inference)
- HuggingFace account (for accessing gated models like Llama)

> **Note:** KAITO provider supports CPU-only inference, so GPU nodes are optional when using KAITO with CPU compute type.

## Quick Start

### Option A: Run Locally

Download the latest release for your platform and run:

```bash
./kubefoundry
```

Open the web UI at **http://localhost:3001**

> **Requires:** `kubectl` configured with cluster access, `helm` CLI installed

> **macOS users:** If you see a quarantine warning, remove it with:
> ```bash
> xattr -dr com.apple.quarantine kubefoundry
> ```

### Option B: Deploy to Kubernetes

```bash
kubectl apply -f https://raw.githubusercontent.com/sozercan/kube-foundry/main/deploy/kubernetes/kubefoundry.yaml

# Access via port-forward
kubectl port-forward -n kubefoundry-system svc/kubefoundry 3001:80
```

Open the web UI at **http://localhost:3001**

See [Kubernetes Deployment](deploy/kubernetes/README.md) for configuration options.

---

### 1. Install a Provider

Navigate to the **Installation** page and click **Install** next to your preferred provider. The UI will guide you through the Helm installation process with real-time status updates.

### 2. Connect HuggingFace Account

Go to **Settings** → **HuggingFace** and click **"Sign in with Hugging Face"** to connect your account via OAuth. Your token will be automatically distributed to all required namespaces.

> **Note:** A HuggingFace token is required to access gated models like Llama.

### 3. Deploy a Model

1. Navigate to the **Models** page
2. **Browse** the curated catalog or **Search** HuggingFace for any compatible model
3. **Review** GPU memory estimates and fit indicators (✓ fits, ⚠ tight, ✗ exceeds)
4. Click **Deploy** on your chosen model
5. **Select Runtime**: Choose between NVIDIA Dynamo, KubeRay, or KAITO based on installed runtimes
6. **Configure** deployment options:
   - **Dynamo/KubeRay**: Select engine (vLLM, SGLang, TRT-LLM), replicas, GPU configuration
   - **KAITO**: Choose from three modes:
     - **Pre-made GGUF**: Ready-to-deploy quantized models for CPU/GPU
     - **HuggingFace GGUF**: Run any GGUF model from HuggingFace directly
     - **vLLM**: GPU inference using the vLLM engine
7. Click **Create Deployment** to launch

> **Note:** Each deployment can use a different runtime. The deployment list shows which runtime each deployment is using.

### 4. Monitor Your Deployment

Head to the **Deployments** page to:
- View real-time status of all deployments across all runtimes
- See pod readiness and health checks with node information
- Stream container logs directly from the UI
- View Prometheus metrics (when running in-cluster)
- Get intelligent guidance when pods are pending (GPU/resource constraints)
- Scale or delete deployments

### 5. Access Your Model

Once status shows **Running**, your model exposes an OpenAI-compatible API. Use `kubectl port-forward` to access it locally:

```bash
# Port-forward to the service (check Deployments page for exact service name)
kubectl port-forward svc/<deployment-name> 8000:8000 -n <namespace>

# List available models
curl http://localhost:8000/v1/models

# Test with a chat completion
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "<model-name>", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## Supported Models

KubeFoundry supports **any HuggingFace model** with a compatible architecture. Browse the curated catalog for tested models, or search HuggingFace Hub for thousands more.

### Supported Architectures

When searching HuggingFace, models are filtered by architecture compatibility:

| Engine       | Supported Architectures                                                               |
| ------------ | ------------------------------------------------------------------------------------- |
| vLLM         | LlamaForCausalLM, MistralForCausalLM, Qwen2ForCausalLM, GPT2LMHeadModel, and 40+ more |
| SGLang       | LlamaForCausalLM, MistralForCausalLM, Qwen2ForCausalLM, and 20+ more                  |
| TensorRT-LLM | LlamaForCausalLM, GPTForCausalLM, MistralForCausalLM, and 15+ more                    |

## Authentication (Optional)

KubeFoundry supports optional authentication using your existing kubeconfig OIDC credentials.

To enable, start the server with:

```bash
AUTH_ENABLED=true ./kubefoundry
```

Then use the CLI to login:

```bash
kubefoundry login                              # Uses current kubeconfig context
kubefoundry login --server https://example.com # Specify server URL
kubefoundry login --context my-cluster         # Use specific context
```

The login command extracts your OIDC token and opens the browser automatically.

## Documentation

- [Architecture Overview](docs/architecture.md)
- [API Reference](docs/api.md)
- [Development Guide](docs/development.md)
- [Azure Cluster Autoscaling Setup](docs/azure-autoscaling.md)
- [Kubernetes Deployment](deploy/kubernetes/README.md)

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.
