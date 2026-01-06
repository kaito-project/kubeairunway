import * as k8s from '@kubernetes/client-node';
import type { DeploymentConfig, DeploymentStatus, DeploymentPhase, MetricDefinition, MetricsEndpointConfig } from '@kubefoundry/shared';
import type { Provider, CRDConfig, HelmRepo, HelmChart, InstallationStatus, InstallationStep, UninstallResources } from '../types';
import { kaitoDeploymentConfigSchema, type KaitoDeploymentConfig } from './schema';
import { aikitService, GGUF_RUNNER_IMAGE } from '../../services/aikit';
import logger from '../../lib/logger';

// Hardcoded KAITO version
const KAITO_VERSION = '0.6.0';

// KAITO base image for vLLM mode
const KAITO_BASE_IMAGE = 'mcr.microsoft.com/aks/kaito/kaito-base:0.1.1';

// Port constants
const LLAMACPP_PORT = 5000;
const VLLM_PORT = 8000;

/**
 * KAITO Provider
 * Implements the Provider interface for KAITO (Kubernetes AI Toolchain Operator)
 * 
 * KAITO's key differentiator is CPU-capable inference using GGUF quantized models
 * built with AIKit. This enables running LLMs without GPU nodes.
 */
export class KaitoProvider implements Provider {
  id = 'kaito';
  name = 'KAITO';
  description = 'Flexible inference with GGUF (llama.cpp) and vLLM support. Deploy models on CPU or GPU nodes.';
  defaultNamespace = 'kaito-workspace';

  // CRD Constants
  private static readonly API_GROUP = 'kaito.sh';
  private static readonly API_VERSION = 'v1beta1';
  private static readonly CRD_PLURAL = 'workspaces';
  private static readonly CRD_KIND = 'Workspace';

  getCRDConfig(): CRDConfig {
    return {
      apiGroup: KaitoProvider.API_GROUP,
      apiVersion: KaitoProvider.API_VERSION,
      plural: KaitoProvider.CRD_PLURAL,
      kind: KaitoProvider.CRD_KIND,
    };
  }

  generateManifest(config: DeploymentConfig): Record<string, unknown> {
    const kaitoConfig = config as KaitoDeploymentConfig;

    logger.debug(
      { name: config.name, modelSource: kaitoConfig.modelSource, computeType: kaitoConfig.computeType, ggufRunMode: kaitoConfig.ggufRunMode },
      'Generating KAITO Workspace manifest'
    );

    // Route to vLLM manifest generation if modelSource is 'vllm'
    if (kaitoConfig.modelSource === 'vllm') {
      return this.generateVllmManifest(kaitoConfig);
    }

    // Determine image and args based on run mode
    let containerImage: string;
    let containerArgs: string[];

    if (kaitoConfig.modelSource === 'huggingface' && kaitoConfig.ggufRunMode === 'direct') {
      // Direct run mode - use runner image with huggingface:// URI
      // Format: huggingface://org/repo/filename.gguf
      containerImage = GGUF_RUNNER_IMAGE;
      const modelUri = `huggingface://${kaitoConfig.modelId}/${kaitoConfig.ggufFile}`;
      containerArgs = [modelUri, '--address=:5000'];
      logger.debug({ image: containerImage, args: containerArgs, modelUri }, 'Using direct run mode with runner image');
    } else {
      // Build mode or premade - use the resolved image reference
      const imageRef = this.getImageRef(kaitoConfig);
      if (!imageRef) {
        throw new Error('Unable to determine image reference for KAITO deployment');
      }
      containerImage = imageRef;
      containerArgs = ['run', '--address=:5000'];
    }

    // Build resource requirements
    const resources: Record<string, Record<string, string | number>> = {};

    if (kaitoConfig.resources?.memory) {
      resources.requests = resources.requests || {};
      resources.requests.memory = kaitoConfig.resources.memory;
    }

    if (kaitoConfig.resources?.cpu) {
      resources.requests = resources.requests || {};
      resources.requests.cpu = kaitoConfig.resources.cpu;
    }

    if (kaitoConfig.computeType === 'gpu' && kaitoConfig.resources?.gpu) {
      resources.limits = resources.limits || {};
      resources.limits['nvidia.com/gpu'] = kaitoConfig.resources.gpu;
    }

    // Build the workspace manifest
    // Note: KAITO Workspace API has resource/inference/tuning at top level, NOT inside a spec field
    const manifest: Record<string, unknown> = {
      apiVersion: `${KaitoProvider.API_GROUP}/${KaitoProvider.API_VERSION}`,
      kind: KaitoProvider.CRD_KIND,
      metadata: {
        name: kaitoConfig.name,
        namespace: kaitoConfig.namespace,
        labels: {
          'app.kubernetes.io/name': 'kubefoundry',
          'app.kubernetes.io/instance': kaitoConfig.name,
          'app.kubernetes.io/managed-by': 'kubefoundry',
          'kubefoundry.io/compute-type': kaitoConfig.computeType,
          'kubefoundry.io/model-source': kaitoConfig.modelSource,
          ...(kaitoConfig.modelSource === 'huggingface' && {
            'kubefoundry.io/run-mode': kaitoConfig.ggufRunMode || 'direct',
          }),
        },
      },
      resource: this.buildResourceSpec(kaitoConfig),
      inference: {
        template: {
          spec: {
            containers: [
              {
                name: 'model',
                image: containerImage,
                args: containerArgs,
                ports: [
                  {
                    containerPort: LLAMACPP_PORT,
                    protocol: 'TCP',
                  },
                ],
                ...(Object.keys(resources).length > 0 && { resources }),
              },
            ],
          },
        },
      },
    };

    return manifest;
  }

