import { describe, it, expect } from 'bun:test';
import { kaitoDeploymentConfigSchema, kaitoInferenceSetSchema } from './schema';

describe('kaitoDeploymentConfigSchema', () => {
  const validPremadeConfig = {
    name: 'my-deployment',
    namespace: 'kaito-workspace',
    provider: 'kaito',
    modelSource: 'premade',
    premadeModel: 'llama3.2:3b',
    computeType: 'cpu',
  };

  const validHuggingFaceConfig = {
    name: 'my-hf-deployment',
    namespace: 'kaito-workspace',
    provider: 'kaito',
    modelSource: 'huggingface',
    modelId: 'TheBloke/Llama-2-7B-Chat-GGUF',
    ggufFile: 'llama-2-7b-chat.Q4_K_M.gguf',
    computeType: 'cpu',
  };

  const validVllmConfig = {
    name: 'my-vllm-deployment',
    namespace: 'kaito-workspace',
    provider: 'kaito',
    modelSource: 'vllm',
    modelId: 'mistralai/Mistral-7B-v0.1',
    computeType: 'gpu',
    resources: {
      gpu: 1,
    },
  };

  describe('valid configurations', () => {
    it('accepts minimal premade configuration', () => {
      const result = kaitoDeploymentConfigSchema.safeParse(validPremadeConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('my-deployment');
        expect(result.data.namespace).toBe('kaito-workspace');
        expect(result.data.modelSource).toBe('premade');
        expect(result.data.premadeModel).toBe('llama3.2:3b');
        // Check defaults
        expect(result.data.computeType).toBe('cpu');
        expect(result.data.replicas).toBe(1);
      }
    });

    it('accepts minimal HuggingFace configuration', () => {
      const result = kaitoDeploymentConfigSchema.safeParse(validHuggingFaceConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('my-hf-deployment');
        expect(result.data.modelSource).toBe('huggingface');
        expect(result.data.modelId).toBe('TheBloke/Llama-2-7B-Chat-GGUF');
        expect(result.data.ggufFile).toBe('llama-2-7b-chat.Q4_K_M.gguf');
      }
    });

    it('accepts minimal vLLM configuration', () => {
      const result = kaitoDeploymentConfigSchema.safeParse(validVllmConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('my-vllm-deployment');
        expect(result.data.modelSource).toBe('vllm');
        expect(result.data.modelId).toBe('mistralai/Mistral-7B-v0.1');
        expect(result.data.computeType).toBe('gpu');
      }
    });

    it('accepts vLLM configuration with maxModelLen', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({
        ...validVllmConfig,
        maxModelLen: 4096,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.maxModelLen).toBe(4096);
      }
    });

    it('accepts vLLM configuration with hfTokenSecret', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({
        ...validVllmConfig,
        hfTokenSecret: 'hf-token-secret',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hfTokenSecret).toBe('hf-token-secret');
      }
    });

    it('accepts all compute types', () => {
      const computeTypes = ['cpu', 'gpu'] as const;
      for (const computeType of computeTypes) {
        const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, computeType });
        expect(result.success).toBe(true);
      }
    });

    it('accepts full configuration with all optional fields', () => {
      const fullConfig = {
        ...validPremadeConfig,
        replicas: 3,
        labelSelector: {
          'kubernetes.io/arch': 'amd64',
        },
        resources: {
          memory: '16Gi',
          cpu: '8',
        },
        imageRef: 'my-registry/my-image:latest',
      };
      const result = kaitoDeploymentConfigSchema.safeParse(fullConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.replicas).toBe(3);
        expect(result.data.labelSelector?.['kubernetes.io/arch']).toBe('amd64');
        expect(result.data.resources?.memory).toBe('16Gi');
        expect(result.data.resources?.cpu).toBe('8');
        expect(result.data.imageRef).toBe('my-registry/my-image:latest');
      }
    });

    it('accepts GPU configuration with gpu resources', () => {
      const gpuConfig = {
        ...validPremadeConfig,
        computeType: 'gpu',
        resources: {
          gpu: 1,
          memory: '32Gi',
        },
      };
      const result = kaitoDeploymentConfigSchema.safeParse(gpuConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.computeType).toBe('gpu');
        expect(result.data.resources?.gpu).toBe(1);
      }
    });
  });

  describe('name validation', () => {
    it('rejects empty name', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, name: '' });
      expect(result.success).toBe(false);
    });

    it('rejects name longer than 63 characters', () => {
      const longName = 'a'.repeat(64);
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, name: longName });
      expect(result.success).toBe(false);
    });

    it('rejects name with uppercase letters', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, name: 'MyDeployment' });
      expect(result.success).toBe(false);
    });

    it('rejects name starting with hyphen', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, name: '-deployment' });
      expect(result.success).toBe(false);
    });

    it('rejects name ending with hyphen', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, name: 'deployment-' });
      expect(result.success).toBe(false);
    });

    it('rejects name with special characters', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, name: 'deploy_ment' });
      expect(result.success).toBe(false);
    });

    it('accepts valid Kubernetes resource names', () => {
      const validNames = ['a', 'deployment', 'my-deployment', 'deploy-123', 'a1b2c3'];
      for (const name of validNames) {
        const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, name });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('replicas validation', () => {
    it('accepts replicas between 1 and 10', () => {
      for (let replicas = 1; replicas <= 10; replicas++) {
        const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, replicas });
        expect(result.success).toBe(true);
      }
    });

    it('rejects replicas less than 1', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, replicas: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects replicas greater than 10', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, replicas: 11 });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer replicas', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, replicas: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('modelSource validation', () => {
    it('rejects premade without premadeModel', () => {
      const { premadeModel, ...configWithoutPremade } = validPremadeConfig;
      const result = kaitoDeploymentConfigSchema.safeParse(configWithoutPremade);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.some(e => e.message.includes('premadeModel'))).toBe(true);
      }
    });

    it('rejects huggingface without modelId', () => {
      const { modelId, ...configWithoutModelId } = validHuggingFaceConfig;
      const result = kaitoDeploymentConfigSchema.safeParse(configWithoutModelId);
      expect(result.success).toBe(false);
    });

    it('rejects huggingface without ggufFile', () => {
      const { ggufFile, ...configWithoutGgufFile } = validHuggingFaceConfig;
      // Both direct and build modes require ggufFile
      const result = kaitoDeploymentConfigSchema.safeParse(configWithoutGgufFile);
      expect(result.success).toBe(false);
    });

    it('accepts huggingface with ggufFile in direct mode', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validHuggingFaceConfig, ggufRunMode: 'direct' });
      expect(result.success).toBe(true);
    });

    it('accepts huggingface with ggufFile in build mode', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validHuggingFaceConfig, ggufRunMode: 'build' });
      expect(result.success).toBe(true);
    });

    it('accepts vllm with just modelId', () => {
      const result = kaitoDeploymentConfigSchema.safeParse(validVllmConfig);
      expect(result.success).toBe(true);
    });

    it('rejects vllm without modelId', () => {
      const { modelId, ...configWithoutModelId } = validVllmConfig;
      const result = kaitoDeploymentConfigSchema.safeParse(configWithoutModelId);
      expect(result.success).toBe(false);
    });

    it('accepts vllm modelSource', () => {
      const result = kaitoDeploymentConfigSchema.safeParse(validVllmConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.modelSource).toBe('vllm');
      }
    });

    it('rejects invalid modelSource', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, modelSource: 'invalid' });
      expect(result.success).toBe(false);
    });
  });

  describe('required fields', () => {
    it('rejects missing namespace', () => {
      const { namespace, ...configWithoutNamespace } = validPremadeConfig;
      const result = kaitoDeploymentConfigSchema.safeParse(configWithoutNamespace);
      expect(result.success).toBe(false);
    });

    it('rejects missing provider', () => {
      const { provider, ...configWithoutProvider } = validPremadeConfig;
      const result = kaitoDeploymentConfigSchema.safeParse(configWithoutProvider);
      expect(result.success).toBe(false);
    });

    it('rejects invalid provider', () => {
      const result = kaitoDeploymentConfigSchema.safeParse({ ...validPremadeConfig, provider: 'dynamo' });
      expect(result.success).toBe(false);
    });

    it('rejects missing modelSource', () => {
      const { modelSource, ...configWithoutModelSource } = validPremadeConfig;
      const result = kaitoDeploymentConfigSchema.safeParse(configWithoutModelSource);
      expect(result.success).toBe(false);
    });
  });

  describe('computeType defaults', () => {
    it('defaults computeType to cpu', () => {
      const { computeType, ...configWithoutComputeType } = validPremadeConfig;
      const result = kaitoDeploymentConfigSchema.safeParse(configWithoutComputeType);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.computeType).toBe('cpu');
      }
    });

    it('defaults replicas to 1', () => {
      const result = kaitoDeploymentConfigSchema.safeParse(validPremadeConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.replicas).toBe(1);
      }
    });
  });
});

