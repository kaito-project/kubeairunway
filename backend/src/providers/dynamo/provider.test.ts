import { describe, test, expect } from 'bun:test';
import { DynamoProvider } from './index';
import type { DeploymentConfig } from '@kubefoundry/shared';

const provider = new DynamoProvider();

describe('DynamoProvider', () => {
  describe('provider info', () => {
    test('has correct id and name', () => {
      expect(provider.id).toBe('dynamo');
      expect(provider.name).toBe('NVIDIA Dynamo');
    });

    test('has default namespace', () => {
      expect(provider.defaultNamespace).toBe('dynamo-system');
    });
  });

  describe('getCRDConfig', () => {
    test('returns correct CRD configuration', () => {
      const config = provider.getCRDConfig();
      expect(config.apiGroup).toBe('nvidia.com');
      expect(config.apiVersion).toBe('v1alpha1');
      expect(config.plural).toBe('dynamographdeployments');
      expect(config.kind).toBe('DynamoGraphDeployment');
    });
  });

  describe('generateManifest', () => {
    const baseConfig: DeploymentConfig = {
      name: 'test-deployment',
      namespace: 'test-ns',
      modelId: 'meta-llama/Llama-3.2-1B',
      engine: 'vllm',
      mode: 'aggregated',
      routerMode: 'none',
      replicas: 1,
      hfTokenSecret: 'hf-token',
      enforceEager: true,
      enablePrefixCaching: false,
      trustRemoteCode: false,
    };

    test('generates valid aggregated manifest', () => {
      const manifest = provider.generateManifest(baseConfig);

      expect(manifest.apiVersion).toBe('nvidia.com/v1alpha1');
      expect(manifest.kind).toBe('DynamoGraphDeployment');
      expect((manifest.metadata as any).name).toBe('test-deployment');
      expect((manifest.metadata as any).namespace).toBe('test-ns');
    });

    test('includes VllmWorker in spec.services for vllm engine', () => {
      const manifest = provider.generateManifest(baseConfig);
      const services = (manifest.spec as any).services;
      expect(services.VllmWorker).toBeDefined();
      expect(services.VllmWorker.componentType).toBe('worker');
      expect(services.VllmWorker.dynamoNamespace).toBe('test-deployment');
      expect(services.VllmWorker.extraPodSpec.mainContainer.image).toMatch(/nvcr\.io\/nvidia\/ai-dynamo\/vllm-runtime:/);
    });

    test('includes SglangWorker in spec.services for sglang engine', () => {
      const manifest = provider.generateManifest({ ...baseConfig, engine: 'sglang' });
      const services = (manifest.spec as any).services;
      expect(services.SglangWorker).toBeDefined();
      expect(services.SglangWorker.componentType).toBe('worker');
      expect(services.SglangWorker.extraPodSpec.mainContainer.image).toMatch(/nvcr\.io\/nvidia\/ai-dynamo\/sglang-runtime:/);
    });

    test('includes TrtllmWorker in spec.services for trtllm engine', () => {
      const manifest = provider.generateManifest({ ...baseConfig, engine: 'trtllm' });
      const services = (manifest.spec as any).services;
      expect(services.TrtllmWorker).toBeDefined();
      expect(services.TrtllmWorker.componentType).toBe('worker');
      expect(services.TrtllmWorker.extraPodSpec.mainContainer.image).toMatch(/nvcr\.io\/nvidia\/ai-dynamo\/tensorrtllm-runtime:/);
    });

    test('includes Frontend in spec.services', () => {
      const manifest = provider.generateManifest(baseConfig);
      const services = (manifest.spec as any).services;
      expect(services.Frontend).toBeDefined();
      expect(services.Frontend.componentType).toBe('frontend');
      expect(services.Frontend.dynamoNamespace).toBe('test-deployment');
      expect(services.Frontend.replicas).toBe(1);
    });

    test('includes backendFramework in spec', () => {
      const manifest = provider.generateManifest(baseConfig);
      expect((manifest.spec as any).backendFramework).toBe('vllm');
    });

    test('includes kubefoundry labels including provider label', () => {
      const manifest = provider.generateManifest(baseConfig);
      const labels = (manifest.metadata as any).labels;
      expect(labels['app.kubernetes.io/name']).toBe('kubefoundry');
      expect(labels['app.kubernetes.io/instance']).toBe('test-deployment');
      expect(labels['app.kubernetes.io/managed-by']).toBe('kubefoundry');
      expect(labels['kubefoundry.io/provider']).toBe('dynamo');
    });

    test('includes hfTokenSecret as envFromSecret', () => {
      const manifest = provider.generateManifest(baseConfig);
      const services = (manifest.spec as any).services;
      expect(services.VllmWorker.envFromSecret).toBe('hf-token');
    });

    test('generates disaggregated manifest with separate workers in spec.services', () => {
      const config = {
        ...baseConfig,
        mode: 'disaggregated' as const,
        prefillReplicas: 2,
        decodeReplicas: 3,
        prefillGpus: 2,
        decodeGpus: 1,
      };

      const manifest = provider.generateManifest(config);
      const services = (manifest.spec as any).services;

      expect(services.VllmPrefillWorker).toBeDefined();
      expect(services.VllmDecodeWorker).toBeDefined();
      expect(services.VllmPrefillWorker.replicas).toBe(2);
      expect(services.VllmDecodeWorker.replicas).toBe(3);
      expect(services.VllmPrefillWorker.subComponentType).toBe('prefill');
      expect(services.VllmDecodeWorker.subComponentType).toBe('decode');
      expect(services.VllmPrefillWorker.extraPodSpec.mainContainer.image).toMatch(/nvcr\.io\/nvidia\/ai-dynamo\/vllm-runtime:/);
      expect(services.VllmDecodeWorker.extraPodSpec.mainContainer.image).toMatch(/nvcr\.io\/nvidia\/ai-dynamo\/vllm-runtime:/);
    });

    test('disaggregated mode sets router-mode to round-robin by default', () => {
      const config = {
        ...baseConfig,
        mode: 'disaggregated' as const,
      };

      const manifest = provider.generateManifest(config);
      const services = (manifest.spec as any).services;
      expect(services.Frontend['router-mode']).toBe('round-robin');
    });

    test('worker includes model in extraPodSpec.mainContainer.args', () => {
      const manifest = provider.generateManifest({
        ...baseConfig,
        contextLength: 8192,
      });
      const services = (manifest.spec as any).services;
      const args = services.VllmWorker.extraPodSpec.mainContainer.args[0];
      expect(args).toContain('--model meta-llama/Llama-3.2-1B');
      expect(args).toContain('--max-model-len 8192');
    });

    test('sets GPU resources when specified', () => {
      const manifest = provider.generateManifest({
        ...baseConfig,
        resources: { gpu: 2, memory: '16Gi' },
      });
      const services = (manifest.spec as any).services;
      const resources = services.VllmWorker.resources;
      expect(resources.limits['nvidia.com/gpu']).toBe('2');
      expect(resources.limits.memory).toBe('16Gi');
    });
  });

  describe('parseStatus', () => {
    test('parses basic deployment status from spec.services format', () => {
      const raw = {
        metadata: {
          name: 'test-deployment',
          namespace: 'test-ns',
          creationTimestamp: '2024-01-01T00:00:00Z',
        },
        spec: {
          backendFramework: 'vllm',
          services: {
            VllmWorker: {
              componentType: 'worker',
              dynamoNamespace: 'test-deployment',
              replicas: 2,
              extraPodSpec: {
                mainContainer: {
                  args: ['python3 -m dynamo.vllm --model meta-llama/Llama-3.2-1B --served-model-name llama'],
                },
              },
            },
            Frontend: { componentType: 'frontend', replicas: 1 },
          },
        },
        status: {
          state: 'successful',
          replicas: { desired: 2, ready: 2, available: 2 },
          conditions: [{ type: 'Ready', status: 'True' }],
        },
      };

      const status = provider.parseStatus(raw);

      expect(status.name).toBe('test-deployment');
      expect(status.namespace).toBe('test-ns');
      expect(status.modelId).toBe('meta-llama/Llama-3.2-1B');
      expect(status.engine).toBe('vllm');
      expect(status.mode).toBe('aggregated');
      expect(status.phase).toBe('Running');
      expect(status.replicas.desired).toBe(2);
      expect(status.replicas.ready).toBe(2);
      expect(status.frontendService).toBe('test-deployment-frontend');
    });

    test('parses sglang deployment', () => {
      const raw = {
        metadata: { name: 'sglang-deploy' },
        spec: {
          backendFramework: 'sglang',
          services: {
            SglangWorker: {
              componentType: 'worker',
              replicas: 1,
              extraPodSpec: {
                mainContainer: {
                  args: ['python3 -m dynamo.sglang --model test/model'],
                },
              },
            },
          },
        },
        status: { phase: 'Pending' },
      };

      const status = provider.parseStatus(raw);
      expect(status.engine).toBe('sglang');
      expect(status.phase).toBe('Pending');
    });

    test('parses disaggregated deployment from spec.services', () => {
      const raw = {
        metadata: { name: 'pd-deploy' },
        spec: {
          backendFramework: 'vllm',
          services: {
            VllmPrefillWorker: {
              componentType: 'worker',
              subComponentType: 'prefill',
              replicas: 2,
              extraPodSpec: {
                mainContainer: {
                  args: ['python3 -m dynamo.vllm --model test/model --is-prefill-worker'],
                },
              },
            },
            VllmDecodeWorker: {
              componentType: 'worker',
              subComponentType: 'decode',
              replicas: 3,
              extraPodSpec: {
                mainContainer: {
                  args: ['python3 -m dynamo.vllm --model test/model'],
                },
              },
            },
            Frontend: { componentType: 'frontend', replicas: 1 },
          },
        },
        status: {
          state: 'successful',
          prefillReplicas: { desired: 2, ready: 2 },
          decodeReplicas: { desired: 3, ready: 3 },
        },
      };

      const status = provider.parseStatus(raw);
      expect(status.mode).toBe('disaggregated');
      expect(status.prefillReplicas?.desired).toBe(2);
      expect(status.decodeReplicas?.desired).toBe(3);
      expect(status.replicas.desired).toBe(5); // 2 + 3
    });

    test('handles missing status', () => {
      const raw = {
        metadata: { name: 'pending' },
        spec: {
          backendFramework: 'vllm',
          services: {
            VllmWorker: {
              componentType: 'worker',
              extraPodSpec: {
                mainContainer: {
                  args: ['python3 -m dynamo.vllm --model test/model'],
                },
              },
            },
          },
        },
      };

      const status = provider.parseStatus(raw);
      expect(status.phase).toBe('Pending');
      expect(status.replicas.ready).toBe(0);
    });

    test('supports legacy format for backward compatibility', () => {
      const raw = {
        metadata: { name: 'legacy-deploy', namespace: 'default' },
        spec: {
          VllmWorker: {
            replicas: 1,
          },
          Frontend: { replicas: 1 },
        },
        status: { phase: 'Running' },
      };

      const status = provider.parseStatus(raw);
      expect(status.name).toBe('legacy-deploy');
      expect(status.engine).toBe('vllm');
      expect(status.mode).toBe('aggregated');
    });
  });

  describe('validateConfig', () => {
    test('validates correct configuration', () => {
      const config = {
        name: 'valid-name',
        namespace: 'test-ns',
        modelId: 'test/model',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'secret',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test('rejects invalid kubernetes name', () => {
      const config = {
        name: 'Invalid_Name',
        namespace: 'test-ns',
        modelId: 'test/model',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'secret',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
      };

      const result = provider.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('installation', () => {
    test('getInstallationSteps returns steps', () => {
      const steps = provider.getInstallationSteps();
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[0].title).toBeDefined();
      expect(steps[0].command).toBeDefined();
    });

    test('getHelmRepos returns empty array (uses direct fetch URLs)', () => {
      const repos = provider.getHelmRepos();
      expect(repos.length).toBe(0);
    });

    test('getHelmCharts returns dynamo-crds and dynamo-platform charts', () => {
      const charts = provider.getHelmCharts();
      expect(charts.length).toBe(2);
      expect(charts[0].name).toBe('dynamo-crds');
      expect(charts[0].namespace).toBe('default');
      expect(charts[0].fetchUrl).toContain('dynamo-crds');
      expect(charts[1].name).toBe('dynamo-platform');
      expect(charts[1].namespace).toBe('dynamo-system');
      expect(charts[1].fetchUrl).toContain('dynamo-platform');
    });
  });

  describe('metrics', () => {
    test('getMetricsConfig returns valid config', () => {
      const config = provider.getMetricsConfig();
      expect(config).not.toBeNull();
      expect(config!.endpointPath).toBe('/metrics');
      expect(config!.port).toBe(8000);
      expect(config!.serviceNamePattern).toContain('{name}');
    });

    test('getKeyMetrics returns metric definitions', () => {
      const metrics = provider.getKeyMetrics();
      expect(metrics.length).toBeGreaterThan(0);

      // Check for expected metrics
      const metricNames = metrics.map(m => m.name);
      expect(metricNames).toContain('vllm:num_requests_running');
      expect(metricNames).toContain('vllm:gpu_cache_usage_perc');
      expect(metricNames).toContain('vllm:e2e_request_latency_seconds');
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

  describe('GAIE (Gateway API Inference Extension) support', () => {
    test('supportsGAIE returns true', () => {
      expect(provider.supportsGAIE()).toBe(true);
    });

    test('generateHTTPRoute creates valid HTTPRoute manifest', () => {
      const config: DeploymentConfig = {
        name: 'test-deployment',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);

      expect(httpRoute.apiVersion).toBe('gateway.networking.k8s.io/v1');
      expect(httpRoute.kind).toBe('HTTPRoute');
      expect((httpRoute.metadata as any).name).toBe('test-deployment-route');
      expect((httpRoute.metadata as any).namespace).toBe('test-ns');
    });

    test('HTTPRoute uses model name from config', () => {
      const config: DeploymentConfig = {
        name: 'test-deployment',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);
      const rules = (httpRoute.spec as any).rules;
      const headerMatch = rules[0].matches[0].headers[0];

      expect(headerMatch.name).toBe('X-Gateway-Model-Name');
      expect(headerMatch.value).toBe('meta-llama/Llama-3.2-1B');
      expect(headerMatch.type).toBe('Exact');
    });

    test('HTTPRoute uses servedModelName when provided', () => {
      const config: DeploymentConfig = {
        name: 'test-deployment',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        servedModelName: 'llama-1b',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);
      const rules = (httpRoute.spec as any).rules;
      const headerMatch = rules[0].matches[0].headers[0];

      expect(headerMatch.value).toBe('llama-1b');
    });

    test('HTTPRoute has correct backend reference', () => {
      const config: DeploymentConfig = {
        name: 'my-model',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);
      const backendRefs = (httpRoute.spec as any).rules[0].backendRefs;

      expect(backendRefs).toHaveLength(1);
      expect(backendRefs[0].name).toBe('my-model');
      expect(backendRefs[0].port).toBe(8000);
    });

    test('HTTPRoute has kubefoundry labels', () => {
      const config: DeploymentConfig = {
        name: 'test-deployment',
        namespace: 'test-ns',
        modelId: 'meta-llama/Llama-3.2-1B',
        engine: 'vllm',
        mode: 'aggregated',
        routerMode: 'none',
        replicas: 1,
        hfTokenSecret: 'hf-token',
        enforceEager: true,
        enablePrefixCaching: false,
        trustRemoteCode: false,
        enableGatewayRouting: true,
      };

      const httpRoute = provider.generateHTTPRoute!(config);
      const labels = (httpRoute.metadata as any).labels;

      expect(labels['app.kubernetes.io/name']).toBe('kubefoundry');
      expect(labels['app.kubernetes.io/instance']).toBe('test-deployment');
      expect(labels['app.kubernetes.io/managed-by']).toBe('kubefoundry');
      expect(labels['kubefoundry.io/provider']).toBe('dynamo');
    });
  });
});
