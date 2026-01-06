# Architecture

## System Overview

KubeFoundry is a monorepo with three packages:
- **frontend** - React SPA for user interaction
- **backend** - Hono API for Kubernetes operations (runs on Bun)
- **shared** - Common TypeScript types (imported directly by frontend and backend)

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│   Browser   │────▶│   Backend   │────▶│   Kubernetes     │
│  (React)    │◀────│   (Hono)    │◀────│   Cluster        │
└─────────────┘     └─────────────┘     └──────────────────┘
       │                   │
       │            ┌──────┴──────┐
       │            │  Provider   │
       │            │  Registry   │
       │            └─────────────┘
       │
       │  (when AUTH_ENABLED=true)
       │            ┌─────────────┐
       └───────────▶│ Auth        │───▶ TokenReview API
                    │ Middleware  │
                    └─────────────┘
```

## Authentication Flow

When `AUTH_ENABLED=true`, the system uses Kubernetes OIDC tokens:

```
┌──────────┐    kubefoundry login    ┌─────────────┐
│   CLI    │ ───────────────────────▶│  kubeconfig │
│          │◀───────────────────────│  (OIDC)     │
└────┬─────┘    extract token        └─────────────┘
     │
     │ open browser with #token=...
     ▼
┌──────────┐    save to localStorage  ┌─────────────┐
│ Browser  │ ────────────────────────▶│  Frontend   │
│          │                          │  (React)    │
└──────────┘                          └──────┬──────┘
                                             │
              Authorization: Bearer <token>  │
                                             ▼
                                      ┌─────────────┐
                                      │  Backend    │
                                      │  (Hono)     │
                                      └──────┬──────┘
                                             │
                          TokenReview API    │
                                             ▼
                                      ┌─────────────┐
                                      │  Kubernetes │
                                      │  API Server │
                                      └─────────────┘
```

## Provider Abstraction

The provider pattern enables support for multiple inference runtimes:

```typescript
interface Provider {
  id: string;
  name: string;
  description: string;

  // CRD configuration
  getCRDConfig(): CRDConfig;

  // Manifest generation and parsing
  generateManifest(config: DeploymentConfig): object;
  parseStatus(resource: object): DeploymentStatus;

  // Validation
  validateConfig(config: DeploymentConfig): ValidationResult;

