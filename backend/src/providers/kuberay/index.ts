import * as k8s from '@kubernetes/client-node';
import type { DeploymentConfig, DeploymentStatus, DeploymentPhase } from '@kubefoundry/shared';
import type { Provider, CRDConfig, HelmRepo, HelmChart, InstallationStatus, InstallationStep } from '../types';
import { kuberayDeploymentConfigSchema, type KubeRayDeploymentConfig } from './schema';

/**
 * KubeRay Provider
 * Implements the Provider interface for Ray Serve on Kubernetes via KubeRay
 */
export class KubeRayProvider implements Provider {
  id = 'kuberay';
  name = 'KubeRay';
  description = 'KubeRay enables Ray Serve on Kubernetes for scalable LLM inference with vLLM backend, supporting both aggregated and disaggregated (P/D) serving modes.';
  defaultNamespace = 'kuberay-system';

  // CRD Constants
  private static readonly API_GROUP = 'ray.io';
  private static readonly API_VERSION = 'v1';
  private static readonly CRD_PLURAL = 'rayservices';
  private static readonly CRD_KIND = 'RayService';

  getCRDConfig(): CRDConfig {
    return {
      apiGroup: KubeRayProvider.API_GROUP,
      apiVersion: KubeRayProvider.API_VERSION,
      plural: KubeRayProvider.CRD_PLURAL,
      kind: KubeRayProvider.CRD_KIND,
    };
  }

  generateManifest(config: DeploymentConfig): Record<string, unknown> {
    // Cast to KubeRay-specific config type
    const kuberayConfig = config as unknown as KubeRayDeploymentConfig;

    if (kuberayConfig.mode === 'disaggregated') {
      return this.generateDisaggregatedManifest(kuberayConfig);
    }
    return this.generateAggregatedManifest(kuberayConfig);
  }

