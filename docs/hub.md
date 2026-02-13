# Hub Mode

Hub mode transforms KubeAIRunway into a multi-instance portal for managing ML deployments across multiple Kubernetes clusters. It adds OAuth authentication, RBAC, and centralized instance management.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        Hub Portal                            │
│  ┌─────────┐   ┌─────────────┐   ┌────────────────────────┐ │
│  │ Browser  │──▶│  Backend    │──▶│  Database (PG/SQLite)  │ │
│  │ (React)  │◀──│  (Hono)     │   └────────────────────────┘ │
│  └─────────┘   └──────┬──────┘                               │
│       │               │                                      │
│       │    ┌──────────┴──────────┐                           │
│       │    │  OAuth Providers    │                           │
│       │    │  (Entra / GitHub)   │                           │
│       │    └─────────────────────┘                           │
│       │                                                      │
│       │    ┌──────────────────────────────────────────┐      │
│       │    │          Instance Manager                │      │
│       │    │  ┌───────────┐ ┌───────────┐ ┌────────┐ │      │
│       │    │  │ Cluster A │ │ Cluster B │ │Cluster…│ │      │
│       │    │  │ (kubeconfig)│(kubeconfig)│(kubeconfig)│      │
│       │    │  └─────┬─────┘ └─────┬─────┘ └───┬────┘ │      │
│       │    └────────┼─────────────┼────────────┼─────┘      │
└───────┼─────────────┼─────────────┼────────────┼─────────────┘
        │             ▼             ▼            ▼
        │      ┌───────────┐ ┌───────────┐ ┌───────────┐
        │      │  K8s API  │ │  K8s API  │ │  K8s API  │
        │      │  Server A │ │  Server B │ │  Server … │
        │      └───────────┘ └───────────┘ └───────────┘
        │
        │  (OAuth flow)
        ▼
  ┌───────────────┐
  │ Identity      │
  │ Provider      │
  │ (Entra/GitHub)│
  └───────────────┘
```

### Key Features

- **OAuth Login** — Sign in with Azure Entra ID or GitHub
- **Instance Management** — Register and monitor multiple Kubernetes clusters
- **RBAC** — Role-based access with admin, deployer, and viewer roles
- **Group Sync** — Map Azure Entra ID groups to roles automatically
- **Credential Management** — Securely store and refresh kubeconfig files
- **Proxy API** — Deploy and manage models across clusters from a single interface

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `HUB_MODE` | Enable hub mode (`true` or `1`) | Yes (for hub) | `false` |
| `DATABASE_URL` | Database connection string. `postgres://...` for PostgreSQL, file path for SQLite | No | `./data/kubefoundry.db` (SQLite) |
| `SESSION_SECRET` | JWT signing key for session tokens | Yes (for hub) | `dev-secret-change-in-production` |
| `CREDENTIALS_PATH` | Directory containing cluster kubeconfig files | No | `./credentials` |
| `ENABLED_AUTH_PROVIDERS` | Comma-separated list of OAuth providers (`entra`, `github`) | Yes (for hub) | (empty) |
| `AZURE_TENANT_ID` | Azure Entra ID tenant ID | If using Entra | — |
| `AZURE_CLIENT_ID` | Azure Entra ID app registration client ID | If using Entra | — |
| `AZURE_CLIENT_SECRET` | Azure Entra ID client secret | If using Entra | — |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | If using GitHub | — |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | If using GitHub | — |
| `AUTH_CALLBACK_URL` | Base URL for OAuth callbacks (e.g., `https://hub.example.com`) | No | Auto-detected from request |

## Azure Entra ID Setup

### 1. Register an App

