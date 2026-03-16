# Architecture

## System Overview

AIRunway is a **fully decoupled** platform. The core value lives in the Kubernetes controller and CRDs. The UI is an optional, swappable layer that communicates exclusively through a REST API. Any frontend (Headlamp, a custom CLI, or the bundled React UI) can drive the same backend.

![AIRunway Architecture](architecture.png)

### Components at a Glance

Note: The UI layer shown above includes the Frontend layer and the Backend layer.

| Component                | Language              | Role                                                        | Required?        |
| ------------------------ | --------------------- | ----------------------------------------------------------- | ---------------- |
| **Controller**           | Go (Kubebuilder)      | Core operator — manages CRDs, provider selection, lifecycle | ✅ Yes            |
| **Provider Controllers** | Go                    | Out-of-tree controllers for KAITO, Dynamo, KubeRay, llmd          | ✅ Yes (1+)       |
| **Backend API**          | TypeScript (Hono/Bun) | REST API — proxies K8s operations, auth, model catalog      | Optional         |
| **React Frontend**       | React/TypeScript      | Bundled Web UI                                              | ❌ Swappable      |
| **Headlamp Plugin**      | React/TypeScript      | Alternative UI inside Headlamp dashboard                    | ❌ Swappable      |
| **Shared Types**         | TypeScript            | Shared API client & type contracts (`@airunway/shared`)  | Library          |
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
 │              │    AIRunway Controller   │  (core operator)           │
 │              │    • Validates specs         │                             │
 │              │    • Selects providers (CEL) │                             │
 │              │    • Manages CRD lifecycle   │                             │
 │              └──────┬───────────────┬───────┘                             │
 │                     │ watches       │ delegates                           │
 │                     ▼               ▼                                     │
 │  ┌──────────────────────┐  ┌──────────────────────────────────────────┐  │
 │  │  ModelDeployment     │  │     Provider Controllers (out-of-tree)   │  │
 │  │  (CRD)               │  │                                          │  │
 │  │                      │  │  ┌────────┐  ┌────────┐  ┌──────────┐┌───────┐  │  │
 │  │  InferenceProvider   │  │  │ KAITO  │  │ Dynamo │  │ KubeRay  ││ llmd  |  │  │
 │  │  Config (CRD)        │  │  └───┬────┘  └───┬────┘  └────┬─────┘└────┬──┘  │  │
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
2. **Shared type library** — `@airunway/shared` provides a typed API client and TypeScript types that any frontend can import. The Headlamp plugin already does this.
3. **Backend is optional** — The core platform (controller + CRDs) works without the backend/frontend. Users can manage `ModelDeployment` resources directly via `kubectl`, Terraform, GitOps, or any Kubernetes API client.
4. **Swappable frontends** — The bundled React UI, the Headlamp plugin, or any custom UI can all drive the same backend API simultaneously. No code changes needed.
5. **Auth is delegated** — Authentication uses Kubernetes `TokenReview`; the frontend simply passes a bearer token. Any UI that can obtain a K8s token works.

## Gateway API Integration

AIRunway optionally integrates with the [Gateway API Inference Extension](https://gateway-api.sigs.k8s.io/geps/gep-3567/) to provide a unified inference gateway. When Gateway API Custom Resources are detected in the cluster, the controller automatically creates an **InferencePool** and **HTTPRoute** for each `ModelDeployment`, allowing all models to be called through a single Gateway endpoint using body-based routing on the `model` field.

The feature is auto-detected at startup and silently disabled if the required CRDs are not present. See [Gateway Integration](gateway.md) for full details.

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
| [Gateway Integration](gateway.md) | Gateway API Inference Extension setup and usage |
| [Design Decisions](design-decisions.md) | Alternatives considered, testing strategy, known limitations, out of scope |
| [API Reference](api.md) | REST API endpoint documentation |
| [Development Guide](development.md) | Setup, build, and testing instructions |