  /**
   * Generate manifest for aggregated (standard) serving mode
   */
  private generateAggregatedManifest(config: KubeRayDeploymentConfig): Record<string, unknown> {
    const serveConfig = {
      applications: [
        {
          name: 'llm_app',
          import_path: 'ray.serve.llm:build_openai_app',
          route_prefix: '/',
          runtime_env: {
            env_vars: {
              VLLM_USE_V1: '1',
            },
          },
          args: {
            llm_configs: [
              {
                model_loading_config: {
                  model_id: config.servedModelName || config.name,
                  model_source: config.modelId,
                  ...(config.acceleratorType && { accelerator_type: config.acceleratorType }),
                },
                deployment_config: {
                  autoscaling_config: {
                    min_replicas: config.minReplicas || 1,
                    max_replicas: config.maxReplicas || 2,
                  },
                },
                engine_kwargs: {
                  tensor_parallel_size: config.tensorParallelSize || 1,
                  pipeline_parallel_size: config.pipelineParallelSize || 1,
                  gpu_memory_utilization: config.gpuMemoryUtilization || 0.9,
                  dtype: 'auto',
                  max_num_seqs: config.maxNumSeqs || 40,
                  max_model_len: config.contextLength || 16384,
                  enable_chunked_prefill: config.enableChunkedPrefill ?? true,
                  enable_prefix_caching: config.enablePrefixCaching ?? true,
                  ...(config.trustRemoteCode && { trust_remote_code: true }),
                },
              },
            ],
          },
        },
      ],
    };

    return {
      apiVersion: `${KubeRayProvider.API_GROUP}/${KubeRayProvider.API_VERSION}`,
      kind: KubeRayProvider.CRD_KIND,
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'kubefoundry',
          'app.kubernetes.io/instance': config.name,
          'app.kubernetes.io/managed-by': 'kubefoundry',
        },
      },
      spec: {
        serveConfigV2: this.yamlStringify(serveConfig),
        rayClusterConfig: {
          headGroupSpec: this.generateHeadGroupSpec(config),
          workerGroupSpecs: [this.generateWorkerGroupSpec(config, 'gpu-group')],
        },
      },
    };
  }

  /**
   * Generate manifest for disaggregated (P/D) serving mode
   * Separates prefill and decode workers for better resource utilization
   */
  private generateDisaggregatedManifest(config: KubeRayDeploymentConfig): Record<string, unknown> {
    const kvConnector = config.kvConnector || 'NixlConnector';

    const serveConfig = {
      applications: [
        {
          name: 'pd-disaggregation',
          import_path: 'ray.serve.llm:build_pd_openai_app',
          route_prefix: '/',
          args: {
            prefill_config: {
              model_loading_config: {
                model_id: config.servedModelName || config.name,
                model_source: config.modelId,
              },
              deployment_config: {
                autoscaling_config: {
                  min_replicas: config.minReplicas || 1,
                  max_replicas: config.maxReplicas || 2,
                },
                ray_actor_options: {
                  resources: {
                    prefill_node: 1,
                  },
                },
              },
              engine_kwargs: {
                tensor_parallel_size: config.tensorParallelSize || 1,
                gpu_memory_utilization: config.gpuMemoryUtilization || 0.9,
                dtype: 'auto',
                max_num_seqs: config.maxNumSeqs || 40,
                max_model_len: config.contextLength || 16384,
                enable_chunked_prefill: config.enableChunkedPrefill ?? true,
                enable_prefix_caching: config.enablePrefixCaching ?? true,
              },
              kv_transfer_config: {
                kv_connector: kvConnector,
                kv_role: 'kv_producer',
              },
            },
            decode_config: {
              model_loading_config: {
                model_id: config.servedModelName || config.name,
                model_source: config.modelId,
              },
              deployment_config: {
                autoscaling_config: {
                  min_replicas: config.minReplicas || 1,
                  max_replicas: config.maxReplicas || 2,
                },
                ray_actor_options: {
                  resources: {
                    decode_node: 1,
                  },
                },
              },
              engine_kwargs: {
                tensor_parallel_size: config.tensorParallelSize || 1,
                gpu_memory_utilization: config.gpuMemoryUtilization || 0.9,
                dtype: 'auto',
                max_num_seqs: config.maxNumSeqs || 40,
                max_model_len: config.contextLength || 16384,
                enable_chunked_prefill: config.enableChunkedPrefill ?? true,
                enable_prefix_caching: config.enablePrefixCaching ?? true,
              },
              kv_transfer_config: {
                kv_connector: kvConnector,
                kv_role: 'kv_consumer',
              },
            },
          },
        },
      ],
    };

    return {
      apiVersion: `${KubeRayProvider.API_GROUP}/${KubeRayProvider.API_VERSION}`,
      kind: KubeRayProvider.CRD_KIND,
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'kubefoundry',
          'app.kubernetes.io/instance': config.name,
          'app.kubernetes.io/managed-by': 'kubefoundry',
        },
      },
      spec: {
        serveConfigV2: this.yamlStringify(serveConfig),
        rayClusterConfig: {
          headGroupSpec: this.generateHeadGroupSpec(config),
          workerGroupSpecs: [
            this.generatePrefillWorkerSpec(config),
            this.generateDecodeWorkerSpec(config),
          ],
        },
      },
    };
  }

  private generateHeadGroupSpec(config: KubeRayDeploymentConfig): Record<string, unknown> {
    const rayImage = config.rayImage || 'rayproject/ray-llm:2.52.0-py311-cu128';
    const headCpu = config.headCpu || '4';
    const headMemory = config.headMemory || '32Gi';

    return {
      rayStartParams: {
        'num-gpus': '0',
      },
      template: {
        spec: {
          containers: [
            {
              name: 'ray-head',
              image: rayImage,
              resources: {
                limits: {
                  cpu: headCpu,
                  memory: headMemory,
                },
                requests: {
                  cpu: headCpu,
                  memory: headMemory,
                },
              },
              ports: [
                { containerPort: 6379, name: 'gcs-server' },
                { containerPort: 8265, name: 'dashboard' },
                { containerPort: 10001, name: 'client' },
                { containerPort: 8000, name: 'serve' },
              ],
            },
          ],
        },
      },
    };
  }

  private generateWorkerGroupSpec(config: KubeRayDeploymentConfig, groupName: string): Record<string, unknown> {
    const rayImage = config.rayImage || 'rayproject/ray-llm:2.52.0-py311-cu128';
    const workerCpu = config.workerCpu || '8';
    const workerMemory = config.workerMemory || '64Gi';
    const gpuCount = config.resources?.gpu || 1;

    return {
      groupName,
      replicas: config.replicas || 1,
      minReplicas: config.minReplicas || 1,
      maxReplicas: config.maxReplicas || 2,
      rayStartParams: {},
      template: {
        spec: {
          containers: [
            {
              name: 'ray-worker',
              image: rayImage,
              resources: {
                limits: {
                  cpu: workerCpu,
                  memory: workerMemory,
                  'nvidia.com/gpu': String(gpuCount),
                },
                requests: {
                  cpu: workerCpu,
                  memory: workerMemory,
                  'nvidia.com/gpu': String(gpuCount),
                },
              },
            },
          ],
          tolerations: [
            {
              key: 'nvidia.com/gpu',
              operator: 'Exists',
              effect: 'NoSchedule',
            },
          ],
        },
      },
    };
  }

  private generatePrefillWorkerSpec(config: KubeRayDeploymentConfig): Record<string, unknown> {
    const baseSpec = this.generateWorkerGroupSpec(config, 'prefill-group');
    // Add prefill_node resource label
    (baseSpec as { rayStartParams: Record<string, string> }).rayStartParams = {
      resources: '"{\\\"prefill_node\\\": 1}"',
    };
    return baseSpec;
  }

  private generateDecodeWorkerSpec(config: KubeRayDeploymentConfig): Record<string, unknown> {
    const baseSpec = this.generateWorkerGroupSpec(config, 'decode-group');
    // Add decode_node resource label
    (baseSpec as { rayStartParams: Record<string, string> }).rayStartParams = {
      resources: '"{\\\"decode_node\\\": 1}"',
    };
    return baseSpec;
  }

  /**
   * Simple YAML-like string serialization for serveConfigV2
   */
  private yamlStringify(obj: unknown, indent: number = 0): string {
    const spaces = '  '.repeat(indent);

    if (obj === null || obj === undefined) {
      return 'null';
    }

    if (typeof obj === 'string') {
      return `"${obj}"`;
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return String(obj);
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      return obj.map(item => `${spaces}- ${this.yamlStringify(item, indent + 1).trimStart()}`).join('\n');
    }

    if (typeof obj === 'object') {
      const entries = Object.entries(obj);
      if (entries.length === 0) return '{}';
      return entries.map(([key, value]) => {
        const valueStr = this.yamlStringify(value, indent + 1);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        if (Array.isArray(value)) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr}`;
      }).join('\n');
    }

    return String(obj);
  }

  parseStatus(raw: unknown): DeploymentStatus {
    const obj = raw as {
      metadata?: { name?: string; namespace?: string; creationTimestamp?: string };
      spec?: {
        serveConfigV2?: string;
        rayClusterConfig?: {
          workerGroupSpecs?: Array<{
            replicas?: number;
            minReplicas?: number;
            maxReplicas?: number;
          }>;
        };
      };
      status?: {
        serviceStatus?: string;
        numServeEndpoints?: number;
        activeServiceStatus?: {
          applicationStatuses?: Record<string, {
            status?: string;
            message?: string;
          }>;
          rayClusterStatus?: {
            state?: string;
            availableWorkerReplicas?: number;
            desiredWorkerReplicas?: number;
          };
        };
        conditions?: Array<{
          type?: string;
          status?: string;
          reason?: string;
          message?: string;
          lastTransitionTime?: string;
        }>;
      };
    };

    const spec = obj.spec || {};
    const status = obj.status || {};
    const activeStatus = status.activeServiceStatus || {};
    const clusterStatus = activeStatus.rayClusterStatus || {};

    // Try to extract model info from serveConfigV2
    let modelId = '';
    let mode: 'aggregated' | 'disaggregated' = 'aggregated';

    if (spec.serveConfigV2) {
      // Check for disaggregated mode
      if (spec.serveConfigV2.includes('build_pd_openai_app') || spec.serveConfigV2.includes('pd-disaggregation')) {
        mode = 'disaggregated';
      }
      // Try to extract model_source
      const modelMatch = spec.serveConfigV2.match(/model_source:\s*["']?([^"'\n]+)["']?/);
      if (modelMatch) {
        modelId = modelMatch[1].trim();
      }
    }

    // Calculate replicas from worker specs
    const workerSpecs = spec.rayClusterConfig?.workerGroupSpecs || [];
    const desiredReplicas = workerSpecs.reduce((sum, w) => sum + (w.replicas || 0), 0);

    // Map RayService status to DeploymentPhase
    let phase: DeploymentPhase = 'Pending';
    const serviceStatus = status.serviceStatus?.toLowerCase() || '';

    if (serviceStatus === 'running' || serviceStatus === 'ready') {
      phase = 'Running';
    } else if (serviceStatus === 'failed' || serviceStatus === 'unhealthy') {
      phase = 'Failed';
    } else if (serviceStatus.includes('deploy') || serviceStatus.includes('pending')) {
      phase = 'Deploying';
    }

    return {
      name: obj.metadata?.name || 'unknown',
      namespace: obj.metadata?.namespace || 'default',
      modelId,
      engine: 'vllm', // Ray Serve uses vLLM backend
      mode,
      phase,
      replicas: {
        desired: clusterStatus.desiredWorkerReplicas || desiredReplicas || 1,
        ready: clusterStatus.availableWorkerReplicas || 0,
        available: clusterStatus.availableWorkerReplicas || 0,
      },
      conditions: (status.conditions || []).map((c) => ({
        type: c.type || '',
        status: (c.status as 'True' | 'False' | 'Unknown') || 'Unknown',
        reason: c.reason,
        message: c.message,
        lastTransitionTime: c.lastTransitionTime,
      })),
      pods: [],
      createdAt: obj.metadata?.creationTimestamp || new Date().toISOString(),
      frontendService: `${obj.metadata?.name}-serve-svc`,
    };
  }

  validateConfig(config: unknown): { valid: boolean; errors: string[]; data?: DeploymentConfig } {
    const result = kuberayDeploymentConfigSchema.safeParse(config);

    if (!result.success) {
      return {
        valid: false,
        errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`),
      };
    }

    return {
      valid: true,
      errors: [],
      data: result.data as unknown as DeploymentConfig,
    };
  }

  getConfigSchema() {
    return kuberayDeploymentConfigSchema;
  }

  getInstallationSteps(): InstallationStep[] {
    return [
      {
        title: 'Add KubeRay Helm Repository',
        command: 'helm repo add kuberay https://ray-project.github.io/kuberay-helm/',
        description: 'Add the KubeRay Helm repository to access Ray operator charts.',
      },
      {
        title: 'Update Helm Repositories',
        command: 'helm repo update',
        description: 'Update local Helm repository cache.',
      },
      {
        title: 'Install KubeRay Operator',
        command: 'helm install kuberay-operator kuberay/kuberay-operator --version 1.5.1',
        description: 'Install the KubeRay operator which manages RayService and RayCluster resources.',
      },
    ];
  }

  getHelmRepos(): HelmRepo[] {
    return [
      {
        name: 'kuberay',
        url: 'https://ray-project.github.io/kuberay-helm/',
      },
    ];
  }

  getHelmCharts(): HelmChart[] {
    return [
      {
        name: 'kuberay-operator',
        chart: 'kuberay/kuberay-operator',
        version: '1.5.1',
        namespace: 'default',
        createNamespace: false,
      },
    ];
  }

  async checkInstallation(k8sApi: {
    customObjectsApi: unknown;
    coreV1Api: unknown;
  }): Promise<InstallationStatus> {
    const customObjectsApi = k8sApi.customObjectsApi as k8s.CustomObjectsApi;
    const coreV1Api = k8sApi.coreV1Api as k8s.CoreV1Api;

    try {
      // Check if RayService CRD exists by trying to list resources
      let crdFound = false;
      try {
        await customObjectsApi.listNamespacedCustomObject(
          KubeRayProvider.API_GROUP,
          KubeRayProvider.API_VERSION,
          this.defaultNamespace,
          KubeRayProvider.CRD_PLURAL
        );
        crdFound = true;
      } catch (error: unknown) {
        const k8sError = error as { response?: { statusCode?: number }; message?: string };
        // 404 means CRD doesn't exist
        if (k8sError?.response?.statusCode === 404 || k8sError?.message === 'HTTP request failed') {
          crdFound = false;
        }
      }

      // Check if kuberay-operator is running
      let operatorRunning = false;
      try {
        // KubeRay operator typically runs in default namespace
        const pods = await coreV1Api.listNamespacedPod(
          'default',
          undefined,
          undefined,
          undefined,
          undefined,
          'app.kubernetes.io/name=kuberay-operator'
        );
        operatorRunning = pods.body.items.some(
          pod => pod.status?.phase === 'Running'
        );

        // Also try alternative label selector
        if (!operatorRunning) {
          const altPods = await coreV1Api.listNamespacedPod(
            'default',
            undefined,
            undefined,
            undefined,
            undefined,
            'app=kuberay-operator'
          );
          operatorRunning = altPods.body.items.some(
            pod => pod.status?.phase === 'Running'
          );
        }
      } catch {
        operatorRunning = false;
      }

      const installed = crdFound && operatorRunning;

      return {
        installed,
        crdFound,
        operatorRunning,
        message: installed
          ? 'KubeRay is installed and running'
          : !crdFound
          ? 'KubeRay CRD not found. Please install the KubeRay operator.'
          : 'KubeRay operator is not running',
      };
    } catch (error) {
      return {
        installed: false,
        message: `Error checking installation: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}

// Export singleton instance
export const kuberayProvider = new KubeRayProvider();