  /**
   * Generate vLLM manifest for HuggingFace models using kaito-base image
   * Based on: https://github.com/kaito-project/kaito/blob/main/examples/custom-model-integration/custom-model-deployment.yaml
   */
  private generateVllmManifest(config: KaitoDeploymentConfig): Record<string, unknown> {
    const gpuCount = config.resources?.gpu || 1;
    
    logger.debug(
      { name: config.name, modelId: config.modelId, gpuCount, maxModelLen: config.maxModelLen },
      'Generating vLLM KAITO Workspace manifest'
    );

    // Build vLLM command args
    const vllmArgs: string[] = [
      '-m',
      'vllm.entrypoints.openai.api_server',
      '--model',
      config.modelId!,
      '--tensor-parallel-size',
      gpuCount.toString(),
      '--trust-remote-code',
    ];

    // Add optional max-model-len if specified
    if (config.maxModelLen) {
      vllmArgs.push('--max-model-len', config.maxModelLen.toString());
    }

    // Build environment variables
    const env: Array<Record<string, unknown>> = [];
    
    // Add HF_TOKEN if gated model (hfTokenSecret is set)
    if (config.hfTokenSecret) {
      env.push({
        name: 'HF_TOKEN',
        valueFrom: {
          secretKeyRef: {
            name: config.hfTokenSecret,
            key: 'HF_TOKEN',
          },
        },
      });
    }

    // Build container spec
    const container: Record<string, unknown> = {
      name: 'model',
      image: KAITO_BASE_IMAGE,
      command: ['python'],
      args: vllmArgs,
      ports: [
        {
          containerPort: VLLM_PORT,
          protocol: 'TCP',
        },
      ],
      livenessProbe: {
        httpGet: {
          path: '/health',
          port: VLLM_PORT,
          scheme: 'HTTP',
        },
        initialDelaySeconds: 600,
        periodSeconds: 10,
        failureThreshold: 3,
      },
      readinessProbe: {
        httpGet: {
          path: '/health',
          port: VLLM_PORT,
          scheme: 'HTTP',
        },
        initialDelaySeconds: 30,
        periodSeconds: 10,
        failureThreshold: 3,
      },
      resources: {
        requests: {
          'nvidia.com/gpu': gpuCount,
        },
        limits: {
          'nvidia.com/gpu': gpuCount,
        },
      },
      volumeMounts: [
        {
          name: 'dshm',
          mountPath: '/dev/shm',
        },
      ],
    };

    // Add env if we have environment variables
    if (env.length > 0) {
      container.env = env;
    }

    // Build the workspace manifest
    const manifest: Record<string, unknown> = {
      apiVersion: `${KaitoProvider.API_GROUP}/${KaitoProvider.API_VERSION}`,
      kind: KaitoProvider.CRD_KIND,
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'kubefoundry',
          'app.kubernetes.io/instance': config.name,
          'app.kubernetes.io/managed-by': 'kubefoundry',
          'kubefoundry.io/compute-type': 'gpu',  // vLLM always requires GPU
          'kubefoundry.io/model-source': 'vllm',
        },
      },
      resource: this.buildResourceSpec(config),
      inference: {
        template: {
          spec: {
            containers: [container],
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
    };

    return manifest;
  }

  /**
   * Build the resource spec for node targeting and scaling
   * Uses preferredNodes approach to use existing nodes instead of auto-provisioning
   */
  private buildResourceSpec(config: KaitoDeploymentConfig): Record<string, unknown> {
    const resourceSpec: Record<string, unknown> = {
      count: config.replicas || 1,
    };

    // labelSelector is required by KAITO API
    if (config.labelSelector && Object.keys(config.labelSelector).length > 0) {
      resourceSpec.labelSelector = {
        matchLabels: config.labelSelector,
      };
    } else {
      // Use a common label that exists on all Linux nodes to allow scheduling anywhere
      // This avoids node affinity issues that occur with empty matchLabels
      resourceSpec.labelSelector = {
        matchLabels: {
          'kubernetes.io/os': 'linux',
        },
      };
    }

    // Use preferredNodes to specify existing nodes instead of auto-provisioning
    if (config.preferredNodes && config.preferredNodes.length > 0) {
      resourceSpec.preferredNodes = config.preferredNodes;
    }

    return resourceSpec;
  }

  /**
   * Get the image reference for a KAITO deployment
   */
  private getImageRef(config: KaitoDeploymentConfig): string | null {
    // If imageRef is already set (from build service), use it
    if (config.imageRef) {
      return config.imageRef;
    }

    // For premade models, get from AIKit service
    if (config.modelSource === 'premade' && config.premadeModel) {
      const model = aikitService.getPremadeModel(config.premadeModel);
      return model?.image || null;
    }

    // For HuggingFace models, the imageRef should have been set by the build service
    // This is a fallback that shouldn't normally be reached
    if (config.modelSource === 'huggingface') {
      return aikitService.getImageRef({
        modelSource: 'huggingface',
        modelId: config.modelId,
        ggufFile: config.ggufFile,
      });
    }

    return null;
  }

  parseStatus(raw: unknown): DeploymentStatus {
    // Note: KAITO Workspace API has resource/inference/tuning at top level, NOT inside a spec field
    const obj = raw as {
      metadata?: {
        name?: string;
        namespace?: string;
        creationTimestamp?: string;
        labels?: Record<string, string>;
      };
      resource?: {
        count?: number;
      };
      inference?: {
        template?: {
          spec?: {
            containers?: Array<{
              image?: string;
              command?: string[];
              args?: string[];
            }>;
          };
        };
      };
      status?: {
        phase?: string;
        workerNodes?: string[];
        conditions?: Array<{
          type?: string;
          status?: string;
          reason?: string;
          message?: string;
          lastTransitionTime?: string;
        }>;
      };
    };

    const metadata = obj.metadata || {};
    const resource = obj.resource || {};
    const inference = obj.inference || {};
    const status = obj.status || {};
    const labels = metadata.labels || {};

    // Determine model info from labels or inference spec
    const modelSource = labels['kubefoundry.io/model-source'] || 'unknown';
    const computeType = labels['kubefoundry.io/compute-type'] || 'cpu';
    const runMode = labels['kubefoundry.io/run-mode'] || '';
    const container = inference.template?.spec?.containers?.[0];
    const imageRef = container?.image || '';
    const containerArgs = container?.args || [];

    // Extract model ID and determine engine based on model source
    let modelId = imageRef;
    let engine: 'llamacpp' | 'vllm' = 'llamacpp';  // Default to llamacpp
    
    if (modelSource === 'vllm' || imageRef === KAITO_BASE_IMAGE) {
      // vLLM mode - extract model from --model arg
      engine = 'vllm';
      const modelArgIdx = containerArgs.findIndex(arg => arg === '--model');
      if (modelArgIdx >= 0 && containerArgs[modelArgIdx + 1]) {
        modelId = containerArgs[modelArgIdx + 1];
      }
    } else if (runMode === 'direct' || imageRef === GGUF_RUNNER_IMAGE) {
      // For direct mode, extract model name from huggingface:// URI in container args
      // Format: huggingface://org/repo/filename.gguf
      const hfArg = containerArgs.find(arg => arg.startsWith('huggingface://'));
      if (hfArg) {
        // Extract the filename from the URI (e.g., "gemma-3-1b-it-Q8_0.gguf")
        const parts = hfArg.replace('huggingface://', '').split('/');
        modelId = parts[parts.length - 1];
      }
    } else if (modelSource === 'premade') {
      // Try to find the premade model name from the image
      const premadeModel = aikitService.getPremadeModels().find(m => m.image === imageRef);
      if (premadeModel) {
        modelId = premadeModel.modelName;
      }
    }

    // Map KAITO phase to our DeploymentPhase
    // KAITO may not set phase directly, so also check conditions
    let phase = this.mapPhase(status.phase);
    
    // If phase is Pending but WorkspaceSucceeded condition is True, it's actually Running
    const workspaceSucceeded = (status.conditions || []).find(c => c.type === 'WorkspaceSucceeded');
    const inferenceReady = (status.conditions || []).find(c => c.type === 'InferenceReady');
    if (phase === 'Pending' && workspaceSucceeded?.status === 'True' && inferenceReady?.status === 'True') {
      phase = 'Running';
    }

    // Calculate replica status
    const desiredReplicas = resource.count || 1;
    const workerNodes = status.workerNodes || [];
    // readyReplicas should be min of workerNodes and desired, or 0 if not running
    const readyReplicas = phase === 'Running' ? Math.min(workerNodes.length || desiredReplicas, desiredReplicas) : 0;

    // Determine the service port and name based on engine
    // KAITO's auto-created service uses port 80 (targeting container port 5000 for llama.cpp)
    // For vLLM, we create a separate KubeFoundry-managed service on port 8000
    const servicePort = engine === 'vllm' ? VLLM_PORT : 80;  // KAITO service exposes port 80
    const serviceName = engine === 'vllm' ? `${metadata.name}-vllm` : metadata.name;

    return {
      name: metadata.name || 'unknown',
      namespace: metadata.namespace || 'default',
      modelId,
      servedModelName: metadata.name || 'unknown',
      engine,  // 'vllm' or 'llamacpp' based on model source
      mode: 'aggregated',
      phase,
      provider: this.id,
      replicas: {
        desired: desiredReplicas,
        ready: readyReplicas,
        available: readyReplicas,
      },
      conditions: (status.conditions || []).map((c) => ({
        type: c.type || '',
        status: (c.status as 'True' | 'False' | 'Unknown') || 'Unknown',
        reason: c.reason,
        message: c.message,
        lastTransitionTime: c.lastTransitionTime,
      })),
      pods: [], // Pods are managed by KAITO
      createdAt: metadata.creationTimestamp || new Date().toISOString(),
      frontendService: `${serviceName}:${servicePort}`, // Use vLLM service name for vLLM deployments
    };
  }

  /**
   * Map KAITO workspace phase to our DeploymentPhase
   */
  private mapPhase(phase?: string): DeploymentPhase {
    if (!phase) return 'Pending';

    switch (phase.toLowerCase()) {
      case 'running':
      case 'ready':
        return 'Running';
      case 'pending':
      case 'waiting':
      case 'creating':
        return 'Pending';
      case 'deploying':
      case 'provisioning':
        return 'Deploying';
      case 'failed':
      case 'error':
        return 'Failed';
      case 'terminating':
      case 'deleting':
        return 'Terminating';
      default:
        return 'Pending';
    }
  }

  validateConfig(config: unknown): { valid: boolean; errors: string[]; data?: DeploymentConfig } {
    const result = kaitoDeploymentConfigSchema.safeParse(config);

    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      logger.warn({ errors }, 'KAITO config validation failed');
      return {
        valid: false,
        errors,
      };
    }

    // Additional validation for premade models
    if (result.data.modelSource === 'premade') {
      const model = aikitService.getPremadeModel(result.data.premadeModel!);
      if (!model) {
        return {
          valid: false,
          errors: [`Unknown premade model: ${result.data.premadeModel}`],
        };
      }
    }

    logger.debug({ name: result.data.name }, 'KAITO config validated successfully');
    return {
      valid: true,
      errors: [],
      data: result.data as unknown as DeploymentConfig,
    };
  }

