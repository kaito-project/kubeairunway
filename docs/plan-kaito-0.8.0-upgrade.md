# KAITO 0.8.0 Upgrade Plan

## Overview

This document outlines the plan to upgrade KubeAIRunway's KAITO provider from version **0.6.0** to **0.8.0**.

**Date Created:** January 9, 2026  
**Status:** Planning

---

## Summary of Changes

| Item | Current (0.6.0) | New (0.8.0) |
|------|-----------------|-------------|
| KAITO Version | `0.6.0` | `0.8.0` |
| GPU node selector | `kubernetes.io/os: linux` | `nvidia.com/gpu.present: "true"` |
| CPU node selector | `kubernetes.io/os: linux` | `kubernetes.io/os: linux` (unchanged) |
| NAP feature gate | Not set | Always `disableNodeAutoProvisioning=true` |
| Base image | `kaito-base:0.1.1` | `kaito-base:0.1.1` (unchanged) |
| Helm values | Not supported | Extended to support `values` object |
| `preferredNodes` | Supported | **Removed** (deprecated in 0.8.0) |

---

## KAITO 0.8.0 Breaking Changes (from upstream)

1. **Inference workload unified to StatefulSet** - Previously could be Deployment, now always StatefulSet. KAITO controller handles migration automatically.
2. **phi-2 model deprecated** - No longer supported as a preset model.
3. **`/query` API removed** - Replaced with FastAPI-based endpoints.
4. **`preferredNodes` deprecated** - BYO nodes should use `labelSelector` instead. Nodes matching the label selector are automatically selected.

---

## Design Decisions

### 1. GPU Node Selection: `nvidia.com/gpu.present: "true"`

**Rationale:** NVIDIA GPU Feature Discovery (GFD) publishes this label on nodes with NVIDIA GPUs. Using this label ensures workloads only schedule on GPU-capable nodes.

**Labels available from GFD:**
- `nvidia.com/gpu.present: "true"` - GPU is present (we use this)
- `nvidia.com/gpu.product` - GPU model name (e.g., "Tesla-V100-SXM2-32GB")
- `nvidia.com/gpu.count` - Number of GPUs
- `nvidia.com/gpu.memory` - GPU memory in MiB

### 2. CPU Node Selection: `kubernetes.io/os: linux`

**Rationale:** For CPU-only inference (llama.cpp/GGUF), we use the standard Linux OS label which is present on all Linux nodes. This is the most permissive default for CPU workloads.

### 3. Always Disable Node Auto-Provisioning

**Rationale:** KubeAIRunway is designed for BYO (Bring Your Own) node scenarios. Disabling NAP:
- Simplifies the user experience
- Avoids conflicts with cloud-provider-specific auto-provisioners
- Aligns with KAITO 0.8.0's BYO node improvements

### 4. Extend HelmChart Interface

**Rationale:** Adding `values` support to `HelmChart` is more flexible and reusable than hardcoding `--set` flags in command strings.

---

## Files to Modify

### 1. `backend/src/providers/types.ts`

**Change:** Add `values` field to `HelmChart` interface.

```typescript
export interface HelmChart {
  name: string;
  chart: string;
  version: string;
  namespace: string;
  createNamespace?: boolean;
  values?: Record<string, unknown>;  // NEW
}
```

### 2. `backend/src/services/helm.ts`

**Change:** Update helm install/upgrade methods to generate `--set` flags from `values` object.

```typescript
// Helper function to flatten values object to --set flags
function flattenValues(obj: Record<string, unknown>, prefix = ''): string[] {
  const result: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result.push(...flattenValues(value as Record<string, unknown>, fullKey));
    } else {
      result.push(`--set ${fullKey}=${value}`);
    }
  }
  return result;
}
```

### 3. `backend/src/providers/kaito/index.ts`

**Changes:**

#### a) Update version constant
```typescript
const KAITO_VERSION = '0.8.0';  // was '0.6.0'
```

#### b) Update `buildResourceSpec()` method
```typescript
private buildResourceSpec(config: KaitoDeploymentConfig): Record<string, unknown> {
  const resourceSpec: Record<string, unknown> = {
    count: config.replicas || 1,
  };

  if (config.labelSelector && Object.keys(config.labelSelector).length > 0) {
    resourceSpec.labelSelector = {
      matchLabels: config.labelSelector,
    };
  } else {
    // Determine default labelSelector based on compute requirements
    const requiresGPU = config.computeType === 'gpu' || config.modelSource === 'vllm';
    
    if (requiresGPU) {
      // GPU workloads: use NVIDIA GPU Feature Discovery label
      resourceSpec.labelSelector = {
        matchLabels: {
          'nvidia.com/gpu.present': 'true',
        },
      };
    } else {
      // CPU-only workloads: use basic Linux node selector
      resourceSpec.labelSelector = {
        matchLabels: {
          'kubernetes.io/os': 'linux',
        },
      };
    }
  }

  // NOTE: preferredNodes removed - deprecated in KAITO 0.8.0
  // BYO nodes should use labelSelector instead

  return resourceSpec;
}
```

#### c) Update `getInstallationSteps()` method
```typescript
getInstallationSteps(): InstallationStep[] {
  return [
    {
      title: 'Add KAITO Helm Repository',
      command: 'helm repo add kaito https://kaito-project.github.io/kaito/charts/kaito',
      description: 'Add the KAITO Helm repository.',
    },
    {
      title: 'Update Helm Repositories',
      command: 'helm repo update',
      description: 'Update local Helm repository cache.',
    },
    {
      title: 'Install KAITO Workspace Operator',
      command: `helm upgrade --install kaito-workspace kaito/workspace --version ${KAITO_VERSION} -n kaito-workspace --create-namespace --set featureGates.disableNodeAutoProvisioning=true --wait`,
      description: `Install the KAITO workspace operator v${KAITO_VERSION} with Node Auto-Provisioning disabled (BYO nodes mode).`,
    },
  ];
}
```

