# KubeAIRunway - Agent Instructions

## WHY: Project Purpose

**KubeAIRunway** is a platform for deploying and managing machine learning models on Kubernetes. It provides a unified CRD abstraction (`ModelDeployment`) that works across multiple inference providers (KAITO, Dynamo, KubeRay, etc.).

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
- `plugins/headlamp/` - Headlamp dashboard plugin
- `docs/` - Detailed documentation (read as needed)

**Core pattern**: Provider abstraction via CRDs:
- `ModelDeployment` - Unified API for deploying ML models
- `InferenceProviderConfig` - Provider registration with capabilities and selection rules

**Headlamp plugin**: When working on `plugins/headlamp/`, read [plugins/headlamp/README.md](plugins/headlamp/README.md) for patterns and best practices. Key rules: use Headlamp's built-in components (`SectionBox`, `SimpleTable`, etc.), never bundle React, use `@kubeairunway/shared` for types/API.

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

### Headlamp Plugin Commands

```bash
cd plugins/headlamp
bun install              # Install plugin dependencies
bun run build            # Build plugin
bun run start            # Development mode with auto-rebuild
bun run test             # Run plugin tests
make setup               # Install deps, build, and deploy to Headlamp
make dev                 # Build and deploy for development
```

**Always run `bun run test` after implementing functionality to verify both frontend and backend changes.**

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
- `spec.engine.type` - `vllm`, `sglang`, `trtllm`, or `llamacpp` (optional, auto-selected from provider capabilities)
- `spec.provider.name` - Optional explicit provider selection
- `spec.serving.mode` - `aggregated` (default) or `disaggregated`
- `spec.resources.gpu.count` - GPU count for aggregated mode
- `spec.scaling.prefill/decode` - Component scaling for disaggregated mode
- `spec.gateway.enabled` - Optional: disable gateway integration for this deployment
- `spec.gateway.modelName` - Optional: override model name for gateway routing

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
- Gateway reconciler: `controller/internal/controller/gateway_reconciler.go`
- Gateway detection: `controller/internal/gateway/detection.go`
- Webhook: `controller/internal/webhook/v1alpha1/modeldeployment_webhook.go`
- Main: `controller/cmd/main.go`

### Web UI
- Hono app (all routes): `backend/src/hono-app.ts`
- Provider interface: `backend/src/providers/types.ts`
- Provider registry: `backend/src/providers/index.ts`
- Kubernetes client: `backend/src/services/kubernetes.ts`
- Gateway routes: `backend/src/routes/gateway.ts`
- Frontend API client: `frontend/src/lib/api.ts`

## Documentation (Progressive Disclosure)

Read these files **only when relevant** to your task:

| File | When to read |
|------|--------------|
| [controller/AGENTS.md](controller/AGENTS.md) | Kubebuilder conventions, scaffolding rules |
| [docs/architecture.md](docs/architecture.md) | System overview and component diagram |
| [docs/controller-architecture.md](docs/controller-architecture.md) | Controller internals, reconciliation, webhooks, RBAC |
| [docs/providers.md](docs/providers.md) | Provider selection and capabilities |
| [docs/crd-reference.md](docs/crd-reference.md) | CRD specifications (ModelDeployment, InferenceProviderConfig) |
| [docs/web-ui-architecture.md](docs/web-ui-architecture.md) | Web UI, auth flow, backend services |
| [docs/api.md](docs/api.md) | Working on REST endpoints or API client |
| [docs/development.md](docs/development.md) | Setup issues, build process, testing |
| [docs/gateway.md](docs/gateway.md) | Gateway API Inference Extension integration |
| [docs/standards.md](docs/standards.md) | Code style questions (prefer running linters instead) |
| [plugins/headlamp/README.md](plugins/headlamp/README.md) | Headlamp plugin development, patterns, components |