  getConfigSchema() {
    return kaitoDeploymentConfigSchema;
  }

  getInstallationSteps(): InstallationStep[] {
    return [
      {
        title: 'Add KAITO Helm Repository',
        command: 'helm repo add kaito https://kaito-project.github.io/kaito/charts/kaito',
        description: 'Add the KAITO Helm repository.',
      },
      {
        title: 'Update Helm Repositories',
        command: 'helm repo update',
        description: 'Update local Helm repository cache.',
      },
      {
        title: 'Install KAITO Workspace Operator',
        command: `helm upgrade --install kaito-workspace kaito/workspace --version ${KAITO_VERSION} -n kaito-workspace --create-namespace --wait`,
        description: `Install the KAITO workspace operator v${KAITO_VERSION} which manages AI workloads.`,
      },
    ];
  }

  getHelmRepos(): HelmRepo[] {
    return [
      {
        name: 'kaito',
        url: 'https://kaito-project.github.io/kaito/charts/kaito',
      },
    ];
  }

  getHelmCharts(): HelmChart[] {
    return [
      {
        name: 'kaito-workspace',
        chart: 'kaito/workspace',
        version: KAITO_VERSION,
        namespace: 'kaito-workspace',
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

    logger.debug('Checking KAITO installation status');

    try {
      // Check if CRD exists by trying to list resources
      let crdFound = false;
      try {
        await customObjectsApi.listNamespacedCustomObject(
          KaitoProvider.API_GROUP,
          KaitoProvider.API_VERSION,
          this.defaultNamespace,
          KaitoProvider.CRD_PLURAL
        );
        crdFound = true;
        logger.debug('KAITO CRD found');
      } catch (error: unknown) {
        const k8sError = error as { response?: { statusCode?: number } };
        // 404 means CRD doesn't exist, other errors might be permissions
        if (k8sError?.response?.statusCode === 404) {
          crdFound = false;
          logger.debug('KAITO CRD not found');
        }
      }

      // Check if operator is running in kaito-workspace namespace (operator namespace)
      // Note: this.defaultNamespace is for deployments, operator runs in 'kaito-workspace'
      const operatorNamespace = 'kaito-workspace';
      let operatorRunning = false;
      try {
        const pods = await coreV1Api.listNamespacedPod(
          operatorNamespace,
          undefined,
          undefined,
          undefined,
          undefined,
          'app.kubernetes.io/name=kaito-workspace'
        );
        operatorRunning = pods.body.items.some(
          pod => pod.status?.phase === 'Running'
        );

        // Also check alternative label patterns
        if (!operatorRunning) {
          const allPods = await coreV1Api.listNamespacedPod(operatorNamespace);
          operatorRunning = allPods.body.items.some(
            pod => pod.status?.phase === 'Running' &&
            (pod.metadata?.name?.includes('kaito') || pod.metadata?.name?.includes('workspace'))
          );
        }
      } catch {
        // Namespace might not exist
        operatorRunning = false;
      }

      const installed = crdFound && operatorRunning;
      logger.info({ installed, crdFound, operatorRunning }, 'KAITO installation check complete');

      return {
        installed,
        crdFound,
        operatorRunning,
        message: installed
          ? 'KAITO is installed and running'
          : !crdFound
          ? 'KAITO CRD not found. Please install the KAITO operator.'
          : 'KAITO operator is not running',
      };
    } catch (error) {
      logger.error({ error }, 'Error checking KAITO installation');
      return {
        installed: false,
        message: `Error checking installation: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  getMetricsConfig(): MetricsEndpointConfig | null {
    // KAITO supports both llama.cpp (port 5000) and vLLM (port 8000)
    // The actual port is determined by the deployment's model source label
    // For now, return llama.cpp config as default - caller should check deployment labels
    return {
      endpointPath: '/metrics',
      port: LLAMACPP_PORT,
      serviceNamePattern: '{name}',
    };
  }

  /**
   * Get metrics config for a specific model source
   * @param modelSource - 'vllm', 'huggingface', or 'premade'
   */
  getMetricsConfigForModelSource(modelSource: string): MetricsEndpointConfig | null {
    const port = modelSource === 'vllm' ? VLLM_PORT : LLAMACPP_PORT;
    return {
      endpointPath: '/metrics',
      port,
      serviceNamePattern: '{name}',
    };
  }

  getKeyMetrics(): MetricDefinition[] {
    // Return metrics for both llama.cpp and vLLM
    // The frontend/metrics service will filter based on what's actually available
    return [
      // llama.cpp/AIKit metrics
      {
        name: 'llamacpp_requests_processing',
        displayName: 'Processing Requests',
        description: 'Number of requests currently being processed',
        unit: 'requests',
        type: 'gauge',
        category: 'queue',
      },
      {
        name: 'llamacpp_requests_pending',
        displayName: 'Pending Requests',
        description: 'Number of requests waiting in queue',
        unit: 'requests',
        type: 'gauge',
        category: 'queue',
      },
      {
        name: 'llamacpp_kv_cache_usage_ratio',
        displayName: 'KV Cache Usage',
        description: 'KV cache usage ratio',
        unit: '%',
        type: 'gauge',
        category: 'cache',
      },
      {
        name: 'llamacpp_tokens_predicted_total',
        displayName: 'Tokens Generated',
        description: 'Total tokens generated',
        unit: 'tokens/s',
        type: 'counter',
        category: 'throughput',
      },
      {
        name: 'llamacpp_prompt_tokens_processed_total',
        displayName: 'Prompt Tokens',
        description: 'Total prompt tokens processed',
        unit: 'tokens/s',
        type: 'counter',
        category: 'throughput',
      },
      // vLLM metrics
      {
        name: 'vllm:num_requests_running',
        displayName: 'Running Requests',
        description: 'Number of requests currently running',
        unit: 'requests',
        type: 'gauge',
        category: 'queue',
      },
      {
        name: 'vllm:num_requests_waiting',
        displayName: 'Waiting Requests',
        description: 'Number of requests waiting in queue',
        unit: 'requests',
        type: 'gauge',
        category: 'queue',
      },
      {
        name: 'vllm:gpu_cache_usage_perc',
        displayName: 'GPU Cache Usage',
        description: 'GPU KV cache usage percentage',
        unit: '%',
        type: 'gauge',
        category: 'cache',
      },
      {
        name: 'vllm:avg_generation_throughput_toks_per_s',
        displayName: 'Generation Throughput',
        description: 'Average tokens generated per second',
        unit: 'tokens/s',
        type: 'gauge',
        category: 'throughput',
      },
    ];
  }

  getUninstallResources(): UninstallResources {
    return {
      // KAITO CRDs: workspaces.kaito.sh, ragengines.kaito.sh
      crds: [
        `${KaitoProvider.CRD_PLURAL}.${KaitoProvider.API_GROUP}`,
        `ragengines.${KaitoProvider.API_GROUP}`,
      ],
      // KAITO operator namespace
      namespaces: ['kaito-workspace'],
    };
  }
}

// Export singleton instance
export const kaitoProvider = new KaitoProvider();
