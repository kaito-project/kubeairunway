# KubeFoundry Headlamp Plugin - Implementation Plan

> **Status**: Planning Complete  
> **Created**: January 6, 2026  
> **Last Updated**: January 6, 2026

## Executive Summary

Create a Headlamp plugin that integrates KubeFoundry's ML deployment management capabilities directly into the Headlamp Kubernetes dashboard. The plugin will provide full feature parity with the main KubeFoundry UI, supporting all runtimes (KAITO, KubeRay, Dynamo) through a full backend proxy architecture.

---

## Decision Summary

| # | Decision Area | Choice | Rationale |
|---|--------------|--------|-----------|
| 1 | Repository Structure | **Monorepo** (`plugins/headlamp/`) | Easier type sharing, coordinated changes, single CI |
| 2 | Data Access Strategy | **Full Backend Proxy** | Maximum feature parity, reuse existing business logic |
| 3 | Shared Types | **Reuse via workspace dependency** | Direct imports from `@kubefoundry/shared` |
| 4 | MVP Scope | **Full Feature Parity** | Metrics, model catalog, AI configurator, full CRUD |
| 5 | Runtime Support | **All Runtimes** (KAITO + KubeRay + Dynamo) | Complete coverage |
| 6 | Plugin Name | **kubefoundry-headlamp-plugin** | Consistent with gatekeeper-headlamp-plugin naming |
| 7 | API Client Strategy | **Shared API Client Package** | Single source of truth, both UIs use same client |
| 8 | Backend Discovery | **Flexible** (In-Cluster + External) | Service discovery with manual override fallback |
| 9 | Authentication | **Pass-through Kubernetes Token** | Seamless auth, same RBAC as Headlamp |
| 10 | Dynamo Status | **Stable, include fully** | No experimental labels needed |
| 11 | Component Strategy | **Rewrite for Headlamp** | Use Headlamp's CommonComponents, no regression to main UI |
| 12 | Shared Package Location | **Extend existing `shared/`** | Add `shared/api/` alongside `shared/types/` |

---

## Discussion Notes

### Code Reuse in Monorepo

With a monorepo + full backend proxy approach, we can reuse significant code:

| Reusable Code | Location | How Plugin Uses It |
|--------------|----------|-------------------|
| **TypeScript Types** | `shared/types/` | Direct import via workspace dependency |
| **API Client** | `shared/api/` (new) | Direct import, same as main frontend |
| **Utility Functions** | `shared/utils/` (if needed) | Direct import |

**What cannot be shared directly:**
- React components (Headlamp has specific constraints)
- Styling/CSS (Headlamp uses its own theming)
- UI-specific hooks

### React Component Constraints

Headlamp plugins have specific constraints:
- Must use Headlamp's bundled React (not bundle their own)
- Must use Headlamp's Material-UI components
- Components are loaded at runtime into Headlamp's environment

**Solution**: Rewrite UI components using Headlamp's `CommonComponents` (SectionBox, SimpleTable, Link, Loader, etc.) following patterns from the gatekeeper-headlamp-plugin.

**No regression to main UI**: The main KubeFoundry frontend stays completely unchanged. The plugin is an additional, separate frontend that shares only types and API logic.

### Backend Installation & Discovery

The KubeFoundry backend can be installed via:
- **In-Cluster Deployment** (Helm chart, K8s manifests)
- **Standalone** (outside cluster, for development)

**Plugin Discovery Strategy**:
1. Try in-cluster service discovery (`kubefoundry.<namespace>.svc`)
2. Fall back to user-configured URL in plugin settings
3. Support `localhost` for development

### Authentication Flow

```
┌─────────────┐    K8s Token     ┌─────────────────────┐
│  Headlamp   │ ───────────────► │ KubeFoundry Backend │
│  (Browser)  │                  │                     │
└─────────────┘                  └─────────────────────┘
       │                                   │
       │ Plugin passes                     │ TokenReview
       │ same token                        │ validation
       ▼                                   ▼
┌─────────────┐                  ┌─────────────────────┐
│   Plugin    │                  │   Kubernetes API    │
└─────────────┘                  └─────────────────────┘
```

