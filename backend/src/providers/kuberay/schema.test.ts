import { describe, it, expect } from 'bun:test';
import { kuberayDeploymentConfigSchema, kuberayManifestSchema } from './schema';

describe('kuberayDeploymentConfigSchema', () => {
  const validConfig = {
    name: 'my-deployment',
    namespace: 'kuberay',
    modelId: 'Qwen/Qwen3-0.6B',
    engine: 'vllm' as const,
    hfTokenSecret: 'hf-token-secret',
  };

  describe('valid configurations', () => {
    it('accepts minimal valid configuration', () => {
      const result = kuberayDeploymentConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('my-deployment');
        expect(result.data.engine).toBe('vllm');
        // Check KubeRay-specific defaults
        expect(result.data.tensorParallelSize).toBe(1);
        expect(result.data.pipelineParallelSize).toBe(1);
        expect(result.data.gpuMemoryUtilization).toBe(0.9);
        expect(result.data.maxNumSeqs).toBe(40);
        expect(result.data.enableChunkedPrefill).toBe(true);
        expect(result.data.minReplicas).toBe(1);
        expect(result.data.maxReplicas).toBe(2);
        expect(result.data.headCpu).toBe('4');
        expect(result.data.headMemory).toBe('32Gi');
        expect(result.data.workerCpu).toBe('8');
        expect(result.data.workerMemory).toBe('64Gi');
        expect(result.data.kvConnector).toBe('NixlConnector');
      }
    });

    it('only accepts vllm engine', () => {
      const result = kuberayDeploymentConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('accepts full configuration with all KubeRay options', () => {
      const fullConfig = {
        ...validConfig,
        acceleratorType: 'A100',
        tensorParallelSize: 4,
        pipelineParallelSize: 2,
        gpuMemoryUtilization: 0.8,
        maxNumSeqs: 100,
        enableChunkedPrefill: false,
        rayImage: 'custom/ray-image:latest',
        headCpu: '8',
        headMemory: '64Gi',
        workerCpu: '16',
        workerMemory: '128Gi',
        minReplicas: 2,
        maxReplicas: 10,
        kvConnector: 'SimpleConnector' as const,
      };
      const result = kuberayDeploymentConfigSchema.safeParse(fullConfig);
      expect(result.success).toBe(true);
    });
  });

  describe('engine validation', () => {
    it('rejects sglang engine', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, engine: 'sglang' });
      expect(result.success).toBe(false);
    });

    it('rejects trtllm engine', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, engine: 'trtllm' });
      expect(result.success).toBe(false);
    });
  });

  describe('parallelism settings', () => {
    it('accepts valid tensor parallel size', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, tensorParallelSize: 8 });
      expect(result.success).toBe(true);
    });

    it('rejects tensor parallel size less than 1', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, tensorParallelSize: 0 });
      expect(result.success).toBe(false);
    });

    it('accepts valid pipeline parallel size', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, pipelineParallelSize: 4 });
      expect(result.success).toBe(true);
    });

    it('rejects pipeline parallel size less than 1', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, pipelineParallelSize: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe('gpuMemoryUtilization validation', () => {
    it('accepts valid utilization between 0.1 and 1.0', () => {
      const values = [0.1, 0.5, 0.9, 1.0];
      for (const gpuMemoryUtilization of values) {
        const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, gpuMemoryUtilization });
        expect(result.success).toBe(true);
      }
    });

    it('rejects utilization less than 0.1', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, gpuMemoryUtilization: 0.05 });
      expect(result.success).toBe(false);
    });

    it('rejects utilization greater than 1.0', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, gpuMemoryUtilization: 1.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('maxNumSeqs validation', () => {
    it('accepts valid maxNumSeqs', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, maxNumSeqs: 100 });
      expect(result.success).toBe(true);
    });

    it('rejects maxNumSeqs less than 1', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, maxNumSeqs: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe('autoscaling settings', () => {
    it('accepts valid min/max replicas', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ 
        ...validConfig, 
        minReplicas: 2, 
        maxReplicas: 10 
      });
      expect(result.success).toBe(true);
    });

    it('rejects minReplicas less than 1', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, minReplicas: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects maxReplicas less than 1', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, maxReplicas: 0 });
      expect(result.success).toBe(false);
    });
  });

  describe('kvConnector validation', () => {
    it('accepts NixlConnector', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, kvConnector: 'NixlConnector' });
      expect(result.success).toBe(true);
    });

    it('accepts SimpleConnector', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, kvConnector: 'SimpleConnector' });
      expect(result.success).toBe(true);
    });

    it('rejects invalid connector', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, kvConnector: 'InvalidConnector' });
      expect(result.success).toBe(false);
    });
  });

  describe('inherits base schema validation', () => {
    it('rejects invalid Kubernetes name', () => {
      const result = kuberayDeploymentConfigSchema.safeParse({ ...validConfig, name: 'Invalid_Name' });
      expect(result.success).toBe(false);
    });

    it('rejects missing required fields', () => {
      const { hfTokenSecret, ...configWithoutToken } = validConfig;
      const result = kuberayDeploymentConfigSchema.safeParse(configWithoutToken);
      expect(result.success).toBe(false);
    });
  });
});

