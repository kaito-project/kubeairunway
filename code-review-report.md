# KubeFoundry — Multi-Model Comprehensive Code Review Report

**Date:** February 10, 2026  
**Models Used:** Claude Opus 4.5, Claude Opus 4.6, Gemini 3 Pro Preview, GPT-5.2 Codex  
**Methodology:** Full rotation matrix — every model reviewed every area independently

## Review Coverage Matrix

| Area | Gemini 3 Pro | GPT-5.2 Codex | Opus 4.5 | Opus 4.6 |
|------|-------------|---------------|----------|----------|
| **Controller (Go)** | ✅ 12 findings | ✅ 7 findings | ✅ 14 findings | ✅ 22 findings |
| **Backend + Shared + Providers** | ✅ 11 findings | ✅ 6 findings | ✅ 16 findings | ✅ 38 findings |
| **Frontend + Infrastructure** | ✅ 8 findings | ✅ 9 findings | ✅ 16 findings | ✅ 20 findings |

> **Full quad-model coverage achieved.** Each of the 3 areas was independently reviewed by all 4 models (12 successful reviews, ~169 total findings before deduplication).

---

## 🔴 CONSENSUS FINDINGS (Multiple Models Agree)

These findings were independently identified by **multiple models** reviewing the same area. Findings flagged by all models have the highest confidence.

### 🆕 0a. ⚡ Frontend: Conditional Hook Call in ManifestViewer (CRITICAL)
- **Severity: CRITICAL** | **Opus 4.6 unique — highest-severity finding in entire review**
- **File:** `frontend/src/components/deployments/ManifestViewer.tsx:152-154`
- **Issue:** `useDeploymentManifest` is called inside a ternary (`props.mode === 'deployed' ? useDeploymentManifest(...) : null`). This violates React's Rules of Hooks — hooks must never be called conditionally. If `mode` changes between renders, React's hook call order shifts, causing crashes or corrupted state.
- **Fix:** Always call `useDeploymentManifest` unconditionally; pass `enabled: props.mode === 'deployed'` to skip fetching when not needed.
- **Flagged by:** Opus 4.6 (Critical)

### 🆕 0b. ⚡ Frontend: Unstable useEffect Dependencies in ManifestViewer (CRITICAL)
- **Severity: CRITICAL** | **Opus 4.6 unique**
- **File:** `frontend/src/components/deployments/ManifestViewer.tsx:177, 185`
- **Issue:** Deps like `[props.mode === 'preview' ? isExpanded : null]` produce unstable dependency shapes. React compares deps by position/identity — ternary deps violate this contract, causing skipped effects or infinite re-runs.
- **Fix:** Use stable deps arrays listing all referenced variables; guard logic inside the effect body with `if` statements.
- **Flagged by:** Opus 4.6 (Critical)

### 1. ⚡ Controller: `specToMap` Silently Swallows Errors → CEL Gets Empty Data
- **Severity: HIGH** | **All 3 models flagged**
- **File:** `controller/internal/controller/modeldeployment_controller.go:378-387`
- **Issue:** `specToMap()` ignores errors from `json.Marshal` and `json.Unmarshal`. On failure, returns empty map, causing CEL selection rules to silently evaluate against no data — selecting wrong or no provider.
- **Fix:** Return error from `specToMap()` and propagate to caller. Fail reconciliation cleanly instead of silently proceeding.
- **Flagged by:** Gemini (High), Opus (High), GPT (implicit via CEL evaluation)

### 2. ⚡ Controller: CEL Compiled on Every Evaluation — Performance Issue
- **Severity: MEDIUM** | **All 3 models flagged**
- **File:** `controller/internal/controller/modeldeployment_controller.go:391-421`
- **Issue:** CEL environment and program are compiled from scratch on every rule evaluation. In clusters with many ModelDeployments and providers, this causes significant CPU overhead.
- **Fix:** Cache compiled CEL programs in the reconciler struct, keyed by expression string.
- **Flagged by:** Gemini (Medium), Opus (Medium), GPT (implicit via performance)

