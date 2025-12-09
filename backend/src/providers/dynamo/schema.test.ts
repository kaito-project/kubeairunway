import { describe, it, expect } from 'bun:test';
import { dynamoDeploymentConfigSchema, dynamoManifestSchema } from './schema';

describe('dynamoDeploymentConfigSchema', () => {
  const validConfig = {
    name: 'my-deployment',
    namespace: 'kubefoundry',
    modelId: 'Qwen/Qwen3-0.6B',
    engine: 'vllm' as const,
    hfTokenSecret: 'hf-token-secret',
  };

  describe('valid configurations', () => {
    it('accepts minimal valid configuration', () => {
      const result = dynamoDeploymentConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('my-deployment');
        expect(result.data.namespace).toBe('kubefoundry');
        expect(result.data.modelId).toBe('Qwen/Qwen3-0.6B');
        expect(result.data.engine).toBe('vllm');
        // Check defaults are applied
        expect(result.data.mode).toBe('aggregated');
        expect(result.data.replicas).toBe(1);
        expect(result.data.enforceEager).toBe(true);
        expect(result.data.enablePrefixCaching).toBe(false);
        expect(result.data.trustRemoteCode).toBe(false);
        expect(result.data.routerMode).toBe('none');
      }
    });

    it('accepts all supported engines', () => {
      const engines = ['vllm', 'sglang', 'trtllm'] as const;
      for (const engine of engines) {
        const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, engine });
        expect(result.success).toBe(true);
      }
    });

    it('accepts all deployment modes', () => {
      const modes = ['aggregated', 'disaggregated'] as const;
      for (const mode of modes) {
        const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, mode });
        expect(result.success).toBe(true);
      }
    });

    it('accepts all router modes', () => {
      const routerModes = ['none', 'kv', 'round-robin'] as const;
      for (const routerMode of routerModes) {
        const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, routerMode });
        expect(result.success).toBe(true);
      }
    });

    it('accepts full configuration with all optional fields', () => {
      const fullConfig = {
        ...validConfig,
        mode: 'disaggregated',
        servedModelName: 'my-model',
        routerMode: 'kv',
        replicas: 3,
        contextLength: 4096,
        enforceEager: false,
        enablePrefixCaching: true,
        trustRemoteCode: true,
        resources: {
          gpu: 2,
          memory: '32Gi',
        },
        engineArgs: {
          customArg: 'value',
        },
      };
      const result = dynamoDeploymentConfigSchema.safeParse(fullConfig);
      expect(result.success).toBe(true);
    });
  });

  describe('name validation', () => {
    it('rejects empty name', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects name longer than 63 characters', () => {
      const longName = 'a'.repeat(64);
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, name: longName });
      expect(result.success).toBe(false);
    });

    it('rejects name with uppercase letters', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, name: 'MyDeployment' });
      expect(result.success).toBe(false);
    });

    it('rejects name starting with hyphen', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, name: '-deployment' });
      expect(result.success).toBe(false);
    });

    it('rejects name ending with hyphen', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, name: 'deployment-' });
      expect(result.success).toBe(false);
    });

    it('rejects name with special characters', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, name: 'deploy_ment' });
      expect(result.success).toBe(false);
    });

    it('accepts valid Kubernetes resource names', () => {
      const validNames = ['a', 'deployment', 'my-deployment', 'deploy-123', 'a1b2c3'];
      for (const name of validNames) {
        const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, name });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('replicas validation', () => {
    it('accepts replicas between 1 and 10', () => {
      for (let replicas = 1; replicas <= 10; replicas++) {
        const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, replicas });
        expect(result.success).toBe(true);
      }
    });

    it('rejects replicas less than 1', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, replicas: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects replicas greater than 10', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, replicas: 11 });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer replicas', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, replicas: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('required fields', () => {
    it('rejects missing namespace', () => {
      const { namespace, ...configWithoutNamespace } = validConfig;
      const result = dynamoDeploymentConfigSchema.safeParse(configWithoutNamespace);
      expect(result.success).toBe(false);
    });

    it('rejects missing modelId', () => {
      const { modelId, ...configWithoutModel } = validConfig;
      const result = dynamoDeploymentConfigSchema.safeParse(configWithoutModel);
      expect(result.success).toBe(false);
    });

    it('rejects missing engine', () => {
      const { engine, ...configWithoutEngine } = validConfig;
      const result = dynamoDeploymentConfigSchema.safeParse(configWithoutEngine);
      expect(result.success).toBe(false);
    });

    it('rejects missing hfTokenSecret', () => {
      const { hfTokenSecret, ...configWithoutToken } = validConfig;
      const result = dynamoDeploymentConfigSchema.safeParse(configWithoutToken);
      expect(result.success).toBe(false);
    });
  });

  describe('invalid engine', () => {
    it('rejects unsupported engine', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, engine: 'invalid-engine' });
      expect(result.success).toBe(false);
    });
  });

  describe('contextLength validation', () => {
    it('accepts positive context length', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, contextLength: 4096 });
      expect(result.success).toBe(true);
    });

    it('rejects zero context length', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, contextLength: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects negative context length', () => {
      const result = dynamoDeploymentConfigSchema.safeParse({ ...validConfig, contextLength: -100 });
      expect(result.success).toBe(false);
    });
  });
});

describe('dynamoManifestSchema', () => {
  const validManifest = {
    apiVersion: 'dynamo.nvidia.com/v1alpha1',
    kind: 'DynamoGraphDeployment',
    metadata: {
      name: 'my-deployment',
      namespace: 'kubefoundry',
    },
    spec: {
      Frontend: {},
    },
  };

  it('accepts valid minimal manifest', () => {
    const result = dynamoManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it('accepts manifest with labels', () => {
    const result = dynamoManifestSchema.safeParse({
      ...validManifest,
      metadata: {
        ...validManifest.metadata,
        labels: {
          'app.kubernetes.io/name': 'my-app',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts manifest with Frontend options', () => {
    const result = dynamoManifestSchema.safeParse({
      ...validManifest,
      spec: {
        Frontend: {
          replicas: 2,
          'http-port': 8080,
          'router-mode': 'kv',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid apiVersion', () => {
    const result = dynamoManifestSchema.safeParse({
      ...validManifest,
      apiVersion: 'wrong/v1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid kind', () => {
    const result = dynamoManifestSchema.safeParse({
      ...validManifest,
      kind: 'Deployment',
    });
    expect(result.success).toBe(false);
  });

  it('accepts additional worker specs in spec (passthrough)', () => {
    const result = dynamoManifestSchema.safeParse({
      ...validManifest,
      spec: {
        Frontend: {},
        VllmWorker: {
          model: 'Qwen/Qwen3-0.6B',
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