1. Go to [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations**
2. Click **New registration**
3. Set a name (e.g., `KubeAIRunway Hub`)
4. Under **Supported account types**, select **Single tenant** (or multi-tenant if needed)
5. Click **Register**

### 2. Configure Redirect URIs

1. In the app registration, go to **Authentication**
2. Click **Add a platform** → **Web**
3. Add the redirect URI:
   - Local development: `http://localhost:3001/api/auth/callback/entra`
   - Production: `https://hub.example.com/api/auth/callback/entra`
4. Save

### 3. Add API Permissions

1. Go to **API permissions** → **Add a permission**
2. Select **Microsoft Graph** → **Delegated permissions**
3. Add:
   - `User.Read` — Sign in and read user profile
   - `GroupMember.Read.All` — Read group memberships (required for group sync)
4. Click **Grant admin consent** for your organization

### 4. Configure Group Claims (Optional)

To automatically sync Azure Entra groups to hub roles:

1. Go to **Token configuration** → **Add groups claim**
2. Select **Security groups**
3. Under **ID token**, select **Group ID**
4. Save

### 5. Create Client Secret

1. Go to **Certificates & secrets** → **New client secret**
2. Set a description and expiration period
3. Copy the secret **Value** immediately (it won't be shown again)

### 6. Set Environment Variables

```bash
export AZURE_TENANT_ID="your-tenant-id"          # From Overview → Directory (tenant) ID
export AZURE_CLIENT_ID="your-client-id"           # From Overview → Application (client) ID
export AZURE_CLIENT_SECRET="your-client-secret"   # From step 5
export ENABLED_AUTH_PROVIDERS="entra"
```

## GitHub OAuth App Setup

### 1. Create OAuth App

1. Go to [GitHub Settings](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**
2. Fill in:
   - **Application name**: `KubeAIRunway Hub`
   - **Homepage URL**: `https://hub.example.com` (or `http://localhost:3001` for dev)
   - **Authorization callback URL**: `https://hub.example.com/api/auth/callback/github` (or `http://localhost:3001/api/auth/callback/github`)
3. Click **Register application**

### 2. Generate Client Secret

1. On the OAuth App page, click **Generate a new client secret**
2. Copy the secret immediately

### 3. Set Environment Variables

```bash
export GITHUB_CLIENT_ID="your-client-id"
export GITHUB_CLIENT_SECRET="your-client-secret"
export ENABLED_AUTH_PROVIDERS="github"
```

> **Tip:** To enable both providers, set `ENABLED_AUTH_PROVIDERS="entra,github"`.

## Credential Management

### Adding Cluster Credentials

Place kubeconfig files in the credentials directory (default: `./credentials`):

```bash
mkdir -p credentials
cp ~/.kube/config credentials/my-cluster.kubeconfig
```

**File naming convention:** `<instance-name>.kubeconfig`

The instance name is derived from the filename (without extension). For example, `prod-east.kubeconfig` creates an instance named `prod-east`.

### Auto-Refresh via CSI Driver

In production, credentials can be mounted via a CSI driver (e.g., Azure Key Vault CSI):

```yaml
volumes:
  - name: credentials
    csi:
      driver: secrets-store.csi.k8s.io
      readOnly: true
      volumeAttributes:
        secretProviderClass: kubefoundry-credentials
```

The credentials service watches the directory for changes and automatically refreshes connections.

### Manual Refresh for Development

During development, simply copy or update kubeconfig files in the credentials directory. The file watcher detects changes and reconnects automatically.

## RBAC Model

### Roles

| Role | Level | Description |
|------|-------|-------------|
| `admin` | 3 | Full access — manage users, roles, group mappings, all instances |
| `deployer` | 2 | Deploy and manage models within assigned namespaces |
| `viewer` | 1 | Read-only access to assigned instances |

Roles are hierarchical: a higher-level role includes all permissions of lower-level roles.

### Permissions

| Permission | Admin | Deployer | Viewer |
|------------|-------|----------|--------|
| View instances | ✅ | ✅ | ✅ |
| View deployments | ✅ | ✅ | ✅ |
| Create/delete deployments | ✅ | ✅ (namespaced) | ❌ |
| Manage users and roles | ✅ | ❌ | ❌ |
| Manage group mappings | ✅ | ❌ | ❌ |
| Register/remove instances | ✅ | ❌ | ❌ |

### Namespace Isolation

Deployer roles can be scoped to specific namespaces. When assigning a deployer role, specify which namespaces the user can deploy to:

```json
{
  "role": "deployer",
  "instanceId": "prod-east",
  "namespaces": ["ml-team", "data-science"]
}
```

### Group-Based Access (Azure Entra)

Map Azure Entra groups to hub roles for automatic access provisioning:

1. Configure group claims in your Azure App Registration (see [Azure Entra ID Setup](#4-configure-group-claims-optional))
2. Create group mappings via the Admin API:

```bash
curl -X POST https://hub.example.com/api/admin/group-mappings \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "azure-group-object-id",
    "groupName": "ML Engineers",
    "role": "deployer",
    "instanceId": "prod-east",
    "namespaces": ["ml-team"]
  }'
```

When users sign in via Entra, their group memberships are checked and roles are assigned automatically.

## Development Setup

Quick start for local development with hub mode:

```bash
# 1. Set up environment
export HUB_MODE=true
export ENABLED_AUTH_PROVIDERS=github
export GITHUB_CLIENT_ID=your-client-id
export GITHUB_CLIENT_SECRET=your-client-secret
export SESSION_SECRET=dev-secret-$(openssl rand -hex 16)

# 2. Add cluster credentials
mkdir -p credentials
cp ~/.kube/config credentials/my-cluster.kubeconfig

# 3. Start development
bun run dev
```

The hub will be available at `http://localhost:3001` with:
- SQLite database at `./data/kubefoundry.db` (auto-created)
- Credentials loaded from `./credentials/`
- GitHub OAuth callbacks at `http://localhost:3001/api/auth/callback/github`

## Production Deployment

### PostgreSQL Setup

For production, use PostgreSQL instead of SQLite:

```bash
export DATABASE_URL="postgres://user:password@db-host:5432/kubefoundry"
```

The database schema is applied automatically on startup via migrations.

### Azure Key Vault + CSI Driver

Store secrets in Azure Key Vault and mount them via the CSI driver:

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: kubefoundry-secrets
spec:
  provider: azure
  parameters:
    keyvaultName: my-keyvault
    objects: |
      array:
        - |
          objectName: session-secret
          objectType: secret
        - |
          objectName: azure-client-secret
          objectType: secret
        - |
          objectName: github-client-secret
          objectType: secret
    tenantId: your-tenant-id
```

### Kustomize Overlays

Use the deployment manifests in `deploy/kubernetes/` with environment-specific overlays:

```yaml
# deploy/kubernetes/overlays/hub/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
patches:
  - target:
      kind: Deployment
      name: kubefoundry
    patch: |
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: HUB_MODE
          value: "true"
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: ENABLED_AUTH_PROVIDERS
          value: "entra"
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: kubefoundry-db
              key: url
```