### 3. ⚡ Controller: Webhook Tests Are Empty Placeholders
- **Severity: MEDIUM** | **All 3 models flagged**
- **File:** `controller/internal/webhook/v1alpha1/modeldeployment_webhook_test.go:50-84`
- **Issue:** Tests are scaffolded with `TODO (user)` comments and zero assertions. Custom defaulting and validation logic is completely untested.
- **Fix:** Implement test cases for defaulting (HuggingFace source default) and validation rules (GPU requirements, engine compatibility).
- **Flagged by:** GPT (Low), Gemini (Medium), Opus (Low)

### 4. ⚡ Controller: Private Key Written with 0644 Permissions
- **Severity: MEDIUM** | **All 3 models flagged**
- **File:** `controller/cmd/main.go:314-316`
- **Issue:** TLS private key file is written with world-readable 0644 permissions instead of restricted 0600.
- **Fix:** Use `os.WriteFile(..., 0o600)` for `tls.key`.
- **Flagged by:** GPT (Low), Gemini (High — via cert security), Opus (Medium)

### 5. ⚡ Backend: Missing Input Validation on Deployment Creation
- **Severity: CRITICAL/HIGH** | **All 3 models flagged**
- **File:** `backend/src/routes/deployments.ts:77-109`
- **Issue:** POST body is parsed from JSON without Zod schema validation. Malformed data can create invalid CRs or cause 500 errors.
- **Fix:** Add `zValidator('json', deploymentConfigSchema)` middleware consistent with other endpoints.
- **Flagged by:** GPT (Medium), Opus (Critical), Gemini (implicit via API design)

### 6. ⚡ Backend: Auth Token Forwarded to HuggingFace
- **Severity: HIGH** | **All 3 models flagged**
- **File:** `backend/src/routes/models.ts:30-33,50-53`
- **Issue:** Authorization header is reused as HuggingFace token. When auth is enabled, this leaks the cluster auth token to an external API.
- **Fix:** Use a dedicated header (e.g., `X-HF-Token`) or validate token format before forwarding.
- **Flagged by:** GPT (High), Opus (Low — verified leak), Gemini (implicit via auth)

### 7. ⚡ Backend: Command Injection Risk in Helm/BuildKit
- **Severity: HIGH** | **Opus unique but critical**
- **File:** `backend/src/services/helm.ts:100-168`, `backend/src/services/buildkit.ts:385-430`
- **Issue:** Helm and Docker buildx args are constructed from user inputs (chart names, namespaces, build args, tags) without sanitization before spawning processes.
- **Fix:** Validate inputs against allowlist patterns (alphanumeric + hyphens) before passing to `spawn`.
- **Flagged by:** Opus (High — both files)

### 8. ⚡ Frontend: Auth Tokens Stored in localStorage — XSS Vulnerable
- **Severity: HIGH** | **All 3 models flagged**
- **File:** `frontend/src/hooks/useAuth.ts:38-45`
- **Issue:** Auth tokens stored in `localStorage` are accessible to any JavaScript. XSS attack can exfiltrate tokens.
- **Fix:** Use `httpOnly` cookies or store in memory with refresh token pattern. Apply strict CSP headers.
- **Flagged by:** Gemini (High), Opus (High), GPT (implicit via frontend security)

### 9. ⚡ Frontend: RBAC ClusterRole Is Over-Permissioned
- **Severity: HIGH** | **All 3 models flagged**
- **File:** `deploy/kubernetes/kubeairunway.yaml:37-83`
- **Issue:** ClusterRole grants `["*"]` verbs on `secrets` and `configmaps` cluster-wide plus `delete` on `namespaces`. Compromised service account = full cluster secret access.
- **Fix:** Restrict to specific verbs (get/list/watch), scope to namespaces via Role+RoleBinding.
- **Flagged by:** GPT (Medium), Gemini (High), Opus (Medium)

### 10. Controller: Status Update Race Condition
- **Severity: HIGH** | 2 of 3 models flagged
- **File:** `controller/internal/controller/modeldeployment_controller.go:93-139`
- **Issue:** `Status().Update()` writes the entire status object. Concurrent updates from core and provider controllers clobber each other.
- **Fix:** Use `Status().Patch()` with server-side apply or merge-patch.
- **Flagged by:** GPT (High), Gemini (Medium)

### 11. Controller: Webhook Certificate Handling Risks
- **Severity: MEDIUM-HIGH** | 2 of 3 models flagged
- **File:** `controller/cmd/main.go:195-320`
- **Issue:** Cert sync from Secret to filesystem happens only once — rotations won't update cert files. Self-signed bootstrap certs could enable MITM.
- **Fix:** Watch Secret changes for rotation; gate self-signed mode behind a dev flag.
- **Flagged by:** GPT (Medium), Gemini (High)

