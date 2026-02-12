# Design Decisions

## Testing Strategy

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

## Alternatives Considered

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

Run controller logic in the local binary instead of in-cluster.

**Rejected because:**
- No high availability (laptop closes, reconciliation stops)
- Partial state if binary crashes mid-deployment
- Would still need in-cluster controller for production use

## Out of Scope (v1alpha1)

The following features are explicitly out of scope for the initial release:

| Feature                               | Reason                                                                          | Future Consideration                |
| ------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| Performance-based autoscaling         | Replica scaling based on metrics (HPA/KEDA). Only KubeRay supports it natively. | v1alpha2+ with KEDA/HPA integration |
| Multi-model serving (LoRA)            | Complex, vLLM-specific                                                          | Future version if demand exists     |
| Adoption of existing resources        | Adds ownership conflict complexity                                              | May add with explicit opt-in        |
| Resource presets (small/medium/large) | Adds indirection without clear value                                            | Docs provide recommended values     |
| GGUF auto-detection                   | Magic detection has edge cases                                                  | Users specify `engine: llamacpp`    |
| Quantization field                    | Can use `engine.args.quantization`                                              | Evaluate based on usage patterns    |

## Known Limitations

### Schema Compatibility

Dynamic CRD version detection only detects API version changes (e.g., `v1alpha1` → `v1beta1`), not schema changes within a version. If a provider makes breaking schema changes without bumping the API version, errors surface at runtime via provider status.

### Controller RBAC Acts as Privileged Intermediary

The controller runs with cluster-wide permissions to create provider resources in any namespace. A user who can create `ModelDeployment` in namespace X can effectively create provider resources in that namespace, even if they lack direct RBAC permissions for those provider CRDs.

### Unmappable Provider Features

The unified API abstracts common patterns, but providers may have features that don't fit the `ModelDeployment` schema. Users needing provider-specific features must use `provider.overrides` (limited to documented keys) or create provider resources directly.

### Provider Operator Unavailability

If a provider operator crashes or is uninstalled while `ModelDeployment` resources exist:
- Provider resources are created but not reconciled into actual workloads
- `ModelDeployment.status` becomes stale (no status updates from provider)
- Status is considered stale if not updated for **5 minutes**

---

*See also: [Architecture Overview](architecture.md)*