The plugin uses the same Kubernetes token that Headlamp uses. The KubeFoundry backend validates it via TokenReview (already implemented).

---

## Project Structure

### Target Directory Layout

```
kube-foundry/
├── frontend/                          # Main KubeFoundry UI (UNCHANGED)
│   └── src/
│       ├── components/
│       ├── pages/
│       └── lib/
│           └── api.ts                 # → Will import from shared/api
│
├── backend/                           # KubeFoundry Backend (UNCHANGED)
│   └── src/
│
├── shared/                            # Shared code (EXTENDED)
│   ├── package.json                   # @kubefoundry/shared
│   ├── tsconfig.json
│   ├── types/                         # Existing types
│   │   ├── index.ts
│   │   ├── model.ts
│   │   ├── deployment.ts
│   │   ├── metrics.ts
│   │   └── ...
│   └── api/                           # NEW: Shared API client
│       ├── index.ts                   # Barrel export
│       ├── client.ts                  # Base request function
│       ├── models.ts                  # modelsApi
│       ├── deployments.ts             # deploymentsApi
│       ├── health.ts                  # healthApi
│       ├── settings.ts                # settingsApi
│       ├── metrics.ts                 # metricsApi
│       ├── installation.ts            # installationApi
│       ├── aikit.ts                   # aikitApi
│       ├── aiconfigurator.ts          # aiConfiguratorApi
│       └── huggingface.ts             # huggingFaceApi
│
├── plugins/                           # NEW: Plugins directory
│   └── headlamp/                      # Headlamp plugin
│       ├── package.json
│       ├── tsconfig.json
│       ├── Makefile
│       ├── README.md
│       ├── CLAUDE.md                  # AI development instructions
│       ├── artifacthub-pkg.yml
│       ├── artifacthub-repo.yml
│       └── src/
│           ├── index.tsx              # Entry point, registrations
│           ├── routes.ts              # Route definitions
│           ├── settings.tsx           # Plugin settings component
│           ├── components/            # Headlamp-specific components
│           │   ├── DeploymentCard.tsx
│           │   ├── MetricsPanel.tsx
│           │   ├── ModelSelector.tsx
│           │   ├── RuntimeBadge.tsx
│           │   └── StatusIndicator.tsx
│           ├── pages/                 # Page components
│           │   ├── DeploymentsList.tsx
│           │   ├── DeploymentDetails.tsx
│           │   ├── ModelsCatalog.tsx
│           │   ├── CreateDeployment.tsx
│           │   ├── RuntimesStatus.tsx
│           │   └── Settings.tsx
│           └── lib/                   # Plugin utilities
│               ├── api-client.ts      # Wraps shared API with auth
│               └── backend-discovery.ts
│
└── package.json                       # Workspace root
```

### Workspace Configuration

```json
// package.json (root)
{
  "workspaces": [
    "frontend",
    "backend",
    "shared",
    "plugins/headlamp"
  ]
}
```

---

## Implementation Phases

### Phase 1: Shared API Client Extraction

**Goal**: Extract the API client from frontend to shared package so both UIs can use it.

**Duration**: 1-2 days

#### Tasks

1. **Create `shared/api/` directory structure**
   - Create `shared/api/client.ts` with base request function
   - Split `frontend/src/lib/api.ts` into separate files per API domain
   - Ensure no React dependencies in shared API code

2. **Update shared package exports**
   - Add `api` export to `shared/package.json`
   - Update `shared/types/index.ts` to include any new types needed

3. **Refactor frontend to use shared API**
   - Update `frontend/src/lib/api.ts` to re-export from `@kubefoundry/shared/api`
   - Ensure all frontend imports continue to work
   - Run frontend tests to verify no regression

4. **API Client Configuration**
   - Base URL configuration (env var or parameter)
   - Auth token injection (callback pattern for different environments)
   - Error handling that works in both contexts

