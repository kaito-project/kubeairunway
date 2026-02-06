# KubeFoundry - Agent Instructions

## WHY: Project Purpose

**KubeFoundry** is a web-based platform for deploying and managing machine learning models on Kubernetes. It simplifies ML operations by providing a unified interface for multiple inference runtimes.

## WHAT: Tech Stack & Structure

**Stack**: React 18 + TypeScript + Vite (frontend) | Bun + Hono + Zod (backend) | Headlamp Plugin SDK (plugin) | Monorepo with shared types

**Key directories**:
- `frontend/src/` - React components, hooks, pages
- `backend/src/` - Hono app, providers, services
- `shared/types/` - Shared TypeScript definitions
- `plugins/headlamp/` - Headlamp dashboard plugin
- `docs/` - Detailed documentation (read as needed)

**Core pattern**: Provider abstraction - all inference runtime logic lives in `backend/src/providers/`. Each provider implements the `Provider` interface in `backend/src/providers/types.ts`.

**Headlamp plugin**: When working on `plugins/headlamp/`, read [plugins/headlamp/README.md](plugins/headlamp/README.md) for patterns and best practices. Key rules: use Headlamp's built-in components (`SectionBox`, `SimpleTable`, etc.), never bundle React, use `@kubefoundry/shared` for types/API.

## HOW: Development Commands

```bash
bun install              # Install dependencies
bun run dev              # Start dev servers (frontend + backend)
bun run test             # Run all tests (frontend + backend)
make compile             # Build single binary to dist/
make compile-all         # Cross-compile for all platforms
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
- After editing frontend files: Check for TypeScript/syntax errors using `get_errors` tool
- After editing backend files: Check for TypeScript/syntax errors using `get_errors` tool
- If errors are found: Fix them before proceeding or informing the user
- Never hand back to the user with syntax or compile errors

**Document your prompts:** When completing a task, summarize the key prompt(s) used so the human can include them in the PR. This supports the project's "prompt request" workflow where prompts are reviewed alongside (or instead of) code. See [CONTRIBUTING.md](CONTRIBUTING.md#ai-assisted-contributions--prompt-requests).

**Always update relevant documentation** (this file, `docs/`, `README.md`, `CONTRIBUTING.md`) after making architectural or stack changes.

## Documentation (Progressive Disclosure)

Read these files **only when relevant** to your task:

| File | When to read |
|------|--------------|
| [docs/architecture.md](docs/architecture.md) | Understanding system design, provider pattern, data flow |
| [docs/api.md](docs/api.md) | Working on REST endpoints or API client |
| [docs/development.md](docs/development.md) | Setup issues, build process, testing |
| [docs/standards.md](docs/standards.md) | Code style questions (prefer running linters instead) |
| [plugins/headlamp/README.md](plugins/headlamp/README.md) | Headlamp plugin development, patterns, components |

## Key Files Reference

### Backend
- Hono app (all routes): `backend/src/hono-app.ts`
- Provider interface: `backend/src/providers/types.ts`
- Provider registry: `backend/src/providers/index.ts`
- Kubernetes client: `backend/src/services/kubernetes.ts`
- Build-time constants: `backend/src/build-info.ts`
- Compile script: `backend/scripts/compile.ts`
- Asset embedding: `backend/scripts/embed-assets.ts`
- AIKit service (KAITO): `backend/src/services/aikit.ts`
- BuildKit service: `backend/src/services/buildkit.ts`
- Registry service: `backend/src/services/registry.ts`
- Metrics service: `backend/src/services/metrics.ts`
- Autoscaler service: `backend/src/services/autoscaler.ts`
- GPU validation: `backend/src/services/gpuValidation.ts`
- AI Configurator service: `backend/src/services/aiconfigurator.ts`
- AI Configurator routes: `backend/src/routes/aiconfigurator.ts`
- Cloud pricing service: `backend/src/services/cloudPricing.ts`
- Cost estimation service: `backend/src/services/costEstimation.ts`
- Cost routes: `backend/src/routes/costs.ts`
- Prometheus parser: `backend/src/lib/prometheus-parser.ts`
- K8s error handling: `backend/src/lib/k8s-errors.ts`

### Frontend
- Frontend API client: `frontend/src/lib/api.ts`

### Headlamp Plugin
- Plugin entry point: `plugins/headlamp/src/index.tsx`
- Route definitions: `plugins/headlamp/src/routes.ts`
- API client wrapper: `plugins/headlamp/src/lib/api-client.ts`
- Backend discovery: `plugins/headlamp/src/lib/backend-discovery.ts`
- Plugin storage: `plugins/headlamp/src/lib/plugin-storage.ts`
- Theme utilities: `plugins/headlamp/src/lib/theme.ts`
- Settings page: `plugins/headlamp/src/settings.tsx`
- Pages: `plugins/headlamp/src/pages/*.tsx`
- Components: `plugins/headlamp/src/components/*.tsx`
