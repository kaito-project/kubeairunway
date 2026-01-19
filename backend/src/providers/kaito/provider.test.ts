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
    test('returns Workspace CRD configuration by default', () => {
      const config = provider.getCRDConfig();
      expect(config.apiGroup).toBe('kaito.sh');
      expect(config.apiVersion).toBe('v1beta1');
      expect(config.plural).toBe('workspaces');
      expect(config.kind).toBe('Workspace');
    });

    test('returns InferenceSet CRD configuration for inferenceset resource type', () => {
      const config = provider.getCRDConfigForResourceType('inferenceset');
      expect(config.apiGroup).toBe('kaito.sh');
      expect(config.apiVersion).toBe('v1alpha1');
      expect(config.plural).toBe('inferencesets');
      expect(config.kind).toBe('InferenceSet');
    });

    test('returns Workspace CRD configuration for workspace resource type', () => {
      const config = provider.getCRDConfigForResourceType('workspace');
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

    // Workspace-specific configs
    const workspacePremadeConfig = {
      ...basePremadeConfig,
      kaitoResourceType: 'workspace' as const,
    };

    const workspaceVllmConfig = {
      ...baseVllmConfig,
      kaitoResourceType: 'workspace' as const,
    };

    // InferenceSet-specific configs
    const inferenceSetPremadeConfig = {
      ...basePremadeConfig,
      kaitoResourceType: 'inferenceset' as const,
    };

    const inferenceSetVllmConfig = {
      ...baseVllmConfig,
      kaitoResourceType: 'inferenceset' as const,
    };

    describe('Workspace manifests (default)', () => {
      test('generates valid Workspace manifest for premade model by default', () => {
        const manifest = provider.generateManifest(basePremadeConfig);

        expect(manifest.apiVersion).toBe('kaito.sh/v1beta1');
        expect(manifest.kind).toBe('Workspace');
        expect((manifest.metadata as any).name).toBe('test-deployment');
        expect((manifest.metadata as any).namespace).toBe('test-ns');
      });

      test('generates valid Workspace manifest with explicit workspace resource type', () => {
        const manifest = provider.generateManifest(workspacePremadeConfig);

        expect(manifest.apiVersion).toBe('kaito.sh/v1beta1');
        expect(manifest.kind).toBe('Workspace');
        expect((manifest.metadata as any).labels['kubefoundry.io/resource-type']).toBe('workspace');
      });

      test('Workspace manifest has resource at top level (not in spec)', () => {
        const config = {
          ...workspacePremadeConfig,
          computeType: 'gpu' as const,
          resources: { gpu: 1 },
        };
        const manifest = provider.generateManifest(config);

        // Workspace uses resource at TOP level
        expect((manifest as any).resource.count).toBe(1);
        // Should NOT be in spec
        expect((manifest.spec as any)?.resource).toBeUndefined();
      });

      test('Workspace manifest has inference at top level (not in spec)', () => {
        const manifest = provider.generateManifest(workspacePremadeConfig);

        // Workspace uses inference at TOP level
        expect((manifest as any).inference).toBeDefined();
        expect((manifest as any).inference.template).toBeDefined();
        // Should NOT be in spec.template
        expect((manifest.spec as any)?.template).toBeUndefined();
      });

      test('Workspace vLLM manifest has correct structure', () => {
        const manifest = provider.generateManifest(workspaceVllmConfig);

        expect(manifest.apiVersion).toBe('kaito.sh/v1beta1');
        expect(manifest.kind).toBe('Workspace');
        expect((manifest as any).resource.count).toBe(1);  // Workspace uses resource.count

        const container = (manifest as any).inference.template.spec.containers[0];
        expect(container.image).toBe('mcr.microsoft.com/aks/kaito/kaito-base:0.1.1');
        expect(container.args).toContain('mistralai/Mistral-7B-v0.1');
      });

      test('Workspace manifest includes instanceType when provided', () => {
        const config = {
          ...workspacePremadeConfig,
          computeType: 'gpu' as const,
          resources: { gpu: 1 },
          instanceType: 'Standard_NC6s_v3',
        };
        const manifest = provider.generateManifest(config);

        expect((manifest as any).resource.instanceType).toBe('Standard_NC6s_v3');
      });
    });

    describe('InferenceSet manifests', () => {
      test('generates valid InferenceSet manifest for premade model', () => {
        const manifest = provider.generateManifest(inferenceSetPremadeConfig);

        expect(manifest.apiVersion).toBe('kaito.sh/v1alpha1');
        expect(manifest.kind).toBe('InferenceSet');
        expect((manifest.metadata as any).name).toBe('test-deployment');
        expect((manifest.metadata as any).namespace).toBe('test-ns');
        expect((manifest.metadata as any).labels['kubefoundry.io/resource-type']).toBe('inferenceset');
      });

      test('generates valid InferenceSet manifest for HuggingFace model', () => {
        const manifest = provider.generateManifest({ ...baseHuggingFaceConfig, kaitoResourceType: 'inferenceset' as const });

        expect(manifest.apiVersion).toBe('kaito.sh/v1alpha1');
        expect(manifest.kind).toBe('InferenceSet');
        expect((manifest.metadata as any).name).toBe('hf-deployment');
      });

      test('generates valid InferenceSet manifest for vLLM model', () => {
        const manifest = provider.generateManifest(inferenceSetVllmConfig);

        expect(manifest.apiVersion).toBe('kaito.sh/v1alpha1');
        expect(manifest.kind).toBe('InferenceSet');
        expect((manifest.metadata as any).name).toBe('vllm-deployment');
        expect((manifest.metadata as any).labels['kubefoundry.io/model-source']).toBe('vllm');
        expect((manifest.metadata as any).labels['kubefoundry.io/compute-type']).toBe('gpu');
      });

      test('InferenceSet has spec.replicas', () => {
        const manifest = provider.generateManifest({ ...inferenceSetPremadeConfig, replicas: 3 });
        expect((manifest.spec as any).replicas).toBe(3);
      });

      test('InferenceSet has spec.template.inference structure', () => {
        const manifest = provider.generateManifest(inferenceSetPremadeConfig);
        expect((manifest.spec as any).template.inference.template.spec.containers).toHaveLength(1);
      });

      test('InferenceSet has labelSelector', () => {
        const manifest = provider.generateManifest(inferenceSetPremadeConfig);
        expect((manifest.spec as any).labelSelector.matchLabels).toBeDefined();
      });
    });

    // Keep existing general tests but update to be more explicit
    test('vLLM manifest uses kaito-base image', () => {
      const manifest = provider.generateManifest(inferenceSetVllmConfig);
      const container = (manifest.spec as any).template.inference.template.spec.containers[0];
      expect(container.image).toBe('mcr.microsoft.com/aks/kaito/kaito-base:0.1.1');
    });

    test('vLLM manifest has correct command and args', () => {
      const manifest = provider.generateManifest(inferenceSetVllmConfig);
      const container = (manifest.spec as any).template.inference.template.spec.containers[0];
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
      const manifest = provider.generateManifest(inferenceSetVllmConfig);
      const container = (manifest.spec as any).template.inference.template.spec.containers[0];
      expect(container.ports[0].containerPort).toBe(8000);
    });

    test('vLLM manifest includes GPU resources', () => {
      const manifest = provider.generateManifest(inferenceSetVllmConfig);
      const container = (manifest.spec as any).template.inference.template.spec.containers[0];
      expect(container.resources.requests['nvidia.com/gpu']).toBe(2);
      expect(container.resources.limits['nvidia.com/gpu']).toBe(2);
    });

    test('vLLM manifest includes shared memory volume', () => {
      const manifest = provider.generateManifest(inferenceSetVllmConfig);
      const templateSpec = (manifest.spec as any).template.inference.template.spec;
      expect(templateSpec.volumes).toHaveLength(1);
      expect(templateSpec.volumes[0].name).toBe('dshm');
      expect(templateSpec.volumes[0].emptyDir.medium).toBe('Memory');
      const container = templateSpec.containers[0];
      expect(container.volumeMounts).toHaveLength(1);
      expect(container.volumeMounts[0].mountPath).toBe('/dev/shm');
    });

    test('vLLM manifest includes maxModelLen when provided', () => {
      const configWithMaxLen = { ...inferenceSetVllmConfig, maxModelLen: 4096 };
      const manifest = provider.generateManifest(configWithMaxLen);
      const container = (manifest.spec as any).template.inference.template.spec.containers[0];
      expect(container.args).toContain('--max-model-len');
      expect(container.args).toContain('4096');
    });

    test('vLLM manifest includes HF_TOKEN env when hfTokenSecret provided', () => {
      const configWithToken = { ...inferenceSetVllmConfig, hfTokenSecret: 'my-hf-secret' };
      const manifest = provider.generateManifest(configWithToken);
      const container = (manifest.spec as any).template.inference.template.spec.containers[0];
      expect(container.env).toHaveLength(1);
      expect(container.env[0].name).toBe('HF_TOKEN');
      expect(container.env[0].valueFrom.secretKeyRef.name).toBe('my-hf-secret');
      expect(container.env[0].valueFrom.secretKeyRef.key).toBe('HF_TOKEN');
    });

    test('vLLM manifest includes probes', () => {
      const manifest = provider.generateManifest(inferenceSetVllmConfig);
      const container = (manifest.spec as any).template.inference.template.spec.containers[0];
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

    describe('InferenceSet-specific structure tests', () => {
      test('InferenceSet includes spec with replica count', () => {
        const manifest = provider.generateManifest({ ...inferenceSetPremadeConfig, replicas: 3 });
        expect((manifest.spec as any).replicas).toBe(3);
      });

      test('InferenceSet includes template with container', () => {
        const manifest = provider.generateManifest(inferenceSetPremadeConfig);
        const containers = (manifest.spec as any).template.inference.template.spec.containers;
        expect(containers).toHaveLength(1);
        expect(containers[0].name).toBe('model');
        expect(containers[0].image).toBeDefined();
        expect(containers[0].ports[0].containerPort).toBe(5000);
      });

      test('uses premade model image from AIKit', () => {
        const manifest = provider.generateManifest(inferenceSetPremadeConfig);
        const container = (manifest.spec as any).template.inference.template.spec.containers[0];
        const premadeModel = aikitService.getPremadeModel('llama3.2:3b');
        expect(container.image).toBe(premadeModel?.image);
      });

      test('uses imageRef for HuggingFace models', () => {
        const manifest = provider.generateManifest({ ...baseHuggingFaceConfig, kaitoResourceType: 'inferenceset' as const });
        const container = (manifest.spec as any).template.inference.template.spec.containers[0];
        expect(container.image).toBe(baseHuggingFaceConfig.imageRef);
      });

      test('includes labelSelector when provided', () => {
        const config = {
          ...inferenceSetPremadeConfig,
          labelSelector: {
            'kubernetes.io/arch': 'amd64',
            'node-type': 'ml',
          },
        };
        const manifest = provider.generateManifest(config);
        expect((manifest.spec as any).labelSelector.matchLabels['kubernetes.io/arch']).toBe('amd64');
        expect((manifest.spec as any).labelSelector.matchLabels['node-type']).toBe('ml');
      });

      test('CPU workload generates kubernetes.io/os: linux labelSelector by default', () => {
        const config = {
          ...inferenceSetPremadeConfig,
          computeType: 'cpu' as const,
        };
        const manifest = provider.generateManifest(config);
        expect((manifest.spec as any).labelSelector.matchLabels['kubernetes.io/os']).toBe('linux');
      });

      test('GPU workload generates nvidia.com/gpu.present: true labelSelector by default', () => {
        const config = {
          ...inferenceSetPremadeConfig,
          computeType: 'gpu' as const,
          resources: { gpu: 1 },
        };
        const manifest = provider.generateManifest(config);
        expect((manifest.spec as any).labelSelector.matchLabels['nvidia.com/gpu.present']).toBe('true');
      });

      test('vLLM workload always generates nvidia.com/gpu.present: true labelSelector', () => {
        const manifest = provider.generateManifest(inferenceSetVllmConfig);
        expect((manifest.spec as any).labelSelector.matchLabels['nvidia.com/gpu.present']).toBe('true');
      });

      test('user-provided labelSelector overrides default GPU/CPU labels', () => {
        const config = {
          ...inferenceSetPremadeConfig,
          computeType: 'gpu' as const,
          resources: { gpu: 1 },
          labelSelector: {
            'custom-label': 'custom-value',
          },
        };
        const manifest = provider.generateManifest(config);
        // Should use custom label, not nvidia.com/gpu.present
        expect((manifest.spec as any).labelSelector.matchLabels['custom-label']).toBe('custom-value');
        expect((manifest.spec as any).labelSelector.matchLabels['nvidia.com/gpu.present']).toBeUndefined();
      });

      test('includes resource requests when specified', () => {
        const config = {
          ...inferenceSetPremadeConfig,
          resources: {
            memory: '16Gi',
            cpu: '8',
          },
        };
        const manifest = provider.generateManifest(config);
        const resources = (manifest.spec as any).template.inference.template.spec.containers[0].resources;
        expect(resources.requests.memory).toBe('16Gi');
        expect(resources.requests.cpu).toBe('8');
      });

      test('includes GPU resources for gpu computeType', () => {
        const config = {
          ...inferenceSetPremadeConfig,
          computeType: 'gpu' as const,
          resources: {
            gpu: 2,
            memory: '32Gi',
          },
        };
        const manifest = provider.generateManifest(config);
        const resources = (manifest.spec as any).template.inference.template.spec.containers[0].resources;
        expect(resources.limits['nvidia.com/gpu']).toBe(2);
        expect(resources.requests.memory).toBe('32Gi');
      });

      test('includes container args for model server', () => {
        const manifest = provider.generateManifest(inferenceSetPremadeConfig);
        const container = (manifest.spec as any).template.inference.template.spec.containers[0];
        expect(container.args).toContain('run');
        expect(container.args.some((arg: string) => arg.includes('5000'))).toBe(true);
      });
    });
  });

  describe('parseStatus', () => {
    describe('Workspace status parsing', () => {
      test('parses basic Workspace deployment status', () => {
        const raw = {
          kind: 'Workspace',
          metadata: {
            name: 'ws-deployment',
            namespace: 'test-ns',
            creationTimestamp: '2024-01-01T00:00:00Z',
            labels: {
              'kubefoundry.io/compute-type': 'cpu',
              'kubefoundry.io/model-source': 'premade',
              'kubefoundry.io/resource-type': 'workspace',
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
            workerNodes: ['node1', 'node2'],
            conditions: [
              { type: 'ResourceReady', status: 'True' },
              { type: 'InferenceReady', status: 'True' },
              { type: 'WorkspaceSucceeded', status: 'True' },
            ],
          },
        };

        const status = provider.parseStatus(raw);

        expect(status.name).toBe('ws-deployment');
        expect(status.namespace).toBe('test-ns');
        expect(status.provider).toBe('kaito');
        expect(status.phase).toBe('Running');
        expect(status.replicas.desired).toBe(2);
        expect(status.replicas.ready).toBe(2);  // Based on workerNodes length
        expect(status.engine).toBe('llamacpp');
        expect(status.frontendService).toBe('ws-deployment:80');
      });

      test('parses pending Workspace deployment', () => {
        const raw = {
          kind: 'Workspace',
          metadata: {
            name: 'pending-ws',
            namespace: 'test-ns',
            labels: { 'kubefoundry.io/resource-type': 'workspace' },
          },
          resource: { count: 1 },
          inference: {
            template: { spec: { containers: [{ image: 'test:latest' }] } },
          },
          status: {
            workerNodes: [],
            conditions: [
              { type: 'WorkspaceReady', status: 'False' },
            ],
          },
        };

        const status = provider.parseStatus(raw);
        expect(status.phase).toBe('Pending');
        expect(status.replicas.ready).toBe(0);
      });

      test('parses Workspace vLLM deployment', () => {
        const raw = {
          kind: 'Workspace',
          metadata: {
            name: 'ws-vllm',
            namespace: 'test-ns',
            labels: {
              'kubefoundry.io/model-source': 'vllm',
              'kubefoundry.io/resource-type': 'workspace',
            },
          },
          resource: { count: 1, instanceType: 'Standard_NC6s_v3' },
          inference: {
            template: {
              spec: {
                containers: [{
                  image: 'mcr.microsoft.com/aks/kaito/kaito-base:0.1.1',
                  command: ['python'],
                  args: ['-m', 'vllm.entrypoints.openai.api_server', '--model', 'meta-llama/Llama-3-8B'],
                }],
              },
            },
          },
          status: {
            workerNodes: ['node1'],
            conditions: [{ type: 'WorkspaceReady', status: 'True' }],
          },
        };

        const status = provider.parseStatus(raw);
        expect(status.engine).toBe('vllm');
        expect(status.modelId).toBe('meta-llama/Llama-3-8B');
        expect(status.frontendService).toBe('ws-vllm-vllm:8000');
      });
    });

    describe('InferenceSet status parsing', () => {
      test('parses basic InferenceSet deployment status', () => {
        const raw = {
          kind: 'InferenceSet',
          metadata: {
            name: 'test-deployment',
            namespace: 'test-ns',
            creationTimestamp: '2024-01-01T00:00:00Z',
            labels: {
              'kubefoundry.io/compute-type': 'cpu',
              'kubefoundry.io/model-source': 'premade',
              'kubefoundry.io/resource-type': 'inferenceset',
            },
          },
          spec: {
            replicas: 2,
            template: {
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
            },
          },
          status: {
            readyReplicas: 2,
            conditions: [
              { type: 'Ready', status: 'True' },
            ],
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
        expect(status.frontendService).toBe('test-deployment:80');
      });

      test('parses vLLM InferenceSet deployment status', () => {
        const raw = {
          kind: 'InferenceSet',
          metadata: {
            name: 'vllm-deployment',
            namespace: 'test-ns',
            creationTimestamp: '2024-01-01T00:00:00Z',
            labels: {
              'kubefoundry.io/compute-type': 'gpu',
              'kubefoundry.io/model-source': 'vllm',
              'kubefoundry.io/resource-type': 'inferenceset',
            },
          },
          spec: {
            replicas: 1,
            template: {
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
            },
          },
          status: {
            readyReplicas: 1,
            conditions: [
              { type: 'Ready', status: 'True' },
            ],
          },
        };

        const status = provider.parseStatus(raw);

        expect(status.name).toBe('vllm-deployment');
        expect(status.engine).toBe('vllm');
        expect(status.modelId).toBe('mistralai/Mistral-7B-v0.1');
        expect(status.frontendService).toBe('vllm-deployment-vllm:8000');
      });

      test('parses pending InferenceSet deployment', () => {
        const raw = {
          kind: 'InferenceSet',
          metadata: { name: 'pending-deploy', namespace: 'test-ns' },
          spec: {
            replicas: 1,
            template: {
              inference: {
                template: {
                  spec: { containers: [{ image: 'test:latest' }] },
                },
              },
            },
          },
          status: {
            readyReplicas: 0,
          },
        };

        const status = provider.parseStatus(raw);
        expect(status.phase).toBe('Pending');
        expect(status.replicas.ready).toBe(0);
      });

      test('parses failed InferenceSet deployment', () => {
        const raw = {
          kind: 'InferenceSet',
          metadata: { name: 'failed-deploy' },
          spec: {
            template: {
              inference: {
                template: {
                  spec: { containers: [{ image: 'test:latest' }] },
                },
              },
            },
          },
          status: {
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
        expect(status.phase).toBe('Pending');
        expect(status.conditions).toHaveLength(1);
        expect(status.conditions[0].reason).toBe('ImagePullError');
      });

      test('handles missing status', () => {
        const raw = {
          kind: 'InferenceSet',
          metadata: { name: 'no-status' },
          spec: {
            replicas: 1,
            template: {
              inference: {
                template: {
                  spec: { containers: [{ image: 'test:latest' }] },
                },
              },
            },
          },
        };

        const status = provider.parseStatus(raw);
        expect(status.phase).toBe('Pending');
        expect(status.replicas.ready).toBe(0);
        expect(status.replicas.desired).toBe(1);
      });

      test('determines phase from Ready condition', () => {
        // Ready=True means Running
        const runningRaw = {
          kind: 'InferenceSet',
          metadata: { name: 'test' },
          spec: { template: { inference: { template: { spec: { containers: [{ image: 'test:latest' }] } } } } },
          status: {
            readyReplicas: 1,
            conditions: [{ type: 'Ready', status: 'True' }],
          },
        };
        expect(provider.parseStatus(runningRaw).phase).toBe('Running');

        // No Ready condition or Ready=False means Pending
        const pendingRaw = {
          kind: 'InferenceSet',
          metadata: { name: 'test' },
          spec: { template: { inference: { template: { spec: { containers: [{ image: 'test:latest' }] } } } } },
          status: { readyReplicas: 0 },
        };
        expect(provider.parseStatus(pendingRaw).phase).toBe('Pending');
      });
    });

    test('extracts model name from premade image', () => {
      const premadeModel = aikitService.getPremadeModel('llama3.2:3b');
      const raw = {
        kind: 'InferenceSet',
        metadata: {
          name: 'test',
          labels: { 'kubefoundry.io/model-source': 'premade' },
        },
        spec: {
          template: {
            inference: {
              template: {
                spec: { containers: [{ image: premadeModel?.image }] },
              },
            },
          },
        },
        status: {
          readyReplicas: 1,
          conditions: [{ type: 'Ready', status: 'True' }],
        },
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

    test('installation command includes version 0.8.0', () => {
      const steps = provider.getInstallationSteps();
      const installStep = steps.find(s => s.command?.includes('helm upgrade --install'));
      expect(installStep).toBeDefined();
      expect(installStep?.command).toContain('--version 0.8.0');
    });

    test('installation command includes disableNodeAutoProvisioning flag', () => {
      const steps = provider.getInstallationSteps();
      const installStep = steps.find(s => s.command?.includes('helm upgrade --install'));
      expect(installStep).toBeDefined();
      expect(installStep?.command).toContain('--set featureGates.disableNodeAutoProvisioning=true');
    });

    test('installation command disables gpu-feature-discovery and local-csi-driver', () => {
      const steps = provider.getInstallationSteps();
      const installStep = steps.find(s => s.command?.includes('helm upgrade --install'));
      expect(installStep).toBeDefined();
      expect(installStep?.command).toContain('--set gpu-feature-discovery.enabled=false');
      expect(installStep?.command).toContain('--set localCSIDriver.useLocalCSIDriver=false');
      expect(installStep?.command).toContain('--skip-crds');
    });

    test('installation steps include kubectl apply for KAITO CRDs', () => {
      const steps = provider.getInstallationSteps();
      const crdSteps = steps.filter(s => s.command?.includes('kubectl apply'));
      expect(crdSteps.length).toBe(2); // Karpenter CRDs and KAITO CRDs

      // Karpenter CRDs (required by KAITO even with disableNodeAutoProvisioning)
      const karpenterCrdStep = crdSteps.find(s => s.command?.includes('karpenter.sh_nodeclaims.yaml'));
      expect(karpenterCrdStep).toBeDefined();
      expect(karpenterCrdStep?.command).toContain('karpenter.sh_nodepools.yaml');

      // KAITO CRDs
      const kaitoCrdStep = crdSteps.find(s => s.command?.includes('kaito.sh_workspaces.yaml'));
      expect(kaitoCrdStep).toBeDefined();
      expect(kaitoCrdStep?.command).toContain('kaito.sh_inferencesets.yaml');
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

    test('getHelmCharts includes version 0.8.0', () => {
      const charts = provider.getHelmCharts();
      expect(charts[0].version).toBe('0.8.0');
    });

    test('getHelmCharts includes disableNodeAutoProvisioning in values', () => {
      const charts = provider.getHelmCharts();
      expect(charts[0].values).toBeDefined();
      expect(charts[0].values?.featureGates).toBeDefined();
      expect((charts[0].values?.featureGates as Record<string, unknown>)?.disableNodeAutoProvisioning).toBe(true);
    });

    test('getHelmCharts disables gpu-feature-discovery and local-csi-driver', () => {
      const charts = provider.getHelmCharts();
      expect(charts[0].values).toBeDefined();
      // GPU Feature Discovery disabled entirely
      expect(charts[0].values?.['gpu-feature-discovery']).toBeDefined();
      const gfdConfig = charts[0].values?.['gpu-feature-discovery'] as Record<string, unknown>;
      expect(gfdConfig?.enabled).toBe(false);
      // Local CSI Driver disabled
      expect(charts[0].values?.localCSIDriver).toBeDefined();
      const csiConfig = charts[0].values?.localCSIDriver as Record<string, unknown>;
      expect(csiConfig?.useLocalCSIDriver).toBe(false);
    });

    test('getHelmCharts uses skipCrds and preCrdUrls to avoid NFD and Karpenter conflicts', () => {
      const charts = provider.getHelmCharts();
      expect(charts[0].skipCrds).toBe(true);
      expect(charts[0].preCrdUrls).toBeDefined();
      expect(charts[0].preCrdUrls?.length).toBe(4);
      // Karpenter CRDs first (required by KAITO even with disableNodeAutoProvisioning)
      expect(charts[0].preCrdUrls?.[0]).toContain('karpenter.sh_nodeclaims.yaml');
      expect(charts[0].preCrdUrls?.[1]).toContain('karpenter.sh_nodepools.yaml');
      // KAITO CRDs
      expect(charts[0].preCrdUrls?.[2]).toContain('kaito.sh_workspaces.yaml');
      expect(charts[0].preCrdUrls?.[3]).toContain('kaito.sh_inferencesets.yaml');
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
