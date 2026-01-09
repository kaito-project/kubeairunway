# KubeFoundry Integration Testing Plan

## Overview

This document outlines the integration testing strategy for KubeFoundry to validate end-to-end model deployment workflows.

## Summary of Decisions

| Question | Choice |
|----------|--------|
| Test Environment | Mock for unit tests, real kind cluster for integration |
| Provider Coverage | KAITO only (start simple, expand later) |
| Lifecycle Phases | Deploy → Wait Ready → Inference → Delete |
| Model Types | Pre-made GGUF (`llama3.2:1b`) |
| CI/CD | GitHub Actions with kind cluster |
| Duration | < 10 minutes |
| Infrastructure | Tests install everything via KubeFoundry API |
| Isolation | New kind cluster per run (ephemeral) |
| Kind Config | Single node |
| KAITO Install | Via `/api/installation/kaito` endpoint |
| Inference Validation | Validate OpenAI-compatible response structure |
| Failure Handling | Hard fail + upload logs for debugging |
| Reporting | Console + JUnit XML |

---

## File Structure

```
backend/src/integration/
├── setup/
│   ├── kind.ts              # Kind cluster create/delete helpers
│   ├── kaito-installer.ts   # Install KAITO via KubeFoundry API
│   └── test-utils.ts        # Polling, timeouts, log capture
├── kaito-deployment.integration.ts   # Main integration test
└── README.md                # How to run locally
```

```
.github/workflows/
└── integration-tests.yml    # GitHub Actions workflow
```

---

## Test Cases

### Test Suite: KAITO Pre-made Model Deployment

| # | Test Case | Expected Duration | Description |
|---|-----------|-------------------|-------------|
| 1 | Install KAITO operator | ~2 min | Call `/api/installation/kaito`, wait for CRD + operator pod ready |
| 2 | Deploy llama3.2:1b model | ~3 min | POST to `/api/deployments`, wait for pod Running |
| 3 | Verify inference endpoint | ~30 sec | Send prompt, validate OpenAI-compatible response |
| 4 | Delete deployment | ~30 sec | DELETE deployment, verify resources gone |

**Total estimated time: ~6-8 minutes**

---

## GitHub Actions Workflow

```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:  # Manual trigger

jobs:
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: oven-sh/setup-bun@v2
      
      - name: Install dependencies
        run: bun install
        
      - name: Create kind cluster
        uses: helm/kind-action@v1
        with:
          cluster_name: kubefoundry-test
          
      - name: Start backend server
        run: |
          cd backend && bun run dev &
          sleep 5  # Wait for server startup
          
      - name: Run integration tests
        run: bun test:integration --reporter=junit --reporter=default
        env:
          KUBECONFIG: /home/runner/.kube/config
          TEST_TIMEOUT: 600000  # 10 min
          
      - name: Capture logs on failure
        if: failure()
        run: |
          kubectl get pods -A
          kubectl describe pods -n kaito-workspace
          kubectl logs -n kaito-workspace -l app.kubernetes.io/managed-by=kubefoundry --tail=500
          
      - name: Upload test artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: integration-test-logs
          path: |
            test-results/
            *.log
            
      - name: Upload JUnit results
        if: always()
        uses: mikepenz/action-junit-report@v4
        with:
          report_paths: 'test-results/*.xml'
```

---

## Test Implementation Outline

### 1. Kind Setup Helper (`setup/kind.ts`)

```typescript
/**
 * Wait for the kind cluster to be ready.
 * Polls until all nodes report Ready status.
 */
export async function waitForClusterReady(timeoutMs = 60000): Promise<void>;

/**
 * Check if kubectl can connect to the cluster.
 */
export async function isClusterAccessible(): Promise<boolean>;
```

### 2. KAITO Installer (`setup/kaito-installer.ts`)