#### Key Files to Create

| File | Purpose |
|------|---------|
| `shared/api/client.ts` | Base `request<T>()` function with auth |
| `shared/api/index.ts` | Barrel exports |
| `shared/api/deployments.ts` | `deploymentsApi` |
| `shared/api/models.ts` | `modelsApi` |
| `shared/api/health.ts` | `healthApi` |
| `shared/api/settings.ts` | `settingsApi` |
| `shared/api/runtimes.ts` | `runtimesApi` |
| `shared/api/installation.ts` | `installationApi` |
| `shared/api/gpu.ts` | `gpuOperatorApi` |
| `shared/api/autoscaler.ts` | `autoscalerApi` |
| `shared/api/huggingface.ts` | `huggingFaceApi` |
| `shared/api/aikit.ts` | `aikitApi` |
| `shared/api/aiconfigurator.ts` | `aiConfiguratorApi` |

#### Exit Criteria

- [ ] `shared/api/` exports all API clients
- [ ] Frontend imports from `@kubefoundry/shared/api` work
- [ ] `bun run test` passes in frontend
- [ ] No React dependencies in `shared/` package

---

### Phase 2: Plugin Scaffolding

**Goal**: Create the basic Headlamp plugin structure with development environment.

**Duration**: 1 day

#### Tasks

1. **Create plugin directory**
   ```bash
   mkdir -p plugins/headlamp
   cd plugins/headlamp
   npx --yes @kinvolk/headlamp-plugin create kubefoundry-headlamp-plugin --no-install
   # Move generated files to current directory
   ```

2. **Configure workspace dependency**
   ```json
   // plugins/headlamp/package.json
   {
     "dependencies": {
       "@kubefoundry/shared": "workspace:*"
     }
   }
   ```

3. **Set up Makefile** (based on gatekeeper plugin)
   - `make setup` - Install deps, build, deploy
   - `make dev` - Build and deploy for development
   - `make build` - Build only
   - `make deploy` - Deploy to Headlamp plugins directory

4. **Create CLAUDE.md** for AI-assisted development

5. **Register basic sidebar and route**
   - "KubeFoundry" parent sidebar entry
   - Placeholder route that renders

#### Exit Criteria

- [ ] `bun install` works at workspace root
- [ ] `make build` succeeds in plugin directory
- [ ] Plugin appears in Headlamp sidebar
- [ ] Placeholder page renders

---

### Phase 3: Core Views - Read Only

**Goal**: Implement deployment listing and details views.

**Duration**: 2-3 days

#### Sidebar Structure

```
KubeFoundry
├── Deployments          /kubefoundry/deployments
├── Models               /kubefoundry/models
├── Runtimes             /kubefoundry/runtimes
└── Settings             /kubefoundry/settings
```

#### Tasks

1. **Backend Discovery & Configuration**
   - Create `lib/backend-discovery.ts`
   - Implement service discovery for in-cluster
   - Plugin settings for manual URL configuration
   - Store settings in Headlamp's plugin storage

2. **API Client Wrapper**
   - Create `lib/api-client.ts`
   - Inject Kubernetes token from Headlamp context
   - Configure base URL from discovery/settings

3. **Deployments List Page**
   - Fetch deployments from backend
   - Display in table: name, model, runtime, status, replicas, GPUs
   - Filters: by namespace, by runtime, by status
   - Link to details page

4. **Deployment Details Page**
   - Full deployment info display
   - Pod status list
   - Conditions display
   - Action buttons (placeholder for Phase 4)

5. **Models Catalog Page**
   - Fetch models from backend
   - Display curated models
   - Search (if HuggingFace integration available)
   - Show compatibility info

6. **Runtimes Status Page**
   - Show KAITO, KubeRay, Dynamo status
   - Installation status
   - Operator health

#### Exit Criteria

- [ ] Deployments list shows all deployments from backend
- [ ] Deployment details page displays full info
- [ ] Models catalog shows curated models
- [ ] Runtimes page shows installation status
- [ ] Backend URL configurable via settings

