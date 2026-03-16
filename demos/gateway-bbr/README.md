# Gateway Body-Based Routing (BBR) Demo

This demo deploys **two models** behind a **single Gateway** and validates that
[Body-Based Routing (BBR)](https://gateway-api-inference-extension.sigs.k8s.io/guides/serving-multiple-inference-pools-latest/)
correctly routes requests to the right model based on the `"model"` field in the
JSON request body.

Each `ModelDeployment` uses a **bring-your-own (BYO) HTTPRoute** — meaning you
create the HTTPRoute yourself and reference it via `spec.gateway.httpRouteRef`.
This prevents the controller from auto-creating routes and gives you full control
over routing rules, which is important when multiple models share one gateway.

## Architecture

```
                    ┌───────────────────────────────────────────────────────┐
                    │                  Kubernetes (Kind)                    │
                    │                                                       │
 ┌────────┐        │  ┌─────────┐     ┌──────────────┐                     │
 │ Client  │───────▶│  │ Gateway │────▶│  BBR (parses │                     │
 │         │        │  │ (Istio) │     │  request body│                     │
 └────────┘        │  └─────────┘     │  → sets header│                    │
                    │                  └──────┬───────┘                     │
                    │                         │ X-Gateway-Model-Name   │
                    │            ┌────────────┴────────────┐                │
                    │            ▼                         ▼                │
                    │   ┌──────────────┐          ┌──────────────┐         │
                    │   │ HTTPRoute    │          │ HTTPRoute    │         │
                    │   │ (model-a)    │          │ (model-b)    │         │
                    │   └──────┬───────┘          └──────┬───────┘         │
                    │          ▼                          ▼                │
                    │   ┌──────────────┐          ┌──────────────┐         │
                    │   │InferencePool │          │InferencePool │         │
                    │   │  + EPP       │          │  + EPP       │         │
                    │   └──────┬───────┘          └──────┬───────┘         │
                    │          ▼                          ▼                │
                    │   ┌──────────────┐          ┌──────────────┐         │
                    │   │  Model A Pod │          │  Model B Pod │         │
                    │   │ (llama3.2 1B)│          │ (gemma2 2B)  │         │
                    │   └──────────────┘          └──────────────┘         │
                    └───────────────────────────────────────────────────────┘
```

**Request flow:** Client → Gateway → BBR → HTTPRoute (matched by header) → InferencePool → EPP → Model Pod

## What This Demo Shows

1. **Two ModelDeployments** running behind a single inference Gateway
2. **BYO HTTPRoutes** — user-managed routes referenced via `spec.gateway.httpRouteRef`
3. **Body-Based Routing** — BBR parses the `"model"` field from the request body and sets the `X-Gateway-Model-Name` header so the correct HTTPRoute matches
4. **End-to-end inference** — curl requests with different model names are routed to the correct model

## Prerequisites

- **Docker** — for building images and running Kind
- **Go 1.25+** — for installing Kind and cloud-provider-kind
- **kubectl** — Kubernetes CLI
- **helm** — for installing KAITO and BBR
- **make** — GNU Make
- **kustomize** — for deploying the controller/provider
- **curl** and **jq** — for testing

## Quick Start

```bash
# From the repo root:
./demos/gateway-bbr/demo.sh
```

The script takes ~15–20 minutes end-to-end (most time is spent waiting for model
pods to pull images and start serving).

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `CLUSTER_NAME` | `airunway-bbr-demo` | Kind cluster name |
| `CONTROLLER_IMG` | `airunway-controller:demo` | Controller image tag |
| `KAITO_PROVIDER_IMG` | `kaito-provider:demo` | KAITO provider image tag |
| `SKIP_BUILD` | _(unset)_ | Set to `1` to skip Docker image builds (useful for re-runs) |
| `CLEANUP_ONLY` | _(unset)_ | Set to `1` to only delete the Kind cluster |

## What Gets Created

| Resource | Name | Description |
|---|---|---|
| Kind cluster | `airunway-bbr-demo` | Local Kubernetes cluster |
| Gateway | `inference-gateway` | Istio-backed inference gateway |
| ModelDeployment | `model-a` | First model (Llama 3.2 1B via KAITO) |
| ModelDeployment | `model-b` | Second model (Gemma 2 2B via KAITO) |
| HTTPRoute | `model-a-route` | BYO route for model-a |
| HTTPRoute | `model-b-route` | BYO route for model-b |
| InferencePool | `model-a` | Auto-created by controller |
| InferencePool | `model-b` | Auto-created by controller |
| Deployment | `model-a-epp` | Endpoint Picker Proxy for model-a |
| Deployment | `model-b-epp` | Endpoint Picker Proxy for model-b |

## BYO Gateway Configurations
If you are using Gateway API with AKS, you might also need add the following configuration to the Gateway resource: 
```yaml
  infrastructure:
    annotations:
      service.beta.kubernetes.io/port_80_health-probe_protocol: tcp
```
For more information, see [Using Gateway API with Azure](https://istio.io/latest/docs/setup/platform-setup/azure/#using-gateway-api-with-azure)

## BYO HTTPRoute Explained

By default, the AIRunway controller auto-creates an HTTPRoute per
`ModelDeployment`. When two models share one gateway, this can cause route
conflicts. The **BYO HTTPRoute** pattern solves this:

1. **You create the HTTPRoutes** (see [manifests/httproutes.yaml](manifests/httproutes.yaml))
2. **Reference them** in the `ModelDeployment` spec:
   ```yaml
   spec:
     gateway:
       enabled: true
       modelName: "llama-3.2-1b-instruct"
       httpRouteRef: "model-a-route"   # ← tells controller to skip auto-creation
   ```
3. The controller still creates the `InferencePool` and `EPP`, but skips HTTPRoute
   creation/deletion for that deployment

Each BYO HTTPRoute matches on the `X-Gateway-Model-Name` header (set by BBR)
so only the correct model's route is matched:

```yaml
rules:
  - matches:
      - headers:
          - type: Exact
            name: X-Gateway-Model-Name
            value: llama-3.2-1b-instruct          # ← BBR sets this from the request body
    backendRefs:
      - group: inference.networking.k8s.io
        kind: InferencePool
        name: model-a
```

> **Important:** Each HTTPRoute should match **only** on its specific model's
> header value. Do NOT add a bare path fallback match (without header) to any
> route — Istio may evaluate the fallback as a valid match for all requests,
> causing cross-model misrouting even when a more specific header match exists
> on another HTTPRoute.

## Cleanup

```bash
CLEANUP_ONLY=1 ./demos/gateway-bbr/demo.sh
```

Or manually:

```bash
kind delete cluster --name airunway-bbr-demo
```

## Troubleshooting

**Models stuck in Pending/Deploying phase:**
```bash
kubectl get modeldeployments -o wide
kubectl get workspaces
kubectl describe workspace model-a
kubectl get pods -l airunway.ai/model-deployment
```

**Gateway not routing correctly:**
```bash
# Check Gateway status
kubectl get gateway inference-gateway -o yaml

# Check HTTPRoutes are accepted
kubectl get httproutes -o wide

# Check InferencePools
kubectl get inferencepools -o wide

# Check EPP logs
kubectl logs -l app.kubernetes.io/name=model-a-epp
kubectl logs -l app.kubernetes.io/name=model-b-epp

# Check BBR logs
kubectl logs -l app.kubernetes.io/name=body-based-routing

# Check Istio logs
kubectl logs -n istio-system -l app=istiod --tail=50
```