### 11a. ⚡ Controller: `status.Message` Never Cleared on Success
- **Severity: LOW-MEDIUM** | **Opus 4.6 unique**
- **File:** `controller/internal/controller/modeldeployment_controller.go:92,102,120`
- **Issue:** `status.Message` is set on failure paths but never cleared on successful reconciliation. A previously failed resource that recovers retains a stale error message, misleading users.
- **Fix:** Clear `status.Message` (set to `""`) at the start of reconciliation or on success path.
- **Flagged by:** Opus 4.6

### 11b. ⚡ Controller: Provider Name Change Not Picked Up After Initial Selection
- **Severity: MEDIUM** | **Opus 4.6 unique**
- **File:** `controller/internal/controller/modeldeployment_controller.go:109-121`
- **Issue:** When a user explicitly changes `spec.provider.name` (e.g., migrating providers), the old provider name sticks in `status.provider.name` because the guard `status.Provider.Name != ""` prevents update.
- **Fix:** Compare `spec.provider.name` with `status.provider.name` and update if they differ.
- **Flagged by:** Opus 4.6

### 11c. ⚡ Controller: Bootstrap Cert Directory Created World-Readable (0755)
- **Severity: MEDIUM** | **Opus 4.6 unique**
- **File:** `controller/cmd/main.go:90`
- **Issue:** `/tmp/k8s-webhook-server/serving-certs` is created with 0755. A directory holding private keys should use 0700.
- **Fix:** Use `os.MkdirAll(certDir, 0o700)`.
- **Flagged by:** Opus 4.6

### 11d. ⚡ Controller: Only `tls.crt` Checked, Not `tls.key`
- **Severity: LOW** | **Opus 4.6 unique**
- **File:** `controller/cmd/main.go:86-88`
- **Issue:** Bootstrap cert check only verifies `tls.crt` exists. If `tls.key` is missing but `tls.crt` exists, bootstrap is skipped and webhook fails to start.
- **Fix:** Check both `tls.crt` and `tls.key` exist before skipping bootstrap.
- **Flagged by:** Opus 4.6

### 11e. ⚡ Controller: Webhook Defaulter Empty Branch for `Replicas == 0`
- **Severity: LOW** | **Opus 4.6 unique**
- **File:** `controller/internal/webhook/v1alpha1/modeldeployment_webhook.go:73-78`
- **Issue:** `else if` branch for "Allow 0 for scale-to-zero" has an empty body — confusing dead code.
- **Fix:** Remove the empty branch or add explicit documentation/logging.
- **Flagged by:** Opus 4.6

### 12. Frontend: Toast Hook Memory Leak
- **Severity: MEDIUM** | 2 of 3 models flagged
- **File:** `frontend/src/hooks/useToast.ts:169-180`
- **Issue:** Effect depends on `state`, re-registering listeners on every state change without proper cleanup.
- **Fix:** Remove `state` from dependency array or register once with `[]`.
- **Flagged by:** GPT (Medium), Opus (Medium)

### 13. Frontend: DeploymentForm Fragile Runtime Logic
- **Severity: MEDIUM** | 2 of 3 models flagged
- **File:** `frontend/src/components/deployments/DeploymentForm.tsx:141-166`
- **Issue:** Default runtime selection computed once; not recomputed when async `runtimes` loads. `isVllmModel` check is fragile.
- **Fix:** Add effect to recompute defaults when runtimes load. Decouple engine detection.
- **Flagged by:** GPT (Medium), Gemini (Low)

### 14. Backend: `uninstall-crds` Endpoint Is Dangerous/Broken
- **Severity: HIGH** | 2 of 3 models flagged
- **File:** `backend/src/routes/installation.ts:236-252`
- **Issue:** Ignores `providerId` and deletes all CRDs broadly. Destructive cluster-level operation with no confirmation.
- **Fix:** Map provider IDs to specific CRDs. Add confirmation. Require admin scope.
- **Flagged by:** Gemini (Low), GPT (High)

---

## 🟡 ADDITIONAL HIGH-SEVERITY FINDINGS (Single Model)

### Controller Area

