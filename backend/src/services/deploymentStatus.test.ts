import { describe, test, expect } from 'bun:test';
import { toDeploymentStatus, type ModelDeployment } from '@airunway/shared';

interface ModelDeploymentOverrides {
  metadata?: Partial<ModelDeployment['metadata']>;
  spec?: Partial<ModelDeployment['spec']>;
  status?: Partial<NonNullable<ModelDeployment['status']>>;
}

function createModelDeployment(overrides: ModelDeploymentOverrides = {}): ModelDeployment {
  return {
    apiVersion: 'airunway.ai/v1alpha1',
    kind: 'ModelDeployment',
    metadata: {
      name: 'test-deploy',
      namespace: 'default',
      creationTimestamp: '2026-03-17T00:00:00Z',
      ...overrides.metadata,
    },
    spec: {
      model: {
        id: 'meta-llama/Llama-3.2-1B-Instruct',
      },
      engine: {
        type: 'vllm',
      },
      serving: {
        mode: 'aggregated',
      },
      ...overrides.spec,
    },
    status: {
      phase: 'Running',
      provider: {
        name: 'kaito',
      },
      replicas: {
        desired: 1,
        ready: 1,
        available: 1,
      },
      ...overrides.status,
    },
  };
}

describe('toDeploymentStatus', () => {
  test('uses the provider endpoint service and service port for frontend access', () => {
    const deployment = createModelDeployment({
      metadata: {
        name: 'llama3-2-1b-3aeb',
        namespace: 'kaito-workspace',
      },
      spec: {
        model: {
          id: 'meta-llama/Llama-3.2-1B-Instruct',
        },
        engine: {
          type: 'llamacpp',
        },
      },
      status: {
        endpoint: {
          service: 'llama3-2-1b-3aeb',
          port: 80,
        },
      },
    });

    expect(toDeploymentStatus(deployment).frontendService).toBe('llama3-2-1b-3aeb:80');
  });

  test('falls back to the deployment name when the provider endpoint is missing', () => {
    const deployment = createModelDeployment({
      metadata: {
        name: 'legacy-deploy',
      },
      status: {
        endpoint: undefined,
      },
    });

    expect(toDeploymentStatus(deployment).frontendService).toBe('legacy-deploy');
  });
});