---

### Phase 4: Full CRUD Operations

**Goal**: Implement create and delete deployment functionality.

**Duration**: 2-3 days

#### Tasks

1. **Create Deployment Wizard**
   - Step 1: Select model (from catalog or HuggingFace search)
   - Step 2: Select runtime (KAITO, KubeRay, Dynamo)
   - Step 3: Configure resources (GPUs, replicas)
   - Step 4: Advanced settings (engine args, etc.)
   - Step 5: Review and create

2. **Delete Deployment**
   - Confirmation dialog
   - Call backend DELETE endpoint
   - Handle errors gracefully

3. **AI Configurator Integration**
   - Add "Suggest Configuration" button
   - Call AI configurator endpoint
   - Pre-fill wizard with suggestions

4. **Error Handling**
   - Display validation errors from backend
   - Show warnings (e.g., GPU not available)
   - Graceful degradation if backend unavailable

#### Exit Criteria

- [ ] Can create new deployment through wizard
- [ ] Can delete existing deployment
- [ ] AI configurator suggestions work
- [ ] Validation errors displayed properly

---

### Phase 5: Advanced Features

**Goal**: Add metrics, logs, and enhanced UX.

**Duration**: 2-3 days

#### Tasks

1. **Metrics Display**
   - Fetch metrics from backend `/deployments/{name}/metrics`
   - Display key metrics: requests/sec, latency, tokens/sec
   - Auto-refresh with configurable interval
   - Handle "metrics not available" gracefully

2. **Logs Access**
   - Fetch logs from backend `/deployments/{name}/logs`
   - Display in scrollable container
   - Pod selector dropdown
   - Tail lines configuration

3. **GPU Capacity Dashboard**
   - Show cluster GPU capacity
   - Node-level breakdown
   - Pending pod reasons

4. **Autoscaler Status**
   - Detect cluster autoscaler type
   - Show autoscaler status
   - Display scaling events

5. **Real-time Updates**
   - Polling with configurable interval
   - Visual indicators for status changes
   - Connection status indicator

#### Exit Criteria

- [ ] Metrics charts render for deployments
- [ ] Logs viewable per pod
- [ ] GPU capacity visible
- [ ] Autoscaler status displayed
- [ ] Auto-refresh working

---

### Phase 6: Polish & Packaging

**Goal**: Prepare for public release.

**Duration**: 1-2 days

#### Tasks

1. **Documentation**
   - README with installation instructions
   - Configuration options documentation
   - Screenshots and demo GIFs
   - Troubleshooting guide

2. **ArtifactHub Publishing**
   - Create `artifacthub-pkg.yml`
   - Create `artifacthub-repo.yml`
   - Add logo and screenshots
   - Semantic versioning

3. **CI/CD Pipeline**
   - GitHub Actions for build/test
   - Automated releases on tag
   - Build validation

4. **Testing**
   - Unit tests for utility functions
   - Component tests with mocked API
   - Integration test documentation

5. **Error States & Edge Cases**
   - Empty states
   - Loading states
   - Error boundaries
   - Offline/disconnected handling

#### Exit Criteria

- [ ] README complete with screenshots
- [ ] Plugin available on ArtifactHub
- [ ] CI/CD pipeline passing
- [ ] Version 0.1.0 released

---

## Technical Details

### Plugin Registration (src/index.tsx)

```typescript
import {
  registerRoute,
  registerSidebarEntry,
  registerPluginSettings,
} from '@kinvolk/headlamp-plugin/lib';

// Sidebar entries
registerSidebarEntry({
  parent: null,
  name: 'kubefoundry',
  label: 'KubeFoundry',
  icon: 'mdi:brain',
  url: '/kubefoundry/deployments',
});

registerSidebarEntry({
  parent: 'kubefoundry',
  name: 'kf-deployments',
  label: 'Deployments',
  url: '/kubefoundry/deployments',
});

// ... more entries

// Routes
registerRoute({
  path: '/kubefoundry/deployments',
  sidebar: 'kf-deployments',
  name: 'KubeFoundry Deployments',
  exact: true,
  component: () => <DeploymentsList />,
});

// Plugin settings
registerPluginSettings(
  'kubefoundry-headlamp-plugin',
  SettingsComponent,
  true // showInMenu
);
```