| # | Severity | Finding | File | Model |
|---|----------|---------|------|-------|
| 15 | **High** | Unchecked type assertion `out.Value().(bool)` can panic if CEL returns unexpected type | `controller/internal/controller/modeldeployment_controller.go:420` | Opus |
| 16 | **High** | Validation logic duplicated between webhook and controller — will drift over time | `webhook/.../modeldeployment_webhook.go:155` vs `controller/modeldeployment_controller.go:143` | Gemini |
| 17 | **High** | No finalizer on ModelDeployment — if provider controller is down during deletion, resources may be orphaned | `controller/internal/controller/modeldeployment_controller.go:60` | Gemini |

### Backend Area

| # | Severity | Finding | File | Model |
|---|----------|---------|------|-------|
| 18 | **High** | Insecure JWT parsing — token decoded via base64 without validation, crash risk | `backend/src/services/auth.ts:226-234` | Opus 4.5, **Opus 4.6** |
| 19 | **High** | Dynamo disaggregated mode assumes non-nil `spec.scaling.prefill/decode` — nil causes panic | `providers/dynamo/transformer.go:171-178,275-355` | GPT, **Opus 4.6** |
| 20 | **High** | Auth tokens stored in plaintext in `~/.kubeairunway/credentials.json` | `backend/src/services/auth.ts:260-269` | Gemini |
| 21 | **High** | HuggingFace token stored in localStorage — XSS vulnerable | `frontend/src/hooks/useHuggingFace.ts:200-206` | Opus 4.5, **Opus 4.6** |
| 22 | **High** | **`/api/settings` PUT is publicly accessible** — unauthenticated users can modify server settings | `backend/src/routes/settings.ts` + `hono-app.ts:73` | **Opus 4.6** |
| 23 | **High** | **`applyOverrides` allows overriding `metadata`, `apiVersion`, `kind`** — privilege escalation via CRD overrides | `providers/kaito/transformer.go:306-318`, `providers/dynamo/transformer.go:541-555` | **Opus 4.6** |
| 24 | **High** | **KAITO status reads replicas from wrong path** — `spec.resource.count` vs root-level `resource.count` | `providers/kaito/status.go:147` vs `transformer.go:102` | **Opus 4.6** |
| 25 | **High** | **KAITO status hardcodes port 80 for all workspaces** — llamacpp uses port 5000, endpoint wrong | `providers/kaito/status.go:166` | **Opus 4.6** |

---

## 🟠 MEDIUM-SEVERITY FINDINGS

### Controller Area

| # | Finding | File | Model |
|---|---------|------|-------|
| 22 | RBAC grants create/update/patch/delete on modeldeployments but controller only reads + updates status | `controller/internal/controller/modeldeployment_controller.go:45-48` | GPT |
| 23 | No CEL cost limits — malicious selection rules could cause DoS | `controller/internal/controller/modeldeployment_controller.go:392` | Gemini, **Opus 4.6** |
| 24 | Immutable `provider.name` check allows clearing (old non-empty → new empty), may orphan resources | `controller/internal/webhook/v1alpha1/modeldeployment_webhook.go:288-303` | GPT |
| 25 | `ObservedGeneration` updated before validation — should update after successful reconciliation | `controller/internal/controller/modeldeployment_controller.go:78-79` | Opus 4.5, **Opus 4.6** |
| 26 | Status update on validation failure returns immediately without checking update success | `controller/internal/controller/modeldeployment_controller.go:93` | Opus 4.5, **Opus 4.6** |
| 27 | Provider selection tie-breaking by name is undocumented | `controller/internal/controller/modeldeployment_controller.go:341` | Gemini |
| 28 | Dockerfile has dead `COPY providers/kaito/go.mod` references | `controller/Dockerfile:9` | Gemini |
| 29 | API allows conflicting aggregated/disaggregated configs caught only at runtime | `controller/api/v1alpha1/modeldeployment_types.go:223` | Gemini |
| 29a | **Provider selection failure doesn't set Phase to Failed** — stays Pending, users can't distinguish "waiting" from "permanently failed" | `controller/internal/controller/modeldeployment_controller.go:98-104` | **Opus 4.6** |

### Backend Area

