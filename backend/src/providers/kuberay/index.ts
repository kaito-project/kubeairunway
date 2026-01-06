import * as k8s from '@kubernetes/client-node';
import type { DeploymentConfig, DeploymentStatus, DeploymentPhase, MetricDefinition, MetricsEndpointConfig } from '@kubefoundry/shared';
import type { Provider, CRDConfig, HelmRepo, HelmChart, InstallationStatus, InstallationStep, UninstallResources } from '../types';
import { kuberayDeploymentConfigSchema, type KubeRayDeploymentConfig } from './schema';
import logger from '../../lib/logger';

// Default fallback version if GitHub fetch fails
const DEFAULT_KUBERAY_VERSION = '1.5.1';

// GitHub API URL for KubeRay releases
const KUBERAY_GITHUB_RELEASES_URL = 'https://api.github.com/repos/ray-project/kuberay/releases/latest';

// Cache for the latest version
let cachedKuberayVersion: string | null = null;
let kuberayCacheTimestamp: number = 0;
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Fetch the latest KubeRay version from GitHub releases
 */
async function fetchLatestKuberayVersion(): Promise<string> {
  // Check cache first
  if (cachedKuberayVersion && (Date.now() - kuberayCacheTimestamp) < CACHE_TTL_MS) {
    return cachedKuberayVersion;
  }

  try {
    const response = await fetch(KUBERAY_GITHUB_RELEASES_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'KubeFoundry',
      },
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Failed to fetch KubeRay version from GitHub');
      return cachedKuberayVersion || process.env.KUBERAY_VERSION || DEFAULT_KUBERAY_VERSION;
    }

    const data = await response.json() as { tag_name?: string };
    const tagName = data.tag_name;

    if (tagName) {
      // Remove 'v' prefix if present (e.g., 'v1.5.1' -> '1.5.1')
      cachedKuberayVersion = tagName.startsWith('v') ? tagName.slice(1) : tagName;
      kuberayCacheTimestamp = Date.now();
      logger.info({ version: cachedKuberayVersion }, 'Fetched latest KubeRay version from GitHub');
      return cachedKuberayVersion;
    }

    return cachedKuberayVersion || process.env.KUBERAY_VERSION || DEFAULT_KUBERAY_VERSION;
  } catch (error) {
    logger.warn({ error }, 'Error fetching KubeRay version from GitHub, using fallback');
    return cachedKuberayVersion || process.env.KUBERAY_VERSION || DEFAULT_KUBERAY_VERSION;
  }
}

/**
 * Get the current KubeRay version (sync - uses cached value or fallback)
 */
function getKuberayVersion(): string {
  return cachedKuberayVersion || process.env.KUBERAY_VERSION || DEFAULT_KUBERAY_VERSION;
}

/**
 * KubeRay Provider
 * Implements the Provider interface for Ray Serve on Kubernetes via KubeRay
 */
export class KubeRayProvider implements Provider {
  id = 'kuberay';
  name = 'Ray Serve via KubeRay';
  description = 'KubeRay enables Ray Serve on Kubernetes for scalable LLM inference with vLLM backend, supporting both aggregated and disaggregated (P/D) serving modes.';
  defaultNamespace = 'kuberay-system';

  // CRD Constants
  private static readonly API_GROUP = 'ray.io';
  private static readonly API_VERSION = 'v1';
  private static readonly CRD_PLURAL = 'rayservices';
  private static readonly CRD_KIND = 'RayService';

  /**
   * Refresh the cached KubeRay version from GitHub releases
   * Call this before installation to ensure we have the latest version
   */
  async refreshVersion(): Promise<string> {
    return fetchLatestKuberayVersion();
  }

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

    logger.debug({ name: config.name, mode: kuberayConfig.mode }, 'Generating KubeRay manifest');

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
                  model_id: config.servedModelName || config.modelId,
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
                  enforce_eager: config.enforceEager ?? true,
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

    // Use per-component replica/GPU settings if specified, otherwise fall back to defaults
    const prefillReplicas = config.prefillReplicas || 1;
    const decodeReplicas = config.decodeReplicas || 1;
    const prefillGpus = config.prefillGpus || config.resources?.gpu || 1;
    const decodeGpus = config.decodeGpus || config.resources?.gpu || 1;

