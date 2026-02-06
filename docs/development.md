# Development Guide

## Prerequisites

- [Bun](https://bun.sh) 1.0+
- Access to a Kubernetes cluster
- Helm CLI (for provider installation)
- kubectl configured with cluster access

## Quick Start

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

### Headlamp Plugin

```bash
cd plugins/headlamp
bun install             # Install plugin dependencies
bun run build           # Build plugin
bun run start           # Development mode with auto-rebuild
bun run test            # Run tests
bun run test:watch      # Watch mode for tests
bun run lint            # Lint code
bun run tsc             # Type check only
```

#### Makefile Commands

```bash
make setup              # Install deps, build, and deploy to Headlamp
make dev                # Build and deploy for development
make build              # Build only
make deploy             # Deploy to Headlamp plugins directory
make clean              # Remove build artifacts
```

#### Prerequisites for Headlamp Plugin

- Headlamp Desktop (v0.20+) or Headlamp running in-cluster
- KubeFoundry backend deployed or running locally

#### Configuring Backend URL

The plugin discovers the backend in this order:
1. **Plugin Settings**: Configure in Headlamp → Settings → Plugins → KubeFoundry
2. **In-Cluster**: Auto-discovers `kubefoundry.<namespace>.svc`
3. **Default**: Falls back to `http://localhost:3001`

#### Testing with Headlamp Desktop

1. Build and deploy the plugin:
   ```bash
   cd plugins/headlamp
   make setup
   ```

2. Start KubeFoundry backend:
   ```bash
   cd ../..
   bun run dev:backend
   ```

3. Open Headlamp Desktop - the plugin should appear in the sidebar

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

### Headlamp Plugin Issues

#### Plugin not appearing in Headlamp
- Verify plugin was built: `cd plugins/headlamp && bun run build`
- Check plugin deployment location:
  - macOS: `~/.config/Headlamp/plugins/kubefoundry-headlamp-plugin`
  - Linux: `~/.config/Headlamp/plugins/kubefoundry-headlamp-plugin`
  - Windows: `%APPDATA%/Headlamp/plugins/kubefoundry-headlamp-plugin`
- Restart Headlamp after deploying the plugin

#### Plugin can't connect to backend
- Check backend URL in Headlamp → Settings → Plugins → KubeFoundry
- Verify backend is running: `curl http://localhost:3001/api/health`
- For in-cluster deployments, ensure the service is accessible
- Check browser dev tools (Network tab) for connection errors

#### Plugin shows "Connection Failed" banner
- The plugin auto-discovers the backend; ensure it's running
- In-cluster: Deploy KubeFoundry backend to `kubefoundry-system` namespace
- Local development: Start backend with `bun run dev:backend`

#### Type errors after shared package changes
- Rebuild the shared package: `cd shared && bun run build`
- Rebuild the plugin: `cd plugins/headlamp && bun run build`
- Clear TypeScript cache: `rm -rf plugins/headlamp/node_modules/.cache`