```typescript
/**
 * Install KAITO operator via KubeFoundry API.
 * Calls POST /api/installation/kaito/install
 */
export async function installKaito(baseUrl: string): Promise<void>;

/**
 * Wait for KAITO to be fully operational.
 * Polls /api/installation/kaito/status until:
 * - installed: true
 * - operatorRunning: true
 * 
 * Timeout: 3 minutes
 */
export async function waitForKaitoReady(
  baseUrl: string, 
  timeoutMs = 180000
): Promise<void>;
```

### 3. Test Utils (`setup/test-utils.ts`)

```typescript
/**
 * Poll deployment status until ready or timeout.
 */
export async function waitForDeploymentReady(
  baseUrl: string,
  name: string,
  namespace: string,
  timeoutMs = 300000
): Promise<DeploymentStatus>;

/**
 * Capture pod logs for debugging failed tests.
 */
export async function captureLogsOnFailure(
  namespace: string
): Promise<string>;

/**
 * Validate that a response matches OpenAI chat completion format.
 */
export function validateOpenAIResponse(response: unknown): {
  valid: boolean;
  errors: string[];
};

/**
 * Generic polling helper with exponential backoff.
 */
export async function poll<T>(
  fn: () => Promise<T>,
  predicate: (result: T) => boolean,
  options: { timeoutMs: number; intervalMs: number; backoff?: boolean }
): Promise<T>;
```

### 4. Main Test File (`kaito-deployment.integration.ts`)

