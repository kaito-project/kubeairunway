# Runtime Selection Migration Plan

> **Status: ✅ COMPLETE** - All phases implemented successfully.

> **Goal:** Move from global provider/runtime selection to per-deployment runtime selection, while ensuring operators are clearly shown as prerequisites.

## Executive Summary

This plan transforms KubeAIRunway from a "single active provider" model to a "multi-runtime" model where:
1. Users select the runtime (Dynamo/KubeRay) when deploying a model, not globally
2. Operator installation status is derived from cluster state (not stored config)
3. Existing deployments continue to work with provider inferred from resource kind

---

## Terminology

| Old Term | New Term (UI) | Backend Constant |
|----------|---------------|------------------|
| Provider | Runtime | `provider` (unchanged) |
| Active Provider | *(removed)* | — |

---

## Phase 1: Backend Foundation

**Objective:** Make backend accept `provider` in deployment requests and infer provider for existing resources.

### 1.1 Update Shared Types

**File:** `shared/types/deployment.ts`

- Add `provider?: 'dynamo' | 'kuberay'` to `DeploymentConfig` (optional during transition)
- Ensure `DeploymentStatus.provider` is always populated

### 1.2 Update Deployment Routes

**File:** `backend/src/routes/deployments.ts`

- `POST /deployments`:
  - Accept `provider` from request body
  - If missing, fall back to `configService.getActiveProviderId()` + emit deprecation warning in response
  - Validate config against the specified provider's schema
- `GET /deployments`: No change (provider inferred from resource)
- `GET /deployments/:name`: No change (provider inferred from resource)

### 1.3 Update Kubernetes Service

**File:** `backend/src/services/kubernetes.ts`

- `createDeployment(config)`: Use `config.provider` to select provider, fall back to active provider
- `listDeployments(namespace)`: Query both CRD kinds, merge results, populate `provider` from resource kind
- `getDeployment(name, namespace)`: Try both CRD kinds, return whichever matches
- Add label `kubeairunway.io/provider` to all created resources for optimization

### 1.4 Update Provider Status Check

**File:** `backend/src/services/kubernetes.ts` or new `backend/src/services/runtime-status.ts`

- Create `getRuntimesStatus(): Promise<RuntimeStatus[]>` that returns:
  ```typescript
  interface RuntimeStatus {
    id: string;           // 'dynamo' | 'kuberay'
    name: string;         // Display name
    installed: boolean;   // CRD exists
    healthy: boolean;     // Operator pods running
    version?: string;     // Detected version
    message?: string;     // Status message
  }
  ```
- Detection logic: Check CRD existence + operator pod health (existing `checkInstallation` methods)

### 1.5 Update Settings Route

**File:** `backend/src/routes/settings.ts`

- Add `GET /api/runtimes/status` endpoint returning `RuntimeStatus[]`
- Keep existing `/api/settings` for backward compatibility
- Deprecate `activeProviderId` in response (keep returning it, but mark as deprecated)

### Exit Criteria (Phase 1)
- [ ] `POST /deployments` with `provider: 'dynamo'` creates a DynamoGraphDeployment
- [ ] `POST /deployments` with `provider: 'kuberay'` creates a RayService
- [ ] `POST /deployments` without `provider` still works (uses fallback) and returns deprecation warning
- [ ] `GET /deployments` returns deployments from both runtimes with correct `provider` field
- [ ] `GET /api/runtimes/status` returns accurate installation status for both runtimes
- [ ] All existing backend tests pass
- [ ] New tests cover: multi-runtime listing, provider inference from CRD kind

---

## Phase 2: Frontend - Add Runtime Selection to Deploy Form

**Objective:** Users select runtime when deploying; form adapts based on selection.

### 2.1 Update Frontend Types

**File:** `frontend/src/lib/api.ts`

- Update `DeploymentConfig` type to include `provider?: 'dynamo' | 'kuberay'`
- Add `RuntimeStatus` type matching backend

### 2.2 Add Runtime Status Hook

**File:** `frontend/src/hooks/useRuntimes.ts` (new)

- `useRuntimesStatus()`: Fetch `/api/runtimes/status`
- Returns list of runtimes with installation/health status

### 2.3 Update Deployment Form

**File:** `frontend/src/components/deployments/DeploymentForm.tsx`