| # | Finding | File | Model |
|---|---------|------|-------|
| 30 | `setConfig` uses `replaceNamespacedConfigMap` without optimistic locking — race condition | `backend/src/services/config.ts:144` | Gemini, **Opus 4.6** |
| 31 | HuggingFace `searchModels` pagination bug — filtered results may return fewer items than requested | `backend/src/services/huggingface.ts:170` | Gemini |
| 32 | Hardcoded container image versions in Dynamo provider require code rebuild to update | `providers/dynamo/transformer.go:463` | Gemini |
| 33 | Hardcoded `DefaultLlamaCppPort = 5000` in KAITO provider | `providers/kaito/transformer.go:39` | Gemini |
| 34 | Shared `PodTemplateSpec` doesn't align with provider expectations — scheduling settings may be dropped | `shared/types/deployment.ts:63-74` + multiple providers | GPT |
| 35 | AI configurator route uses manual `safeParse` instead of `zValidator` — inconsistent | `backend/src/routes/aiconfigurator.ts:31-54` | Opus 4.5, **Opus 4.6** |
| 36 | Cloud pricing OData filter has potential injection risk | `backend/src/services/cloudPricing.ts:227` | Opus 4.5 |
| 37 | Missing validation for cost query params (`gpuCount`, `replicas`, `computeType`) | `backend/src/routes/costs.ts:37-43` | Opus 4.5, **Opus 4.6** |
| 38 | `kubernetes.ts` is 45.7KB monolithic file — maintenance risk | `backend/src/services/kubernetes.ts` | Opus 4.5, **Opus 4.6** |
| 38a | **GET `/deployments` swallows errors and returns 200 with empty array** — clients can't detect failures | `backend/src/routes/deployments.ts:69-75` | **Opus 4.6** |
| 38b | **`providerId` param not validated** — passed directly to K8s API without regex constraint | `backend/src/routes/installation.ts:114,139,155,197,237` | **Opus 4.6** |
| 38c | **HuggingFace fetch calls have no timeout** — slow HF API hangs requests indefinitely | `backend/src/services/huggingface.ts:51,81,182,231` | **Opus 4.6** |
| 38d | **`loadCredentials` trusts file content blindly** — `JSON.parse` + `as` cast with no schema validation | `backend/src/services/auth.ts:287-288` | **Opus 4.6** |
| 38e | **Dynamo `config.go:Register` missing status-update retry loop** — unlike KAITO/KubeRay providers | `providers/dynamo/config.go:166` | **Opus 4.6** |
| 38f | **Non-deterministic engine args from map iteration** — causes unnecessary resource updates every 30s | `providers/dynamo/transformer.go:450`, `providers/kuberay/transformer.go:372` | **Opus 4.6** |
| 38g | **KubeRay head node missing nodeSelector/tolerations** — head may schedule on wrong node | `providers/kuberay/transformer.go:162-211` | **Opus 4.6** |
| 38h | **Misleading error message** for `resources.gpu` check — references scaling.prefill/decode even without scaling block | `controller/internal/controller/modeldeployment_controller.go:181` | **Opus 4.6** |
| 38i | **POST `/aiconfigurator/normalize-gpu` has no Zod validation** — only manual `body.gpuProduct` check | `backend/src/routes/aiconfigurator.ts:60-72` | **Opus 4.6** |
| 38j | **`modelId` regex too strict** — doesn't allow dots in org names (e.g., `org.name/model`) | `backend/src/services/aiconfigurator.ts:176` | **Opus 4.6** |
| 38k | **HuggingFace `modelId` interpolated into URL without sanitization** — path traversal risk | `backend/src/services/huggingface.ts:226` | **Opus 4.6** |
| 38l | **Token placed in URL fragment** (`#token=...`) in `generateLoginUrl` — visible in browser history/referrer | `backend/src/services/auth.ts:313` | **Opus 4.6** |
| 38m | **Internal `error.message` from K8s API leaked to clients** in multiple route/service files | `models.ts:43`, `installation.ts:105,259`, `secrets.ts:33,124,129` | **Opus 4.6** |

### Frontend Area