describe('kaitoInferenceSetSchema', () => {
  const validManifest = {
    apiVersion: 'kaito.sh/v1alpha1',
    kind: 'InferenceSet',
    metadata: {
      name: 'my-deployment',
      namespace: 'kaito-workspace',
    },
    spec: {
      replicas: 1,
      labelSelector: {
        matchLabels: {
          'kubernetes.io/os': 'linux',
        },
      },
      template: {
        inference: {
          template: {
            spec: {
              containers: [
                {
                  name: 'model',
                  image: 'ghcr.io/kaito-project/aikit/llama-3.2:3b',
                  ports: [
                    {
                      containerPort: 5000,
                      protocol: 'TCP',
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };

  it('accepts valid minimal manifest', () => {
    const result = kaitoInferenceSetSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it('accepts manifest with labels', () => {
    const result = kaitoInferenceSetSchema.safeParse({
      ...validManifest,
      metadata: {
        ...validManifest.metadata,
        labels: {
          'app.kubernetes.io/name': 'my-app',
          'kubefoundry.io/compute-type': 'cpu',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts manifest with resource instanceType', () => {
    const result = kaitoInferenceSetSchema.safeParse({
      ...validManifest,
      spec: {
        ...validManifest.spec,
        replicas: 2,
        template: {
          resource: {
            instanceType: 'Standard_NC24ads_A100_v4',
          },
          inference: validManifest.spec.template.inference,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts manifest with container resources', () => {
    const result = kaitoInferenceSetSchema.safeParse({
      ...validManifest,
      spec: {
        ...validManifest.spec,
        template: {
          inference: {
            template: {
              spec: {
                containers: [
                  {
                    name: 'model',
                    image: 'test:latest',
                    resources: {
                      requests: {
                        memory: '8Gi',
                        cpu: '4',
                      },
                      limits: {
                        'nvidia.com/gpu': 1,
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid apiVersion', () => {
    const result = kaitoInferenceSetSchema.safeParse({
      ...validManifest,
      apiVersion: 'wrong/v1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid kind', () => {
    const result = kaitoInferenceSetSchema.safeParse({
      ...validManifest,
      kind: 'Deployment',
    });
    expect(result.success).toBe(false);
  });

  it('accepts manifest with container args', () => {
    const result = kaitoInferenceSetSchema.safeParse({
      ...validManifest,
      spec: {
        ...validManifest.spec,
        template: {
          inference: {
            template: {
              spec: {
                containers: [
                  {
                    name: 'model',
                    image: 'test:latest',
                    args: ['run', '--address=:5000'],
                  },
                ],
              },
            },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts manifest with volumes for vLLM shared memory', () => {
    const result = kaitoInferenceSetSchema.safeParse({
      ...validManifest,
      spec: {
        ...validManifest.spec,
        template: {
          inference: {
            template: {
              spec: {
                containers: [
                  {
                    name: 'model',
                    image: 'test:latest',
                  },
                ],
                volumes: [
                  {
                    name: 'dshm',
                    emptyDir: {
                      medium: 'Memory',
                    },
                  },
                ],
              },
            },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });
});