describe('kuberayManifestSchema', () => {
  const validManifest = {
    apiVersion: 'ray.io/v1',
    kind: 'RayService',
    metadata: {
      name: 'my-service',
    },
    spec: {
      serveConfigV2: 'applications:\n  - name: vllm',
      rayClusterConfig: {
        headGroupSpec: {
          rayStartParams: {
            dashboard_host: '0.0.0.0',
          },
          template: {
            spec: {
              containers: [
                {
                  name: 'ray-head',
                  image: 'rayproject/ray:2.10.0',
                  resources: {
                    limits: { cpu: '4', memory: '16Gi' },
                    requests: { cpu: '4', memory: '16Gi' },
                  },
                },
              ],
            },
          },
        },
        workerGroupSpecs: [
          {
            groupName: 'gpu-worker',
            replicas: 1,
            minReplicas: 1,
            maxReplicas: 2,
            rayStartParams: {},
            template: {
              spec: {
                containers: [
                  {
                    name: 'ray-worker',
                    image: 'rayproject/ray:2.10.0',
                    resources: {
                      limits: { cpu: '8', memory: '32Gi', 'nvidia.com/gpu': '1' },
                      requests: { cpu: '8', memory: '32Gi', 'nvidia.com/gpu': '1' },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  };

  it('accepts valid manifest', () => {
    const result = kuberayManifestSchema.safeParse(validManifest);
    expect(result.success).toBe(true);
  });

  it('accepts manifest with namespace', () => {
    const result = kuberayManifestSchema.safeParse({
      ...validManifest,
      metadata: {
        ...validManifest.metadata,
        namespace: 'kuberay',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts manifest with labels', () => {
    const result = kuberayManifestSchema.safeParse({
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

  it('accepts manifest with tolerations', () => {
    const manifestWithTolerations = {
      ...validManifest,
      spec: {
        ...validManifest.spec,
        rayClusterConfig: {
          ...validManifest.spec.rayClusterConfig,
          workerGroupSpecs: [
            {
              ...validManifest.spec.rayClusterConfig.workerGroupSpecs[0],
              template: {
                spec: {
                  ...validManifest.spec.rayClusterConfig.workerGroupSpecs[0].template.spec,
                  tolerations: [
                    {
                      key: 'nvidia.com/gpu',
                      operator: 'Exists',
                      effect: 'NoSchedule',
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    };
    const result = kuberayManifestSchema.safeParse(manifestWithTolerations);
    expect(result.success).toBe(true);
  });

  it('rejects invalid apiVersion', () => {
    const result = kuberayManifestSchema.safeParse({
      ...validManifest,
      apiVersion: 'wrong/v1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid kind', () => {
    const result = kuberayManifestSchema.safeParse({
      ...validManifest,
      kind: 'Deployment',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing serveConfigV2', () => {
    const { serveConfigV2, ...specWithoutServeConfig } = validManifest.spec;
    const result = kuberayManifestSchema.safeParse({
      ...validManifest,
      spec: specWithoutServeConfig,
    });
    expect(result.success).toBe(false);
  });
});