#### d) Update `getHelmCharts()` method
```typescript
getHelmCharts(): HelmChart[] {
  return [
    {
      name: 'kaito-workspace',
      chart: 'kaito/workspace',
      version: KAITO_VERSION,
      namespace: 'kaito-workspace',
      createNamespace: true,
      values: {
        featureGates: {
          disableNodeAutoProvisioning: true,
        },
      },
    },
  ];
}
```

### 4. Update Schema (`backend/src/providers/kaito/schema.ts`)

**Change:** Remove the deprecated `preferredNodes` field.

```typescript
// REMOVE this field from kaitoDeploymentConfigSchema:
// preferredNodes: z.array(z.string()).optional(),
```

### 5. Update Shared Types (`shared/types/deployment.ts`)

**Change:** Remove the deprecated `preferredNodes` field from `DeploymentConfig`.

```typescript
// REMOVE this field from DeploymentConfig interface:
// preferredNodes?: string[];     // Preferred node names for scheduling
```

### 6. Update Frontend (`frontend/src/components/deployments/DeploymentForm.tsx`)

**Changes:**

#### a) Remove state declaration
```typescript
// REMOVE:
// const [preferredNodes, setPreferredNodes] = useState<string[]>([])
```

#### b) Remove from reset function
```typescript
// REMOVE from handleRuntimeChange or similar reset logic:
// setPreferredNodes([])
```

#### c) Remove from form submission payload
```typescript
// REMOVE all occurrences of:
// ...(preferredNodes.length > 0 && { preferredNodes }),
```

#### d) Remove from useCallback dependencies
```typescript
// REMOVE preferredNodes from dependency arrays
```

#### e) Remove entire "Preferred Nodes Selection" UI section (~lines 988-1049)
```tsx
// REMOVE the entire block:
// {/* Preferred Nodes Selection */}
// <div className="space-y-3">
//   <Label>Preferred Nodes (Optional)</Label>
//   ... entire section ...
// </div>
```

---

## Test Updates

### Files to update:
- `backend/src/hono-app.test.ts` - Update version expectations
- `backend/src/providers/kaito/*.test.ts` - If exists, update manifest assertions

### Test cases to verify:
1. ✅ Version is `0.8.0`
2. ✅ GPU workload generates `nvidia.com/gpu.present: "true"` labelSelector
3. ✅ CPU workload generates `kubernetes.io/os: linux` labelSelector
4. ✅ vLLM workload (always GPU) generates `nvidia.com/gpu.present: "true"`
5. ✅ Installation command includes `--set featureGates.disableNodeAutoProvisioning=true`
6. ✅ User-provided labelSelector is respected (not overwritten)

---

## Implementation Order

1. [x] **Update `HelmChart` interface** in `backend/src/providers/types.ts`
2. [x] **Update helm service** in `backend/src/services/helm.ts` to handle `values`
3. [x] **Update KAITO provider** in `backend/src/providers/kaito/index.ts`:
   - Bump version to `0.8.0`
   - Update `buildResourceSpec()` for GPU/CPU label logic
   - Remove `preferredNodes` handling
   - Update `getInstallationSteps()` with NAP flag
   - Update `getHelmCharts()` with values
4. [x] **Update KAITO schema** in `backend/src/providers/kaito/schema.ts`:
   - Remove `preferredNodes` field
5. [x] **Update shared types** in `shared/types/deployment.ts`:
   - Remove `preferredNodes` field from `DeploymentConfig`
6. [x] **Update frontend** in `frontend/src/components/deployments/DeploymentForm.tsx`:
   - Remove `preferredNodes` state
   - Remove "Preferred Nodes Selection" UI section
   - Remove from form submission payloads
7. [x] **Update/add tests** for the changes
8. [x] **Run `bun run test`** to verify all changes pass
9. [ ] **Manual testing** with actual KAITO deployment

---

## Rollback Plan

If issues are discovered:
1. Revert version to `0.6.0`
2. Remove `disableNodeAutoProvisioning` flag
3. Restore original `buildResourceSpec()` logic

---

## Dependencies

- KAITO Helm chart version 0.8.0 must be available in the repository
- Clusters using GPU features need NVIDIA GPU Operator or GPU Feature Discovery installed

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| GPU nodes missing `nvidia.com/gpu.present` label | GPU workloads won't schedule | Document NVIDIA GPU Operator requirement; users can override labelSelector |
| Existing deployments affected by StatefulSet migration | Brief downtime during pod recreation | KAITO handles this automatically; document in release notes |
| Helm values flattening edge cases | Installation might fail | Test with nested values; add error handling |

---

## References

- [KAITO v0.8.0 Release Notes](https://github.com/kaito-project/kaito/releases/tag/v0.8.0)
- [KAITO Installation Docs](https://kaito-project.github.io/kaito/docs/installation/)
- [NVIDIA GPU Feature Discovery](https://github.com/NVIDIA/k8s-device-plugin/tree/main/docs/gpu-feature-discovery)
- [KAITO BYO Nodes Proposal](https://github.com/kaito-project/kaito/tree/main/docs/proposals/20250820-byo-nodes.md)
- [KAITO Cloud Provider Agnostic Scheduling Proposal](https://github.com/kaito-project/kaito/tree/main/docs/proposals/20250902-cloud-provider-agnostic-scheduling.md)
