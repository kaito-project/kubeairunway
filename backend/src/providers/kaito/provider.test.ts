import { describe, test, expect } from 'bun:test';
import { KaitoProvider } from './index';
import { aikitService } from '../../services/aikit';

const provider = new KaitoProvider();

describe('KaitoProvider', () => {
  describe('provider info', () => {
    test('has correct id and name', () => {
      expect(provider.id).toBe('kaito');
      expect(provider.name).toBe('KAITO');
    });

    test('has description mentioning GGUF and vLLM', () => {
      expect(provider.description).toContain('GGUF');
      expect(provider.description).toContain('vLLM');
    });

    test('has default namespace', () => {
      expect(provider.defaultNamespace).toBe('kaito-workspace');
    });
  });

  describe('getCRDConfig', () => {
    test('returns correct CRD configuration', () => {
      const config = provider.getCRDConfig();
      expect(config.apiGroup).toBe('kaito.sh');
      expect(config.apiVersion).toBe('v1beta1');
      expect(config.plural).toBe('workspaces');
      expect(config.kind).toBe('Workspace');
    });
  });

  describe('generateManifest', () => {
    const basePremadeConfig = {
      name: 'test-deployment',
      namespace: 'test-ns',
      provider: 'kaito',
      modelSource: 'premade' as const,
      premadeModel: 'llama3.2:3b',
      computeType: 'cpu' as const,
      replicas: 1,
    };

    const baseHuggingFaceConfig = {
      name: 'hf-deployment',
      namespace: 'test-ns',
      provider: 'kaito',
      modelSource: 'huggingface' as const,
      modelId: 'TheBloke/Llama-2-7B-Chat-GGUF',
      ggufFile: 'llama-2-7b-chat.Q4_K_M.gguf',
      imageRef: 'kubefoundry-registry.kubefoundry-system.svc:5000/thebloke-llama-2-7b-chat-gguf:q4-k-m',
      computeType: 'cpu' as const,
      replicas: 1,
    };

    const baseVllmConfig = {
      name: 'vllm-deployment',
      namespace: 'test-ns',
      provider: 'kaito',
      modelSource: 'vllm' as const,
      modelId: 'mistralai/Mistral-7B-v0.1',
      computeType: 'gpu' as const,
      replicas: 1,
      resources: {
        gpu: 2,
      },
    };

    test('generates valid Workspace manifest for premade model', () => {
      const manifest = provider.generateManifest(basePremadeConfig);

      expect(manifest.apiVersion).toBe('kaito.sh/v1beta1');
      expect(manifest.kind).toBe('Workspace');
      expect((manifest.metadata as any).name).toBe('test-deployment');
      expect((manifest.metadata as any).namespace).toBe('test-ns');
    });

    test('generates valid Workspace manifest for HuggingFace model', () => {
      const manifest = provider.generateManifest(baseHuggingFaceConfig);

      expect(manifest.apiVersion).toBe('kaito.sh/v1beta1');
      expect(manifest.kind).toBe('Workspace');
      expect((manifest.metadata as any).name).toBe('hf-deployment');
    });

    test('generates valid Workspace manifest for vLLM model', () => {
      const manifest = provider.generateManifest(baseVllmConfig);

      expect(manifest.apiVersion).toBe('kaito.sh/v1beta1');
      expect(manifest.kind).toBe('Workspace');
      expect((manifest.metadata as any).name).toBe('vllm-deployment');
      expect((manifest.metadata as any).labels['kubefoundry.io/model-source']).toBe('vllm');
      expect((manifest.metadata as any).labels['kubefoundry.io/compute-type']).toBe('gpu');
    });

    test('vLLM manifest uses kaito-base image', () => {
      const manifest = provider.generateManifest(baseVllmConfig);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.image).toBe('mcr.microsoft.com/aks/kaito/kaito-base:0.1.1');
    });

    test('vLLM manifest has correct command and args', () => {
      const manifest = provider.generateManifest(baseVllmConfig);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.command).toEqual(['python']);
      expect(container.args).toContain('-m');
      expect(container.args).toContain('vllm.entrypoints.openai.api_server');
      expect(container.args).toContain('--model');
      expect(container.args).toContain('mistralai/Mistral-7B-v0.1');
      expect(container.args).toContain('--tensor-parallel-size');
      expect(container.args).toContain('2');  // GPU count
      expect(container.args).toContain('--trust-remote-code');
    });

    test('vLLM manifest uses port 8000', () => {
      const manifest = provider.generateManifest(baseVllmConfig);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.ports[0].containerPort).toBe(8000);
    });

    test('vLLM manifest includes GPU resources', () => {
      const manifest = provider.generateManifest(baseVllmConfig);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.resources.requests['nvidia.com/gpu']).toBe(2);
      expect(container.resources.limits['nvidia.com/gpu']).toBe(2);
    });

    test('vLLM manifest includes shared memory volume', () => {
      const manifest = provider.generateManifest(baseVllmConfig);
      const spec = (manifest.inference as any).template.spec;
      expect(spec.volumes).toHaveLength(1);
      expect(spec.volumes[0].name).toBe('dshm');
      expect(spec.volumes[0].emptyDir.medium).toBe('Memory');
      const container = spec.containers[0];
      expect(container.volumeMounts).toHaveLength(1);
      expect(container.volumeMounts[0].mountPath).toBe('/dev/shm');
    });

    test('vLLM manifest includes maxModelLen when provided', () => {
      const configWithMaxLen = { ...baseVllmConfig, maxModelLen: 4096 };
      const manifest = provider.generateManifest(configWithMaxLen);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.args).toContain('--max-model-len');
      expect(container.args).toContain('4096');
    });

    test('vLLM manifest includes HF_TOKEN env when hfTokenSecret provided', () => {
      const configWithToken = { ...baseVllmConfig, hfTokenSecret: 'my-hf-secret' };
      const manifest = provider.generateManifest(configWithToken);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.env).toHaveLength(1);
      expect(container.env[0].name).toBe('HF_TOKEN');
      expect(container.env[0].valueFrom.secretKeyRef.name).toBe('my-hf-secret');
      expect(container.env[0].valueFrom.secretKeyRef.key).toBe('HF_TOKEN');
    });

    test('vLLM manifest includes probes', () => {
      const manifest = provider.generateManifest(baseVllmConfig);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.livenessProbe).toBeDefined();
      expect(container.livenessProbe.httpGet.port).toBe(8000);
      expect(container.livenessProbe.httpGet.path).toBe('/health');
      expect(container.readinessProbe).toBeDefined();
      expect(container.readinessProbe.httpGet.port).toBe(8000);
    });

    test('includes kubefoundry labels', () => {
      const manifest = provider.generateManifest(basePremadeConfig);
      const labels = (manifest.metadata as any).labels;
      expect(labels['app.kubernetes.io/name']).toBe('kubefoundry');
      expect(labels['app.kubernetes.io/instance']).toBe('test-deployment');
      expect(labels['app.kubernetes.io/managed-by']).toBe('kubefoundry');
      expect(labels['kubefoundry.io/compute-type']).toBe('cpu');
      expect(labels['kubefoundry.io/model-source']).toBe('premade');
    });

    test('includes resource spec with replica count', () => {
      const manifest = provider.generateManifest({ ...basePremadeConfig, replicas: 3 });
      expect((manifest.resource as any).count).toBe(3);
    });

    test('includes inference template with container', () => {
      const manifest = provider.generateManifest(basePremadeConfig);
      const containers = (manifest.inference as any).template.spec.containers;
      expect(containers).toHaveLength(1);
      expect(containers[0].name).toBe('model');
      expect(containers[0].image).toBeDefined();
      expect(containers[0].ports[0].containerPort).toBe(5000);
    });

    test('uses premade model image from AIKit', () => {
      const manifest = provider.generateManifest(basePremadeConfig);
      const container = (manifest.inference as any).template.spec.containers[0];
      const premadeModel = aikitService.getPremadeModel('llama3.2:3b');
      expect(container.image).toBe(premadeModel?.image);
    });

    test('uses imageRef for HuggingFace models', () => {
      const manifest = provider.generateManifest(baseHuggingFaceConfig);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.image).toBe(baseHuggingFaceConfig.imageRef);
    });

    test('includes labelSelector when provided', () => {
      const config = {
        ...basePremadeConfig,
        labelSelector: {
          'kubernetes.io/arch': 'amd64',
          'node-type': 'ml',
        },
      };
      const manifest = provider.generateManifest(config);
      expect((manifest.resource as any).labelSelector.matchLabels['kubernetes.io/arch']).toBe('amd64');
      expect((manifest.resource as any).labelSelector.matchLabels['node-type']).toBe('ml');
    });

    test('includes resource requests when specified', () => {
      const config = {
        ...basePremadeConfig,
        resources: {
          memory: '16Gi',
          cpu: '8',
        },
      };
      const manifest = provider.generateManifest(config);
      const resources = (manifest.inference as any).template.spec.containers[0].resources;
      expect(resources.requests.memory).toBe('16Gi');
      expect(resources.requests.cpu).toBe('8');
    });

    test('includes GPU resources for gpu computeType', () => {
      const config = {
        ...basePremadeConfig,
        computeType: 'gpu' as const,
        resources: {
          gpu: 2,
          memory: '32Gi',
        },
      };
      const manifest = provider.generateManifest(config);
      const resources = (manifest.inference as any).template.spec.containers[0].resources;
      expect(resources.limits['nvidia.com/gpu']).toBe(2);
      expect(resources.requests.memory).toBe('32Gi');
    });

    test('includes container args for model server', () => {
      const manifest = provider.generateManifest(basePremadeConfig);
      const container = (manifest.inference as any).template.spec.containers[0];
      expect(container.args).toContain('run');
      expect(container.args.some((arg: string) => arg.includes('5000'))).toBe(true);
    });
  });

  describe('parseStatus', () => {
    test('parses basic deployment status', () => {
      const raw = {
        metadata: {
          name: 'test-deployment',
          namespace: 'test-ns',
          creationTimestamp: '2024-01-01T00:00:00Z',
          labels: {
            'kubefoundry.io/compute-type': 'cpu',
            'kubefoundry.io/model-source': 'premade',
          },
        },
        resource: {
          count: 2,
        },
        inference: {
          template: {
            spec: {
              containers: [
                {
                  image: 'ghcr.io/kaito-project/aikit/llama-3.2:3b',
                },
              ],
            },
          },
        },
        status: {
          phase: 'Running',
          workerNodes: ['node-1', 'node-2'],
        },
      };

      const status = provider.parseStatus(raw);

      expect(status.name).toBe('test-deployment');
      expect(status.namespace).toBe('test-ns');
      expect(status.provider).toBe('kaito');
      expect(status.phase).toBe('Running');
      expect(status.replicas.desired).toBe(2);
      expect(status.replicas.ready).toBe(2);
      expect(status.engine).toBe('llamacpp');
      expect(status.frontendService).toBe('test-deployment:80');  // KAITO service exposes port 80
    });

    test('parses vLLM deployment status', () => {
      const raw = {
        metadata: {
          name: 'vllm-deployment',
          namespace: 'test-ns',
          creationTimestamp: '2024-01-01T00:00:00Z',
          labels: {
            'kubefoundry.io/compute-type': 'gpu',
            'kubefoundry.io/model-source': 'vllm',
          },
        },
        resource: {
          count: 1,
        },
        inference: {
          template: {
            spec: {
              containers: [
                {
                  image: 'mcr.microsoft.com/aks/kaito/kaito-base:0.1.1',
                  command: ['python'],
                  args: ['-m', 'vllm.entrypoints.openai.api_server', '--model', 'mistralai/Mistral-7B-v0.1', '--tensor-parallel-size', '2'],
                },
              ],
            },
          },
        },
        status: {
          phase: 'Running',
          workerNodes: ['node-1'],
        },
      };

      const status = provider.parseStatus(raw);

      expect(status.name).toBe('vllm-deployment');
      expect(status.engine).toBe('vllm');
      expect(status.modelId).toBe('mistralai/Mistral-7B-v0.1');
      expect(status.frontendService).toBe('vllm-deployment-vllm:8000');  // Uses separate vLLM service
    });

    test('parses pending deployment', () => {
      const raw = {
        metadata: { name: 'pending-deploy', namespace: 'test-ns' },
        resource: { count: 1 },
        inference: {
          template: {
            spec: { containers: [{ image: 'test:latest' }] },
          },
        },
        status: {
          phase: 'Pending',
        },
      };

      const status = provider.parseStatus(raw);
      expect(status.phase).toBe('Pending');
      expect(status.replicas.ready).toBe(0);
    });

    test('parses failed deployment', () => {
      const raw = {
        metadata: { name: 'failed-deploy' },
        inference: {
          template: {
            spec: { containers: [{ image: 'test:latest' }] },
          },
        },
        status: {
          phase: 'Failed',
          conditions: [
            {
              type: 'Ready',
              status: 'False',
              reason: 'ImagePullError',
              message: 'Failed to pull image',
            },
          ],
        },
      };

      const status = provider.parseStatus(raw);
      expect(status.phase).toBe('Failed');
      expect(status.conditions).toHaveLength(1);
      expect(status.conditions[0].reason).toBe('ImagePullError');
    });

    test('handles missing status', () => {
      const raw = {
        metadata: { name: 'no-status' },
        resource: { count: 1 },
        inference: {
          template: {
            spec: { containers: [{ image: 'test:latest' }] },
          },
        },
      };

      const status = provider.parseStatus(raw);
      expect(status.phase).toBe('Pending');
      expect(status.replicas.ready).toBe(0);
      expect(status.replicas.desired).toBe(1);
    });

    test('maps various KAITO phases correctly', () => {
      const testCases = [
        { input: 'Running', expected: 'Running' },
        { input: 'Ready', expected: 'Running' },
        { input: 'Pending', expected: 'Pending' },
        { input: 'Waiting', expected: 'Pending' },
        { input: 'Creating', expected: 'Pending' },
        { input: 'Deploying', expected: 'Deploying' },
        { input: 'Provisioning', expected: 'Deploying' },
        { input: 'Failed', expected: 'Failed' },
        { input: 'Error', expected: 'Failed' },
        { input: 'Terminating', expected: 'Terminating' },
        { input: 'Deleting', expected: 'Terminating' },
      ];

      for (const { input, expected } of testCases) {
        const raw = {
          metadata: { name: 'test' },
          inference: { template: { spec: { containers: [{ image: 'test:latest' }] } } },
          status: { phase: input },
        };
        const status = provider.parseStatus(raw);
        expect(status.phase).toBe(expected);
      }
    });

    test('extracts model name from premade image', () => {
      const premadeModel = aikitService.getPremadeModel('llama3.2:3b');
      const raw = {
        metadata: {
          name: 'test',
          labels: { 'kubefoundry.io/model-source': 'premade' },
        },
        inference: {
          template: {
            spec: { containers: [{ image: premadeModel?.image }] },
          },
        },
        status: { phase: 'Running' },
      };

      const status = provider.parseStatus(raw);
      expect(status.modelId).toBe(premadeModel?.modelName);
    });
  });

  describe('validateConfig', () => {
    test('validates correct premade configuration', () => {
      const config = {
        name: 'valid-name',
        namespace: 'test-ns',
        provider: 'kaito',
        modelSource: 'premade',
        premadeModel: 'llama3.2:3b',
        computeType: 'cpu',
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('validates correct huggingface configuration', () => {
      const config = {
        name: 'valid-name',
        namespace: 'test-ns',
        provider: 'kaito',
        modelSource: 'huggingface',
        modelId: 'TheBloke/Llama-2-7B-Chat-GGUF',
        ggufFile: 'llama-2-7b-chat.Q4_K_M.gguf',
        computeType: 'cpu',
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('validates correct vllm configuration', () => {
      const config = {
        name: 'valid-name',
        namespace: 'test-ns',
        provider: 'kaito',
        modelSource: 'vllm',
        modelId: 'mistralai/Mistral-7B-v0.1',
        computeType: 'gpu',
        resources: { gpu: 2 },
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('validates vllm configuration with optional fields', () => {
      const config = {
        name: 'valid-name',
        namespace: 'test-ns',
        provider: 'kaito',
        modelSource: 'vllm',
        modelId: 'meta-llama/Llama-2-7b-hf',
        computeType: 'gpu',
        resources: { gpu: 4 },
        maxModelLen: 8192,
        hfTokenSecret: 'hf-secret',
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects invalid kubernetes name', () => {
      const config = {
        name: 'Invalid_Name',
        namespace: 'test-ns',
        provider: 'kaito',
        modelSource: 'premade',
        premadeModel: 'llama3.2:3b',
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    test('rejects unknown premade model', () => {
      const config = {
        name: 'valid-name',
        namespace: 'test-ns',
        provider: 'kaito',
        modelSource: 'premade',
        premadeModel: 'nonexistent-model',
        computeType: 'cpu',
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Unknown premade model'))).toBe(true);
    });

    test('rejects premade without premadeModel', () => {
      const config = {
        name: 'valid-name',
        namespace: 'test-ns',
        provider: 'kaito',
        modelSource: 'premade',
        computeType: 'cpu',
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(false);
    });
  });

  describe('getConfigSchema', () => {
    test('returns the kaito deployment config schema', () => {
      const schema = provider.getConfigSchema();
      expect(schema).toBeDefined();
      // Schema should be able to parse valid config
      const result = schema.safeParse({
        name: 'test',
        namespace: 'ns',
        provider: 'kaito',
        modelSource: 'premade',
        premadeModel: 'llama3.2:3b',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('installation', () => {
    test('getInstallationSteps returns steps', () => {
      const steps = provider.getInstallationSteps();
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[0].title).toBeDefined();
      expect(steps[0].command).toBeDefined();
    });

    test('installation steps include helm repo add', () => {
      const steps = provider.getInstallationSteps();
      const helmRepoStep = steps.find(s => s.command?.includes('helm repo add'));
      expect(helmRepoStep).toBeDefined();
      expect(helmRepoStep?.command).toContain('kaito');
    });

    test('getHelmRepos returns kaito repo', () => {
      const repos = provider.getHelmRepos();
      expect(repos.length).toBe(1);
      expect(repos[0].name).toBe('kaito');
      expect(repos[0].url).toContain('kaito-project.github.io');
    });

    test('getHelmCharts returns kaito-workspace chart', () => {
      const charts = provider.getHelmCharts();
      expect(charts.length).toBe(1);
      expect(charts[0].name).toBe('kaito-workspace');
      expect(charts[0].namespace).toBe('kaito-workspace');
      expect(charts[0].createNamespace).toBe(true);
    });
  });

  describe('metrics', () => {
    test('getMetricsConfig returns valid config for llama.cpp (default)', () => {
      const config = provider.getMetricsConfig();
      expect(config).not.toBeNull();
      expect(config!.endpointPath).toBe('/metrics');
      expect(config!.port).toBe(5000);
      expect(config!.serviceNamePattern).toContain('{name}');
    });

    test('getMetricsConfigForModelSource returns correct port for vllm', () => {
      const config = provider.getMetricsConfigForModelSource('vllm');
      expect(config).not.toBeNull();
      expect(config!.port).toBe(8000);
    });

    test('getMetricsConfigForModelSource returns correct port for huggingface', () => {
      const config = provider.getMetricsConfigForModelSource('huggingface');
      expect(config).not.toBeNull();
      expect(config!.port).toBe(5000);
    });

    test('getKeyMetrics returns metric definitions for both engines', () => {
      const metrics = provider.getKeyMetrics();
      expect(metrics.length).toBeGreaterThan(0);

      // Check for expected llama.cpp metrics
      const metricNames = metrics.map(m => m.name);
      expect(metricNames).toContain('llamacpp_requests_processing');
      expect(metricNames).toContain('llamacpp_kv_cache_usage_ratio');

      // Check for expected vLLM metrics
      expect(metricNames).toContain('vllm:num_requests_running');
      expect(metricNames).toContain('vllm:gpu_cache_usage_perc');
    });

    test('metrics have required fields', () => {
      const metrics = provider.getKeyMetrics();
      for (const metric of metrics) {
        expect(metric.name).toBeDefined();
        expect(metric.displayName).toBeDefined();
        expect(metric.type).toMatch(/gauge|counter|histogram/);
        expect(metric.category).toBeDefined();
      }
    });
  });
});

describe('provider registry integration', () => {
  test('kaito provider is registered', async () => {
    const { providerRegistry } = await import('../index');
    const kaitoProvider = providerRegistry.getProvider('kaito');
    expect(kaitoProvider).toBeDefined();
    expect(kaitoProvider?.id).toBe('kaito');
  });

  test('kaito appears in available providers list', async () => {
    const { providerRegistry } = await import('../index');
    const providers = providerRegistry.listProviders();
    const kaito = providers.find((p: { id: string }) => p.id === 'kaito');
    expect(kaito).toBeDefined();
  });
});
