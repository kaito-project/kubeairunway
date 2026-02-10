# Plan: Expand KAITO to Support vLLM for Any HuggingFace Model

> **Status**: Planning  
> **Created**: 2026-01-05  
> **Template Reference**: [custom-model-deployment.yaml](https://raw.githubusercontent.com/kaito-project/kaito/refs/heads/main/examples/custom-model-integration/custom-model-deployment.yaml)

## Overview

Expand KAITO provider to support **any vLLM-compatible HuggingFace model** using the `kaito-base` image (`mcr.microsoft.com/aks/kaito/kaito-base:0.1.1`), in addition to existing GGUF/llama.cpp support.

## Decision Summary

| Question | Decision |
|----------|----------|
| Model source name | `vllm` |
| Runtime compatibility | All models with `vllm` in `supportedEngines` |
| GPU requirement | vLLM mode: required, GGUF: optional (CPU or GPU) |
| Tensor parallelism | Auto-set to match GPU count |
| HF Token | Reuse existing `hfTokenSecret` field |
| Pipeline selection | Always `text-generation` (no UI option) |
| vLLM parameters | `--max-model-len` in Advanced section |
| Engine field value | `vllm` |
| Provider description | "Flexible inference with GGUF (llama.cpp) and vLLM support" |
| Quantized formats | fp16/bf16 only (no AWQ/GPTQ for now) |

---

## KAITO Workspace Template (vLLM Mode)

Based on the custom-model-deployment.yaml template:

```yaml
apiVersion: kaito.sh/v1beta1
kind: Workspace
metadata:
  name: workspace-{name}
  namespace: {namespace}
  labels:
    app.kubernetes.io/name: kubeairunway
    kubeairunway.io/model-source: vllm
    kubeairunway.io/compute-type: gpu
resource:
  count: {replicas}
  labelSelector:
    matchLabels:
      kubernetes.io/os: linux
  preferredNodes: [{preferredNodes}]  # optional
inference:
  template:
    spec:
      containers:
        - name: model
          image: mcr.microsoft.com/aks/kaito/kaito-base:0.1.1
          command:
            - "python"
          args:
            - "-m"
            - "vllm.entrypoints.openai.api_server"
            - "--model"
            - "{modelId}"  # HuggingFace model ID
            - "--tensor-parallel-size"
            - "{gpuCount}"  # Auto-set to match GPU count
            - "--trust-remote-code"
            - "--max-model-len"
            - "{maxModelLen}"  # Optional, from Advanced settings
          ports:
            - containerPort: 8000
              protocol: TCP
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
              scheme: HTTP
            initialDelaySeconds: 600
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
              scheme: HTTP
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          resources:
            requests:
              nvidia.com/gpu: {gpuCount}
            limits:
              nvidia.com/gpu: {gpuCount}
          env:
            - name: HF_TOKEN  # Only if gated model
              valueFrom:
                secretKeyRef:
                  name: {hfTokenSecret}
                  key: HF_TOKEN
          volumeMounts:
            - name: dshm
              mountPath: /dev/shm
      volumes:
        - name: dshm
          emptyDir:
            medium: Memory
```

---

## Changes Required

### Phase 1: Backend Schema & Provider

#### 1.1 Schema Changes (`backend/src/providers/kaito/schema.ts`)

```typescript
// Expand modelSource enum
modelSource: z.enum(['premade', 'huggingface', 'vllm']),

// New fields for vLLM mode
maxModelLen: z.number().int().min(1).optional(),  // --max-model-len
```

Update refinement:
```typescript
.refine(
  data => {
    if (data.modelSource === 'premade') return !!data.premadeModel;
    if (data.modelSource === 'huggingface') return !!data.modelId && !!data.ggufFile;
    if (data.modelSource === 'vllm') return !!data.modelId;  // Just needs model ID
    return false;
  },
  { message: '...' }
);
```

#### 1.2 Provider Changes (`backend/src/providers/kaito/index.ts`)

- Add constant: `KAITO_BASE_IMAGE = 'mcr.microsoft.com/aks/kaito/kaito-base:0.1.1'`
- Add constant: `VLLM_PORT = 8000` (vLLM uses port 8000, not 5000)
- Update `description` to: "Flexible inference with GGUF (llama.cpp) and vLLM support"
- Add `generateVllmManifest()` method
- Update `generateManifest()` to route to new method when `modelSource === 'vllm'`
- Update `parseStatus()` to handle vLLM mode:
  - Extract model ID from `--model` arg
  - Set engine to `vllm`
  - Use port 8000 for service
- Update `getKeyMetrics()` to return vLLM metrics when applicable

#### 1.3 Shared Types (`shared/types/deployment.ts`)

```typescript
// Expand modelSource
modelSource?: 'premade' | 'huggingface' | 'vllm';

// Add maxModelLen
maxModelLen?: number;
```

---

### Phase 2: Frontend UI

#### 2.1 Runtime Compatibility (`DeploymentForm.tsx`)

Update `isRuntimeCompatible()`:
```typescript
function isRuntimeCompatible(runtimeId: RuntimeId, modelEngines: Engine[]): boolean {
  if (runtimeId === 'kaito') {
    // KAITO supports llamacpp (GGUF) AND vllm
    return modelEngines.includes('llamacpp') || modelEngines.includes('vllm');
  }
  // ... existing logic
}
```

#### 2.2 KAITO Model Configuration Section

When KAITO is selected and model has `vllm` in engines (not GGUF):

- **No run mode selection** (no build/direct toggle)
- **GPU required** (hide CPU option, default to GPU)
- **Show "Tensor Parallelism" = GPUs** (auto-linked)
- **Advanced section**: Add `--max-model-len` input

```tsx
{isVllmModel && selectedRuntime === 'kaito' && (
  <div className="space-y-4">
    <Alert>
      <AlertDescription>
        This model will be deployed using vLLM on GPU. Tensor parallelism 
        will automatically match the GPU count.
      </AlertDescription>
    </Alert>
    
    {/* GPUs selector (required) */}
    <div className="space-y-2">
      <Label>GPUs</Label>
      <Input type="number" min={1} max={8} ... />
      <p className="text-xs text-muted-foreground">
        Tensor parallelism will be set to match GPU count
      </p>
    </div>
    
    {/* In Advanced section */}
    <div className="space-y-2">
      <Label>Max Model Length (optional)</Label>
      <Input type="number" placeholder="Default (from model config)" ... />
    </div>
  </div>
)}
```

#### 2.3 Submit Handler

```typescript
if (selectedRuntime === 'kaito' && isVllmModel) {
  deployConfig = {
    ...deployConfig,
    modelSource: 'vllm',
    modelId: model.id,
    computeType: 'gpu',  // Always GPU for vLLM
    resources: { gpu: gpuCount },
    ...(maxModelLen && { maxModelLen }),
    ...(isGatedModel && { hfTokenSecret: config.hfTokenSecret }),
    ...(preferredNodes.length > 0 && { preferredNodes }),
  };
}
```

#### 2.4 Runtime Info Update

```typescript
const RUNTIME_INFO = {
  kaito: {
    name: 'KAITO',
    description: 'Flexible inference with GGUF (llama.cpp) and vLLM support',
    defaultNamespace: 'kaito-workspace',
  },
  // ...
}
```

---

### Phase 3: Status Parsing & Metrics

#### 3.1 Update `parseStatus()` 

```typescript
// Detect vLLM mode from labels or container
if (modelSource === 'vllm') {
  // Extract model from --model arg
  const modelArgIdx = containerArgs.findIndex(arg => arg === '--model');
  if (modelArgIdx >= 0 && containerArgs[modelArgIdx + 1]) {
    modelId = containerArgs[modelArgIdx + 1];
  }
  engine = 'vllm';
}
```

#### 3.2 Metrics Config

vLLM exposes Prometheus metrics on `/metrics`:

```typescript
getMetricsConfig(): MetricsEndpointConfig | null {
  // vLLM uses port 8000, llama.cpp uses port 5000
  // Need to detect which mode based on deployment labels
  return {
    endpointPath: '/metrics',
    port: 8000,  // For vLLM; need logic to handle both
    serviceNamePattern: '{name}',
  };
}

getKeyMetrics(): MetricDefinition[] {
  // vLLM metrics (different from llama.cpp)
  return [
    { name: 'vllm:num_requests_running', displayName: 'Running Requests', ... },
    { name: 'vllm:num_requests_waiting', displayName: 'Waiting Requests', ... },
    { name: 'vllm:gpu_cache_usage_perc', displayName: 'GPU Cache Usage', ... },
    { name: 'vllm:avg_generation_throughput_toks_per_s', displayName: 'Throughput', ... },
  ];
}
```

---

### Phase 4: Testing

#### 4.1 Unit Tests

- `backend/src/providers/kaito/index.test.ts`:
  - Test `generateManifest()` for vLLM mode
  - Test `parseStatus()` for vLLM deployments
  - Test schema validation for vLLM config

#### 4.2 Integration Test Scenarios

- Deploy vLLM model via KAITO
- Verify manifest has correct vLLM command/args
- Verify port 8000 is used
- Verify tensor parallelism matches GPU count
- Verify HF_TOKEN env var when gated model

---

## File Changes Summary

| File | Changes |
|------|---------|
| `backend/src/providers/kaito/schema.ts` | Add `vllm` to modelSource, add `maxModelLen` field |
| `backend/src/providers/kaito/index.ts` | Add `generateVllmManifest()`, update `parseStatus()`, update description |
| `shared/types/deployment.ts` | Add `vllm` to modelSource, add `maxModelLen` |
| `frontend/src/components/deployments/DeploymentForm.tsx` | Add vLLM mode UI, update runtime compatibility |

---

## Implementation Order

1. **Backend schema** - Add new fields
2. **Backend provider** - Add manifest generation
3. **Shared types** - Sync type changes
4. **Frontend form** - Add UI for vLLM mode
5. **Status parsing** - Handle vLLM deployments
6. **Metrics** - vLLM metrics support
7. **Tests** - Unit and integration tests
8. **Run `bun run test`** - Verify all changes

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| What to call model source? | `vllm` |
| GPU required for vLLM? | Yes, always |
| Tensor parallelism UI? | Auto-set to GPU count |
| vLLM params to expose? | Just `--max-model-len` |
| Pipeline selection? | Always `text-generation` |
| AWQ/GPTQ support? | Not for now (fp16/bf16 only) |
