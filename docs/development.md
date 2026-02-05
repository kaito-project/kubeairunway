# Development Guide

## Prerequisites

- [Go](https://go.dev) 1.23+ (for controller development)
- [Bun](https://bun.sh) 1.0+ (for Web UI development)
- Access to a Kubernetes cluster
- Helm CLI (for provider installation)
- kubectl configured with cluster access

## Quick Start

### Web UI Development
```bash
# Install dependencies
bun install

# Start development servers (frontend + backend)
bun run dev

# Development mode:
#   Frontend: http://localhost:5173 (Vite dev server, proxies API to backend)
#   Backend:  http://localhost:3001
#
# Production mode (compiled binary):
#   Single server: http://localhost:3001 (frontend embedded in backend)
```

### Controller Development
```bash
# Build the controller binary
make controller-build

# Run controller tests
make controller-test

# Run controller locally (uses your kubeconfig)
make controller-run

# Regenerate CRDs and deepcopy code after editing *_types.go files
make controller-generate

# Install CRDs into the cluster
make controller-install

# Deploy controller to cluster
make controller-deploy
```

**Important**: After editing `controller/api/v1alpha1/*_types.go` files, always run:
```bash
cd controller && make manifests generate
```

## Building a Single Binary

The project can be compiled to a standalone executable that includes both the backend API and embedded frontend assets:

```bash
# Compile to single binary (includes frontend)
bun run compile

# Run the binary (serves both API and frontend on port 3001)
./dist/kubefoundry

# Check version info
curl http://localhost:3001/api/health/version
```

The compile process:
1. Builds the frontend with Vite
2. Generates native Bun file imports in `backend/src/embedded-assets.ts`
3. Injects build-time constants (version, git commit, build time) via `--define`
4. Compiles everything into a single executable using `bun build --compile --minify --sourcemap`

The binary is completely self-contained with zero-copy file serving. The backend uses Hono on Bun for optimal performance.

### Cross-Compilation

Build for multiple platforms:

```bash
# Build for all platforms
make compile-all

# Or individual targets
make compile-linux     # linux-x64, linux-arm64
make compile-darwin    # darwin-x64, darwin-arm64
make compile-windows   # windows-x64

# With explicit version
VERSION=v1.0.0 bun run compile
```

Supported targets:
- `linux-x64`, `linux-arm64`
- `darwin-x64`, `darwin-arm64`
- `windows-x64`

## Controller Development

The controller is a Go-based Kubernetes operator built with [Kubebuilder](https://kubebuilder.io/).

### Project Structure
```
controller/
├── api/v1alpha1/           # CRD type definitions
│   ├── modeldeployment_types.go
│   └── inferenceproviderconfig_types.go
├── cmd/                    # Main entrypoint
├── config/                 # Kustomize manifests
│   ├── crd/                # Generated CRD YAMLs
│   ├── rbac/               # RBAC manifests
│   └── manager/            # Controller deployment
├── internal/
│   ├── controller/         # Reconciliation logic
│   └── webhook/            # Validation webhooks
└── Makefile                # Build commands
```

### CRDs
KubeFoundry defines two CRDs:

1. **ModelDeployment** (namespaced) - User-facing API for deploying models
2. **InferenceProviderConfig** (cluster-scoped) - Provider registration

After editing `*_types.go` files, regenerate code:
```bash
cd controller && make manifests generate
```

### Running Locally
```bash
# Install CRDs first
make controller-install

# Run controller (uses your kubeconfig)
make controller-run
```

### Testing
```bash
# Run unit tests
make controller-test

# Run with verbose output
cd controller && go test -v ./...
```

## Environment Variables

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001
VITE_DEFAULT_NAMESPACE=kubefoundry-system
VITE_DEFAULT_HF_SECRET=hf-token-secret
```

### Backend (.env)
```env
PORT=3001
DEFAULT_NAMESPACE=kubefoundry-system
CORS_ORIGIN=http://localhost:5173
AUTH_ENABLED=false
```

## Authentication

KubeFoundry supports optional authentication using Kubernetes OIDC tokens from your kubeconfig.

### Enabling Authentication

Set the `AUTH_ENABLED` environment variable:

```bash
AUTH_ENABLED=true ./dist/kubefoundry
```

### Login Flow

1. **Run the login command:**
   ```bash
   kubefoundry login
   ```
   This extracts your OIDC token from kubeconfig and opens the browser with a magic link.

2. **Alternative: Specify server URL:**
   ```bash
   kubefoundry login --server https://kubefoundry.example.com
   ```

3. **Use a specific kubeconfig context:**
   ```bash
   kubefoundry login --context my-cluster
   ```

### How It Works

- The CLI extracts the OIDC `id-token` from your kubeconfig
- Opens your browser with a URL containing the token in the fragment (`#token=...`)
- The frontend saves the token to localStorage
- All API requests include the token in the `Authorization: Bearer` header
- The backend validates tokens using Kubernetes `TokenReview` API

### Public Routes (No Auth Required)

These routes are accessible without authentication:
- `GET /api/health` - Health check
- `GET /api/cluster/status` - Cluster connection status
- `GET /api/settings` - Settings (includes `auth.enabled` for frontend)

### CLI Commands

```bash
kubefoundry                    # Start server (default)
kubefoundry serve              # Start server
kubefoundry login              # Login with kubeconfig credentials
kubefoundry login --server URL # Login to specific server
kubefoundry login --context X  # Use specific kubeconfig context
kubefoundry logout             # Clear stored credentials
kubefoundry version            # Show version
kubefoundry help               # Show help
```

## Project Commands

### Root
```bash
bun run dev           # Start both frontend and backend
bun run build         # Build all packages
bun run compile       # Build single binary (frontend + backend) to dist/kubefoundry
bun run lint          # Lint all packages
```

### Controller (Go)
```bash
make controller-build       # Build Go controller binary
make controller-test        # Run controller tests
make controller-run         # Run controller locally
make controller-generate    # Regenerate CRDs and deepcopy code
make controller-install     # Install CRDs into cluster
make controller-deploy      # Deploy controller to cluster
```

### Frontend
```bash
bun run dev:frontend    # Start Vite dev server
bun run build:frontend  # Build for production
```

### Backend
```bash
bun run dev:backend     # Start with watch mode
bun run build:backend   # Compile TypeScript
bun run compile         # Build single binary executable
```

## Kubernetes Setup

### Create HuggingFace Token Secret
```bash
kubectl create secret generic hf-token-secret \
  --from-literal=HF_TOKEN="your-token" \
  -n kubefoundry
```

### Install NVIDIA Dynamo (via Helm)
```bash
export NAMESPACE=dynamo-system
export RELEASE_VERSION=0.7.1

# Install CRDs
helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-${RELEASE_VERSION}.tgz
helm install dynamo-crds dynamo-crds-${RELEASE_VERSION}.tgz --namespace default

# Install Platform
helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-${RELEASE_VERSION}.tgz
helm install dynamo-platform dynamo-platform-${RELEASE_VERSION}.tgz --namespace ${NAMESPACE} --create-namespace
```

## Adding a New Provider

1. **Create provider directory:**
   ```
   backend/src/providers/<name>/
   ├── index.ts    # Provider implementation
   └── schema.ts   # Zod validation schema
   ```

2. **Implement the Provider interface:**
   ```typescript
   import { Provider, CRDConfig, ... } from '../types';

   export class MyProvider implements Provider {
     id = 'my-provider';
     name = 'My Provider';
     description = '...';

     getCRDConfig(): CRDConfig { ... }
     generateManifest(config: DeploymentConfig): object { ... }
     parseStatus(resource: object): DeploymentStatus { ... }
     // ... implement all interface methods
   }
   ```

3. **Register the provider:**
   ```typescript
   // backend/src/providers/index.ts
   import { MyProvider } from './my-provider';

   providerRegistry.register(new MyProvider());
   ```

## Adding a New Model

Edit `backend/src/data/models.json`:

```json
{
  "models": [
    {
      "id": "org/model-name",
      "name": "Model Display Name",
      "description": "Brief description",
      "size": "7B",
      "task": "chat",
      "contextLength": 32768,
      "supportedEngines": ["vllm", "sglang"],
      "minGpuMemory": "16GB"
    }
  ]
}
```

## Testing API Endpoints

```bash
# Health check
curl http://localhost:3001/api/health

# Cluster status
curl http://localhost:3001/api/cluster/status

# List models
curl http://localhost:3001/api/models

# List deployments
curl http://localhost:3001/api/deployments

# Create deployment (Dynamo/KubeRay)
curl -X POST http://localhost:3001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-deployment",
    "namespace": "kubefoundry-system",
    "provider": "dynamo",
    "modelId": "Qwen/Qwen3-0.6B",
    "engine": "vllm",
    "mode": "aggregated",
    "replicas": 1,
    "hfTokenSecret": "hf-token-secret",
    "enforceEager": true
  }'

# Create deployment (KAITO with premade model)
curl -X POST http://localhost:3001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "kaito-deployment",
    "namespace": "kaito-workspace",
    "provider": "kaito",
    "modelSource": "premade",
    "premadeModel": "llama3.2-1b",
    "computeType": "cpu"
  }'

# Create deployment (KAITO with HuggingFace GGUF - direct mode)
curl -X POST http://localhost:3001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "gemma-deployment",
    "namespace": "kaito-workspace",
    "provider": "kaito",
    "modelSource": "huggingface",
    "modelId": "bartowski/gemma-3-1b-it-GGUF",
    "ggufFile": "gemma-3-1b-it-Q8_0.gguf",
    "ggufRunMode": "direct",
    "computeType": "cpu"
  }'

# Create deployment (KAITO with vLLM for GPU inference)
curl -X POST http://localhost:3001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "vllm-deployment",
    "namespace": "kaito-workspace",
    "provider": "kaito",
    "modelSource": "vllm",
    "modelId": "Qwen/Qwen3-0.6B",
    "hfTokenSecret": "hf-token-secret",
    "resources": { "gpu": 1 }
  }'
```

## Accessing Deployed Models

After deployment is running:

```bash
# Port-forward to the service (check deployment details for exact service name)
# Dynamo/KubeRay deployments expose port 8000
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n kubefoundry-system

# KAITO deployments with vLLM expose port 8000
kubectl port-forward svc/<deployment-name> 8000:8000 -n kaito-workspace

# KAITO deployments with llama.cpp (premade/GGUF) expose port 5000
kubectl port-forward svc/<deployment-name> 5000:5000 -n kaito-workspace

# Test the model (OpenAI-compatible API)
# For vLLM (port 8000):
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-0.6B",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# For llama.cpp (port 5000):
curl http://localhost:5000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "llama3.2-1b",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Troubleshooting

### Controller not reconciling
- Check controller logs: `kubectl logs -n kubefoundry-system deploy/kubefoundry-controller-manager`
- Verify CRDs are installed: `kubectl get crd modeldeployments.kubefoundry.kubefoundry.ai`
- Check RBAC permissions for the controller service account

### ModelDeployment stuck in Pending
- Check if any `InferenceProviderConfig` resources exist: `kubectl get inferenceproviderconfigs`
- Verify at least one provider has `status.ready: true`
- Check controller logs for provider selection errors

### Backend can't connect to cluster
- Verify kubectl is configured: `kubectl cluster-info`
- Check KUBECONFIG environment variable
- Ensure proper RBAC permissions

### Provider not detected as installed
- Check CRD exists:
  - Dynamo: `kubectl get crd dynamographdeployments.nvidia.com`
  - KubeRay: `kubectl get crd rayservices.ray.io`
  - KAITO: `kubectl get crd workspaces.kaito.sh`
- Check operator deployment:
  - Dynamo: `kubectl get deployments -n dynamo-system`
  - KubeRay: `kubectl get deployments -n ray-system`
  - KAITO: `kubectl get deployments -n kaito-workspace`

### KAITO deployment stuck in Pending
- Check KAITO workspace status: `kubectl describe workspace <name> -n kaito-workspace`
- Verify node labels match labelSelector (default: `kubernetes.io/os: linux`)
- For vLLM mode, ensure GPU nodes are available
- Check events: `kubectl get events -n kaito-workspace --sort-by=.lastTimestamp`

### Metrics not available
- Metrics require KubeFoundry to run in-cluster
- Check deployment pods are running: `kubectl get pods -n <namespace>`
- Verify metrics endpoint is exposed (port 8000 for vLLM, port 5000 for llama.cpp)

### Frontend can't reach backend
- Check CORS_ORIGIN matches frontend URL
- Verify backend is running on correct port
- Check browser console for errors