```typescript
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { waitForClusterReady } from './setup/kind';
import { installKaito, waitForKaitoReady } from './setup/kaito-installer';
import { 
  waitForDeploymentReady, 
  captureLogsOnFailure,
  validateOpenAIResponse 
} from './setup/test-utils';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_NAMESPACE = 'kaito-workspace';
const TEST_MODEL = 'llama3.2:1b';
const DEPLOYMENT_NAME = 'integration-test-llama';

describe('KAITO Integration Tests', () => {
  let testFailed = false;

  beforeAll(async () => {
    // Ensure cluster is accessible
    await waitForClusterReady();
    
    // Install KAITO via KubeFoundry API
    await installKaito(BASE_URL);
    await waitForKaitoReady(BASE_URL);
  }, 300000); // 5 min timeout for setup

  afterAll(async () => {
    if (testFailed) {
      // Capture logs for debugging
      const logs = await captureLogsOnFailure(TEST_NAMESPACE);
      console.log('=== Pod Logs ===\n', logs);
    }
    
    // Cleanup: delete test deployment
    try {
      await fetch(`${BASE_URL}/api/deployments/${TEST_NAMESPACE}/${DEPLOYMENT_NAME}`, {
        method: 'DELETE',
      });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  test('deploy llama3.2:1b pre-made model', async () => {
    const config = {
      name: DEPLOYMENT_NAME,
      namespace: TEST_NAMESPACE,
      provider: 'kaito',
      modelSource: 'premade',
      premadeModel: TEST_MODEL,
      ggufRunMode: 'direct',
      computeType: 'cpu',
      replicas: 1,
    };

    const res = await fetch(`${BASE_URL}/api/deployments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });

    expect(res.status).toBe(201);

    // Wait for deployment to be ready
    const status = await waitForDeploymentReady(
      BASE_URL,
      DEPLOYMENT_NAME,
      TEST_NAMESPACE,
      300000 // 5 min
    );

    expect(status.phase).toBe('Running');
    expect(status.replicas.ready).toBeGreaterThanOrEqual(1);
  }, 360000); // 6 min timeout

  test('inference endpoint returns valid OpenAI response', async () => {
    // Get deployment to find service endpoint
    const deploymentRes = await fetch(
      `${BASE_URL}/api/deployments/${TEST_NAMESPACE}/${DEPLOYMENT_NAME}`
    );
    expect(deploymentRes.status).toBe(200);
    
    const deployment = await deploymentRes.json();
    const inferenceUrl = deployment.endpoint || 
      `http://${DEPLOYMENT_NAME}.${TEST_NAMESPACE}.svc:8080`;

    // Use kubectl port-forward or proxy for in-cluster service
    // For CI, we'll use the KubeFoundry proxy endpoint
    const proxyUrl = `${BASE_URL}/api/deployments/${TEST_NAMESPACE}/${DEPLOYMENT_NAME}/proxy`;

    const chatRes = await fetch(`${proxyUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TEST_MODEL,
        messages: [
          { role: 'user', content: 'Say hello in exactly 3 words.' }
        ],
        max_tokens: 50,
      }),
    });

    expect(chatRes.status).toBe(200);
    
    const chatData = await chatRes.json();
    const validation = validateOpenAIResponse(chatData);
    
    expect(validation.valid).toBe(true);
    expect(chatData.choices[0].message.content).toBeTruthy();
  }, 60000); // 1 min timeout

  test('delete deployment cleans up resources', async () => {
    const deleteRes = await fetch(
      `${BASE_URL}/api/deployments/${TEST_NAMESPACE}/${DEPLOYMENT_NAME}`,
      { method: 'DELETE' }
    );

    expect(deleteRes.status).toBe(200);

    // Verify deployment is gone
    const checkRes = await fetch(
      `${BASE_URL}/api/deployments/${TEST_NAMESPACE}/${DEPLOYMENT_NAME}`
    );

    expect(checkRes.status).toBe(404);
  }, 30000);
});
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `API_URL` | `http://localhost:3000` | Backend API URL |
| `TEST_TIMEOUT` | `600000` | Max test duration (ms) |
| `KAITO_INSTALL_TIMEOUT` | `180000` | KAITO install wait (ms) |
| `DEPLOYMENT_READY_TIMEOUT` | `300000` | Deployment ready wait (ms) |
| `TEST_MODEL` | `llama3.2:1b` | Pre-made model to test |
| `KUBECONFIG` | `~/.kube/config` | Kubernetes config path |

---

## Local Development

### Prerequisites

- Docker installed and running
- `kind` CLI installed
- `kubectl` CLI installed
- `bun` installed

### Running Locally

```bash
# Create kind cluster (if not exists)
kind create cluster --name kubefoundry-test

# Start the backend server
cd backend && bun run dev &

# Run integration tests
bun run test:integration

# Cleanup when done
kind delete cluster --name kubefoundry-test
```

### Debugging Failed Tests

When tests fail locally, resources are left in place for debugging:

```bash
# Check pod status
kubectl get pods -n kaito-workspace

# View pod logs
kubectl logs -n kaito-workspace -l app.kubernetes.io/managed-by=kubefoundry

# Describe failing pod
kubectl describe pod -n kaito-workspace <pod-name>

# Check events
kubectl get events -n kaito-workspace --sort-by='.lastTimestamp'
```

---

## Package.json Script Addition

Add to `backend/package.json`:

```json
{
  "scripts": {
    "test:integration": "bun test src/integration/*.integration.ts --timeout 600000"
  }
}
```

---

## OpenAI Response Validation Schema

The inference test validates responses match this structure:

```typescript
interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
```

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Image pull slow in CI | Accept ~3 min pull time; consider caching in future |
| Flaky network in GHA | Add retry logic with exponential backoff |
| KAITO install timeout | 3 min timeout with clear error messages |
| Inference slow on first call | Allow 30s for first response (model loading) |
| Kind cluster creation fails | Retry once; fail fast with clear error |
| Test leaves resources behind | Always cleanup in afterAll, even on failure |

---

## Future Enhancements

1. **Add more providers**: Extend to Dynamo and KubeRay when GPU tests are feasible
2. **Parallel test runs**: Run multiple model tests in parallel
3. **Performance benchmarks**: Track inference latency over time
4. **Chaos testing**: Test pod failures and recovery
5. **Upgrade testing**: Verify model upgrades work correctly
6. **Multi-node tests**: Test scheduling across nodes

---

## Timeline

| Phase | Tasks | Estimate |
|-------|-------|----------|
| Phase 1 | Setup helpers + basic deployment test | 1 day |
| Phase 2 | Inference validation + cleanup | 0.5 day |
| Phase 3 | GitHub Actions workflow | 0.5 day |
| Phase 4 | Documentation + polish | 0.5 day |

**Total: ~2.5 days**
