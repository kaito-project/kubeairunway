# Architecture

## System Overview

KubeAIRunway is a **fully decoupled** platform. The core value lives in the Kubernetes controller and CRDs — the UI is an optional, swappable layer that communicates exclusively through a REST API. Any frontend (Headlamp, a custom CLI, or the bundled React UI) can drive the same backend.

### Components at a Glance

| Component                | Language              | Role                                                        | Required?        |
| ------------------------ | --------------------- | ----------------------------------------------------------- | ---------------- |
| **Controller**           | Go (Kubebuilder)      | Core operator — manages CRDs, provider selection, lifecycle | ✅ Yes            |
| **Provider Controllers** | Go                    | Out-of-tree controllers for KAITO, Dynamo, KubeRay          | ✅ Yes (1+)       |
| **Backend API**          | TypeScript (Hono/Bun) | REST API — proxies K8s operations, auth, model catalog      | Optional         |
| **React Frontend**       | React/TypeScript      | Bundled Web UI                                              | ❌ Swappable      |
| **Headlamp Plugin**      | React/TypeScript      | Alternative UI inside Headlamp dashboard                    | ❌ Swappable      |
| **Shared Types**         | TypeScript            | Shared API client & type contracts (`@kubeairunway/shared`)  | Library          |
| **kubectl / API**        | —                     | Direct CRD access via Kubernetes API                        | Always available |

### Component Architecture Diagram

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                     FRONTEND LAYER (swappable)                          │
 │                                                                          │
 │  Any of these can be used — or replaced — independently:                │
 │                                                                          │
 │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐  │
 │  │  React UI    │  │  Headlamp    │  │  Any Custom UI / CLI         │  │
 │  │  (bundled)   │  │  Plugin      │  │  (dashboard, portal, etc.)   │  │
 │  └──────┬───────┘  └──────┬───────┘  └──────────────┬───────────────┘  │
 │         │                 │                          │                   │
 └─────────┼─────────────────┼──────────────────────────┼───────────────────┘
           │                 │                          │
           │        REST API (JSON over HTTP)           │
           │         /api/deployments                   │
           │         /api/models                        │
           │         /api/runtimes                      │
           │         /api/health ...                    │
           ▼                 ▼                          ▼
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                      BACKEND API LAYER                                   │
 │                                                                          │
 │  ┌────────────────────────────────────────────────────────────────────┐  │
 │  │  Hono REST API  (Bun runtime)                                     │  │
 │  │                                                                    │  │
 │  │  • Auth middleware (K8s TokenReview)                               │  │
 │  │  • Model catalog & HuggingFace integration                        │  │
 │  │  • Deployment CRUD, metrics, logs                                 │  │
 │  │  • Runtime installation (Helm)                                    │  │
 │  │  • GPU validation, cost estimation                                │  │
 │  │  • Provider-agnostic — reads InferenceProviderConfig CRDs         │  │
 │  └──────────────────────────┬─────────────────────────────────────────┘  │
 └─────────────────────────────┼────────────────────────────────────────────┘
                               │
                  Kubernetes API (client-go / @kubernetes/client-node)
                               │
 ┌─────────────────────────────┼────────────────────────────────────────────┐
 │                    KUBERNETES CLUSTER                                     │
 │                             │                                             │
 │              ┌──────────────▼──────────────┐                             │
 │              │    KubeAIRunway Controller   │  (core operator)           │
 │              │    • Validates specs         │                             │
 │              │    • Selects providers (CEL) │                             │
 │              │    • Manages CRD lifecycle   │                             │
 │              └──────┬───────────────┬───────┘                             │
 │                     │ watches       │ delegates                           │
 │                     ▼               ▼                                     │
 │  ┌──────────────────────┐  ┌──────────────────────────────────────────┐  │
 │  │  ModelDeployment     │  │     Provider Controllers (out-of-tree)   │  │
 │  │  (CRD)               │  │                                          │  │
 │  │                      │  │  ┌────────┐  ┌────────┐  ┌──────────┐   │  │
 │  │  InferenceProvider   │  │  │ KAITO  │  │ Dynamo │  │ KubeRay  │   │  │
 │  │  Config (CRD)        │  │  └───┬────┘  └───┬────┘  └────┬─────┘   │  │
 │  └──────────────────────┘  │      │           │            │          │  │
 │                             │      ▼           ▼            ▼          │  │
 │                             │  ┌────────┐  ┌────────┐  ┌──────────┐   │  │
 │                             │  │KAITO   │  │Dynamo  │  │RayService│   │  │
 │                             │  │Workspace│  │Graph   │  │          │   │  │
 │                             │  └────────┘  └────────┘  └──────────┘   │  │
 │                             └──────────────────────────────────────────┘  │
 │                                                                           │
 │              ┌────────────────────────────────────────────┐               │
 │              │        Inference Pods (GPU/CPU)            │               │
 │              │  Running vLLM, sglang, TRT-LLM, llama.cpp │               │
 │              └────────────────────────────────────────────┘               │
 └───────────────────────────────────────────────────────────────────────────┘
```

### Why the Frontend Is Fully Decoupled

1. **REST-only contract** — The frontend communicates with the backend exclusively via `HTTP/JSON`. There is no shared state, no server-side rendering, and no session affinity.
2. **Shared type library** — `@kubeairunway/shared` provides a typed API client and TypeScript types that any frontend can import. The Headlamp plugin already does this.
3. **Backend is optional** — The core platform (controller + CRDs) works without the backend/frontend. Users can manage `ModelDeployment` resources directly via `kubectl`, Terraform, GitOps, or any Kubernetes API client.
4. **Swappable frontends** — The bundled React UI, the Headlamp plugin, or any custom UI can all drive the same backend API simultaneously. No code changes needed.
5. **Auth is delegated** — Authentication uses Kubernetes `TokenReview`; the frontend simply passes a bearer token. Any UI that can obtain a K8s token works.

## Documentation

For detailed documentation on specific topics, see:

| Document | Description |
|----------|-------------|
| [Controller Architecture](controller-architecture.md) | Reconciliation model, status ownership, drift detection, owner references, finalizers, update semantics, validation webhook, RBAC |
| [CRD Reference](crd-reference.md) | ModelDeployment and InferenceProviderConfig CRD specifications |
| [Providers](providers.md) | Provider selection algorithm, capability matrix, provider abstraction, KAITO details |
| [Web UI Architecture](web-ui-architecture.md) | Backend API, authentication flow, data models, frontend architecture, backend services |
| [Headlamp Plugin](headlamp-plugin.md) | Headlamp dashboard plugin architecture and design |
| [Observability](observability.md) | Prometheus metrics and Kubernetes events |
| [Versioning & Upgrades](versioning-upgrades.md) | API versioning strategy, controller upgrades, compatibility matrix |
| [Design Decisions](design-decisions.md) | Alternatives considered, testing strategy, known limitations, out of scope |
| [API Reference](api.md) | REST API endpoint documentation |
| [Development Guide](development.md) | Setup, build, and testing instructions |
