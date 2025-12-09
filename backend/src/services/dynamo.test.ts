import { describe, it, expect } from 'bun:test';
import { generateDynamoManifest, validateManifest } from './dynamo';

describe('generateDynamoManifest', () => {
  const baseConfig = {
    name: 'test-deployment',
    namespace: 'kubefoundry',
    modelId: 'Qwen/Qwen3-0.6B',
    engine: 'vllm' as const,
    mode: 'aggregated' as const,
    routerMode: 'none' as const,
    replicas: 1,
    hfTokenSecret: 'hf-token-secret',
    enforceEager: true,
    enablePrefixCaching: false,
    trustRemoteCode: false,
  };

  describe('manifest structure', () => {
    it('generates correct apiVersion and kind', () => {
      const manifest = generateDynamoManifest(baseConfig);
      expect(manifest.apiVersion).toBe('dynamo.nvidia.com/v1alpha1');
      expect(manifest.kind).toBe('DynamoGraphDeployment');
    });

    it('generates correct metadata', () => {
      const manifest = generateDynamoManifest(baseConfig);
      expect(manifest.metadata.name).toBe('test-deployment');
      expect(manifest.metadata.namespace).toBe('kubefoundry');
      expect(manifest.metadata.labels).toEqual({
        'app.kubernetes.io/name': 'dynamote',
        'app.kubernetes.io/instance': 'test-deployment',
        'app.kubernetes.io/managed-by': 'dynamote',
      });
    });

    it('includes Frontend spec', () => {
      const manifest = generateDynamoManifest(baseConfig);
      expect(manifest.spec.Frontend).toBeDefined();
      expect((manifest.spec.Frontend as Record<string, unknown>).replicas).toBe(1);
      expect((manifest.spec.Frontend as Record<string, unknown>)['http-port']).toBe(8000);
    });
  });

  describe('engine selection', () => {
    it('generates VllmWorker for vllm engine', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, engine: 'vllm' });
      expect(manifest.spec.VllmWorker).toBeDefined();
      expect(manifest.spec.SglangWorker).toBeUndefined();
      expect(manifest.spec.TrtllmWorker).toBeUndefined();
    });

    it('generates SglangWorker for sglang engine', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, engine: 'sglang' });
      expect(manifest.spec.SglangWorker).toBeDefined();
      expect(manifest.spec.VllmWorker).toBeUndefined();
      expect(manifest.spec.TrtllmWorker).toBeUndefined();
    });

    it('generates TrtllmWorker for trtllm engine', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, engine: 'trtllm' });
      expect(manifest.spec.TrtllmWorker).toBeDefined();
      expect(manifest.spec.VllmWorker).toBeUndefined();
      expect(manifest.spec.SglangWorker).toBeUndefined();
    });
  });

  describe('worker spec configuration', () => {
    it('includes model path and served model name', () => {
      const manifest = generateDynamoManifest(baseConfig);
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['model-path']).toBe('Qwen/Qwen3-0.6B');
      expect(worker['served-model-name']).toBe('Qwen/Qwen3-0.6B');
    });

    it('uses custom served model name when provided', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, servedModelName: 'custom-name' });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['served-model-name']).toBe('custom-name');
    });

    it('includes replicas count', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, replicas: 3 });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker.replicas).toBe(3);
    });

    it('includes envFrom with HF token secret', () => {
      const manifest = generateDynamoManifest(baseConfig);
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker.envFrom).toEqual([
        {
          secretRef: {
            name: 'hf-token-secret',
          },
        },
      ]);
    });
  });

  describe('optional configuration', () => {
    it('includes enforce-eager when enabled', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, enforceEager: true });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['enforce-eager']).toBe(true);
    });

    it('excludes enforce-eager when disabled', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, enforceEager: false });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['enforce-eager']).toBeUndefined();
    });

    it('includes enable-prefix-caching when enabled', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, enablePrefixCaching: true });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['enable-prefix-caching']).toBe(true);
    });

    it('excludes enable-prefix-caching when disabled', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, enablePrefixCaching: false });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['enable-prefix-caching']).toBeUndefined();
    });

    it('includes trust-remote-code when enabled', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, trustRemoteCode: true });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['trust-remote-code']).toBe(true);
    });

    it('includes max-model-len when contextLength is provided', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, contextLength: 4096 });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['max-model-len']).toBe(4096);
    });

    it('excludes max-model-len when contextLength is not provided', () => {
      const manifest = generateDynamoManifest(baseConfig);
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['max-model-len']).toBeUndefined();
    });
  });

  describe('resource configuration', () => {
    it('includes GPU resources when specified', () => {
      const manifest = generateDynamoManifest({
        ...baseConfig,
        resources: { gpu: 2 },
      });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      const resources = worker.resources as Record<string, Record<string, unknown>>;
      expect(resources.limits['nvidia.com/gpu']).toBe(2);
    });

    it('includes memory when specified', () => {
      const manifest = generateDynamoManifest({
        ...baseConfig,
        resources: { gpu: 1, memory: '32Gi' },
      });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      const resources = worker.resources as Record<string, Record<string, unknown>>;
      expect(resources.limits.memory).toBe('32Gi');
    });

    it('excludes resources when not specified', () => {
      const manifest = generateDynamoManifest(baseConfig);
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker.resources).toBeUndefined();
    });
  });

  describe('router mode configuration', () => {
    it('excludes router-mode when set to none', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, routerMode: 'none' });
      const frontend = manifest.spec.Frontend as Record<string, unknown>;
      expect(frontend['router-mode']).toBeUndefined();
    });

    it('includes router-mode when set to kv', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, routerMode: 'kv' });
      const frontend = manifest.spec.Frontend as Record<string, unknown>;
      expect(frontend['router-mode']).toBe('kv');
    });

    it('includes router-mode when set to round-robin', () => {
      const manifest = generateDynamoManifest({ ...baseConfig, routerMode: 'round-robin' });
      const frontend = manifest.spec.Frontend as Record<string, unknown>;
      expect(frontend['router-mode']).toBe('round-robin');
    });
  });

  describe('engine args', () => {
    it('includes custom engine args', () => {
      const manifest = generateDynamoManifest({
        ...baseConfig,
        engineArgs: {
          'custom-arg': 'value',
          'another-arg': 123,
        },
      });
      const worker = manifest.spec.VllmWorker as Record<string, unknown>;
      expect(worker['custom-arg']).toBe('value');
      expect(worker['another-arg']).toBe(123);
    });
  });
});