**Add Runtime Selector:**
- Position: After deployment name, before engine selection
- UI: Radio group with runtime options
- Each option shows: name, description, installation status badge
- If runtime not installed: Show inline warning + link to Installation page
- Default selection logic:
  1. If only one runtime installed → auto-select it
  2. If both installed → default to Dynamo
  3. If none installed → show both with warnings

**Adapt Form Based on Runtime:**
- Namespace: Update default when runtime changes (Dynamo → `dynamo-system`, KubeRay → `kuberay-system`)
- Engine options: Filter based on runtime capabilities (KubeRay only supports vLLM currently)
- Advanced options: Show/hide runtime-specific options (e.g., KV routing for Dynamo only)

**Submit Behavior:**
- Always include `provider` in request payload
- Disable submit if selected runtime not installed (with clear message)

### 2.4 Update Deploy Page

**File:** `frontend/src/pages/DeployPage.tsx`

- Pass runtime status to `DeploymentForm`
- No other changes needed

### Exit Criteria (Phase 2)
- [ ] Deploy form shows runtime selector with both options
- [ ] Runtime installation status is visible in selector
- [ ] Selecting a runtime updates namespace default
- [ ] Engine dropdown filters based on runtime
- [ ] Cannot submit if runtime not installed
- [ ] Successful deployment with explicit runtime selection
- [ ] Frontend type-check passes
- [ ] Manual test: deploy with Dynamo, deploy with KubeRay (if both installed)

---

## Phase 3: Frontend - Update Settings & Installation Pages

**Objective:** Reframe Settings from "active provider" to "installed runtimes" view.

### 3.1 Update Settings Page - General Tab

**File:** `frontend/src/pages/SettingsPage.tsx`

**Remove:**
- "Active Provider" dropdown
- Provider selection logic and `handleProviderChange`

**Replace With:**
- "Installed Runtimes" section showing status of each runtime:
  - Runtime name + icon
  - Status badge (Installed/Not Installed/Unhealthy)
  - Version (if detected)
  - Link to Installation page for each

**Keep:**
- Cluster status section
- Default namespace display (show both runtime namespaces)

### 3.2 Update Settings Page - Advanced Tab

**File:** `frontend/src/pages/SettingsPage.tsx`

**Update:**
- Show CRD details for ALL runtimes, not just "active" one
- Remove references to "active provider"

**Restructure:**
- Show both runtimes side-by-side or in tabs
- Each runtime has its own installation status and actions
- Remove dependency on `activeProviderId`

**Per-Runtime Section:**
- Installation status (CRD, operator pods, version)
- Install/Upgrade buttons
- Manual installation commands

### 3.4 Update Sidebar

**File:** `frontend/src/components/layout/Sidebar.tsx`

- Remove runtime-specific theming based on `activeProvider`
- Use neutral theme or show indicator for "multi-runtime mode"

### 3.5 Update useSettings Hook

**File:** `frontend/src/hooks/useSettings.ts`

- Deprecate `activeProvider` usage
- Add `installedRuntimes` from new endpoint
- Keep backward compatibility for any remaining consumers

### Exit Criteria (Phase 3)
- [ ] Settings page shows both runtimes with status (no dropdown)
- [ ] Installation page shows both runtimes independently
- [ ] Can install/upgrade each runtime independently
- [ ] No UI references to "active provider"
- [ ] Sidebar works without active provider
- [ ] Frontend type-check passes
- [ ] All frontend tests pass

---

## Phase 4: Deployments List & Details Updates

**Objective:** Show runtime info in deployment list and details views.

### 4.1 Update Deployment List

**File:** `frontend/src/pages/DeploymentsPage.tsx`

- Add runtime badge/icon to each deployment card
- Optional: Add runtime filter dropdown

### 4.2 Update Deployment Card

**File:** `frontend/src/components/deployments/DeploymentCard.tsx`

- Display runtime badge (small icon or text)
- Use runtime-specific accent color if desired

### 4.3 Update Deployment Details Page

**File:** `frontend/src/pages/DeploymentDetailsPage.tsx`

- Show runtime in deployment info section
- Ensure metrics fetch uses correct runtime (from deployment status)

### 4.4 Update Metrics Service

**File:** `backend/src/services/metrics.ts`