### Backend Discovery (src/lib/backend-discovery.ts)

```typescript
interface BackendConfig {
  url: string;
  source: 'settings' | 'service-discovery' | 'default';
}

export async function discoverBackend(): Promise<BackendConfig> {
  // 1. Check plugin settings
  const settingsUrl = getPluginSetting('backendUrl');
  if (settingsUrl) {
    return { url: settingsUrl, source: 'settings' };
  }

  // 2. Try in-cluster service discovery
  const namespace = getPluginSetting('backendNamespace') || 'kubefoundry-system';
  const serviceUrl = `http://kubefoundry.${namespace}.svc:3001`;
  
  try {
    const response = await fetch(`${serviceUrl}/api/health`);
    if (response.ok) {
      return { url: serviceUrl, source: 'service-discovery' };
    }
  } catch {
    // Service not available
  }

  // 3. Default (for development)
  return { url: 'http://localhost:3001', source: 'default' };
}
```

### API Client Wrapper (src/lib/api-client.ts)

```typescript
import { createApiClient } from '@kubefoundry/shared/api';
import { getToken } from './auth';
import { discoverBackend } from './backend-discovery';

let apiClient: ReturnType<typeof createApiClient> | null = null;

export async function getApiClient() {
  if (!apiClient) {
    const backend = await discoverBackend();
    apiClient = createApiClient({
      baseUrl: backend.url,
      getToken: () => getToken(), // From Headlamp context
    });
  }
  return apiClient;
}

// Convenience exports
export const deploymentsApi = {
  list: async (...args) => (await getApiClient()).deployments.list(...args),
  get: async (...args) => (await getApiClient()).deployments.get(...args),
  create: async (...args) => (await getApiClient()).deployments.create(...args),
  delete: async (...args) => (await getApiClient()).deployments.delete(...args),
};
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Backend not reachable from Headlamp | Medium | High | Clear error messaging, manual URL config |
| CRD schema changes in KAITO/KubeRay | Medium | High | Backend abstracts CRD details |
| Headlamp plugin API changes | Low | Medium | Pin headlamp-plugin version |
| Type sync issues between packages | Medium | Medium | Workspace dependencies, CI checks |
| Performance with many deployments | Low | Medium | Pagination in backend |
| Auth token issues across contexts | Medium | High | Comprehensive error handling |

---

## Timeline Summary

| Phase | Duration | Dependencies | Deliverables |
|-------|----------|--------------|--------------|
| Phase 1: API Extraction | 1-2 days | None | `shared/api/` package |
| Phase 2: Scaffolding | 1 day | Phase 1 | Basic plugin structure |
| Phase 3: Read-Only Views | 2-3 days | Phase 2 | Deployments, Models, Runtimes views |
| Phase 4: CRUD Operations | 2-3 days | Phase 3 | Create/Delete, AI Configurator |
| Phase 5: Advanced Features | 2-3 days | Phase 4 | Metrics, Logs, GPU info |
| Phase 6: Packaging | 1-2 days | Phase 5 | ArtifactHub release |

**Total: ~10-14 days of focused development**

---

## Success Metrics

1. **Functional**: All CRUD operations work for KAITO, KubeRay, and Dynamo deployments
2. **Performance**: List view loads in <2s with 50+ deployments
3. **Reliability**: Graceful degradation when backend unavailable
4. **Adoption**: Published on ArtifactHub with installation guide
5. **Quality**: TypeScript strict mode, no `any` escapes, test coverage >60%

---

## Open Questions (Resolved)

All planning questions have been answered. Ready to proceed with Phase 1 implementation.

---

## Next Steps

1. ✅ Planning complete
2. ⏳ Begin Phase 1: Shared API Client Extraction
3. Review and approve this plan before coding begins
