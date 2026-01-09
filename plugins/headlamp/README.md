# KubeFoundry Headlamp Plugin

[![Artifact Hub](https://img.shields.io/endpoint?url=https://artifacthub.io/badge/repository/kubefoundry)](https://artifacthub.io/packages/headlamp/kubefoundry/kubefoundry-headlamp-plugin)

A [Headlamp](https://headlamp.dev/) plugin that integrates KubeFoundry's ML deployment management capabilities directly into the Headlamp Kubernetes dashboard.

## Features

- **Full Feature Parity**: Complete KubeFoundry functionality within Headlamp
- **Multi-Runtime Support**: KAITO, KubeRay, and Dynamo runtimes
- **Model Catalog**: Browse curated models and search HuggingFace
- **Deployment Management**: Create, view, and delete deployments
- **Metrics & Monitoring**: Real-time metrics, logs, and GPU capacity
- **AI Configuration**: Intelligent model configuration suggestions

## Installation

### From Artifact Hub

1. Open Headlamp settings
2. Navigate to Plugins
3. Search for "kubefoundry"
4. Install the plugin

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/sozercan/kube-foundry.git
cd kube-foundry/plugins/headlamp

# Build and deploy
make setup
```

## Prerequisites

- Headlamp v0.20+ installed
- KubeFoundry backend deployed in your cluster (or running locally)
- Kubernetes cluster with kubectl access

## Configuration

### Backend URL

The plugin attempts to discover the KubeFoundry backend in this order:

1. **Plugin Settings**: Configure URL in Headlamp Plugin Settings
2. **In-Cluster Discovery**: Automatically discovers `kubefoundry.<namespace>.svc`
3. **Default**: Falls back to `http://localhost:3001` (development)

To configure:
1. Open Headlamp → Settings → Plugins → KubeFoundry
2. Set the "Backend URL" field
3. Optionally set the "Backend Namespace" for service discovery

## Development

### Prerequisites

- Node.js 18+ or Bun
- Headlamp Desktop or running in cluster

### Setup

```bash
# Install dependencies
bun install

# Build the plugin
bun run build

# Start development mode (auto-rebuild)
bun run start
```

### Makefile Commands

```bash
make setup      # Install deps, build, and deploy to Headlamp
make dev        # Build and deploy for development
make build      # Build only
make deploy     # Deploy to Headlamp plugins directory
make clean      # Remove build artifacts
```

### Testing

```bash
bun run test        # Run tests once
bun run test:watch  # Watch mode
bun run lint        # Lint code
bun run tsc         # Type check
```

## Development Patterns

### Key Files

| File | Purpose |
|------|---------|
| `src/index.tsx` | Plugin entry point, route and sidebar registrations |
| `src/routes.ts` | Route path constants |
| `src/settings.tsx` | Plugin settings component |
| `src/lib/api-client.ts` | API client wrapper with Headlamp auth |
| `src/lib/backend-discovery.ts` | Backend URL discovery logic |
| `src/lib/plugin-storage.ts` | Headlamp plugin config storage |
| `src/lib/theme.ts` | Theme utilities for Headlamp compatibility |
| `src/pages/*.tsx` | Page components |
| `src/components/*.tsx` | Reusable components |

### Using Headlamp Components

Always use Headlamp's built-in components:

```typescript
import {
  SectionBox,
  SimpleTable,
  Loader,
  Link,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
```

### Using the API Client

```typescript
import { useApiClient } from '@/lib/api-client';

function MyComponent() {
  const api = useApiClient();
  
  useEffect(() => {
    api.deployments.list().then(setDeployments);
  }, []);
}
```

### Registering Routes

```typescript
import { registerRoute, registerSidebarEntry } from '@kinvolk/headlamp-plugin/lib';

registerRoute({
  path: '/kubefoundry/deployments',
  sidebar: 'kf-deployments',
  name: 'KubeFoundry Deployments',
  exact: true,
  component: () => <DeploymentsList />,
});
```

### Best Practices

**DO:**
- Use Headlamp's `SectionBox`, `SimpleTable`, `StatusLabel`, `Loader`, `Link` components
- Use the shared `@kubefoundry/shared` package for types and API client
- Test components with mocked Headlamp dependencies
- Use `src/lib/plugin-storage.ts` for plugin configuration

**DO NOT:**
- Bundle React or ReactDOM (Headlamp provides them at runtime)
- Use custom CSS frameworks (use MUI via Headlamp)
- Make direct K8s API calls (use backend proxy)
- Store secrets in localStorage
- Import from `@mui/material` directly (use Headlamp's re-exports)
- Use TanStack Query (not available in Headlamp environment)

### Troubleshooting

**Plugin not appearing in Headlamp:**
- Verify plugin was built: `bun run build`
- Check deployment: `make deploy`
- Restart Headlamp Desktop

**Backend connection issues:**
- Check backend is running: `curl http://localhost:3001/api/health`
- Verify plugin settings in Headlamp → Settings → Plugins → KubeFoundry

**Type errors after shared package changes:**
```bash
cd ../../shared && bun run build
cd ../plugins/headlamp && bun run build
```

## Architecture

```
┌──────────────────┐     ┌─────────────────────┐
│    Headlamp      │     │  KubeFoundry        │
│   (Browser)      │────▶│    Backend          │
│                  │     │                     │
│  ┌────────────┐  │     │  ┌───────────────┐  │
│  │ KubeFoundry│  │     │  │ REST API      │  │
│  │  Plugin    │──┼────▶│  │ /api/*        │  │
│  └────────────┘  │     │  └───────────────┘  │
└──────────────────┘     └─────────────────────┘
         │                         │
         │ K8s Token               │ K8s API
         ▼                         ▼
┌──────────────────────────────────────────────┐
│              Kubernetes Cluster              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │  KAITO  │  │ KubeRay │  │ Dynamo  │      │
│  └─────────┘  └─────────┘  └─────────┘      │
└──────────────────────────────────────────────┘
```

## Sidebar Structure

```
KubeFoundry
├── Deployments      - List and manage deployments
├── Models           - Browse model catalog
├── Runtimes         - View runtime installation status
└── Settings         - Configure plugin settings
```

## License

MIT License - see [LICENSE](../../LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for development guidelines.
