# AI Runway Kubernetes Deployment

This directory contains Kubernetes manifests for deploying AI Runway to a cluster. The deployment is split into required, optional, and opt-in installer manifests:

- **`controller.yaml`** — CRDs, controller, webhooks, and RBAC (required)
- **`dashboard.yaml`** — Web UI dashboard deployment and service (optional)
- **`dashboard-installer-rbac.yaml`** — optional elevated RBAC for one-click provider installation from the dashboard

## Quick Start

```bash
# 1. Install CRDs and controller (required)
kubectl apply -f controller.yaml

# 2. Install one or more provider shims (required — registers providers with AI Runway)
# See "Available provider shims" below for the full list
kubectl apply -f https://raw.githubusercontent.com/kaito-project/airunway/main/providers/<provider>/deploy/<provider>.yaml

# 3. Install dashboard UI (optional)
kubectl apply -f dashboard.yaml

# 4. Optional: enable dashboard-driven provider installs
# This grants broad cluster-scoped installer permissions. See dashboard-installer-rbac.yaml below.
kubectl apply -f dashboard-installer-rbac.yaml
```

> **Note:** `controller.yaml` must be applied first — it creates the CRDs and namespace that the dashboard depends on. Provider shims must be installed before providers appear in the UI. Webhooks become fully functional after the controller starts and completes certificate rotation (~10-30s).

Available provider shims:
- [kaito.yaml](../providers/kaito/deploy/kaito.yaml)
- [dynamo.yaml](../providers/dynamo/deploy/dynamo.yaml)
- [kuberay.yaml](../providers/kuberay/deploy/kuberay.yaml)
- [llmd.yaml](../providers/llmd/deploy/llmd.yaml)

## Access AIRunway

After deploying the dashboard, access AI Runway using port-forward:

```bash
kubectl port-forward -n airunway-system svc/airunway 3001:80
```

Then open http://localhost:3001 in your browser.

## What's Included

### controller.yaml

| Resource | Description |
|----------|-------------|
| `Namespace` | `airunway-system` — dedicated namespace |
| `CustomResourceDefinition` | `ModelDeployment` CRD |
| `CustomResourceDefinition` | `InferenceProviderConfig` CRD |
| `Deployment` | Controller manager deployment |
| `ServiceAccount` | Service account for the controller |
| `ClusterRole` | RBAC permissions for CRD and Kubernetes resource access |
| `ClusterRoleBinding` | Binds cluster role to controller service account |
| `MutatingWebhookConfiguration` | Mutating admission webhook for `ModelDeployment` |
| `ValidatingWebhookConfiguration` | Validating admission webhook for `ModelDeployment` |
| `Service` | Webhook service endpoint |
| `Secret` | Webhook TLS certificate secret |
| `Service` | Controller metrics service |
| `Role` / `RoleBinding` | Leader election RBAC |


### dashboard-installer-rbac.yaml

This manifest is optional and should be applied only when you want the dashboard
to run Helm/kubectl for provider installation. Provider charts for KAITO, Dynamo,
and KubeRay create cluster-scoped resources such as CRDs, admission webhooks,
ClusterRoles, and ClusterRoleBindings. Kubernetes therefore requires elevated
installer permissions, including RBAC `bind` and `escalate`. Treat this as
cluster-admin-like access for the dashboard ServiceAccount.

If you do not apply this manifest, the dashboard can still show the manual
installation commands. Automatic install buttons will return a clear permission
message when the dashboard lacks installer permissions.

### dashboard.yaml

| Resource | Description |
|----------|-------------|
| `ServiceAccount` | Service account for the dashboard pod |
| `ClusterRole` | RBAC permissions for dashboard read access |
| `ClusterRoleBinding` | Binds cluster role to dashboard service account |
| `Deployment` | Dashboard web UI deployment |
| `Service` | ClusterIP service on port 80 |

## Configuration

### Dashboard Environment Variables

The following environment variables can be configured on the **dashboard** deployment in `dashboard.yaml`:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `AUTH_ENABLED` | `false` | Enable authentication |

### Enable Authentication

Uncomment the `AUTH_ENABLED` environment variable in the dashboard deployment:

```yaml
env:
  - name: AUTH_ENABLED
    value: "true"
```

## Verify Deployment

```bash
# Check all pods
kubectl get pods -n airunway-system

# Check services
kubectl get svc -n airunway-system

# View controller logs
kubectl logs -n airunway-system -l control-plane=controller-manager -f

# View dashboard logs
kubectl logs -n airunway-system -l app.kubernetes.io/name=airunway -f

# Test dashboard health endpoint
kubectl exec -it -n airunway-system deploy/airunway -- curl localhost:3001/api/health
```

## Uninstall

```bash
# Remove optional dashboard installer RBAC (if installed)
kubectl delete -f dashboard-installer-rbac.yaml

# Remove dashboard (if installed)
kubectl delete -f dashboard.yaml

# Remove controller, CRDs, and namespace
kubectl delete -f controller.yaml
```

## Metrics Feature

Once deployed in-cluster, AI Runway can fetch real-time metrics from inference deployments (vLLM, Ray Serve). This feature requires in-cluster deployment as it uses Kubernetes service DNS to reach metrics endpoints.
