# KubeFoundry Unified CRD Abstraction

## Design Document

**Status:** Draft
**Author:** Sertac Ozercan
**Date:** January 2026
**Last Updated:** February 4, 2026

---

## 1. Executive Summary

This document proposes the introduction of a unified KubeFoundry Custom Resource Definition (CRD) that abstracts the underlying inference providers (KAITO, Dynamo, KubeRay). Users will deploy a `ModelDeployment` custom resource, and a KubeFoundry controller will reconcile this into the appropriate provider-specific resources.

### Goals
- Provide a single, unified API for deploying LLM inference workloads
- Abstract provider-specific complexity from end users
- Enable provider migration without changing the user-facing resource
- Centralize status aggregation and lifecycle management
- Support future provider additions without user-facing API changes

### Non-Goals
- Replacing provider-specific CRDs (they will still exist)
- Supporting all possible provider-specific features in the unified API
- Auto-migration between providers (manual trigger only)
- Performance-based autoscaling (HPA/KEDA replica scaling - deferred to future version)
- Adopting/migrating existing provider resources (users with existing KAITO Workspaces or DynamoGraphDeployments must create new ModelDeployments and manually delete old resources)
- Multi-model serving (LoRA adapters)

---

## 2. Behavior Changes

> **Important:** This section documents significant changes from previous KubeFoundry behavior.

### 2.1 Controller Required

KubeFoundry now requires the controller to be installed in the cluster before deployments can be created.

**Before:**
- `kubefoundry` binary generated and applied provider manifests directly
- Worked immediately with just kubeconfig access

**After:**
- `kubefoundry` binary creates `ModelDeployment` CRDs
- Controller (running in-cluster) reconciles CRDs into provider resources
- Must run `kubefoundry controller install` before first use

**Option A: Using the CLI**
```bash
$ kubefoundry controller install
Installing kubefoundry-controller...
  - CRDs: ModelDeployment
  - Deployment: kubefoundry-controller
  - RBAC: ServiceAccount, ClusterRole, ClusterRoleBinding
Done. Controller running in namespace kubefoundry-system.

$ kubefoundry start
Starting UI at http://localhost:3000
```

**Option B: Using kubectl directly**
```bash
# One-command install
kubectl apply -f https://raw.githubusercontent.com/kubefoundry/kubefoundry/main/manifests/install.yaml

# Or with kustomize for customization
kubectl apply -k https://github.com/kubefoundry/kubefoundry/manifests
```

**Upgrading the controller:**
```bash
# Option A: CLI
$ kubefoundry controller upgrade

# Option B: kubectl (re-apply latest manifests)
kubectl apply -f https://raw.githubusercontent.com/kubefoundry/kubefoundry/main/manifests/install.yaml
```

If controller isn't installed:
```bash
$ kubefoundry start
Error: kubefoundry-controller not found in cluster.
Run 'kubefoundry controller install' first.
```

### 2.2 TypeScript Binary Role Change

| Function                    | Before                       | After                                                     |
| --------------------------- | ---------------------------- | --------------------------------------------------------- |
| Generate provider manifests | Yes                          | No (controller does this)                                 |
| Apply provider CRDs         | Yes                          | No (controller does this)                                 |
| Parse provider status       | Yes                          | No (reads ModelDeployment.status)                         |
| Web UI                      | Yes                          | Yes (unchanged)                                           |
| Create deployments          | Direct to provider           | Creates ModelDeployment CRD                               |
| Install controller          | Applies controller manifests | Applies controller manifests (also available via kubectl) |

### 2.3 Manifest Generation Location

All manifest generation logic moves from TypeScript to the Go controller. The TypeScript codebase no longer contains provider-specific manifest templates.

### 2.4 KubeRay Requires Explicit Selection

KubeRay is never auto-selected by the provider selection algorithm. Users must explicitly specify `provider.name: kuberay` to use it.

**Rationale:**
- KubeRay's primary differentiator is autoscaling via Ray Serve, which is out of scope for v1alpha1
- KubeRay requires more setup knowledge and Ray-specific configuration
- Auto-selecting KubeRay could confuse users who aren't familiar with Ray

**Usage:**
```yaml
spec:
  provider:
    name: kuberay  # Must be explicit - will not be auto-selected
```

---

## 3. Architecture: Provider Plugin Model

> This architecture treats all providers (KAITO, Dynamo, KubeRay, and future providers) as external plugins rather than built-in components. This approach is inspired by the Kubernetes Container Runtime Interface (CRI) and Cluster API provider patterns.

### 3.1 Design Principles

> **Recommendation:** This plugin architecture is the recommended approach for KubeFoundry. It provides the best extensibility, independent release cycles, and follows proven Kubernetes patterns (CRI, Cluster API). See Appendix A for a simpler monolithic alternative suitable for teams that don't need third-party providers.

1. **Core has zero provider knowledge** - The core controller only handles ModelDeployment CRD validation and defaults
2. **Providers are adapters** - Each provider controller is a "shim" (like dockershim for CRI) that translates ModelDeployment to upstream CRDs
3. **Independent releases** - Provider controllers are versioned and released independently from core
4. **Third-party extensibility** - Anyone can add a new provider without modifying KubeFoundry core

### 3.2 The CRI Analogy

This design follows the same pattern as Kubernetes Container Runtime Interface (CRI):

```
CRI Pattern:
   kubelet ──► CRI Interface ──► containerd/CRI-O/dockershim ──► containers

KubeFoundry Provider Pattern:
   core ──► Provider Interface ──► kaito-provider/dynamo-provider ──► upstream CRDs
```

