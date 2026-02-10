# KubeAIRunway Kubernetes Deployment

This directory contains Kubernetes manifests for deploying KubeAIRunway to a cluster.

## Quick Start

```bash
# Deploy using kubectl
kubectl apply -f kubeairunway.yaml
```

## Access KubeAIRunway

After deployment, access KubeAIRunway using port-forward:

```bash
kubectl port-forward -n kubeairunway-system svc/kubeairunway 3001:80
```

Then open http://localhost:3001 in your browser.

## What's Included

| Resource | Description |
|----------|-------------|
| `Namespace` | `kubeairunway-system` - dedicated namespace |
| `ServiceAccount` | Service account for KubeAIRunway pod |
| `ClusterRole` | RBAC permissions for K8s and CRD access |
| `ClusterRoleBinding` | Binds role to service account |
| `Deployment` | KubeAIRunway server deployment |
| `Service` | ClusterIP service on port 80 |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `AUTH_ENABLED` | `false` | Enable authentication |

### Enable Authentication

Uncomment the `AUTH_ENABLED` environment variable in the deployment:

```yaml
env:
  - name: AUTH_ENABLED
    value: "true"
```

## Verify Deployment

```bash
# Check pods
kubectl get pods -n kubeairunway-system

# Check service
kubectl get svc -n kubeairunway-system

# View logs
kubectl logs -n kubeairunway-system -l app.kubernetes.io/name=kubeairunway -f

# Test health endpoint
kubectl exec -it -n kubeairunway-system deploy/kubeairunway -- curl localhost:3001/api/health
```

## Uninstall

```bash
kubectl delete -f kubeairunway.yaml
```

## Metrics Feature

Once deployed in-cluster, KubeAIRunway can fetch real-time metrics from inference deployments (vLLM, Ray Serve). This feature requires in-cluster deployment as it uses Kubernetes service DNS to reach metrics endpoints.
