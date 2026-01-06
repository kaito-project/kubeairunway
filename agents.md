# KubeFoundry - Agent Instructions

## WHY: Project Purpose

**KubeFoundry** is a web-based platform for deploying and managing machine learning models on Kubernetes. It simplifies ML operations by providing a unified interface for multiple inference runtimes.

## WHAT: Tech Stack & Structure

**Stack**: React 18 + TypeScript + Vite (frontend) | Bun + Hono + Zod (backend) | Monorepo with shared types

**Key directories**:
- `frontend/src/` - React components, hooks, pages
- `backend/src/` - Hono app, providers, services
- `shared/types/` - Shared TypeScript definitions
- `docs/` - Detailed documentation (read as needed)

**Core pattern**: Provider abstraction - all inference runtime logic lives in `backend/src/providers/`. Each provider implements the `Provider` interface in `backend/src/providers/types.ts`.

## HOW: Development Commands

```bash
bun install              # Install dependencies
bun run dev              # Start dev servers (frontend + backend)
bun run test             # Run all tests (frontend + backend)
make compile             # Build single binary to dist/
make compile-all         # Cross-compile for all platforms
```

**Always run `bun run test` after implementing functionality to verify both frontend and backend changes.**

**Always validate changes immediately after editing files:**
- After editing frontend files: Check for TypeScript/syntax errors using `get_errors` tool
- After editing backend files: Check for TypeScript/syntax errors using `get_errors` tool
- If errors are found: Fix them before proceeding or informing the user
- Never hand back to the user with syntax or compile errors

**Always update relevant documentation** (this file, `docs/`, `README.md`, `CONTRIBUTING.md`) after making architectural or stack changes.

## Documentation (Progressive Disclosure)

Read these files **only when relevant** to your task:

| File | When to read |
|------|--------------|
| [docs/architecture.md](docs/architecture.md) | Understanding system design, provider pattern, data flow |
| [docs/api.md](docs/api.md) | Working on REST endpoints or API client |
| [docs/development.md](docs/development.md) | Setup issues, build process, testing |
| [docs/standards.md](docs/standards.md) | Code style questions (prefer running linters instead) |

## Key Files Reference

- Hono app (all routes): `backend/src/hono-app.ts`
- Provider interface: `backend/src/providers/types.ts`
- Provider registry: `backend/src/providers/index.ts`
- Kubernetes client: `backend/src/services/kubernetes.ts`
- Frontend API client: `frontend/src/lib/api.ts`
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
- Prometheus parser: `backend/src/lib/prometheus-parser.ts`
- K8s error handling: `backend/src/lib/k8s-errors.ts`