    const serveConfig = {
      applications: [
        {
          name: 'pd-disaggregation',
          import_path: 'ray.serve.llm:build_pd_openai_app',
          route_prefix: '/',
          args: {
            prefill_config: {
              model_loading_config: {
                model_id: config.servedModelName || config.modelId,
                model_source: config.modelId,
              },
              deployment_config: {
                autoscaling_config: {
                  min_replicas: config.prefillMinReplicas || config.minReplicas || 1,
                  max_replicas: config.prefillMaxReplicas || config.maxReplicas || 2,
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
                enforce_eager: config.enforceEager ?? true,
                kv_transfer_config: {
                  kv_connector: kvConnector,
                  kv_role: 'kv_producer',
                },
              },
            },
            decode_config: {
              model_loading_config: {
                model_id: config.servedModelName || config.modelId,
                model_source: config.modelId,
              },
              deployment_config: {
                autoscaling_config: {
                  min_replicas: config.decodeMinReplicas || config.minReplicas || 1,
                  max_replicas: config.decodeMaxReplicas || config.maxReplicas || 2,
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
                enforce_eager: config.enforceEager ?? true,
                kv_transfer_config: {
                  kv_connector: kvConnector,
                  kv_role: 'kv_consumer',
                },
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
            this.generatePrefillWorkerSpec(config, prefillReplicas, prefillGpus),
            this.generateDecodeWorkerSpec(config, decodeReplicas, decodeGpus),
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
              envFrom: [
                {
                  secretRef: {
                    name: config.hfTokenSecret,
                  },
                },
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
              envFrom: [
                {
                  secretRef: {
                    name: config.hfTokenSecret,
                  },
                },
              ],
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

  private generatePrefillWorkerSpec(config: KubeRayDeploymentConfig, replicas: number, gpuCount: number): Record<string, unknown> {
    const baseSpec = this.generateWorkerGroupSpecWithParams(config, 'prefill-group', replicas, gpuCount);
    // Add prefill_node resource label
    (baseSpec as { rayStartParams: Record<string, string> }).rayStartParams = {
      resources: '"{\\\"prefill_node\\\": 1}"',
    };
    return baseSpec;
  }

  private generateDecodeWorkerSpec(config: KubeRayDeploymentConfig, replicas: number, gpuCount: number): Record<string, unknown> {
    const baseSpec = this.generateWorkerGroupSpecWithParams(config, 'decode-group', replicas, gpuCount);
    // Add decode_node resource label
    (baseSpec as { rayStartParams: Record<string, string> }).rayStartParams = {
      resources: '"{\\\"decode_node\\\": 1}"',
    };
    return baseSpec;
  }

  private generateWorkerGroupSpecWithParams(
    config: KubeRayDeploymentConfig,
    groupName: string,
    replicas: number,
    gpuCount: number
  ): Record<string, unknown> {
    const rayImage = config.rayImage || 'rayproject/ray-llm:2.52.0-py311-cu128';
    const workerCpu = config.workerCpu || '8';
    const workerMemory = config.workerMemory || '64Gi';

    // Use per-component min/max replicas
    let minReplicas: number;
    let maxReplicas: number;

    if (groupName === 'prefill-group') {
      minReplicas = config.prefillMinReplicas || config.minReplicas || 1;
      maxReplicas = config.prefillMaxReplicas || config.maxReplicas || 2;
    } else {
      minReplicas = config.decodeMinReplicas || config.minReplicas || 1;
      maxReplicas = config.decodeMaxReplicas || config.maxReplicas || 2;
    }

    return {
      groupName,
      replicas,
      minReplicas,
      maxReplicas,
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
              envFrom: [
                {
                  secretRef: {
                    name: config.hfTokenSecret,
                  },
                },
              ],
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
            groupName?: string;
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
    let servedModelName = '';
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
      // Try to extract model_id (served model name)
      const servedModelMatch = spec.serveConfigV2.match(/model_id:\s*["']?([^"'\n]+)["']?/);
      if (servedModelMatch) {
        servedModelName = servedModelMatch[1].trim();
      }
    }

    // Calculate replicas from worker specs
    const workerSpecs = spec.rayClusterConfig?.workerGroupSpecs || [];
    const desiredReplicas = workerSpecs.reduce((sum, w) => sum + (w.replicas || 0), 0);

    // Extract prefill/decode replica counts for disaggregated mode
    let prefillDesired = 0;
    let decodeDesired = 0;

    if (mode === 'disaggregated') {
      for (const workerSpec of workerSpecs) {
        if (workerSpec.groupName === 'prefill-group') {
          prefillDesired = workerSpec.replicas || 0;
        } else if (workerSpec.groupName === 'decode-group') {
          decodeDesired = workerSpec.replicas || 0;
        }
      }
    }

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

    const result: DeploymentStatus = {
      name: obj.metadata?.name || 'unknown',
      namespace: obj.metadata?.namespace || 'default',
      modelId,
      servedModelName: servedModelName || obj.metadata?.name || 'unknown',
      engine: 'vllm', // Ray Serve uses vLLM backend
      mode,
      phase,
      provider: this.id,
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

    // Add disaggregated replica status if in disaggregated mode
    if (mode === 'disaggregated') {
      // Note: Ready counts would need to come from actual pod status
      // For now, estimate based on available replicas ratio
      const readyRatio = desiredReplicas > 0
        ? (clusterStatus.availableWorkerReplicas || 0) / desiredReplicas
        : 0;

      result.prefillReplicas = {
        desired: prefillDesired,
        ready: Math.round(prefillDesired * readyRatio),
      };
      result.decodeReplicas = {
        desired: decodeDesired,
        ready: Math.round(decodeDesired * readyRatio),
      };
    }

    return result;
  }

  validateConfig(config: unknown): { valid: boolean; errors: string[]; data?: DeploymentConfig } {
    const result = kuberayDeploymentConfigSchema.safeParse(config);

    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      logger.warn({ errors }, 'KubeRay config validation failed');
      return {
        valid: false,
        errors,
      };
    }

    logger.debug({ name: result.data.name }, 'KubeRay config validated successfully');
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
    const version = getKuberayVersion();
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
        command: `helm install kuberay-operator kuberay/kuberay-operator --namespace kuberay-system --create-namespace --version ${version}`,
        description: `Install the KubeRay operator v${version} in the kuberay-system namespace which manages RayService and RayCluster resources.`,
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
    const version = getKuberayVersion();
    return [
      {
        name: 'kuberay-operator',
        chart: 'kuberay/kuberay-operator',
        version,
        namespace: 'kuberay-system',
        createNamespace: true,
      },
    ];
  }

  async checkInstallation(k8sApi: {
    customObjectsApi: unknown;
    coreV1Api: unknown;
  }): Promise<InstallationStatus> {
    const customObjectsApi = k8sApi.customObjectsApi as k8s.CustomObjectsApi;
    const coreV1Api = k8sApi.coreV1Api as k8s.CoreV1Api;

    logger.debug('Checking KubeRay installation status');

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
        logger.debug('KubeRay CRD found');
      } catch (error: unknown) {
        const k8sError = error as { response?: { statusCode?: number }; message?: string };
        // 404 means CRD doesn't exist
        if (k8sError?.response?.statusCode === 404 || k8sError?.message === 'HTTP request failed') {
          crdFound = false;
          logger.debug('KubeRay CRD not found');
        }
      }

      // Check if kuberay-operator is running
      let operatorRunning = false;
      try {
        // KubeRay operator runs in kuberay-system namespace
        const pods = await coreV1Api.listNamespacedPod(
          'kuberay-system',
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
            'kuberay-system',
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
      logger.info({ installed, crdFound, operatorRunning }, 'KubeRay installation check complete');

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
      logger.error({ error }, 'Error checking KubeRay installation');
      return {
        installed: false,
        message: `Error checking installation: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  getMetricsConfig(): MetricsEndpointConfig | null {
    return {
      endpointPath: '/metrics',
      port: 8080,
      // KubeRay exposes metrics on the head service (not serve-svc)
      serviceNamePattern: '{name}-head-svc',
    };
  }

  getKeyMetrics(): MetricDefinition[] {
    return [
      // Queue metrics
      {
        name: 'ray_serve_replica_processing_queries',
        displayName: 'In-Flight Requests',
        description: 'Current number of queries being processed',
        unit: 'requests',
        type: 'gauge',
        category: 'queue',
      },
      {
        name: 'ray_serve_deployment_queued_queries',
        displayName: 'Queued Requests',
        description: 'Number of queries waiting to be assigned to a replica',
        unit: 'requests',
        type: 'gauge',
        category: 'queue',
      },
      // Latency metrics (histograms)
      {
        name: 'ray_serve_deployment_processing_latency_ms',
        displayName: 'Avg Processing Latency',
        description: 'Latency for queries to be processed',
        unit: 'ms',
        type: 'histogram',
        category: 'latency',
      },
      {
        name: 'ray_serve_http_request_latency_ms',
        displayName: 'Avg HTTP Latency',
        description: 'End-to-end HTTP request latency',
        unit: 'ms',
        type: 'histogram',
        category: 'latency',
      },
      // Throughput metrics (counters)
      {
        name: 'ray_serve_deployment_request_counter_total',
        displayName: 'Requests Processed',
        description: 'Total number of queries processed',
        unit: 'req/s',
        type: 'counter',
        category: 'throughput',
      },
      {
        name: 'ray_serve_num_http_requests_total',
        displayName: 'HTTP Requests',
        description: 'Number of HTTP requests processed',
        unit: 'req/s',
        type: 'counter',
        category: 'throughput',
      },
      // Error metrics (counters)
      {
        name: 'ray_serve_deployment_error_counter_total',
        displayName: 'Errors',
        description: 'Number of exceptions in the deployment',
        unit: 'errors/s',
        type: 'counter',
        category: 'errors',
      },
      {
        name: 'ray_serve_num_http_error_requests_total',
        displayName: 'HTTP Errors',
        description: 'Number of non-200 HTTP responses',
        unit: 'errors/s',
        type: 'counter',
        category: 'errors',
      },
    ];
  }

  getUninstallResources(): UninstallResources {
    return {
      // KubeRay CRDs
      crds: [
        `${KubeRayProvider.CRD_PLURAL}.${KubeRayProvider.API_GROUP}`,
        `rayclusters.${KubeRayProvider.API_GROUP}`,
        `rayjobs.${KubeRayProvider.API_GROUP}`,
      ],
      // KubeRay operator namespace - can be deleted on uninstall
      namespaces: ['kuberay-system'],
    };
  }
}

// Export singleton instance
export const kuberayProvider = new KubeRayProvider();
