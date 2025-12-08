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

# Frontend: http://localhost:5173
# Backend: http://localhost:3001
```

## Building a Single Binary

The backend can be compiled to a standalone executable:

```bash
# Compile to single binary
bun run compile

# Run the binary (no runtime required)
./backend/dist/kubefoundry
```

## Environment Variables

### Frontend (.env)
```env
VITE_API_URL=http://localhost:3001
VITE_DEFAULT_NAMESPACE=kubefoundry
VITE_DEFAULT_HF_SECRET=hf-token-secret
```

### Backend (.env)
```env
PORT=3001
DEFAULT_NAMESPACE=kubefoundry
CORS_ORIGIN=http://localhost:5173
```

## Project Commands

### Root
```bash
bun run dev           # Start both frontend and backend
bun run build         # Build all packages
bun run compile       # Build single binary for backend
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

## Kubernetes Setup

### Create HuggingFace Token Secret
```bash
kubectl create secret generic hf-token-secret \
  --from-literal=HF_TOKEN="your-token" \
  -n kubefoundry
```

### Install NVIDIA Dynamo (via Helm)
```bash
helm repo add nvidia-dynamo https://nvidia.github.io/dynamo
helm repo update
helm install dynamo-operator nvidia-dynamo/dynamo \
  --namespace kubefoundry --create-namespace
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

# Create deployment
curl -X POST http://localhost:3001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-deployment",
    "namespace": "kubefoundry",
    "modelId": "Qwen/Qwen3-0.6B",
    "engine": "vllm",
    "mode": "aggregated",
    "replicas": 1,
    "hfTokenSecret": "hf-token-secret",
    "enforceEager": true
  }'
```

## Accessing Deployed Models

After deployment is running:

```bash
# Port-forward to the frontend service
kubectl port-forward svc/<deployment>-frontend 8000:8000 -n kubefoundry

# Test the model
curl http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-0.6B",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Troubleshooting

### Backend can't connect to cluster
- Verify kubectl is configured: `kubectl cluster-info`
- Check KUBECONFIG environment variable
- Ensure proper RBAC permissions

### Provider not detected as installed
- Check CRD exists: `kubectl get crd dynamographdeployments.dynamo.nvidia.com`
- Check operator deployment: `kubectl get deployments -n kubefoundry`

### Frontend can't reach backend
- Check CORS_ORIGIN matches frontend URL
- Verify backend is running on correct port
- Check browser console for errors