| # | Finding | File | Model |
|---|---------|------|-------|
| 39 | MetricsTab calls `setActiveCategory` during render — potential render loop | `frontend/src/components/metrics/MetricsTab.tsx:90-93` | GPT, **Opus 4.6** |
| 40 | `useMetrics` queryKey omits `provider` — stale cache across runtime changes | `frontend/src/hooks/useMetrics.ts:176-189` | GPT |
| 41 | Hardcoded `http://localhost:8000` in Chat button — fails for remote access | `frontend/src/components/deployments/DeploymentList.tsx` | Gemini |
| 42 | `atob()` for JWT decode fails on non-ASCII (Unicode) characters | `frontend/src/hooks/useAuth.ts` | Gemini |
| 43 | Fragile environment check using `import.meta.env.MODE` for timeout logic | `frontend/src/lib/api.ts` | Gemini |
| 44 | Dockerfile `COPY . .` before build — inefficient layer caching | `Dockerfile:24` | Gemini |
| 45 | Missing ESLint deps in HuggingFaceCallbackPage useEffect — disabled via comment | `frontend/src/pages/HuggingFaceCallbackPage.tsx:99` | Opus 4.5, **Opus 4.6** |
| 46 | `setTimeout` in mutation callbacks not cleared on unmount — memory leak | `frontend/src/hooks/useDeployments.ts:82-101` | Opus 4.5 |
| 47 | ErrorBoundary uses `bg-gray-50` instead of theme-aware `bg-background` — breaks dark mode | `frontend/src/components/ErrorBoundary.tsx:36` | Opus 4.5, **Opus 4.6** |
| 48 | Duplicate `nodes` resource in RBAC ClusterRole rules | `deploy/kubernetes/kubeairunway.yaml:47,80-83` | Opus 4.5, **Opus 4.6** |
| 48a | Unstable `nodePools` object dep in CostEstimate useEffect — fetch storm on every render | `frontend/src/components/deployments/CostEstimate.tsx:52-85` | **Opus 4.6** |
| 48b | Non-unique React key: `deployment.name` not unique across namespaces — misrendering | `frontend/src/components/deployments/DeploymentList.tsx:196-200` | **Opus 4.6** |
| 48c | Console.log in production leaks request URLs to browser console | `frontend/src/lib/api.ts:6,170,205` | **Opus 4.6** |
| 48d | Raw error.message shown to users — may expose internal paths/stack traces | `frontend/src/components/ErrorBoundary.tsx:46-49` | **Opus 4.6** |
| 48e | Unpinned distroless base image tag — supply-chain drift risk | `Dockerfile:45` | **Opus 4.6** |
| 48f | No lint/typecheck/build steps in CI workflow — only unit tests | `.github/workflows/test.yml` | **Opus 4.6** |

---

## 🟢 LOW-SEVERITY FINDINGS