describe('validateManifest', () => {
  const validManifest = {
    apiVersion: 'dynamo.nvidia.com/v1alpha1',
    kind: 'DynamoGraphDeployment',
    metadata: {
      name: 'test',
      namespace: 'kubefoundry',
    },
    spec: {
      Frontend: { replicas: 1 },
      VllmWorker: { 'model-path': 'test' },
    },
  };

  it('validates correct manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects invalid apiVersion', () => {
    const result = validateManifest({ ...validManifest, apiVersion: 'wrong/v1' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid or missing apiVersion');
  });

  it('detects invalid kind', () => {
    const result = validateManifest({ ...validManifest, kind: 'Deployment' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid or missing kind');
  });

  it('detects missing metadata.name', () => {
    const result = validateManifest({
      ...validManifest,
      metadata: { ...validManifest.metadata, name: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing metadata.name');
  });

  it('detects missing metadata.namespace', () => {
    const result = validateManifest({
      ...validManifest,
      metadata: { ...validManifest.metadata, namespace: '' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing metadata.namespace');
  });

  it('detects missing Frontend spec', () => {
    const { Frontend, ...specWithoutFrontend } = validManifest.spec;
    const result = validateManifest({
      ...validManifest,
      spec: specWithoutFrontend,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing Frontend spec');
  });

  it('detects missing worker spec', () => {
    const result = validateManifest({
      ...validManifest,
      spec: { Frontend: { replicas: 1 } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing worker spec (VllmWorker, SglangWorker, or TrtllmWorker)');
  });

  it('validates SglangWorker as valid worker', () => {
    const result = validateManifest({
      ...validManifest,
      spec: {
        Frontend: { replicas: 1 },
        SglangWorker: { 'model-path': 'test' },
      },
    });
    expect(result.valid).toBe(true);
  });

  it('validates TrtllmWorker as valid worker', () => {
    const result = validateManifest({
      ...validManifest,
      spec: {
        Frontend: { replicas: 1 },
        TrtllmWorker: { 'model-path': 'test' },
      },
    });
    expect(result.valid).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const result = validateManifest({
      apiVersion: 'wrong',
      kind: 'wrong',
      metadata: { name: '', namespace: '' },
      spec: {},
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
