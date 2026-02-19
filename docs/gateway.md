# Gateway API Inference Extension Integration

## Overview

KubeAIRunway integrates with the [Gateway API Inference Extension](https://github.com/kubernetes-sigs/gateway-api-inference-extension) to provide a unified inference gateway. Instead of port-forwarding to each model's Service individually, you deploy a single Gateway and call **all** models through one endpoint using the standard OpenAI-compatible API. The Gateway routes requests to the correct model based on the `model` field in the request body.

When gateway integration is active, KubeAIRunway automatically creates an **InferencePool** and an **HTTPRoute** for each `ModelDeployment`. You only need to provide the Gateway itself.

## Architecture

```
                     ┌───────────────────────────────────────────────┐
                     │              Kubernetes Cluster               │
                     │                                               │
 ┌────────┐         │  ┌─────────┐       ┌───────────┐              │
 │ Client  │────────▶│  │ Gateway │──────▶│ HTTPRoute │              │
 │ (curl/  │         │  │         │  BBR  │           │              │
 │ openai) │         │  └─────────┘       └─────┬─────┘              │
 └────────┘         │                          │                     │
                     │                          ▼                     │
                     │                  ┌───────────────┐             │
                     │                  │ InferencePool │             │
                     │                  │ (auto-created)│             │
                     │                  └───────┬───────┘             │
                     │                          │                     │
                     │                          ▼                     │
                     │                  ┌───────────────┐             │
                     │                  │  Model Server  │             │
                     │                  │  Pod (vLLM,    │             │
                     │                  │  sglang, etc.) │             │
                     │                  └───────────────┘             │
                     └───────────────────────────────────────────────┘
```

**Request flow:** Client → Gateway → Body-Based Routing (BBR) → HTTPRoute → InferencePool → Endpoint Picker (EPP) → Model Server Pod

**What KubeAIRunway creates automatically:**
- `InferencePool` — selects pods labeled with `kubeairunway.ai/model-deployment: <name>` on the model's serving port
- `HTTPRoute` — routes from the Gateway to the InferencePool

**What you provide:**
- A Gateway resource (with any compatible implementation)

## Prerequisites

- Kubernetes cluster with [Gateway API CRDs](https://gateway-api.sigs.k8s.io/guides/#installing-gateway-api) installed
- [Gateway API Inference Extension CRDs](https://github.com/kubernetes-sigs/gateway-api-inference-extension) installed (provides `InferencePool`)
- A compatible gateway implementation (see below)

## Compatible Gateway Implementations

| Implementation | `gatewayClassName` | Status | Docs |
|---|---|---|---|
| [Envoy Gateway](https://gateway.envoyproxy.io/) | `eg` | GA support | [Inference Extension guide](https://gateway.envoyproxy.io/docs/tasks/ai-gateway/gateway-api-inference-extension/) |
| [Istio](https://istio.io/) | `istio` | Supported | [Inference Extension guide](https://istio.io/latest/docs/tasks/traffic-management/inference/) |
| [kgateway](https://kgateway.dev/) | `kgateway` | Supported | [Inference Extension guide](https://kgateway.dev/docs/ai/gateway-api-inference-extension/) |
| [GKE Gateway](https://cloud.google.com/kubernetes-engine/docs/concepts/gateway-api) | `gke-l7-rilb` | Supported | [GKE Inference guide](https://cloud.google.com/kubernetes-engine/docs/how-to/serve-llms-with-gateway-api) |

> **Note:** The only difference between implementations is the `gatewayClassName` in your Gateway resource. All KubeAIRunway-managed resources (InferencePool, HTTPRoute) are identical regardless of which gateway you use.

## Setup

### Step 1: Install Gateway API CRDs

```bash
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/latest/download/standard-install.yaml
```

### Step 2: Install Gateway API Inference Extension CRDs

```bash
kubectl apply -f https://github.com/kubernetes-sigs/gateway-api-inference-extension/releases/latest/download/manifests.yaml
```

### Step 3: Install a Gateway Implementation

Follow the installation guide for your chosen implementation:

- **Envoy Gateway:** [quickstart](https://gateway.envoyproxy.io/docs/tasks/quickstart/)
- **Istio:** [getting started](https://istio.io/latest/docs/setup/getting-started/)
- **kgateway:** [quickstart](https://kgateway.dev/docs/quickstart/)
- **GKE Gateway:** [enable Gateway controller](https://cloud.google.com/kubernetes-engine/docs/how-to/deploying-gateways)

> [!NOTE]
> **Istio:** Inference Extension support must be explicitly enabled by setting `ENABLE_INFERENCE_EXTENSION=true` on the `istiod` deployment (or passing `--set values.pilot.env.ENABLE_INFERENCE_EXTENSION=true` during `istioctl install`). Without this, Istio ignores InferencePool backend refs in HTTPRoutes. The `minimal` profile is sufficient — Istio auto-creates a gateway deployment and LoadBalancer Service when you create a Gateway resource. See the [Istio Inference Extension guide](https://istio.io/latest/docs/tasks/traffic-management/inference/) for full details.

### Step 4: Create a Gateway Resource

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: inference-gateway
  namespace: default
spec:
  gatewayClassName: eg  # Change to match your implementation
  listeners:
    - name: http
      protocol: HTTP
      port: 80
```

If you have multiple Gateways in the cluster, label the one to use for inference:

```yaml
metadata:
  labels:
    kubeairunway.ai/inference-gateway: "true"
```

### Step 5: Deploy Models

Deploy models as usual. KubeAIRunway automatically creates the InferencePool and HTTPRoute:

```yaml
apiVersion: kubeairunway.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: qwen3
  namespace: default
spec:
  model:
    id: "Qwen/Qwen3-0.6B"
```

The `ModelDeployment` status will show gateway information once ready:

```bash
kubectl get modeldeployment qwen3 -o jsonpath='{.status.gateway}'
```

## Configuration

### Auto-detection

The controller auto-detects Gateway API Inference Extension CRDs at startup by querying the Kubernetes discovery API. If the CRDs (`InferencePool`, `HTTPRoute`, `Gateway`) are present, gateway integration is enabled. If not, it is silently disabled — no errors, no resources created.

### Explicit Gateway Selection

If you have multiple Gateways or want deterministic behavior, use controller flags:

```
--gateway-name=inference-gateway
--gateway-namespace=default
```

When set, the controller always uses the specified Gateway as the HTTPRoute parent instead of auto-detecting.

### Endpoint Picker (EPP) Configuration

The InferencePool requires a reference to an Endpoint Picker extension service. By default the controller uses:

```
--epp-service-name=kubeairunway-epp   # EPP Service name
--epp-service-port=9002               # EPP Service port
```

Override these if your EPP service has a different name or port.

### Auto-detection with Multiple Gateways

When no explicit gateway is configured and multiple Gateway resources exist in the cluster, the controller looks for one labeled with:

```yaml
kubeairunway.ai/inference-gateway: "true"
```

If no labeled Gateway is found, the controller skips gateway reconciliation and sets the `GatewayReady` condition to `False`.

### Per-deployment Configuration

Each `ModelDeployment` can override gateway behavior:

```yaml
spec:
  gateway:
    # Disable gateway integration for this specific deployment
    enabled: false
    # Override the model name used in routing (defaults to auto-discovered from /v1/models, or spec.model.id)
    modelName: "my-custom-model-name"
```

| Field | Default | Description |
|---|---|---|
| `spec.gateway.enabled` | `true` (when Gateway detected) | Set to `false` to skip InferencePool/HTTPRoute creation |
| `spec.gateway.modelName` | Auto-discovered or `spec.model.id` | Model name used for routing and in API requests |

### Model Name Resolution

The controller resolves the gateway model name using this priority:

1. **`spec.gateway.modelName`** — explicit override, always wins
2. **`spec.model.servedName`** — user-specified served name
3. **Auto-discovered from `/v1/models`** — the controller probes the running model server's OpenAI-compatible `/v1/models` endpoint and uses the first model ID returned. This handles baked-in images where the served name differs from `spec.model.id`.
4. **`spec.model.id`** — final fallback

Auto-discovery runs only when the deployment reaches `Running` phase. If the probe fails (timeout, error, no models), it silently falls through to the next level.

## Using the Gateway

### Finding the Gateway Endpoint

```bash
# Get the Gateway address
kubectl get gateway inference-gateway -o jsonpath='{.status.addresses[0].value}'

# Or check the ModelDeployment status
kubectl get modeldeployment qwen3 -o jsonpath='{.status.gateway.endpoint}'
```

### Calling Models via curl

```bash
GATEWAY_IP=$(kubectl get gateway inference-gateway -o jsonpath='{.status.addresses[0].value}')

curl http://${GATEWAY_IP}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-0.6B",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Calling Models via Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    base_url=f"http://{GATEWAY_IP}/v1",
    api_key="unused",  # No auth by default
)

response = client.chat.completions.create(
    model="Qwen/Qwen3-0.6B",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(response.choices[0].message.content)
```

### Multiple Models, One Endpoint

The gateway routes to the correct model based on the `model` field in the request body. Deploy multiple models and call them all through the same endpoint:

```bash
# Call model A
curl http://${GATEWAY_IP}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "Qwen/Qwen3-0.6B", "messages": [{"role": "user", "content": "Hi"}]}'

# Call model B through the same endpoint
curl http://${GATEWAY_IP}/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "meta-llama/Llama-3.1-8B-Instruct", "messages": [{"role": "user", "content": "Hi"}]}'
```

## Troubleshooting

### Gateway integration is not activating

**Symptom:** No InferencePool or HTTPRoute created for deployments.

1. Check that CRDs are installed:
   ```bash
   kubectl api-resources | grep -E "inferencepools|httproutes|gateways"
   ```
2. Check controller logs for detection messages:
   ```bash
   kubectl logs -n kubeairunway-system deploy/kubeairunway-controller | grep -i gateway
   ```
3. If CRDs were installed after the controller started, restart the controller to refresh detection.

### GatewayReady condition is False

**Symptom:** `ModelDeployment` has `GatewayReady=False`.

1. Check the condition message:
   ```bash
   kubectl get modeldeployment <name> -o jsonpath='{.status.conditions}' | jq '.[] | select(.type=="GatewayReady")'
   ```
2. Common reasons:
   - **NoGateway** — No Gateway resource found. Create one or set `--gateway-name`/`--gateway-namespace`.
   - **Multiple Gateways** — Multiple Gateways exist but none is labeled `kubeairunway.ai/inference-gateway=true`.
   - **InferencePoolFailed** / **HTTPRouteFailed** — RBAC issue or CRD version mismatch.

### Requests return 404 or connection refused

1. Verify the Gateway has an address:
   ```bash
   kubectl get gateway inference-gateway -o jsonpath='{.status.addresses}'
   ```
2. Verify the HTTPRoute is accepted:
   ```bash
   kubectl get httproute <deployment-name> -o yaml
   ```
3. Verify the InferencePool matches running pods:
   ```bash
   kubectl get inferencepool <deployment-name> -o yaml
   kubectl get pods -l kubeairunway.ai/model-deployment=<deployment-name>
   ```

### Istio-specific issues

Ensure the `ENABLE_INFERENCE_EXTENSION=true` environment variable is set on the `istiod` deployment:

```bash
kubectl set env deployment/istiod -n istio-system ENABLE_INFERENCE_EXTENSION=true
```