| # | Finding | File | Model |
|---|---------|------|-------|
| 49 | KAITO: Resource limits not set (only requests) — no guaranteed QoS | `providers/kaito/transformer.go:224` | Gemini |
| 50 | KubeRay: Engine args passed as single string env var — shell parsing risk | `providers/kuberay/transformer.go:173` | Gemini |
| 51 | `getInferenceProviderConfig` returns `Promise<any>` — bypasses type checking | `backend/src/services/kubernetes.ts:453` | Gemini |
| 52 | Helm `execute` uses string parsing for error handling instead of typed errors | `backend/src/services/helm.ts:86` | Gemini |
| 53 | Models `/:id` endpoint only queries static list, not HuggingFace fallback | `backend/src/routes/models.ts:64` | Gemini |
| 54 | Scaffolded controller tests have no meaningful assertions | `controller/internal/controller/modeldeployment_controller_test.go:54-82` | GPT, Opus |
| 55 | `model.description?.toLowerCase()` may throw if description is undefined | `frontend/src/pages/ModelsPage.tsx:24-30` | GPT |
| 56 | Icon-only refresh button missing `aria-label` | `frontend/src/pages/DeploymentsPage.tsx:45-53` | GPT |
| 57 | Headlamp plugin uses webpack `eval` devtool — unsafe for production/CSP | `plugins/headlamp/dist/main.js` | GPT |
| 58 | Global `staleTime: 5000ms` causes aggressive K8s API polling | `frontend/src/App.tsx` | Gemini |
| 59 | `ContextLength` uses `int32` instead of `int64` | `controller/api/v1alpha1/modeldeployment_types.go:110` | Gemini |
| 60 | CEL evaluation errors silently ignored — masks config issues | `controller/internal/controller/modeldeployment_controller.go:324-330` | Opus |
| 61 | Missing context propagation to internal methods | `controller/internal/controller/modeldeployment_controller.go:60-140` | Opus |
| 62 | GPU count `Minimum=0` allows 0 GPUs with GPU-requiring engines | `controller/api/v1alpha1/modeldeployment_types.go:135-138` | Opus |
| 63 | `POD_NAMESPACE` fatal error lacks useful debugging context | `controller/cmd/main.go:267-270` | Opus |
| 64 | Dockerfile uses `golang:1.25` — verify matches go.mod | `controller/Dockerfile:1` | Opus |
| 65 | Secrets service swallows namespace creation error details | `backend/src/services/secrets.ts:50-71` | Opus |
| 66 | HuggingFace API response lacks runtime type validation | `backend/src/services/huggingface.ts:65-71` | Opus |
| 67 | Registry uses `emptyDir` — data loss on pod restart | `backend/src/services/registry.ts:270` | Opus |
| 68 | Unused `boolPtr` function in Dynamo provider | `providers/dynamo/transformer.go:539-540` | Opus |
| 69 | Unused `sanitizeLabelValue` function in KubeRay provider | `providers/kuberay/transformer.go:431-448` | Opus |
| 70 | Shared type conversion handles optional fields inconsistently | `shared/types/deployment.ts:225-280` | Opus |
| 71 | `document.getElementById('root')!` non-null assertion can throw | `frontend/src/main.tsx:16` | Opus |
| 72 | Long-running API requests can't be cancelled on unmount | `frontend/src/lib/api.ts:169-229` | Opus |
| 73 | `.github/workflows/test.yml` uses `bun ci` — should be `bun install --frozen-lockfile` | `.github/workflows/test.yml:22` | Opus |
| 74 | Test utilities missing `BrowserRouter` wrapper — router-dependent components will fail | `frontend/src/test/test-utils.tsx:40-58` | Opus |
| 75 | Login page missing `<form>` element — hurts a11y | `frontend/src/pages/LoginPage.tsx:117-124` | Opus |
| 76 | Deployment table missing ARIA labels and scope headers | `frontend/src/components/deployments/DeploymentList.tsx:182-283` | Opus |
| 77 | Duplicate query invalidation in install/uninstall hooks | `frontend/src/hooks/useInstallation.ts:64-70,83-89` | Opus |
| 78 | KAITO `sanitizeLabelValue` unused (separate from KubeRay #69) | `providers/kaito/transformer.go:282-297` | **Opus 4.6** |
| 79 | KubeRay worker resources only set `limits`, not `requests` — affects QoS class and scheduling | `providers/kuberay/transformer.go:227-236,270-279` | **Opus 4.6** |
| 80 | KubeRay `serveConfigV2` is hardcoded YAML — no model/engine customization, fragile contract | `providers/kuberay/transformer.go:118-125` | **Opus 4.6** |
| 81 | `computeType` query param accepts any string — should validate as `gpu`/`cpu` enum | `backend/src/routes/costs.ts:40` | **Opus 4.6** |
| 82 | `estimateCost` function is a no-op stub — unused parameter, always returns zero | `backend/src/services/costEstimation.ts:148` | **Opus 4.6** |
| 83 | Destructive re-release in CI — deletes and recreates releases, breaking existing download links | `.github/workflows/release.yml:99-103` | **Opus 4.6** |

---

## Summary by Area

### Controller (Go) — ⚠️ Needs Attention
- **~33 findings across 4 models** (5 consensus, 4 High, 14 Medium, 10 Low)
- **Top priorities:** `specToMap` error swallowing (all agree), CEL caching (all agree), status race condition, provider name change bug, provider selection failure doesn't set Failed phase
- All models agree the core reconciliation pattern is sound but needs hardening

### Backend + Shared + Providers — 🔴 Needs Immediate Attention
- **~46 findings across 4 models** (4 consensus, 9 High, 24 Medium, 9 Low)
- **Top priorities:** Unauthenticated settings mutation (Opus 4.6), `applyOverrides` privilege escalation (Opus 4.6), KAITO status path/port bugs (Opus 4.6), Dynamo nil panic, deployment validation, modelId URL injection
- Opus 4.6 uncovered critical provider-level bugs missed by other models

### Frontend + Infrastructure — ✅ Good with Improvements
- **~35 findings across 4 models** (2 Critical, 2 High, 16 Medium, 11 Low)
- **Top priorities:** Conditional hook call in ManifestViewer (Critical — Opus 4.6), localStorage token storage (all agree), RBAC (all agree), non-unique React keys
- Clean React patterns overall, but ManifestViewer has Rules of Hooks violations

### Total: ~114 deduplicated findings across 83 unique items

---

## Recommended Priority Actions

### 🔴 Immediate (Critical — Opus 4.6 Unique Catches)
1. **Fix conditional hook call in ManifestViewer** — violates Rules of Hooks, causes crashes (Frontend)
2. **Fix unstable useEffect deps in ManifestViewer** — ternary deps break React contract (Frontend)
3. **Restrict `/api/settings` PUT to authenticated users** — currently publicly accessible (Backend)
4. **Restrict `applyOverrides` to spec subtrees only** — blocks metadata/kind override privilege escalation (Providers)

### 🔴 Immediate (All Models Agree — Highest Confidence)
5. **Fix `specToMap` error handling** — return errors instead of empty map (Controller)
6. **Add Zod validation to deployment creation** — prevent malformed CRs (Backend)
7. **Restrict RBAC ClusterRole** to least-privilege verbs and namespaces (Infrastructure)
8. **Stop forwarding auth tokens to HuggingFace** — use dedicated header (Backend)
9. **Secure auth token storage** — migrate from localStorage to httpOnly cookies (Frontend)
10. **Cache CEL programs** — compile once, reuse (Controller performance)

### 🟠 Short-term (Multiple Models Agree)
11. Fix Dynamo disaggregated nil pointer panic (GPT + Opus 4.6)
12. Fix KAITO status replicas path mismatch and port hardcoding (Opus 4.6)
13. Fix status update race condition using `Status().Patch()` (Controller)
14. Fix `uninstall-crds` to scope by provider and add confirmation (Backend)
15. Fix toast hook memory leak (Frontend)
16. Implement webhook tests (Controller)
17. Fix cert file/dir permissions to 0600/0700 (Controller)
18. Sort map keys before building engine args — prevents unnecessary updates (Providers)
19. Sanitize HuggingFace `modelId` before URL interpolation (Backend — Opus 4.6)

### 🟡 Medium-term
20. Sanitize inputs to helm/buildkit spawn commands (Backend — Opus)
21. Add CEL cost limits to prevent DoS (Controller — Gemini + Opus 4.6)
22. Add finalizer to ModelDeployment (Controller — Gemini)
23. Add timeouts to HuggingFace fetch calls (Backend — Opus 4.6)
24. Fix KubeRay head node missing nodeSelector/tolerations (Providers — Opus 4.6)
25. Fix provider name change not picked up after initial selection (Controller — Opus 4.6)
26. Fix provider selection failure Phase (set to Failed, not Pending) (Controller — Opus 4.6)
27. Add lint/typecheck/build steps to CI workflow (Infrastructure — Opus 4.6)
28. Stop leaking internal K8s error.message to API clients (Backend — Opus 4.6)

---

## Model Performance Notes

| Model | Areas Reviewed | Total Findings | Unique Contributions |
|-------|---------------|----------------|---------------------|
| **Gemini 3 Pro** | 3/3 ✅ | ~31 | CEL DoS risk, missing finalizers, validation duplication, HF pagination bug |
| **GPT-5.2 Codex** | 3/3 ✅ | ~22 | Status race condition, React state bugs, a11y issues |
| **Opus 4.5** | 3/3 ✅ | ~46 | Command injection risks, unchecked type assertion, JWT parsing, monolithic file |
| **Opus 4.6** | 3/3 ✅ | ~80 | **Conditional hook call (Critical)**, unauthenticated settings PUT, `applyOverrides` privilege escalation, KAITO status path/port bugs, non-deterministic map iteration, non-unique React keys, provider name change bug, modelId URL injection, KubeRay head scheduling |

> **Opus 4.6 was the standout performer**, producing the highest finding count and uncovering the only Critical-severity issues in the entire review (ManifestViewer hook violations). It also found several High-severity provider bugs (KAITO status path, applyOverrides escalation, unauthenticated PUT) that all other models missed.

*Report generated from 12 successful reviews across 4 AI models (Gemini 3 Pro, GPT-5.2 Codex, Claude Opus 4.5, Claude Opus 4.6). Every area was independently reviewed by all 4 models for maximum coverage and confidence.*
