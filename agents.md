# KubeFoundry - Agent Instructions

## WHY: Project Purpose

**KubeFoundry** is a platform for deploying and managing machine learning models on Kubernetes. It provides a unified CRD abstraction (`ModelDeployment`) that works across multiple inference providers (KAITO, Dynamo, KubeRay, etc.).

## WHAT: Tech Stack & Structure

**Stack**:
- **Controller**: Go + Kubebuilder (Kubernetes operator)
- **Web UI**: React 18 + TypeScript + Vite (frontend) | Bun + Hono + Zod (backend)

**Key directories**:
- `controller/` - Go-based Kubernetes controller (kubebuilder project)
  - `controller/api/v1alpha1/` - CRD type definitions
  - `controller/internal/controller/` - Reconciliation logic
  - `controller/internal/webhook/` - Validation webhooks
  - `controller/config/` - Kustomize manifests for CRDs/RBAC
- `frontend/src/` - React components, hooks, pages
- `backend/src/` - Hono app, providers, services
- `shared/types/` - Shared TypeScript definitions
- `docs/` - Detailed documentation (read as needed)

**Core pattern**: Provider abstraction via CRDs:
- `ModelDeployment` - Unified API for deploying ML models
- `InferenceProviderConfig` - Provider registration with capabilities and selection rules

## HOW: Development Commands

### Controller (Go)
```bash
make controller-build       # Build Go controller binary
make controller-test        # Run controller tests
make controller-run         # Run controller locally
make controller-generate    # Regenerate CRDs and deepcopy code
make controller-install     # Install CRDs into cluster
make controller-deploy      # Deploy controller to cluster
```

### Web UI (TypeScript)
```bash
bun install              # Install dependencies
bun run dev              # Start dev servers (frontend + backend)
bun run test             # Run all tests (frontend + backend)
make compile             # Build single binary to dist/
make compile-all         # Cross-compile for all platforms
```

**After editing controller `*_types.go` files:**
```bash
cd controller && make manifests generate
```

**Always validate changes immediately after editing files:**
- After editing Go files: Run `go build ./...` and `go test ./...`
- After editing frontend/backend files: Check for TypeScript/syntax errors
- If errors are found: Fix them before proceeding
- Never hand back to the user with syntax or compile errors

## CRD Reference

### ModelDeployment
Unified API for deploying ML models. Key fields:
- `spec.model.id` - HuggingFace model ID or custom identifier
- `spec.model.source` - `huggingface` or `custom`
- `spec.engine.type` - `vllm`, `sglang`, `trtllm`, or `llamacpp`
- `spec.provider.name` - Optional explicit provider selection
- `spec.serving.mode` - `aggregated` (default) or `disaggregated`
- `spec.resources.gpu.count` - GPU count for aggregated mode
- `spec.scaling.prefill/decode` - Component scaling for disaggregated mode

### InferenceProviderConfig
Cluster-scoped resource for provider registration:
- `spec.capabilities.engines` - Supported inference engines
- `spec.capabilities.servingModes` - Supported serving modes
- `spec.capabilities.gpuSupport/cpuSupport` - Hardware support
- `spec.selectionRules` - CEL expressions for auto-selection
- `status.ready` - Provider health status

## Key Files Reference

### Controller
- CRD types: `controller/api/v1alpha1/modeldeployment_types.go`
- Provider config types: `controller/api/v1alpha1/inferenceproviderconfig_types.go`
- Reconciler: `controller/internal/controller/modeldeployment_controller.go`
- Webhook: `controller/internal/webhook/v1alpha1/modeldeployment_webhook.go`
- Main: `controller/cmd/main.go`

### Web UI
- Hono app (all routes): `backend/src/hono-app.ts`
- Provider interface: `backend/src/providers/types.ts`
- Provider registry: `backend/src/providers/index.ts`
- Kubernetes client: `backend/src/services/kubernetes.ts`
- Frontend API client: `frontend/src/lib/api.ts`

## Documentation (Progressive Disclosure)

Read these files **only when relevant** to your task:

| File | When to read |
|------|--------------|
| [controller/AGENTS.md](controller/AGENTS.md) | Kubebuilder conventions, scaffolding rules |
| [docs/architecture.md](docs/architecture.md) | Understanding system design, provider pattern |
| [docs/api.md](docs/api.md) | Working on REST endpoints or API client |
| [docs/development.md](docs/development.md) | Setup issues, build process, testing |