Just as `dockershim` was an adapter that made Docker (which predates CRI) work with the CRI interface, `kaito-provider` is an adapter that makes KAITO (which doesn't know about KubeFoundry) work with the KubeFoundry provider interface.

#### Lessons from Dockershim

Dockershim was deprecated and removed from Kubernetes in v1.24 due to architectural issues. Our design explicitly avoids these mistakes:

| Dockershim Problem | Our Solution |
|--------------------|--------------|
| **Embedded in kubelet** - Tight coupling meant every kubelet release had to consider Docker compatibility | Provider controllers are **separate deployments** with independent release cycles |
| **Maintenance burden** - Docker bugs affected core Kubernetes releases | A bug in kaito-provider only affects KAITO users, not core |
| **Blocked innovation** - New features (cgroups v2) couldn't be adopted because dockershim couldn't translate them | Providers can be updated independently; `provider.overrides` provides escape hatch |
| **Special treatment** - Docker got different treatment than other runtimes | All providers go through the same InferenceProviderConfig interface |

When dockershim was removed, Mirantis created `cri-dockerd` as an external adapter - validating that shims can live outside core. Our architecture follows this correct pattern from day one.

### 3.3 System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                    User                                          │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       │ kubectl apply
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                             ModelDeployment                                      │
│                          kubefoundry.ai/v1alpha1                                 │
│                                                                                  │
│  spec:                                                                           │
│    model: {id: "meta-llama/Llama-3.1-8B", source: huggingface}                  │
│    engine: {type: vllm}                                                          │
│    provider: {name: kaito}   ◄─── explicit, or let provider-selector choose     │
│    resources: {...}                                                              │
│                                                                                  │
│  status:                                                                         │
│    provider:                       ◄─── set by provider-selector or user        │
│      name: kaito                                                                 │
│      selectedReason: "..."                                                       │
│    phase: Running                  ◄─── set by provider controller              │
│    endpoint: {...}                 ◄─── set by provider controller              │
│    conditions: [...]               ◄─── set by provider controller              │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         │                             │                             │
         ▼                             ▼                             ▼
┌─────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│  kubefoundry-core   │  │   provider-selector     │  │   provider controllers  │
│  (webhooks only)    │  │   (optional component)  │  │                         │
│                     │  │                         │  │  ┌───────────────────┐  │
│  • Validate schema  │  │  • Watches MD where     │  │  │  kaito-provider   │  │
│  • Set defaults     │  │    provider.name empty  │  │  └───────────────────┘  │
│  • NO provider      │  │  • Queries registered   │  │  ┌───────────────────┐  │
│    knowledge        │  │    providers            │  │  │  dynamo-provider  │  │
│                     │  │  • Runs selection algo  │  │  └───────────────────┘  │
│                     │  │  • Sets provider.name   │  │  ┌───────────────────┐  │
│                     │  │                         │  │  │  kuberay-provider │  │
│                     │  │  Can be replaced with   │  │  └───────────────────┘  │
│                     │  │  custom selector!       │  │  ┌───────────────────┐  │
│                     │  │                         │  │  │  your-provider    │  │
│                     │  │                         │  │  └───────────────────┘  │
└─────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
                                       │
                                       │ reads
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                       InferenceProviderConfig                              │
│                          kubefoundry.ai/v1alpha1                                 │
│                                                                                  │
│  Each provider registers itself with capabilities and selection rules            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Data Flow

```
                                    ┌─────────────────┐
                                    │ User applies    │
                                    │ ModelDeployment │
                                    └────────┬────────┘
                                             │
                                             ▼
                                    ┌─────────────────┐
                                    │ kubefoundry-    │
                                    │ core webhooks   │
                                    │ (validation)    │
                                    └────────┬────────┘
                                             │
                          ┌──────────────────┴──────────────────┐
                          │                                     │
                          ▼                                     ▼
               ┌─────────────────────┐              ┌─────────────────────┐
               │ provider specified? │──── yes ───►│ provider controller │
               └─────────────────────┘              │ watches & acts      │
                          │                         └──────────┬──────────┘
                          no                                   │
                          │                                    │
                          ▼                                    │
               ┌─────────────────────┐                         │
               │ provider-selector   │                         │
               │ picks best match    │                         │
               │ from configs        │                         │
               └─────────┬───────────┘                         │
                         │                                     │
                         │ sets status.provider.name           │
                         │                                     │
                         └─────────────────────────────────────┤
                                                               │
                                                               ▼
                                                    ┌─────────────────────┐
                                                    │ Provider creates    │
                                                    │ upstream resource   │
                                                    │ (Workspace, etc.)   │
                                                    └─────────┬───────────┘
                                                              │
                                                              ▼
                                                    ┌─────────────────────┐
                                                    │ Upstream operator   │
                                                    │ reconciles pods     │
                                                    └─────────┬───────────┘
                                                              │
                                                              ▼
                                                    ┌─────────────────────┐
                                                    │ Provider syncs      │
                                                    │ status back to      │
                                                    │ ModelDeployment     │
                                                    └─────────────────────┘
```

### 3.5 Component Breakdown

#### 3.5.1 kubefoundry-core (Minimal)

The core component contains only:
- `ModelDeployment` CRD definition
- `InferenceProviderConfig` CRD definition
- Validating webhook (schema validation only, no provider knowledge)
- Mutating webhook (defaults only)

The core does NOT contain:
- Provider-specific transformation logic
- Provider selection algorithm (this is in provider-selector)
- Knowledge of Workspace, DynamoGraphDeployment, or RayService schemas

#### 3.5.2 provider-selector (Conditionally Required, Replaceable)

A separate component that handles auto-selection:
- Watches `ModelDeployment` resources where `status.provider.name` is empty
- Queries all `InferenceProviderConfig` resources
- Runs selection algorithm based on provider capabilities
- Sets `status.provider.name` and `status.provider.selectedReason`

**When is provider-selector required?**
- **Required** if `spec.provider.name` is omitted (auto-selection needed)
- **Not required** if user explicitly specifies `spec.provider.name`

If provider-selector is not installed and no provider is specified, the `ModelDeployment` remains in `Pending` status with condition `ProviderSelected: False` and message "No provider specified and provider-selector not installed".

**No healthy providers:** If all `InferenceProviderConfig` resources report `ready: false`, the `ModelDeployment` remains in `Pending` status with message "No healthy providers available".

Organizations can replace this with custom selectors for:
- Policy-based selection ("Team X can only use KAITO")
- Cost-based selection ("Prefer cheapest provider")
- Availability-based selection ("Use provider with most capacity")

#### 3.5.3 Provider Controllers

Each provider is a separate controller deployment that acts as an adapter (shim):

```
github.com/kubefoundry/kaito-provider/
github.com/kubefoundry/dynamo-provider/
github.com/kubefoundry/kuberay-provider/
github.com/third-party/their-provider/   # Third-party providers welcome
```

Provider controllers:
1. Register themselves by creating an `InferenceProviderConfig`
2. Watch `ModelDeployment` filtered by `status.provider.name == "their-name"`
3. Transform `ModelDeployment` spec to upstream CRD (e.g., Workspace)
4. Write status back to `ModelDeployment` using server-side apply
5. Handle upstream schema changes with version-specific transformers

### 3.6 Upstream Providers

| Provider | CRD                     | API Group             | Primary Use Case                      |
| -------- | ----------------------- | --------------------- | ------------------------------------- |
| KAITO    | `Workspace`             | `kaito.sh/v1beta1`    | CPU/GPU flexible with GGUF, vLLM      |
| Dynamo   | `DynamoGraphDeployment` | `nvidia.com/v1alpha1` | High-perf GPU with vLLM/sglang/trtllm |
| KubeRay  | `RayService`            | `ray.io/v1`           | Scalable serving with Ray Serve       |

### 3.7 Deployment Topology

```
kubefoundry-system namespace:
├── kubefoundry-core         (webhooks, minimal resources)
├── provider-selector        (optional, replaceable)
├── kaito-provider      ─┐
├── dynamo-provider      ├── independently versioned & released
├── kuberay-provider    ─┘
└── third-party-provider     (installed separately)
```

### 3.8 Installation Options

```bash
# Full bundle (core + selector + all built-in providers)
kubectl apply -f https://kubefoundry.io/install.yaml

# À la carte installation
kubectl apply -f https://kubefoundry.io/core.yaml
kubectl apply -f https://kubefoundry.io/provider-selector.yaml
kubectl apply -f https://kubefoundry.io/providers/kaito.yaml
kubectl apply -f https://kubefoundry.io/providers/dynamo.yaml

# Third-party provider
kubectl apply -f https://newframework.io/kubefoundry-provider.yaml
```

Or with CLI:

```bash
kubefoundry controller install                    # Core only
kubefoundry provider install kaito                # Built-in provider
kubefoundry provider install dynamo
kubefoundry provider install https://example.com/provider.yaml  # Third-party
```

### 3.9 InferenceProviderConfig CRD

Each provider registers itself by creating an `InferenceProviderConfig` resource:

```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: InferenceProviderConfig
metadata:
  name: kaito
spec:
  # Capabilities this provider supports
  capabilities:
    engines: [vllm, llamacpp]
    servingModes: [aggregated]
    cpuSupport: true
    gpuSupport: true

  # Selection rules for auto-selection algorithm
  # Conditions use CEL (Common Expression Language) - same as K8s ValidatingAdmissionPolicy
  selectionRules:
    - condition: "!has(spec.resources.gpu) || spec.resources.gpu.count == 0"
      priority: 100  # Best for CPU workloads
    - condition: "spec.engine.type == 'llamacpp'"
      priority: 100  # Only llamacpp provider

  # Documentation link
  documentation: "https://github.com/kubefoundry/kaito-provider"

status:
  # Written by the provider controller on startup
  ready: true
  version: "kaito-provider:v1.2.0"
  lastHeartbeat: "2026-02-04T10:00:00Z"
  upstreamCRDVersion: "kaito.sh/v1alpha1"
  upstreamSchemaHash: "abc123def456"
```

**Selection Rule Expression Language:** Conditions use [CEL (Common Expression Language)](https://github.com/google/cel-spec), the same expression language used by Kubernetes ValidatingAdmissionPolicy. This provides:
- Type-safe expressions with compile-time validation
- Access to the full `ModelDeployment` spec via `spec.*`
- Standard functions: `has()`, `size()`, string operations, etc.
- Example: `has(spec.resources.gpu) && spec.resources.gpu.count > 0`

### 3.10 Status Ownership with Server-Side Apply

Multiple controllers write to `ModelDeployment.status` using server-side apply with distinct field managers.

**Conflict Resolution:** Server-side apply (SSA) handles conflicts via field ownership. Each controller uses a unique `fieldManager` identifier and owns distinct, non-overlapping fields. This means:
- `provider-selector` owns `status.provider.name` and `status.provider.selectedReason`
- Provider controllers own `status.phase`, `status.endpoint`, `status.replicas`, etc.
- No conflicts occur because fields don't overlap
- If a controller attempts to write a field owned by another, SSA rejects the update (this indicates a bug)

```yaml
status:
  # Written by provider-selector (fieldManager: "provider-selector")
  provider:
    name: kaito
    selectedReason: "no GPU requested → kaito"
    # Written by provider controller (fieldManager: "kaito-provider")
    resourceName: my-llm
    resourceKind: Workspace

  # Written by kaito-provider (fieldManager: "kaito-provider")
  phase: Running
  message: "All replicas healthy"
  endpoint:
    service: my-llm
    port: 80

  replicas:
    desired: 1
    ready: 1
    available: 1

  conditions:
    - type: Validated           # core webhook
      status: "True"
    - type: ProviderSelected    # provider-selector
      status: "True"
    - type: ProviderCompatible  # provider controller
      status: "True"
    - type: ResourceCreated     # provider controller
      status: "True"
    - type: Ready               # provider controller
      status: "True"

  observedGeneration: 1
```

### 3.11 Provider Controller Implementation

Each provider controller transforms `ModelDeployment` to its upstream CRD and handles schema instability:

```go
type KAITOProviderController struct {
    client          client.Client
    schemaDetector  *SchemaDetector
    transformers    map[string]KAITOTransformer  // schema hash → transformer
}

func (r *KAITOProviderController) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
    var md kubefoundryv1alpha1.ModelDeployment
    if err := r.client.Get(ctx, req.NamespacedName, &md); err != nil {
        return ctrl.Result{}, client.IgnoreNotFound(err)
    }

    // 1. Detect current KAITO CRD schema
    schema, err := r.schemaDetector.Detect(ctx)
    if err != nil {
        return r.handleSchemaDetectionFailure(ctx, &md, err)
    }

    // 2. Find transformer for this schema version
    transformer, ok := r.transformers[schema.Hash]
    if !ok {
        return r.handleUnknownSchema(ctx, &md, schema)
    }

    // 3. Transform ModelDeployment to Workspace
    workspace, err := transformer.ToWorkspace(&md)
    if err != nil {
        return ctrl.Result{}, err
    }

    // 4. Validate with dry-run before applying
    if err := r.validateAndApply(ctx, workspace); err != nil {
        return r.handleApplyFailure(ctx, &md, err)
    }

    // 5. Sync Workspace status back to ModelDeployment
    return r.syncStatus(ctx, &md, workspace)
}

func (r *KAITOProviderController) SetupWithManager(mgr ctrl.Manager) error {
    return ctrl.NewControllerManagedBy(mgr).
        For(&kubefoundryv1alpha1.ModelDeployment{}).
        WithEventFilter(predicate.NewPredicateFuncs(func(obj client.Object) bool {
            md := obj.(*kubefoundryv1alpha1.ModelDeployment)
            return md.Status.Provider.Name == "kaito"
        })).
        Owns(&unstructured.Unstructured{/* Workspace */}).
        Complete(r)
}
```

### 3.12 Schema Version Adapters

Provider controllers maintain multiple transformers for different upstream schema versions:

```go
// Original KAITO schema
type KAITOTransformerV03 struct{}

func (t *KAITOTransformerV03) ToWorkspace(md *ModelDeployment) (*unstructured.Unstructured, error) {
    ws := &unstructured.Unstructured{}
    ws.SetAPIVersion("kaito.sh/v1alpha1")
    ws.SetKind("Workspace")
    // Uses resource.count (original field name)
    unstructured.SetNestedField(ws.Object, md.Spec.Scaling.Replicas, "spec", "resource", "count")
    return ws, nil
}

// After KAITO renamed fields (hypothetical future version)
type KAITOTransformerV04 struct{}

func (t *KAITOTransformerV04) ToWorkspace(md *ModelDeployment) (*unstructured.Unstructured, error) {
    ws := &unstructured.Unstructured{}
    ws.SetAPIVersion("kaito.sh/v1alpha1")
    ws.SetKind("Workspace")
    // Uses resource.replicas (new field name)
    unstructured.SetNestedField(ws.Object, md.Spec.Scaling.Replicas, "spec", "resource", "replicas")
    return ws, nil
}

// Registry of known schemas
var KAITOTransformers = map[string]KAITOTransformer{
    "abc123def456": &KAITOTransformerV03{},  // schema hash for v0.3.x
    "789xyz000111": &KAITOTransformerV04{},  // schema hash for v0.4.x
}
```

### 3.13 Semantic Translation

Provider controllers handle two types of translation, similar to how Kubernetes dockershim translated between CRI and Docker:

1. **Syntactic translation** - Field mapping and schema version adapters (covered in 3.12)
2. **Semantic translation** - Concept mapping when ModelDeployment concepts don't exist in the upstream provider

#### The Dockershim Precedent

Dockershim was an adapter that made Docker (which predates CRI) work with the CRI interface. It handled semantic mismatches like:
- CRI's "PodSandbox" concept → Docker had no equivalent, so dockershim created a `pause` container
- CRI's streaming APIs → Translated to Docker's different streaming semantics

Provider controllers follow the same pattern - they're adapters that handle semantic gaps between ModelDeployment and upstream CRDs.

#### Semantic Translation Examples

| ModelDeployment Concept | KAITO Translation | Dynamo Translation | KubeRay Translation |
|------------------------|-------------------|--------------------|--------------------|
| `engine.type: vllm` | Creates inference template with vLLM preset | Sets `backendFramework: vllm` | Configures RayServe with vLLM worker |
| `engine.type: llamacpp` | Creates custom inference template | ❌ Rejects with error | ❌ Rejects with error |
| `serving.mode: disaggregated` | ❌ Rejects with error | Creates separate Prefill/Decode workers | Creates multiple Ray actor groups |
| `scaling.replicas` | Sets `resource.count` | Sets worker replicas | Sets Ray worker replicas |

#### Implementation Pattern

```go
type SemanticTranslator interface {
    // CanHandle returns whether this provider supports the ModelDeployment configuration
    CanHandle(md *ModelDeployment) (bool, string)  // (supported, reason if not)

    // TranslateSpec performs semantic translation to upstream CRD
    TranslateSpec(md *ModelDeployment) (*unstructured.Unstructured, error)

    // TranslateStatus maps upstream status back to ModelDeployment status
    TranslateStatus(upstream *unstructured.Unstructured) (*ModelDeploymentStatus, error)
}

// Example: KAITO rejects disaggregated mode
func (t *KAITOTransformer) CanHandle(md *ModelDeployment) (bool, string) {
    if md.Spec.Serving.Mode == "disaggregated" {
        return false, "KAITO does not support disaggregated serving mode"
    }
    if md.Spec.Engine.Type == "sglang" || md.Spec.Engine.Type == "trtllm" {
        return false, fmt.Sprintf("KAITO does not support %s engine", md.Spec.Engine.Type)
    }
    return true, ""
}
```

#### Status Semantic Translation

Each provider reports status differently. Provider controllers translate these to the unified ModelDeployment status:

```go
// KAITO status translation
func (t *KAITOTransformer) TranslateStatus(ws *unstructured.Unstructured) (*ModelDeploymentStatus, error) {
    // KAITO uses conditions: WorkspaceSucceeded, InferenceReady
    conditions, _ := getNestedSlice(ws.Object, "status", "conditions")

    status := &ModelDeploymentStatus{}
    for _, c := range conditions {
        if c["type"] == "WorkspaceSucceeded" && c["status"] == "True" {
            status.Phase = "Running"
        } else if c["type"] == "WorkspaceSucceeded" && c["status"] == "False" {
            status.Phase = "Failed"
            status.Message = c["message"].(string)
        }
    }
    return status, nil
}

// Dynamo status translation
func (t *DynamoTransformer) TranslateStatus(dgd *unstructured.Unstructured) (*ModelDeploymentStatus, error) {
    // Dynamo uses state field: "deploying", "successful", "failed"
    state, _ := getNestedString(dgd.Object, "status", "state")

    status := &ModelDeploymentStatus{}
    switch state {
    case "successful":
        status.Phase = "Running"
    case "deploying":
        status.Phase = "Deploying"
    case "failed":
        status.Phase = "Failed"
        status.Message, _ = getNestedString(dgd.Object, "status", "message")
    }
    return status, nil
}
```

#### Additional Resource Creation

Like dockershim creating pause containers, provider controllers may create additional resources:

```go
func (t *DynamoTransformer) TranslateSpec(md *ModelDeployment) ([]*unstructured.Unstructured, error) {
    resources := []*unstructured.Unstructured{}

    // Primary resource: DynamoGraphDeployment
    dgd := t.createDynamoGraphDeployment(md)
    resources = append(resources, dgd)

    // Additional resource: ConfigMap for NATS configuration (if needed)
    if md.Spec.Serving.Mode == "disaggregated" {
        natsConfig := t.createNATSConfigMap(md)
        resources = append(resources, natsConfig)
    }

    return resources, nil
}
```

### 3.14 Adding a New Provider

Third parties can add providers without any changes to KubeFoundry core:

1. Create a controller that watches `ModelDeployment`
2. Filter for `status.provider.name == "your-provider"`
3. Transform to your upstream CRD
4. Write status back to `ModelDeployment`
5. Create `InferenceProviderConfig` on startup

```go
// third-party-provider/main.go
func main() {
    // Register this provider
    providerConfig := &kubefoundryv1alpha1.InferenceProviderConfig{
        ObjectMeta: metav1.ObjectMeta{Name: "newframework"},
        Spec: kubefoundryv1alpha1.ProviderConfigSpec{
            Capabilities: kubefoundryv1alpha1.ProviderCapabilities{
                Engines:      []string{"vllm", "custom"},
                ServingModes: []string{"aggregated"},
                GPUSupport:   true,
            },
            SelectionRules: []kubefoundryv1alpha1.SelectionRule{
                {Condition: "spec.model.id.startsWith('newframework/')", Priority: 100},
            },
        },
    }
    client.Create(ctx, providerConfig)

    // Start controller
    mgr.Start(ctx)
}
```

---

## 4. Detailed Design

### 4.1 ModelDeployment CRD

```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: my-llm
  namespace: default
  annotations:
    # Optional: pause reconciliation for debugging
    kubefoundry.ai/reconcile-paused: "false"
spec:
  # Model specification (required)
  model:
    id: "meta-llama/Llama-3.1-8B-Instruct"  # HuggingFace model ID (required when source=huggingface, omit for custom)
    servedName: "llama-3.1-8b"               # API-facing model name (optional - defaults to model ID basename)
                                             # N/A for source=custom (container defines model name internally)
    source: "huggingface"                    # huggingface (default) | custom (pre-loaded in image)

  # Provider selection (optional - auto-selected if not specified)
  provider:
    name: "dynamo"                           # dynamo | kaito | kuberay
    # Provider-specific overrides (optional escape hatch, see Section 4.15)
    overrides: {}
      # Dynamo example:
      # routerMode: "kv"
      # frontend: { replicas: 2, resources: { cpu: "4", memory: "8Gi" } }
      #
      # KubeRay example:
      # head: { resources: { cpu: "4", memory: "8Gi" }, rayStartParams: { "num-cpus": "0" } }

  # Inference engine configuration
  engine:
    type: "vllm"                             # vllm | sglang | trtllm | llamacpp

    # Universal options (apply to all engines, mapped to engine-specific flags)
    contextLength: 8192                      # vllm: --max-model-len, sglang: --context-length, llamacpp: --ctx-size

    # HuggingFace-specific (vllm, sglang only - N/A for llamacpp/gguf)
    trustRemoteCode: false

    # Engine-specific options (use args for full control)
    # Schema: map[string]string - all values are strings
    # These are passed directly to the engine and vary by type:
    #   vllm:    --enforce-eager, --enable-prefix-caching, --gpu-memory-utilization, --quantization
    #   sglang:  --disable-cuda-graph, --disable-radix-cache, --mem-fraction-static, --quantization
    #   trtllm:  enable_block_reuse, kv_cache_config
    #   llamacpp: --cache-type-k, --cache-type-v, --ctx-size
    args: {}  # e.g., { "quantization": "awq", "gpu-memory-utilization": "0.9" }

  # Serving mode
  serving:
    mode: "aggregated"                       # aggregated | disaggregated
    # Note: routerMode moved to provider.overrides (Dynamo-specific)

  # Scaling configuration
  scaling:
    replicas: 1                              # For aggregated mode (0 allowed for scale-to-zero)
    # For disaggregated mode (spec.resources not allowed, use per-component)
    # Note: Frontend/head component uses controller defaults; customize via provider.overrides
    prefill:
      replicas: 1
      gpu:
        count: 1                             # Required for disaggregated
      memory: "64Gi"                         # Required for disaggregated
    decode:
      replicas: 1
      gpu:
        count: 1                             # Required for disaggregated
      memory: "64Gi"                         # Required for disaggregated

  # Resource requirements (GPU inferred from gpu.count > 0)
  resources:
    gpu:
      count: 1
      # Optional: GPU resource name (defaults to nvidia.com/gpu, override for AMD/Intel)
      type: "nvidia.com/gpu"
    memory: "32Gi"
    cpu: "4"

  # Container customization
  image: ""                                  # Optional: custom container image
  env: []                                    # Optional: environment variables
    # - name: VLLM_LOGGING_LEVEL
    #   value: DEBUG

  # Pod metadata propagation
  podTemplate:
    metadata:
      labels: {}                             # Labels for created pods
      annotations: {}                        # Annotations for created pods

  # Secrets
  secrets:
    huggingFaceToken: "hf-token-secret"      # K8s secret name

  # Optional: Node targeting
  nodeSelector: {}
  tolerations: []

status:
  # Unified status
  phase: "Running"                           # Pending | Deploying | Running | Failed | Terminating
  message: "Deployment is healthy"           # Extracted from provider status

  # Provider information
  provider:
    name: "dynamo"
    resourceName: "my-llm"
    resourceKind: "DynamoGraphDeployment"
    selectedReason: "default → dynamo (GPU inference default)"  # Explains auto-selection

  # Replica status
  replicas:
    desired: 1
    ready: 1
    available: 1

  # Service endpoint
  endpoint:
    service: "my-llm-frontend"
    port: 8000

  # Conditions (Kubernetes-style)
  conditions:
    - type: "Validated"                          # Set by core webhook
      status: "True"
      lastTransitionTime: "2026-01-30T09:50:00Z"
      reason: "ValidationPassed"
      message: "Schema validation passed"
    - type: "ProviderSelected"                   # Set by provider-selector
      status: "True"
      lastTransitionTime: "2026-01-30T09:51:00Z"
      reason: "AutoSelected"
      message: "Provider dynamo auto-selected"
    - type: "ProviderCompatible"                 # Set by provider controller
      status: "True"
      lastTransitionTime: "2026-01-30T09:52:00Z"
      reason: "CompatibilityVerified"
      message: "Configuration compatible with Dynamo"
    - type: "ResourceCreated"                    # Set by provider controller
      status: "True"
      lastTransitionTime: "2026-01-30T09:55:00Z"
      reason: "ResourceCreated"
      message: "DynamoGraphDeployment created successfully"
    - type: "Ready"                              # Set by provider controller
      status: "True"
      lastTransitionTime: "2026-01-30T10:00:00Z"
      reason: "DeploymentReady"
      message: "All replicas are ready"

  # Observed generation for controller
  observedGeneration: 1
```

### 4.2 Example Transformations

This section shows how `ModelDeployment` resources are transformed into provider-specific CRDs.

#### Example 1: GPU Deployment → Dynamo (Auto-selected)

**ModelDeployment (user creates):**
```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: llama-8b
  namespace: default
spec:
  model:
    id: "meta-llama/Llama-3.1-8B-Instruct"
    source: "huggingface"
  engine:
    type: "vllm"
    contextLength: 8192
  serving:
    mode: "aggregated"
  scaling:
    replicas: 1
  resources:
    gpu:
      count: 1
    memory: "32Gi"
  secrets:
    huggingFaceToken: "hf-token"
```

**DynamoGraphDeployment (controller creates):**
```yaml
apiVersion: nvidia.com/v1alpha1
kind: DynamoGraphDeployment
metadata:
  name: llama-8b
  namespace: default
  ownerReferences:
    - apiVersion: kubefoundry.ai/v1alpha1
      kind: ModelDeployment
      name: llama-8b
      controller: true
spec:
  backendFramework: vllm
  services:
    Frontend:
      componentType: frontend
      dynamoNamespace: llama-8b
      replicas: 1
      envFromSecret: hf-token
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
    VllmWorker:
      componentType: worker
      dynamoNamespace: llama-8b
      replicas: 1
      envFromSecret: hf-token
      resources:
        limits:
          gpu: "1"
          memory: "32Gi"
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
          command: ["/bin/sh", "-c"]
          args: ["python3 -m dynamo.vllm --model meta-llama/Llama-3.1-8B-Instruct --max-model-len 8192"]
```

**Status after reconciliation:**
```yaml
status:
  phase: "Running"
  provider:
    name: "dynamo"
    resourceName: "llama-8b"
    resourceKind: "DynamoGraphDeployment"
    selectedReason: "default → dynamo (GPU inference default)"
  endpoint:
    service: "llama-8b-frontend"
    port: 8000
```

#### Example 2: CPU Deployment (GGUF) → KAITO (Auto-selected)

**ModelDeployment (user creates):**
```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: gemma-cpu
  namespace: default
spec:
  model:
    id: "google/gemma-3-1b-it-qat-q8_0-gguf"
    source: "huggingface"
  engine:
    type: "llamacpp"
  serving:
    mode: "aggregated"
  scaling:
    replicas: 1
  resources:
    gpu:
      count: 0  # No GPU - triggers KAITO selection
    memory: "16Gi"
    cpu: "8"
  image: "ghcr.io/sozercan/llama-cpp-runner:latest"
```

**Workspace (controller creates):**
```yaml
apiVersion: kaito.sh/v1beta1
kind: Workspace
metadata:
  name: gemma-cpu
  namespace: default
  ownerReferences:
    - apiVersion: kubefoundry.ai/v1alpha1
      kind: ModelDeployment
      name: gemma-cpu
      controller: true
  labels:
    kubefoundry.ai/model-source: huggingface
resource:
  count: 1
  labelSelector:
    matchLabels:
      kubernetes.io/os: linux
inference:
  template:
    spec:
      containers:
        - name: model
          image: ghcr.io/sozercan/llama-cpp-runner:latest
          args: ["huggingface://google/gemma-3-1b-it-qat-q8_0-gguf/gemma-3-1b-it-q8_0.gguf", "--address=:5000"]
          ports:
            - containerPort: 5000
          resources:
            requests:
              memory: "16Gi"
              cpu: "8"
```

**Status after reconciliation:**
```yaml
status:
  phase: "Running"
  provider:
    name: "kaito"
    resourceName: "gemma-cpu"
    resourceKind: "Workspace"
    selectedReason: "no GPU requested → kaito (only CPU provider)"
  endpoint:
    service: "gemma-cpu"
    port: 80
```

#### Example 3: Disaggregated P/D with KV Routing → Dynamo

**ModelDeployment (user creates):**
```yaml
apiVersion: kubefoundry.ai/v1alpha1
kind: ModelDeployment
metadata:
  name: llama-70b-pd
  namespace: default
spec:
  model:
    id: "meta-llama/Llama-3.1-70B-Instruct"
    source: "huggingface"
  provider:
    name: "dynamo"
    overrides:
      routerMode: "kv"                    # KV cache routing (Dynamo-specific)
      frontend:                           # Optional: customize router (uses defaults if omitted)
        replicas: 2
        resources:
          cpu: "4"
          memory: "8Gi"
  engine:
    type: "vllm"
  serving:
    mode: "disaggregated"
  scaling:
    # Frontend/head not specified here - configured via provider.overrides or uses defaults
    prefill:
      replicas: 2
      gpu:
        count: 4
      memory: "128Gi"
    decode:
      replicas: 4
      gpu:
        count: 2
      memory: "64Gi"
  # Note: spec.resources is not allowed in disaggregated mode
  secrets:
    huggingFaceToken: "hf-token"
```

**DynamoGraphDeployment (controller creates):**
```yaml
apiVersion: nvidia.com/v1alpha1
kind: DynamoGraphDeployment
metadata:
  name: llama-70b-pd
  namespace: default
  ownerReferences:
    - apiVersion: kubefoundry.ai/v1alpha1
      kind: ModelDeployment
      name: llama-70b-pd
      controller: true
spec:
  backendFramework: vllm
  services:
    Frontend:
      componentType: frontend
      dynamoNamespace: llama-70b-pd
      replicas: 2                          # From overrides.frontend.replicas
      router-mode: kv                      # From overrides.routerMode
      envFromSecret: hf-token
      resources:
        requests:
          cpu: "4"                         # From overrides.frontend.resources.cpu
          memory: "8Gi"                    # From overrides.frontend.resources.memory
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
    VllmPrefillWorker:
      componentType: worker
      subComponentType: prefill
      dynamoNamespace: llama-70b-pd
      replicas: 2
      envFromSecret: hf-token
      resources:
        limits:
          gpu: "4"
          memory: "128Gi"  # From scaling.prefill.memory
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
          command: ["/bin/sh", "-c"]
          args: ["python3 -m dynamo.vllm --model meta-llama/Llama-3.1-70B-Instruct --is-prefill-worker"]
    VllmDecodeWorker:
      componentType: worker
      subComponentType: decode
      dynamoNamespace: llama-70b-pd
      replicas: 4
      envFromSecret: hf-token
      resources:
        limits:
          gpu: "2"
          memory: "64Gi"   # From scaling.decode.memory
      extraPodSpec:
        mainContainer:
          image: nvcr.io/nvidia/ai-dynamo/vllm-runtime:0.7.1
          command: ["/bin/sh", "-c"]
          args: ["python3 -m dynamo.vllm --model meta-llama/Llama-3.1-70B-Instruct"]
```

**Status after reconciliation:**
```yaml
status:
  phase: "Running"
  provider:
    name: "dynamo"
    resourceName: "llama-70b-pd"
    resourceKind: "DynamoGraphDeployment"
    selectedReason: "explicit provider selection"
  replicas:
    desired: 6  # 2 prefill + 4 decode
    ready: 6
  endpoint:
    service: "llama-70b-pd-frontend"
    port: 8000
```

### 4.3 Controller Reconciliation Logic

```
┌─────────────────────────────────────────────────────────────────┐
│                    Reconciliation Loop                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Receive ModelDeployment event                               │
│                      │                                          │
│                      ▼                                          │
│  2. Check for pause annotation                                  │
│     - If kubefoundry.ai/reconcile-paused: "true", skip         │
│                      │                                          │
│                      ▼                                          │
│  3. Validate spec against schema (webhook)                      │
│     - Check model ID format                                     │
│     - Validate engine/provider compatibility                    │
│     - Check resource requirements                               │
│                      │                                          │
│                      ▼                                          │
│  4. Select/validate provider                                    │
│     - If explicit: use specified provider                       │
│     - If auto: run selection algorithm                          │
│     - Record selectedReason in status                           │
│                      │                                          │
│                      ▼                                          │
│  5. Detect installed provider CRD version                       │
│     - Query API for available versions                          │
│     - Generate manifest for detected version                    │
│                      │                                          │
│                      ▼                                          │
│  6. Generate provider-specific manifest                         │
│     - Transform unified spec to provider format                 │
│     - Apply provider overrides if specified                     │
│     - Set owner reference to ModelDeployment                    │
│                      │                                          │
│                      ▼                                          │
│  7. Create/Update provider resource                             │
│     - Apply manifest to cluster                                 │
│     - Handle conflicts/updates                                  │
│     - Reconcile drift (overwrite direct edits)                  │
│                      │                                          │
│                      ▼                                          │
│  8. Watch provider resource status                              │
│     - Extract meaningful error messages                         │
│     - Map provider status to unified status                     │
│     - Update ModelDeployment.status                             │
│                      │                                          │
│                      ▼                                          │
│  9. Handle deletion (finalizers)                                │
│     - Delete provider resource                                  │
│     - Wait for cleanup (with timeout)                           │
│     - Remove finalizer after 5-10 min timeout if stuck          │
│     - Emit warning event if force-removed                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.4 Provider Selection Algorithm

The controller auto-selects a provider when `spec.provider.name` is omitted.

**GPU default behavior:** If `resources.gpu` is omitted entirely, it is treated as `gpu.count: 0` (CPU-only), which selects KAITO.

```
IF gpu.count == 0 OR resources.gpu is omitted:
    return KAITO
    reason: "no GPU requested → kaito (only CPU provider)"

IF engine == "trtllm" OR engine == "sglang":
    return Dynamo
    reason: "engine={engine} → dynamo (only {engine} provider)"

IF engine == "llamacpp":
    return KAITO
    reason: "engine=llamacpp → kaito (only llamacpp provider)"

IF mode == "disaggregated":
    return Dynamo
    reason: "mode=disaggregated → dynamo (best disaggregated support)"

DEFAULT:
    return Dynamo
    reason: "default → dynamo (GPU inference default)"
```

**Note:** KubeRay is never auto-selected. Users must explicitly specify `provider.name: kuberay` to use it.

### 4.5 Provider Capability Matrix

| Criteria                   | KAITO   | Dynamo        | KubeRay                     |
| -------------------------- | ------- | ------------- | --------------------------- |
| CPU inference              | **Yes** | No            | No                          |
| GPU inference              | Yes     | **Yes**       | Yes                         |
| vLLM engine                | Yes     | **Yes**       | Yes                         |
| sglang engine              | No      | **Yes**       | No                          |
| trtllm engine              | No      | **Yes**       | No                          |
| llamacpp engine            | **Yes** | No            | No                          |
| GGUF models                | **Yes** | No            | No                          |
| Disaggregated P/D          | No      | **Yes**       | Yes                         |
| KV routing (via overrides) | No      | **Yes**       | Yes (via RayService config) |
| Auto-selection             | Yes     | Yes (default) | No (explicit only)          |

### 4.6 Drift Detection and Reconciliation

The controller enforces the ModelDeployment spec on the provider resource.

**Default behavior:** If someone directly edits the provider resource (e.g., `kubectl edit dynamographdeployment my-llm`), the controller will overwrite those changes on the next reconciliation.

**Pause annotation:** To temporarily disable reconciliation for debugging:
```yaml
metadata:
  annotations:
    kubefoundry.ai/reconcile-paused: "true"
```

### 4.7 Finalizer Handling

The controller uses finalizers to ensure cleanup. If the provider operator is unavailable:

1. Controller attempts cleanup for **5 minutes**
2. After timeout, controller removes finalizer with warning event
3. Orphaned provider resources may remain (logged for manual cleanup)

**Manual escape (immediate):**
```bash
kubectl patch modeldeployment my-llm --type=merge \
  -p '{"metadata":{"finalizers":[]}}'
```

### 4.8 Owner References and Garbage Collection

The KubeFoundry controller sets `ownerReferences` on created provider resources:

```yaml
# Provider resource (e.g., DynamoGraphDeployment)
metadata:
  ownerReferences:
    - apiVersion: kubefoundry.ai/v1alpha1
      kind: ModelDeployment
      name: my-llm
      uid: abc-123
      controller: true
      blockOwnerDeletion: true
```

This ensures:
- Deleting `ModelDeployment` automatically deletes the provider resource
- Provider resources cannot be accidentally orphaned
- Clear ownership hierarchy in the cluster

**Namespace Requirement:** Provider resources are always created in the **same namespace** as the `ModelDeployment`. Cross-namespace ownership is not supported because:
- Kubernetes owner references require same-namespace resources
- Simplifies RBAC configuration
- Follows standard Kubernetes patterns (e.g., Deployment → ReplicaSet → Pod)

### 4.9 Status Mapping

The controller extracts meaningful error messages from provider status.

| Provider | Provider Status            | Unified Phase | Message Extraction           |
| -------- | -------------------------- | ------------- | ---------------------------- |
| KAITO    | `WorkspaceSucceeded: True` | Running       | -                            |
| KAITO    | `InferenceReady: False`    | Deploying     | Extract condition message    |
| KAITO    | Error condition            | Failed        | Extract error from condition |
| Dynamo   | `state: successful`        | Running       | -                            |
| Dynamo   | `state: deploying`         | Deploying     | -                            |
| Dynamo   | `state: failed`            | Failed        | Extract from status.message  |
| KubeRay  | `serviceStatus: Running`   | Running       | -                            |
| KubeRay  | `serviceStatus: Pending`   | Pending       | -                            |
| KubeRay  | `serviceStatus: Failed`    | Failed        | Extract from serveStatuses   |

### 4.10 Dynamic CRD Version Detection

The controller dynamically detects installed provider CRD versions:

1. On startup and periodically, query the Kubernetes API for available CRDs
2. For each provider, determine the installed version (e.g., `kaito.sh/v1beta1` vs `kaito.sh/v1`)
3. Generate manifests targeting the detected version
4. Log warnings if expected CRDs are missing

This prevents breakage when providers release new CRD versions.

### 4.11 Update Semantics

When a user updates a `ModelDeployment` spec, the controller handles changes based on field type:

**Identity fields (trigger delete + recreate):**

| Field | Reason |
|-------|--------|
| `model.id` | Changing the model fundamentally changes the deployment |
| `model.source` | Changing from huggingface to custom changes how model is loaded |
| `engine.type` | Changing inference engine requires new containers |
| `provider.name` | Changing provider requires different resource type |
| `serving.mode` | Changing aggregated ↔ disaggregated restructures the entire deployment |

> **Warning:** Changing identity fields causes brief downtime as the provider resource is deleted and recreated. In-flight requests will fail during this window.

**Config fields (in-place update):**

| Field | Notes |
|-------|-------|
| `model.servedName` | Changes API-facing model name argument |
| `scaling.replicas` | Can be updated without recreation |
| `scaling.prefill.*`, `scaling.decode.*` | Worker scaling (disaggregated mode) |
| `env` | Environment variable changes |
| `resources` | Memory/CPU/GPU adjustments |
| `engine.args` | Engine parameter tuning |
| `engine.contextLength` | Context length adjustment |
| `engine.trustRemoteCode` | Trust remote code flag |
| `image` | Rolling update to new container image |
| `secrets.huggingFaceToken` | Updates secret reference |
| `podTemplate.metadata` | Updates pod labels/annotations |
| `nodeSelector`, `tolerations` | Scheduling constraints |
| `provider.overrides` | Provider-specific configuration |

The controller patches the provider resource in place for config field changes. If the provider operator rejects an update (e.g., due to its own immutable field constraints), the error is surfaced in `ModelDeployment.status`.

### 4.12 Label Propagation

Labels from `ModelDeployment.metadata.labels` are selectively propagated:

- **To provider resource:** Only labels with `kubefoundry.ai/` prefix are copied
- **To pods:** Use `spec.podTemplate.metadata.labels` for pod-level labels
- **Controller-managed:** The controller always adds `kubefoundry.ai/managed-by: kubefoundry`

This prevents accidental conflicts with provider-managed labels while allowing KubeFoundry-specific labels to flow through.

### 4.13 Secret Handling

The `secrets.huggingFaceToken` field accepts a Kubernetes secret name (string). The controller passes this to provider resources using `envFromSecret`, which injects all keys from the secret as environment variables.

```yaml
secrets:
  huggingFaceToken: "my-hf-secret"  # Secret name only (not secretKeyRef)
```

Users should create secrets with the keys expected by the runtime (e.g., `HF_TOKEN`).

### 4.14 Endpoint Access

The controller creates ClusterIP services only. Users are responsible for external access:

```yaml
status:
  endpoint:
    service: "my-llm-frontend"  # ClusterIP service
    port: 8000
```

**Accessing the endpoint:**
- **Local development:** `kubectl port-forward svc/my-llm-frontend 8000:8000`
- **Production:** Create Ingress, Gateway, or LoadBalancer service separately

LoadBalancer/Ingress configuration is deferred to future versions to keep the initial scope focused.

### 4.15 Provider Overrides Reference

The `provider.overrides` field is an untyped `map[string]interface{}` that allows provider-specific configuration. The controller interprets known keys at runtime.

**Schema:** `map[string]interface{}` (flexible, no compile-time validation)

#### Dynamo Overrides

| Key                         | Type   | Description                                           | Default       |
| --------------------------- | ------ | ----------------------------------------------------- | ------------- |
| `routerMode`                | string | Request routing strategy: `kv`, `round-robin`, `none` | `round-robin` |
| `frontend.replicas`         | int    | Number of frontend/router pods                        | `1`           |
| `frontend.resources.cpu`    | string | CPU request for frontend                              | `"2"`         |
| `frontend.resources.memory` | string | Memory request for frontend                           | `"4Gi"`       |

**Example:**
```yaml
provider:
  name: "dynamo"
  overrides:
    routerMode: "kv"
    frontend:
      replicas: 2
      resources:
        cpu: "4"
        memory: "8Gi"
```

#### KubeRay Overrides

| Key                     | Type              | Description                      | Default |
| ----------------------- | ----------------- | -------------------------------- | ------- |
| `head.resources.cpu`    | string            | CPU request for Ray head node    | `"2"`   |
| `head.resources.memory` | string            | Memory request for Ray head node | `"4Gi"` |
| `head.rayStartParams`   | map[string]string | Ray head start parameters        | `{}`    |

**Example:**
```yaml
provider:
  name: "kuberay"
  overrides:
    head:
      resources:
        cpu: "4"
        memory: "8Gi"
      rayStartParams:
        dashboard-host: "0.0.0.0"
        num-cpus: "0"
```

#### KAITO Overrides

KAITO currently has no supported overrides (aggregated mode only, no separate router component).

#### Override Behavior

- **Unknown keys trigger warnings** - Controller logs a warning for any unknown key at any nesting depth (helps catch typos like `replicsa`)
- **Invalid types cause reconciliation failure** - Error surfaced in `ModelDeployment.status`
- **Defaults apply when omitted** - Only specify what you need to customize

#### Provider Component Defaults

The following defaults are applied by provider controllers when not overridden:

**Dynamo Defaults:**

| Component | Field | Default Value |
|-----------|-------|---------------|
| Frontend | `replicas` | `1` |
| Frontend | `resources.cpu` | `"2"` |
| Frontend | `resources.memory` | `"4Gi"` |
| Frontend | `routerMode` | `"round-robin"` |

**KubeRay Defaults:**

| Component | Field | Default Value |
|-----------|-------|---------------|
| Head | `resources.cpu` | `"2"` |
| Head | `resources.memory` | `"4Gi"` |
| Head | `rayStartParams` | `{}` |

**KAITO Defaults:**

KAITO uses aggregated mode only and does not have separate frontend/head components. Resource defaults are derived from `spec.resources`.

**Image Defaults:**

Each provider controller manages default container images for supported engines. Users only need to specify `spec.image` to override the default.

| Provider | Engine | Default Image (managed by provider) |
|----------|--------|-------------------------------------|
| Dynamo | vllm | `nvcr.io/nvidia/ai-dynamo/vllm-runtime:<version>` |
| Dynamo | sglang | `nvcr.io/nvidia/ai-dynamo/sglang-runtime:<version>` |
| Dynamo | trtllm | `nvcr.io/nvidia/ai-dynamo/trtllm-runtime:<version>` |
| KAITO | vllm | KAITO preset image |
| KAITO | llamacpp | User must specify (no default) |
| KubeRay | vllm | `rayproject/ray-ml:<version>` |

---

## 5. Implementation Plan

### Prerequisites

**Kubernetes Version:** 1.26+ required for:
- CEL validation in CRDs
- Server-side apply improvements
- ValidatingAdmissionPolicy support

**Webhook TLS:** The validating webhook uses self-signed certificates managed by [cert-controller](https://github.com/open-policy-agent/cert-controller) (from the OPA project). This approach:
- Automatically generates and rotates TLS certificates
- No external dependency on cert-manager
- Certificates stored in Kubernetes secrets
- Controller handles certificate rotation transparently

### Phase 1: Controller and All Providers (MVP)

**Scope:**
- Go controller with Kubebuilder
- ModelDeployment CRD with new fields (`image`, `env`, `podTemplate.metadata`)
- All three providers (Dynamo, KAITO, KubeRay)
- Auto-provider selection with `selectedReason`
- Minimal validating webhook (engine↔provider compatibility, required fields)
- Status aggregation with extracted error messages
- Drift reconciliation with pause annotation
- Finalizer timeout handling
- Dynamic CRD version detection

**Controller Structure (Go + Kubebuilder):**
```
kubefoundry-controller/
├── api/
│   └── v1alpha1/
│       ├── modeldeployment_types.go
│       ├── modeldeployment_webhook.go
│       └── zz_generated.deepcopy.go
├── controllers/
│   └── modeldeployment_controller.go
├── pkg/
│   ├── providers/
│   │   ├── interface.go
│   │   ├── dynamo/
│   │   │   ├── transformer.go
│   │   │   └── status.go
│   │   ├── kaito/
│   │   │   ├── transformer.go
│   │   │   └── status.go
│   │   └── kuberay/
│   │       ├── transformer.go
│   │       └── status.go
│   ├── selection/
│   │   └── algorithm.go
│   └── version/
│       └── detector.go
├── config/
│   ├── crd/
│   ├── rbac/
│   └── webhook/
├── main.go
└── Dockerfile
```

**Deliverables:**
- `kubefoundry controller install` installs controller and CRDs
- Published manifests at `manifests/install.yaml` for CLI-free installation
- Kustomize base at `manifests/` for customization
- `kubectl apply -f modeldeployment.yaml` creates provider deployment
- Status reflects provider state with meaningful error messages
- Deletion cleans up provider resources (with timeout fallback)

### Phase 2: Advanced Features

**Scope:**
- Dry-run capability (`kubefoundry.ai/dry-run: "true"` annotation)
- Provider migration support
- Metrics and observability
- Conversion webhooks for future API versions

### Phase 3: Production Hardening

**Scope:**
- Leader election for HA
- Rate limiting and backoff
- Comprehensive error handling
- E2E testing suite

---

## 6. Controller Implementation

### 6.1 Technology Choice: Go + Kubebuilder

The controller is implemented in Go using Kubebuilder.

**Rationale:**
- Native controller-runtime patterns (workqueues, informers, leader election)
- Efficient watch mechanisms
- Strong typing with CRD code generation
- Industry standard for Kubernetes operators
- Better resource efficiency than alternatives

**Trade-offs:**
- Separate codebase from TypeScript UI
- Manifest generation logic must be reimplemented in Go
- Team needs Go expertise

### 6.2 TypeScript Binary Changes

The TypeScript binary becomes a thin client:

| Function           | Implementation                            |
| ------------------ | ----------------------------------------- |
| Web UI             | Unchanged                                 |
| Create deployment  | Creates `ModelDeployment` CRD via K8s API |
| Show status        | Reads `ModelDeployment.status`            |
| Delete deployment  | Deletes `ModelDeployment` CRD             |
| Install controller | Applies controller manifests              |
| Upgrade controller | Updates controller deployment image       |

**Removed from TypeScript:**
- Provider manifest generation (Dynamo, KAITO, KubeRay templates)
- Direct provider CRD application
- Provider-specific status parsing

### 6.3 Controller Upgrades

When upgrading the KubeFoundry controller:

**Upgrade process:**
```bash
# Option A: CLI upgrade
kubefoundry controller upgrade

# Option B: kubectl
kubectl apply -f https://raw.githubusercontent.com/kubefoundry/kubefoundry/main/manifests/install.yaml
```

**Behavior during upgrade:**
- Controller deployment performs a rolling update (no downtime)
- Existing `ModelDeployment` resources continue to function
- In-flight reconciliations complete with the old controller, then new controller takes over
- Provider resources are not disrupted during controller upgrade

**CRD updates:**
- New controller versions may include updated CRD schemas
- CRD updates are applied automatically by `controller upgrade` or manifest apply
- Existing resources remain valid (new fields have defaults)
- Breaking CRD changes only occur between API versions (e.g., v1alpha1 → v1beta1)

**Rollback:**
```bash
# Rollback to previous version
kubectl rollout undo deployment/kubefoundry-controller -n kubefoundry-system
```

**Version compatibility:**
- Controller version is independent of provider operator versions
- Controller detects provider CRD versions dynamically (see Section 4.10)
- Minimum supported Kubernetes version: 1.26+ (required for CEL validation and server-side apply improvements)

### 6.4 Version Compatibility Matrix

| KubeFoundry Controller | Kubernetes | KAITO Operator | Dynamo Operator | KubeRay Operator |
|------------------------|------------|----------------|-----------------|------------------|
| v0.1.x                 | 1.26-1.30  | v0.3.x         | v0.1.x          | v1.1.x           |

**Provider Operator Requirements:**

| Provider | Minimum Version | CRD API Version | Notes |
|----------|-----------------|-----------------|-------|
| KAITO    | v0.3.0          | kaito.sh/v1beta1 | Requires GPU operator for GPU workloads |
| Dynamo   | v0.1.0          | nvidia.com/v1alpha1 | Requires NVIDIA GPU operator |
| KubeRay  | v1.1.0          | ray.io/v1       | Optional: KubeRay autoscaler for scaling |

> **Note:** This matrix will be updated with each release. Check the [release notes](https://github.com/kubefoundry/kubefoundry/releases) for the latest compatibility information.

---

## 7. API Versioning Strategy

### Version Progression

1. **v1alpha1** - Initial release
   - Experimental API
   - Breaking changes allowed
   - No stability guarantees

2. **v1beta1** - Stabilization
   - Feature complete
   - Breaking changes with deprecation warnings
   - Migration tooling provided

3. **v1** - Stable
   - No breaking changes
   - Long-term support
   - Backward compatibility required

### Conversion Webhooks

When moving between versions, conversion webhooks will handle:
- Field renames
- Structural changes
- Default value updates

---

## 8. Validation Webhook

The controller includes a validating admission webhook (Phase 1).

### Validation Rules

**Schema Validation (core webhook):**

| Rule                                                                | Error Message                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `engine: vllm` with `gpu.count: 0`                                  | "vLLM engine requires GPU (set resources.gpu.count > 0)"         |
| `engine: sglang` with `gpu.count: 0`                                | "SGLang engine requires GPU (set resources.gpu.count > 0)"       |
| `engine: trtllm` with `gpu.count: 0`                                | "TensorRT-LLM engine requires GPU (set resources.gpu.count > 0)" |
| `mode: disaggregated` with `spec.resources.gpu`                     | "Cannot specify both resources.gpu and scaling.prefill/decode"   |
| `mode: disaggregated` without `scaling.prefill` or `scaling.decode` | "Disaggregated mode requires scaling.prefill and scaling.decode" |
| `mode: disaggregated` without `scaling.prefill.gpu.count`           | "Disaggregated mode requires scaling.prefill.gpu.count"          |
| `mode: disaggregated` without `scaling.decode.gpu.count`            | "Disaggregated mode requires scaling.decode.gpu.count"           |
| Missing `engine.type`                                               | "engine.type is required"                                        |
| Missing `model.id` when `source: huggingface`                       | "model.id is required when source is huggingface"                |
| `servedName` specified with `source: custom`                        | Warning: "servedName is ignored for custom source"               |
| Provider CRD not installed                                          | "Provider '{name}' CRD not installed in cluster"                 |

**Provider Compatibility (validated by provider controllers, not core):**

| Rule                                         | Error Message                                    |
| -------------------------------------------- | ------------------------------------------------ |
| `engine: sglang` with `provider: kaito`      | "KAITO does not support sglang engine"           |
| `engine: trtllm` with `provider: kaito`      | "KAITO does not support trtllm engine"           |
| `engine: llamacpp` with `provider: dynamo`   | "Dynamo does not support llamacpp engine"        |
| `engine: llamacpp` with `provider: kuberay`  | "KubeRay does not support llamacpp engine"       |
| `engine: sglang` with `provider: kuberay`    | "KubeRay does not support sglang engine"         |
| `engine: trtllm` with `provider: kuberay`    | "KubeRay does not support trtllm engine"         |
| `gpu.count: 0` with `provider: dynamo`       | "Dynamo requires GPU (set resources.gpu.count > 0)" |
| `gpu.count: 0` with `provider: kuberay`      | "KubeRay requires GPU (set resources.gpu.count > 0)" |
| `mode: disaggregated` with `provider: kaito` | "KAITO does not support disaggregated mode"      |

> **Note:** Provider compatibility validation is performed by provider controllers, not the core webhook. This maintains the "core has zero provider knowledge" principle. If a provider rejects a configuration, the error is surfaced in `ModelDeployment.status.conditions` with type `ProviderCompatible: False`.

**Webhook Unavailability:** If the webhook is not available (e.g., during initial setup), schema validation occurs at reconciliation time. The controller will accept the resource and set `status.phase: Pending` with a descriptive message until validation passes.

---

## 9. Observability

### Metrics

```
# Controller metrics
kubefoundry_modeldeployment_total{namespace, phase}
kubefoundry_reconciliation_duration_seconds{provider}
kubefoundry_reconciliation_errors_total{provider, error_type}
kubefoundry_provider_selection{provider, reason}

# Deployment metrics
kubefoundry_deployment_replicas{name, namespace, state}
kubefoundry_deployment_phase{name, namespace, phase}
```

### Events

```yaml
Events:
  Type    Reason              Message
  ----    ------              -------
  Normal  ProviderSelected    Selected provider 'dynamo': default → dynamo (GPU inference default)
  Normal  ResourceCreated     Created DynamoGraphDeployment 'my-llm'
  Warning SecretNotFound      Secret 'hf-token-secret' not found in namespace 'default'
  Warning ProviderError       Provider resource in error state: insufficient GPUs
  Warning DriftDetected       Provider resource was modified directly, reconciling
  Warning FinalizerTimeout    Finalizer removed after timeout, provider resource may be orphaned
```

---

## 10. Security Considerations

### RBAC Requirements

```yaml
# Controller ServiceAccount permissions
rules:
  - apiGroups: ["kubefoundry.ai"]
    resources: ["modeldeployments", "modeldeployments/status"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["kaito.sh"]
    resources: ["workspaces"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["nvidia.com"]
    resources: ["dynamographdeployments"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["ray.io"]
    resources: ["rayservices"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: ["apiextensions.k8s.io"]
    resources: ["customresourcedefinitions"]
    verbs: ["get", "list"]  # For dynamic version detection
```

### Secret Handling

- Controller never reads secret contents
- Only passes secret references to provider resources
- HuggingFace tokens stay in K8s secrets

---

## 11. Testing Strategy

### Unit Tests
- Manifest transformation logic per provider
- Status mapping and error extraction
- Provider selection algorithm
- Schema validation
- CRD version detection

### Integration Tests
- Controller reconciliation with mock K8s API
- Owner reference handling
- Finalizer behavior and timeout
- Drift detection and reconciliation
- Webhook validation

### E2E Tests
- Full deployment lifecycle per provider
- Error recovery scenarios
- Controller restart resilience

---

## 12. Out of Scope (v1alpha1)

The following features are explicitly out of scope for the initial release:

| Feature                               | Reason                                                                                                                                   | Future Consideration                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Performance-based autoscaling         | Replica scaling based on metrics (HPA/KEDA). Not to be confused with cluster autoscaling (Karpenter). Only KubeRay supports it natively. | v1alpha2+ with KEDA/HPA integration |
| Multi-model serving (LoRA)            | Complex, vLLM-specific                                                                                                                   | Future version if demand exists     |
| Adoption of existing resources        | Adds ownership conflict complexity                                                                                                       | May add with explicit opt-in        |
| Resource presets (small/medium/large) | Adds indirection without clear value                                                                                                     | Docs provide recommended values     |
| GGUF auto-detection                   | Magic detection has edge cases                                                                                                           | Users specify `engine: llamacpp`    |
| Quantization field                    | Can use `engine.args.quantization`                                                                                                       | Evaluate based on usage patterns    |

---

## 13. Known Limitations

### 13.1 Provider Schema Compatibility

Dynamic CRD version detection (Section 4.10) only detects API version changes (e.g., `v1alpha1` → `v1beta1`), not schema changes within a version.

**Impact:** If a provider makes breaking schema changes without bumping the API version (e.g., field renames, structural changes), the controller will generate invalid manifests. Errors surface at runtime via provider status, with no proactive warning.

**Mitigation (future):**
- Schema fingerprinting to detect drift
- Documented compatibility matrix per release
- Controller warnings when provider CRD differs from expected schema

### 13.2 Controller RBAC Acts as Privileged Intermediary

The controller runs with cluster-wide permissions to create provider resources (Workspace, DynamoGraphDeployment, RayService) in any namespace. This follows standard Kubernetes operator patterns (e.g., Deployment controller creates Pods on behalf of users).

**Impact:** A user who can create `ModelDeployment` in namespace X can effectively create provider resources in that namespace, even if they lack direct RBAC permissions for those provider CRDs. Organizations wanting per-provider access control (e.g., "Team A can only use KAITO") cannot enforce this at the provider CRD level.

**Mitigation (future):**
- SubjectAccessReview checks before creating provider resources
- Namespace-level provider allowlists via ConfigMap or annotation
- Validating webhook that checks user permissions for the target provider

### 13.3 Unmappable Provider Features

The unified API abstracts common patterns, but providers may have features that don't fit the `ModelDeployment` schema.

**Impact:** Users needing provider-specific features not exposed in the unified API must either:
1. Use `provider.overrides` (limited to documented keys)
2. Create provider resources directly, bypassing KubeFoundry

Mixed management (some resources via KubeFoundry, some direct) creates operational complexity and potential conflicts.

**Mitigation (future):**
- Expand `provider.overrides` as new provider features emerge
- Passthrough mode for arbitrary provider fields (with validation disabled)

### 13.4 Provider Operator Unavailability

The design handles provider operator unavailability at deletion time (finalizer timeout, Section 4.7), but not during ongoing operations.

**Impact:** If a provider operator crashes, is uninstalled, or becomes unavailable while `ModelDeployment` resources exist:
- KubeFoundry controller continues creating/updating provider resources
- Provider resources are not reconciled into actual workloads
- `ModelDeployment.status` becomes stale (no status updates from provider)
- No proactive detection or user notification

**Staleness Definition:** Status is considered stale if the provider resource status has not been updated for **5 minutes**. This threshold balances timely detection against normal reconciliation intervals.

**Mitigation (future):**
- Health checks for provider operators before reconciliation
- `StaleStatus` condition when status exceeds staleness threshold
- Status condition indicating provider operator health
- Periodic staleness detection for provider resource status

---

## 14. Alternatives Considered

### Alternative 1: No Abstraction

Keep the current direct-to-provider approach.

**Rejected because:**
- Users need provider-specific knowledge
- No unified lifecycle management
- Difficult to add features across providers

### Alternative 2: TypeScript Controller

Implement controller in TypeScript to reuse existing code.

**Rejected because:**
- Less efficient watch mechanisms
- No native controller-runtime patterns
- Would need to rewrite to Go eventually for production

### Alternative 3: Helm Chart Abstraction

Use Helm charts with values-based provider selection.

**Rejected because:**
- No runtime status aggregation
- Complex templating for conditional resources
- No controller for lifecycle management

### Alternative 4: Local Binary with Embedded Controller

Run controller logic in the local kubefoundry binary instead of in-cluster.

**Rejected because:**
- No high availability (laptop closes, reconciliation stops)
- Partial state if binary crashes mid-deployment
- Would still need in-cluster controller for production use

---

## 15. Engine-Specific Parameter Reference

Since each inference engine has different parameter names and defaults, the unified API abstracts common concepts while providing an escape hatch via `engine.args`.

### 15.1 Context Length

| Engine       | Parameter           | Default       |
| ------------ | ------------------- | ------------- |
| vLLM         | `--max-model-len`   | Model default |
| SGLang       | `--context-length`  | Model default |
| TensorRT-LLM | Build-time config   | -             |
| llama.cpp    | `--ctx-size` / `-c` | Model max     |

> **Note:** For TensorRT-LLM, `engine.contextLength` is **ignored with a warning** since context length must be configured at engine build time, not runtime. Users should ensure their TensorRT-LLM image is built with the desired context length.

### 15.2 Trust Remote Code

| Engine       | Parameter             | Default |
| ------------ | --------------------- | ------- |
| vLLM         | `--trust-remote-code` | `false` |
| SGLang       | `--trust-remote-code` | `false` |
| TensorRT-LLM | Build-time            | -       |
| llama.cpp    | N/A                   | -       |

### 15.3 Quantization (via engine.args)

| Engine       | Parameter        | Values                     |
| ------------ | ---------------- | -------------------------- |
| vLLM         | `--quantization` | awq, gptq, squeezellm, fp8 |
| SGLang       | `--quantization` | awq, gptq, squeezellm, fp8 |
| TensorRT-LLM | Build-time       | -                          |
| llama.cpp    | N/A              | Built into GGUF file       |

Example:
```yaml
engine:
  type: vllm
  args:
    quantization: "awq"
```

### 15.4 GPU Memory Utilization (via engine.args)

| Engine       | Parameter                  | Default  |
| ------------ | -------------------------- | -------- |
| vLLM         | `--gpu-memory-utilization` | `0.9`    |
| SGLang       | `--mem-fraction-static`    | `0.88`   |
| TensorRT-LLM | KvCacheConfig              | -        |
| llama.cpp    | `--cache-ram`              | 8192 MiB |

---

## Appendix A: Alternative Architecture - Monolithic Controller

> **Note:** This appendix describes a simpler alternative architecture where all provider knowledge is embedded in a single controller. **This is NOT the recommended approach** — see Section 3 for the recommended plugin architecture. This alternative trades extensibility for simplicity and may be appropriate for teams that don't need third-party providers or custom selection logic.

### A.1 Overview

Instead of separate provider controllers, a single `kubefoundry-controller` contains all provider transformation logic:

```
┌──────────────────────────────────────────────────────────────────┐
│                     User's Machine                                │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              kubefoundry binary (TypeScript)                │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │ │
│  │  │   Web UI     │  │   CLI        │  │ Controller       │  │ │
│  │  │              │  │   Commands   │  │ Installer        │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │ │
│  └────────────────────────────┬────────────────────────────────┘ │
└───────────────────────────────┼──────────────────────────────────┘
                                │ kubeconfig
                                ▼
┌───────────────────────────────────────────────────────────────────┐
│                         K8s Cluster                                │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              kubefoundry-controller (Go)                     │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │  │
│  │  │ Reconciler   │  │  Provider    │  │ Status           │   │  │
│  │  │              │  │  Transformers│  │ Aggregation      │   │  │
│  │  │              │  │  (embedded)  │  │                  │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ ModelDeployment │  │ Provider CRDs   │  │ Pods/Services   │   │
│  │ CRDs            │  │ (Dynamo/KAITO)  │  │                 │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘   │
└───────────────────────────────────────────────────────────────────┘
```

### A.2 Data Flow

```
User Config → ModelDeployment CRD → KubeFoundry Controller → Provider CRD → Provider Operator → Pods/Services
                     ↓
              Status Aggregation
```

### A.3 Controller Structure

All provider logic lives in a single Go controller:

```
kubefoundry-controller/
├── api/
│   └── v1alpha1/
│       ├── modeldeployment_types.go
│       ├── modeldeployment_webhook.go
│       └── zz_generated.deepcopy.go
├── controllers/
│   └── modeldeployment_controller.go
├── pkg/
│   ├── providers/
│   │   ├── interface.go
│   │   ├── dynamo/
│   │   │   ├── transformer.go      # Embedded KAITO logic
│   │   │   └── status.go
│   │   ├── kaito/
│   │   │   ├── transformer.go      # Embedded Dynamo logic
│   │   │   └── status.go
│   │   └── kuberay/
│   │       ├── transformer.go      # Embedded KubeRay logic
│   │       └── status.go
│   └── selection/
│       └── algorithm.go            # Built-in selection
├── config/
│   ├── crd/
│   ├── rbac/
│   └── webhook/
├── main.go
└── Dockerfile
```

### A.4 Built-in Provider Selection

The selection algorithm is hardcoded in the controller:

```
IF gpu.count == 0 OR resources.gpu is omitted:
    return KAITO
    reason: "no GPU requested → kaito (only CPU provider)"

IF engine == "trtllm" OR engine == "sglang":
    return Dynamo
    reason: "engine={engine} → dynamo (only {engine} provider)"

IF engine == "llamacpp":
    return KAITO
    reason: "engine=llamacpp → kaito (only llamacpp provider)"

IF mode == "disaggregated":
    return Dynamo
    reason: "mode=disaggregated → dynamo (best disaggregated support)"

DEFAULT:
    return Dynamo
    reason: "default → dynamo (GPU inference default)"
```

### A.5 Installation

Single deployment:

```bash
# One command installs everything
kubectl apply -f https://kubefoundry.io/install.yaml

# Or via CLI
kubefoundry controller install
```

### A.6 Comparison: Monolithic vs Plugin Architecture

| Aspect                        | Monolithic (This Section)   | Plugin (Section 3)             |
| ----------------------------- | --------------------------- | ------------------------------ |
| Provider knowledge in core    | Yes                         | No                             |
| Adding new provider           | Modify & release controller | Deploy new provider controller |
| Provider bug blast radius     | All users                   | Only that provider's users     |
| Independent provider releases | No                          | Yes                            |
| Provider version pinning      | No                          | Yes (per provider)             |
| Custom selection logic        | No                          | Yes (replaceable selector)     |
| Installation complexity       | Single deployment           | Multiple deployments           |
| Third-party providers         | Requires core changes       | Just deploy controller         |

### A.7 When to Use Monolithic

The monolithic architecture may be appropriate when:

1. **Simplicity is paramount** - You want the easiest possible deployment
2. **No third-party providers** - You only use KAITO, Dynamo, and KubeRay
3. **Centralized releases are acceptable** - You're OK waiting for a full controller release to get provider fixes
4. **No custom selection needed** - The built-in selection algorithm meets your needs

### A.8 Trade-offs

**Advantages:**
- Simpler installation (single deployment)
- Fewer moving parts to manage
- No CRD for provider registration
- Simpler debugging (one controller to examine)

**Disadvantages:**
- Tight coupling - all provider code in one repo
- Blast radius - bug in KAITO transformer affects all users
- No third-party extensibility without forking
- Cannot pin individual provider versions
- Cannot replace selection algorithm

---

## 16. References

### Kubernetes & Controller Development
- [Kubernetes Custom Resources](https://kubernetes.io/docs/concepts/extend-kubernetes/api-extension/custom-resources/)
- [controller-runtime](https://github.com/kubernetes-sigs/controller-runtime)
- [Kubebuilder Book](https://book.kubebuilder.io/)

### Provider CRD Specifications
- [KAITO CRD Spec](https://github.com/kaito-project/kaito)
- [Dynamo CRD Spec](https://github.com/ai-dynamo/dynamo)
- [KubeRay CRD Spec](https://github.com/ray-project/kuberay)

### Engine Documentation
- [vLLM Engine Arguments](https://docs.vllm.ai/en/stable/configuration/engine_args/)
- [SGLang Server Arguments](https://docs.sglang.io/advanced_features/server_arguments.html)
- [TensorRT-LLM KV Cache Reuse](https://nvidia.github.io/TensorRT-LLM/advanced/kv-cache-reuse.html)
- [llama.cpp Server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

### Plugin Architecture Inspiration (Section 3)
- [Kubernetes Container Runtime Interface (CRI)](https://kubernetes.io/docs/concepts/architecture/cri/)
- [containerd CRI Implementation](https://github.com/containerd/containerd)

### Dockershim History & Lessons
- [Dockershim Deprecation FAQ](https://kubernetes.io/blog/2020/12/02/dockershim-faq/)
- [Dockershim: The Historical Context](https://kubernetes.io/blog/2022/05/03/dockershim-historical-context/)
- [Kubernetes is Moving on From Dockershim](https://kubernetes.io/blog/2022/01/07/kubernetes-is-moving-on-from-dockershim/)
- [cri-dockerd - External Dockershim Adapter](https://github.com/Mirantis/cri-dockerd)