  // Installation
  checkInstallation(k8s: KubernetesService): Promise<InstallationStatus>;
  getHelmRepos(): HelmRepo[];
  getHelmCharts(): HelmChart[];
  getInstallationSteps(): InstallationStep[];
}
```

### Supported Providers

| Provider | CRD | Status | Description |
|----------|-----|--------|-------------|
| NVIDIA Dynamo | DynamoGraphDeployment | ✅ Available | High-performance GPU inference with KV-cache routing |
| KubeRay | RayService | ✅ Available | Ray-based serving with autoscaling |
| KAITO | Pod/Deployment | ✅ Available | CPU-capable inference with pre-built GGUF models |

### KAITO Provider

The KAITO provider enables flexible inference with multiple backends:

- **vLLM Mode**: GPU inference using vLLM engine with full HuggingFace model support
- **Pre-made GGUF**: Ready-to-deploy quantized models from `ghcr.io/kaito-project/aikit/*`
- **HuggingFace GGUF**: Run any GGUF model from HuggingFace directly (no build required)
- **CPU/GPU Flexibility**: llama.cpp models can run on CPU nodes (no GPU required) or GPU nodes

| Mode | Engine | Compute | Use Case |
|------|--------|---------|----------|
| vLLM | vLLM | GPU | High-performance GPU inference |
| Pre-made GGUF | llama.cpp | CPU/GPU | Ready-to-deploy quantized models |
| HuggingFace GGUF | llama.cpp | CPU/GPU | Run any HuggingFace GGUF model |

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

## Data Models

### Model (Catalog Entry)
```typescript
interface Model {
  id: string;                    // HuggingFace model ID
  name: string;                  // Display name
  description: string;
  size: string;                  // Parameter count (e.g., "0.6B")
  task: 'text-generation' | 'chat';
  contextLength?: number;
  supportedEngines: Engine[];
  minGpuMemory?: string;
  gated?: boolean;               // Requires HuggingFace auth
  // Fields from HuggingFace search
  estimatedGpuMemory?: string;   // Estimated GPU memory (e.g., "16GB")
  estimatedGpuMemoryGb?: number; // Numeric GPU memory for comparisons
  parameterCount?: number;       // Parameter count from safetensors
  fromHfSearch?: boolean;        // True if from HF search (not curated)
}
```

### DeploymentConfig
```typescript
interface DeploymentConfig {
  name: string;                  // K8s resource name
  namespace: string;
  modelId: string;
  engine: 'vllm' | 'sglang' | 'trtllm';
  mode: 'aggregated' | 'disaggregated';
  replicas: number;
  hfTokenSecret: string;
  enforceEager: boolean;
  enablePrefixCaching: boolean;
  trustRemoteCode: boolean;
}
```

### DeploymentStatus
```typescript
interface DeploymentStatus {
  name: string;
  namespace: string;
  modelId: string;
  engine: Engine;
  phase: 'Pending' | 'Deploying' | 'Running' | 'Failed' | 'Terminating';
  replicas: { desired: number; ready: number; available: number; };
  pods: PodStatus[];
  createdAt: string;
}
```

## Configuration Storage

Settings are persisted in a Kubernetes ConfigMap:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: kubefoundry-config
  namespace: kubefoundry-system
data:
  config.json: |
    {
      "defaultNamespace": "kubefoundry-system"
    }
```

**Note:** Each deployment specifies its own runtime (`provider` field). There is no global "active provider" - users select the runtime when creating a deployment.

## Frontend Architecture

### Component Hierarchy
```
App
├── MainLayout
│   ├── Header (cluster status, warnings)
│   ├── Sidebar (navigation)
│   └── Page Content
│       ├── ModelsPage (tabs: Curated / HuggingFace Search)
│       │   ├── ModelGrid (curated models)
│       │   └── HfModelSearch (HuggingFace search with GPU fit indicators)
│       ├── DeployPage (GPU capacity warnings)
│       ├── DeploymentsPage
│       ├── DeploymentDetailsPage
│       ├── SettingsPage
```

### State Management
- **Server State**: TanStack Query for API data with caching
- **Local State**: React useState for UI state
- **Persistent State**: Browser localStorage for user preferences

## Backend Services

### KubernetesService
Handles all Kubernetes API interactions:
- List/create/delete custom resources for all providers
- Get pod status and logs
- Check cluster connectivity
- Namespace and node management
- Check GPU availability on nodes (`nvidia.com/gpu` resources)
- Detect GPU memory from node labels (`nvidia.com/gpu.memory` or `nvidia.com/gpu.product`)
- Get detailed GPU capacity with per-node and per-pool breakdown
- Check GPU Operator installation status (CRDs, pods)
- Get pod failure reasons from Kubernetes Events
- Delete CRDs and namespaces for complete provider uninstallation

### MetricsService
Fetches and processes Prometheus metrics from inference deployments:
- Connects to deployment metrics endpoints (when running in-cluster)
- Parses Prometheus text format
- Supports vLLM and llama.cpp metric formats
- Handles provider-specific metric configurations

### AutoscalerService
Detects and monitors cluster autoscaler:
- Detects autoscaler type (AKS managed, self-managed Cluster Autoscaler)
- Parses autoscaler status from ConfigMap
- Reports node group health and scaling status

### HuggingFaceService
Handles HuggingFace Hub API interactions:
- Search models with text-generation pipeline
- Filter by architecture compatibility (vLLM, SGLang, TRT-LLM)
- Estimate GPU memory from parameter count (~2GB/billion params × 1.2 overhead)
- Extract parameter counts from safetensors metadata
- OAuth token exchange for gated model access

### ConfigService
Manages application configuration:
- Read/write ConfigMap
- Get active provider
- Persist provider settings

### HelmService
Handles Helm CLI operations:
- Check Helm availability and version
- Add/update repositories
- Install/upgrade/uninstall charts with real-time output
- Detect stuck/pending releases and handle cleanup
- Install NVIDIA GPU Operator (`gpu-operator` namespace)

### AuthService
Handles authentication when `AUTH_ENABLED=true`:
- Validate tokens via Kubernetes TokenReview API
- Extract OIDC tokens from kubeconfig (for CLI login)
- Generate magic link URLs for browser authentication
- Store/load/clear credentials locally (`~/.kubefoundry/credentials.json`)

### RegistryService
Manages in-cluster container registry for KAITO image builds:
- Deploy and manage registry Deployment and Service
- Check registry readiness
- Generate registry URLs for in-cluster access

### BuildKitService
Manages BuildKit builder for KAITO custom images:
- Deploy BuildKit using Kubernetes driver
- Check builder status and readiness
- Build custom AIKit images from HuggingFace GGUF models

### AikitService
Handles KAITO/AIKit image operations:
- List available pre-made GGUF models
- Build custom images from HuggingFace GGUF files
- Generate image references for deployments

### AIConfiguratorService
Interfaces with NVIDIA AI Configurator for optimal inference configuration:
- Check if AI Configurator CLI is available locally (with 5-minute caching)
- Analyze model + GPU combinations to get optimal settings (tensor parallelism, batch size, etc.)
- Parse AI Configurator CSV output into deployment configuration
- Support aggregated and disaggregated serving modes
- Normalize GPU product labels to AI Configurator format
- Provide sensible defaults when AI Configurator is unavailable
- Input validation to prevent command injection attacks
- Automatic temp directory cleanup with try/finally pattern