- Derive provider from deployment status, not `configService.getActiveProvider()`
- Update method signatures if needed to accept provider explicitly

### Exit Criteria (Phase 4)
- [ ] Deployment list shows runtime for each deployment
- [ ] Deployment details shows runtime
- [ ] Metrics load correctly for deployments of either runtime
- [ ] Filtering by runtime works (if implemented)

---

## Phase 5: Cleanup & Deprecation

**Objective:** Remove deprecated code paths and finalize migration.

### 5.1 Backend Cleanup

**Files:** `backend/src/services/config.ts`, `backend/src/routes/settings.ts`

- Remove `activeProviderId` from ConfigMap schema
- Remove `setActiveProvider()` method
- Remove `getActiveProviderId()` fallback in deployment routes (make `provider` required)
- Update `Settings` response to remove `activeProvider`

### 5.2 Frontend Cleanup

**Files:** Various

- Remove all `activeProvider` / `activeProviderId` references
- Remove `useUpdateSettings` for provider changes
- Clean up any dead code paths

### 5.3 Type Cleanup

**File:** `shared/types/settings.ts`

- Remove `activeProviderId` from `AppConfig`
- Remove `activeProvider` from `Settings`
- Add `runtimes: RuntimeStatus[]` to `Settings` (or keep separate endpoint)

### 5.4 Update Documentation

**Files:** `docs/architecture.md`, `docs/api.md`, `agents.md`, `README.md`

- Update architecture diagrams
- Document new `/api/runtimes/status` endpoint
- Remove references to "active provider"
- Add migration notes for API consumers

### Exit Criteria (Phase 5)
- [ ] `POST /deployments` without `provider` returns 400 error
- [ ] No `activeProviderId` in ConfigMap or API responses
- [ ] All tests pass
- [ ] Documentation updated
- [ ] `bun run test` passes for both frontend and backend

---

## Phase 6: Validation & Release

**Objective:** End-to-end validation and release preparation.

### 6.1 Integration Testing

- [ ] Fresh cluster: Install Dynamo only → deploy model → verify
- [ ] Fresh cluster: Install KubeRay only → deploy model → verify
- [ ] Fresh cluster: Install both → deploy models to each → list shows both
- [ ] Existing cluster with old deployments → verify they appear with correct runtime

### 6.2 Migration Testing

- [ ] Cluster with existing ConfigMap (`activeProviderId`) → backend starts without error
- [ ] Existing deployments (no label) → listed correctly with inferred runtime

### 6.3 UI/UX Review

- [ ] Deploy form is intuitive for new users
- [ ] Settings page clearly shows what's installed
- [ ] Error states are clear (runtime not installed)

### 6.4 Release Notes

- Document breaking change: `provider` field now required in `POST /deployments`
- Document new endpoint: `GET /api/runtimes/status`
- Document UI changes

### Exit Criteria (Phase 6)
- [ ] All integration tests pass
- [ ] Migration from old state works
- [ ] Release notes drafted
- [ ] Ready for release

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Multi-namespace listing complexity | Constrain to user-provided namespace; list both CRD kinds within it |
| RBAC for cluster-wide operations | Document required permissions; graceful degradation if lacking |
| Breaking API change | Phase 1-4 maintain backward compat; Phase 5 is breaking (announced) |
| Runtime detection unreliable | Use CRD existence as primary signal; operator health as secondary |
| Existing deployments without label | Infer from CRD kind (authoritative); label is optimization only |

---

## Timeline Estimate

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1 | 2-3 days | None |
| Phase 2 | 2 days | Phase 1 |
| Phase 3 | 1-2 days | Phase 1 |
| Phase 4 | 1 day | Phase 1 |
| Phase 5 | 1 day | Phases 2-4 |
| Phase 6 | 1 day | Phase 5 |

**Total:** ~8-10 days

---

## Appendix: API Changes Summary

### New Endpoints
- `GET /api/runtimes/status` → `RuntimeStatus[]`

### Modified Endpoints
- `POST /api/deployments` → accepts `provider` field (required after Phase 5)
- `GET /api/settings` → `activeProviderId` deprecated, then removed

### Removed (Phase 5)
- `PUT /api/settings` with `activeProviderId` no longer has effect

### Response Changes
- All `DeploymentStatus` responses include `provider` field (already exists, now always populated)
