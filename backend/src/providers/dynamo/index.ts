import * as k8s from '@kubernetes/client-node';
import type { DeploymentConfig, DeploymentStatus, DeploymentPhase, MetricDefinition, MetricsEndpointConfig } from '@kubefoundry/shared';
import type { Provider, CRDConfig, HelmRepo, HelmChart, InstallationStatus, InstallationStep, UninstallResources } from '../types';
import { dynamoDeploymentConfigSchema, type DynamoDeploymentConfig } from './schema';
import logger from '../../lib/logger';

// Default fallback version if GitHub fetch fails
const DEFAULT_DYNAMO_VERSION = '0.7.1';

// NVIDIA Dynamo runtime images
const DYNAMO_RUNTIME_IMAGES = {
  vllm: 'nvcr.io/nvidia/ai-dynamo/vllm-runtime',
  sglang: 'nvcr.io/nvidia/ai-dynamo/sglang-runtime',
  trtllm: 'nvcr.io/nvidia/ai-dynamo/tensorrtllm-runtime',
} as const;

// GitHub API URL for Dynamo releases
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/ai-dynamo/dynamo/releases/latest';

// Cache for the latest version
let cachedVersion: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 3600000; // 1 hour

/**
 * Fetch the latest Dynamo version from GitHub releases
 */
async function fetchLatestDynamoVersion(): Promise<string> {
  // Check cache first
  if (cachedVersion && (Date.now() - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedVersion;
  }

  try {
    const response = await fetch(GITHUB_RELEASES_URL, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'KubeFoundry',
      },
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Failed to fetch Dynamo version from GitHub');
      return cachedVersion || process.env.DYNAMO_VERSION || DEFAULT_DYNAMO_VERSION;
    }

    const data = await response.json() as { tag_name?: string };
    const tagName = data.tag_name;

    if (tagName) {
      // Remove 'v' prefix if present (e.g., 'v0.7.1' -> '0.7.1')
      cachedVersion = tagName.startsWith('v') ? tagName.slice(1) : tagName;
      cacheTimestamp = Date.now();
      logger.info({ version: cachedVersion }, 'Fetched latest Dynamo version from GitHub');
      return cachedVersion;
    }

    return cachedVersion || process.env.DYNAMO_VERSION || DEFAULT_DYNAMO_VERSION;
  } catch (error) {
    logger.warn({ error }, 'Error fetching Dynamo version from GitHub, using fallback');
    return cachedVersion || process.env.DYNAMO_VERSION || DEFAULT_DYNAMO_VERSION;
  }
}

/**
 * Get the current Dynamo version (sync - uses cached value or fallback)
 */
function getDynamoVersion(): string {
  return cachedVersion || process.env.DYNAMO_VERSION || DEFAULT_DYNAMO_VERSION;
}

/**
 * NVIDIA Dynamo Provider
 * Implements the Provider interface for NVIDIA's Dynamo inference platform
 */
export class DynamoProvider implements Provider {
  id = 'dynamo';
  name = 'NVIDIA Dynamo';
  description = 'NVIDIA Dynamo is a high-performance inference serving platform for LLMs with support for KV cache routing and disaggregated serving.';
  defaultNamespace = 'dynamo-system';

  // CRD Constants
  private static readonly API_GROUP = 'nvidia.com';
  private static readonly API_VERSION = 'v1alpha1';
  private static readonly CRD_PLURAL = 'dynamographdeployments';
  private static readonly CRD_KIND = 'DynamoGraphDeployment';

  /**
   * Refresh the cached Dynamo version from GitHub releases
   * Call this before installation to ensure we have the latest version
   */
  async refreshVersion(): Promise<string> {
    return fetchLatestDynamoVersion();
  }

  getCRDConfig(): CRDConfig {
    return {
      apiGroup: DynamoProvider.API_GROUP,
      apiVersion: DynamoProvider.API_VERSION,
      plural: DynamoProvider.CRD_PLURAL,
      kind: DynamoProvider.CRD_KIND,
    };
  }

  generateManifest(config: DeploymentConfig): Record<string, unknown> {
    const dynamoConfig = config as DynamoDeploymentConfig;

    logger.debug({ name: config.name, mode: dynamoConfig.mode, engine: dynamoConfig.engine }, 'Generating Dynamo manifest');

    if (dynamoConfig.mode === 'disaggregated') {
      return this.generateDisaggregatedManifest(dynamoConfig);
    }
    return this.generateAggregatedManifest(dynamoConfig);
  }

  /**
   * Generate manifest for aggregated (standard) serving mode
   * Uses the correct DynamoGraphDeployment spec.services format
   */
  private generateAggregatedManifest(config: DynamoDeploymentConfig): Record<string, unknown> {
    const workerSpec = this.generateWorkerSpec(config);
    const frontendSpec = this.generateFrontendSpec(config);

    // Build services map with Frontend and appropriate worker
    const services: Record<string, unknown> = {
      Frontend: frontendSpec,
      ...workerSpec,
    };

    return {
      apiVersion: `${DynamoProvider.API_GROUP}/${DynamoProvider.API_VERSION}`,
      kind: DynamoProvider.CRD_KIND,
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'kubefoundry',
          'app.kubernetes.io/instance': config.name,
          'app.kubernetes.io/managed-by': 'kubefoundry',
          'kubefoundry.io/provider': 'dynamo',
        },
      },
      spec: {
        backendFramework: config.engine,
        services,
      },
    };
  }

  /**
   * Generate manifest for disaggregated (P/D) serving mode
   * Creates separate prefill and decode workers with engine-specific flags
   * Uses the correct DynamoGraphDeployment spec.services format
   */
  private generateDisaggregatedManifest(config: DynamoDeploymentConfig): Record<string, unknown> {
    const frontendSpec = this.generateFrontendSpec(config);
    const prefillWorkerSpec = this.generateDisaggregatedWorkerSpec(config, 'prefill');
    const decodeWorkerSpec = this.generateDisaggregatedWorkerSpec(config, 'decode');

    // Build services map with Frontend and both prefill/decode workers
    const services: Record<string, unknown> = {
      Frontend: frontendSpec,
      ...prefillWorkerSpec,
      ...decodeWorkerSpec,
    };

    return {
      apiVersion: `${DynamoProvider.API_GROUP}/${DynamoProvider.API_VERSION}`,
      kind: DynamoProvider.CRD_KIND,
      metadata: {
        name: config.name,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'kubefoundry',
          'app.kubernetes.io/instance': config.name,
          'app.kubernetes.io/managed-by': 'kubefoundry',
          'kubefoundry.io/provider': 'dynamo',
        },
      },
      spec: {
        backendFramework: config.engine,
        services,
      },
    };
  }

  private generateFrontendSpec(config: DynamoDeploymentConfig): Record<string, unknown> {
    const version = getDynamoVersion();
    const runtimeImage = `${DYNAMO_RUNTIME_IMAGES[config.engine]}:${version}`;

    const spec: Record<string, unknown> = {
      componentType: 'frontend',
      dynamoNamespace: config.name,
      replicas: 1,
    };

    // Use round-robin router for disaggregated mode if not specified
    const routerMode = config.mode === 'disaggregated' && config.routerMode === 'none'
      ? 'round-robin'
      : config.routerMode;

    if (routerMode !== 'none') {
      spec['router-mode'] = routerMode;
    }

    // Add HF token secret for frontend as well
    if (config.hfTokenSecret) {
      spec.envFromSecret = config.hfTokenSecret;
    }

    // Add extraPodSpec with image in mainContainer
    spec.extraPodSpec = {
      mainContainer: {
        image: runtimeImage,
        workingDir: '/workspace/examples/backends/' + config.engine,
      },
    };

    return spec;
  }

  private generateWorkerSpec(config: DynamoDeploymentConfig): Record<string, unknown> {
    const version = getDynamoVersion();
    const runtimeImage = `${DYNAMO_RUNTIME_IMAGES[config.engine]}:${version}`;

    const baseSpec: Record<string, unknown> = {
      componentType: 'worker',
      dynamoNamespace: config.name,
      replicas: config.replicas,
    };

    // Add HF token secret
    if (config.hfTokenSecret) {
      baseSpec.envFromSecret = config.hfTokenSecret;
    }

    // Add resource requirements in the correct format
    if (config.resources) {
      baseSpec.resources = {
        limits: {
          'nvidia.com/gpu': String(config.resources.gpu),
          ...(config.resources.memory && { memory: config.resources.memory }),
        },
        requests: {
          'nvidia.com/gpu': String(config.resources.gpu),
          ...(config.resources.memory && { memory: config.resources.memory }),
        },
      };
    }

    // Build extraPodSpec with mainContainer for model configuration
    const mainContainer: Record<string, unknown> = {
      image: runtimeImage,
      workingDir: '/workspace/examples/backends/' + config.engine,
    };

    // Build args for the inference engine
    const args: string[] = [];
    args.push(`python3 -m dynamo.${config.engine}`);
    args.push(`--model ${config.modelId}`);
    
    if (config.servedModelName) {
      args.push(`--served-model-name ${config.servedModelName}`);
    }

    if (config.enforceEager) {
      args.push('--enforce-eager');
    }

    if (config.enablePrefixCaching) {
      args.push('--enable-prefix-caching');
    }

    if (config.trustRemoteCode) {
      args.push('--trust-remote-code');
    }

    if (config.contextLength) {
      args.push(`--max-model-len ${config.contextLength}`);
    }

    // Add engine-specific arguments
    if (config.engineArgs) {
      Object.entries(config.engineArgs).forEach(([key, value]) => {
        if (typeof value === 'boolean' && value) {
          args.push(`--${key}`);
        } else if (typeof value !== 'boolean') {
          args.push(`--${key} ${value}`);
        }
      });
    }

    mainContainer.command = ['/bin/sh', '-c'];
    mainContainer.args = [args.join(' ')];

    baseSpec.extraPodSpec = {
      mainContainer,
    };

    // Return with appropriate worker key based on engine
    switch (config.engine) {
      case 'vllm':
        return { VllmWorker: baseSpec };
      case 'sglang':
        return { SglangWorker: baseSpec };
      case 'trtllm':
        return { TrtllmWorker: baseSpec };
      default:
        return { VllmWorker: baseSpec };
    }
  }

  /**
   * Generate worker spec for disaggregated mode (prefill or decode)
   * Each engine has different flags for disaggregation:
   * - vllm: --is-prefill-worker for prefill workers (decode has no flag)
   * - sglang: --disaggregation-mode prefill|decode
   * - trtllm: --disaggregation-mode prefill|decode
   */
  private generateDisaggregatedWorkerSpec(
    config: DynamoDeploymentConfig,
    role: 'prefill' | 'decode'
  ): Record<string, unknown> {
    const isPrefill = role === 'prefill';
    const replicas = isPrefill ? (config.prefillReplicas || 1) : (config.decodeReplicas || 1);
    const gpus = isPrefill ? (config.prefillGpus || 1) : (config.decodeGpus || 1);
    const version = getDynamoVersion();
    const runtimeImage = `${DYNAMO_RUNTIME_IMAGES[config.engine]}:${version}`;

    const baseSpec: Record<string, unknown> = {
      componentType: 'worker',
      subComponentType: role,
      dynamoNamespace: config.name,
      replicas,
    };

    // Add HF token secret
    if (config.hfTokenSecret) {
      baseSpec.envFromSecret = config.hfTokenSecret;
    }

    // Add resource requirements
    baseSpec.resources = {
      limits: {
        'nvidia.com/gpu': String(gpus),
        ...(config.resources?.memory && { memory: config.resources.memory }),
      },
      requests: {
        'nvidia.com/gpu': String(gpus),
        ...(config.resources?.memory && { memory: config.resources.memory }),
      },
    };

    // Build args for the inference engine
    const args: string[] = [];
    args.push(`python3 -m dynamo.${config.engine}`);
    args.push(`--model ${config.modelId}`);
    
    if (config.servedModelName) {
      args.push(`--served-model-name ${config.servedModelName}`);
    }

    if (config.enforceEager) {
      args.push('--enforce-eager');
    }

    if (config.enablePrefixCaching) {
      args.push('--enable-prefix-caching');
    }

    if (config.trustRemoteCode) {
      args.push('--trust-remote-code');
    }

    if (config.contextLength) {
      args.push(`--max-model-len ${config.contextLength}`);
    }

    // Add engine-specific disaggregation flags
    switch (config.engine) {
      case 'vllm':
        if (isPrefill) {
          args.push('--is-prefill-worker');
        }
        break;
      case 'sglang':
      case 'trtllm':
        args.push(`--disaggregation-mode ${role}`);
        break;
    }

    // Add engine-specific arguments
    if (config.engineArgs) {
      Object.entries(config.engineArgs).forEach(([key, value]) => {
        if (typeof value === 'boolean' && value) {
          args.push(`--${key}`);
        } else if (typeof value !== 'boolean') {
          args.push(`--${key} ${value}`);
        }
      });
    }

    baseSpec.extraPodSpec = {
      mainContainer: {
        image: runtimeImage,
        workingDir: '/workspace/examples/backends/' + config.engine,
        command: ['/bin/sh', '-c'],
        args: [args.join(' ')],
      },
    };

    // Return with appropriate worker key based on engine
    switch (config.engine) {
      case 'vllm':
        return { [`Vllm${isPrefill ? 'Prefill' : 'Decode'}Worker`]: baseSpec };
      case 'sglang':
        return { [`Sglang${isPrefill ? 'Prefill' : 'Decode'}Worker`]: baseSpec };
      case 'trtllm':
        return { [`Trtllm${isPrefill ? 'Prefill' : 'Decode'}Worker`]: baseSpec };
      default:
        return { [`Vllm${isPrefill ? 'Prefill' : 'Decode'}Worker`]: baseSpec };
    }
  }

  parseStatus(raw: unknown): DeploymentStatus {
    interface WorkerSpec {
      replicas?: number;
      componentType?: string;
      dynamoNamespace?: string;
      extraPodSpec?: {
        mainContainer?: {
          args?: string[];
        };
      };
    }

    const obj = raw as {
      metadata?: { name?: string; namespace?: string; creationTimestamp?: string };
      spec?: {
        backendFramework?: string;
        services?: Record<string, WorkerSpec>;
        // Legacy format support (direct workers in spec)
        VllmWorker?: WorkerSpec;
        SglangWorker?: WorkerSpec;
        TrtllmWorker?: WorkerSpec;
        VllmPrefillWorker?: WorkerSpec;
        VllmDecodeWorker?: WorkerSpec;
        SglangPrefillWorker?: WorkerSpec;
        SglangDecodeWorker?: WorkerSpec;
        TrtllmPrefillWorker?: WorkerSpec;
        TrtllmDecodeWorker?: WorkerSpec;
        Frontend?: WorkerSpec;
      };
      status?: {
        phase?: string;
        state?: string;
        replicas?: { ready?: number; available?: number; desired?: number };
        services?: Record<string, { desired?: number; ready?: number; available?: number }>;
        prefillReplicas?: { ready?: number; desired?: number };
        decodeReplicas?: { ready?: number; desired?: number };
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

    // Get services from the new format, or build from legacy format
    const services = spec.services || {} as Record<string, WorkerSpec>;
    
    // If no services map, check for legacy format (workers directly in spec)
    const hasLegacyFormat = !spec.services && (
      spec.VllmWorker || spec.SglangWorker || spec.TrtllmWorker ||
      spec.VllmPrefillWorker || spec.VllmDecodeWorker ||
      spec.SglangPrefillWorker || spec.SglangDecodeWorker ||
      spec.TrtllmPrefillWorker || spec.TrtllmDecodeWorker
    );
    
    if (hasLegacyFormat) {
      // Copy legacy workers to services for unified processing
      if (spec.VllmWorker) services.VllmWorker = spec.VllmWorker;
      if (spec.SglangWorker) services.SglangWorker = spec.SglangWorker;
      if (spec.TrtllmWorker) services.TrtllmWorker = spec.TrtllmWorker;
      if (spec.VllmPrefillWorker) services.VllmPrefillWorker = spec.VllmPrefillWorker;
      if (spec.VllmDecodeWorker) services.VllmDecodeWorker = spec.VllmDecodeWorker;
      if (spec.SglangPrefillWorker) services.SglangPrefillWorker = spec.SglangPrefillWorker;
      if (spec.SglangDecodeWorker) services.SglangDecodeWorker = spec.SglangDecodeWorker;
      if (spec.TrtllmPrefillWorker) services.TrtllmPrefillWorker = spec.TrtllmPrefillWorker;
      if (spec.TrtllmDecodeWorker) services.TrtllmDecodeWorker = spec.TrtllmDecodeWorker;
      if (spec.Frontend) services.Frontend = spec.Frontend;
    }

    // Determine engine from backendFramework or from service keys
    let engine: 'vllm' | 'sglang' | 'trtllm' = 'vllm';
    if (spec.backendFramework) {
      engine = spec.backendFramework as 'vllm' | 'sglang' | 'trtllm';
    } else {
      // Infer from service keys
      for (const key of Object.keys(services)) {
        if (key.toLowerCase().includes('vllm')) { engine = 'vllm'; break; }
        if (key.toLowerCase().includes('sglang')) { engine = 'sglang'; break; }
        if (key.toLowerCase().includes('trtllm')) { engine = 'trtllm'; break; }
      }
    }

    // Extract model info from worker args
    let modelId = '';
    let servedModelName = '';
    let desiredReplicas = 1;
    let mode: 'aggregated' | 'disaggregated' = 'aggregated';
    let prefillDesired = 0;
    let decodeDesired = 0;

    // Check for disaggregated workers
    const prefillWorker = services.VllmPrefillWorker || services.SglangPrefillWorker || services.TrtllmPrefillWorker;
    const decodeWorker = services.VllmDecodeWorker || services.SglangDecodeWorker || services.TrtllmDecodeWorker;
    
    if (prefillWorker || decodeWorker) {
      mode = 'disaggregated';
      const worker = prefillWorker || decodeWorker;
      // Try to extract model from args
      const args = worker?.extraPodSpec?.mainContainer?.args?.[0] || '';
      const modelMatch = args.match(/--model\s+(\S+)/);
      if (modelMatch) modelId = modelMatch[1];
      const servedMatch = args.match(/--served-model-name\s+(\S+)/);
      if (servedMatch) servedModelName = servedMatch[1];
      prefillDesired = prefillWorker?.replicas || 0;
      decodeDesired = decodeWorker?.replicas || 0;
      desiredReplicas = prefillDesired + decodeDesired;
    } else {
      // Aggregated mode - find worker
      const worker = services.VllmWorker || services.SglangWorker || services.TrtllmWorker;
      if (worker) {
        desiredReplicas = worker.replicas || 1;
        // Try to extract model from args
        const args = worker.extraPodSpec?.mainContainer?.args?.[0] || '';
        const modelMatch = args.match(/--model\s+(\S+)/);
        if (modelMatch) modelId = modelMatch[1];
        const servedMatch = args.match(/--served-model-name\s+(\S+)/);
        if (servedMatch) servedModelName = servedMatch[1];
      }
    }

    // Determine phase from status
    let phase: DeploymentPhase = 'Pending';
    if (status.state === 'successful') {
      phase = 'Running';
    } else if (status.phase) {
      phase = status.phase as DeploymentPhase;
    } else if (status.conditions?.some(c => c.type === 'Ready' && c.status === 'True')) {
      phase = 'Running';
    }

    const result: DeploymentStatus = {
      name: obj.metadata?.name || 'unknown',
      namespace: obj.metadata?.namespace || 'default',
      modelId,
      servedModelName: servedModelName || obj.metadata?.name || 'unknown',
      engine,
      mode,
      phase,
      provider: this.id,
      replicas: {
        desired: status.replicas?.desired || desiredReplicas,
        ready: status.replicas?.ready || 0,
        available: status.replicas?.available || 0,
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
      frontendService: `${obj.metadata?.name}-frontend`,
    };

    // Add disaggregated replica status if in disaggregated mode
    if (mode === 'disaggregated') {
      result.prefillReplicas = {
        desired: status.prefillReplicas?.desired || prefillDesired,
        ready: status.prefillReplicas?.ready || 0,
      };
      result.decodeReplicas = {
        desired: status.decodeReplicas?.desired || decodeDesired,
        ready: status.decodeReplicas?.ready || 0,
      };
    }

    return result;
  }

  validateConfig(config: unknown): { valid: boolean; errors: string[]; data?: DeploymentConfig } {
    const result = dynamoDeploymentConfigSchema.safeParse(config);

    if (!result.success) {
      const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      logger.warn({ errors }, 'Dynamo config validation failed');
      return {
        valid: false,
        errors,
      };
    }

    logger.debug({ name: result.data.name }, 'Dynamo config validated successfully');
    return {
      valid: true,
      errors: [],
      data: result.data as DeploymentConfig,
    };
  }

  getConfigSchema() {
    return dynamoDeploymentConfigSchema;
  }

  getInstallationSteps(): InstallationStep[] {
    const version = getDynamoVersion();
    return [
      {
        title: 'Set Environment Variables',
        command: `export NAMESPACE=dynamo-system\nexport RELEASE_VERSION=${version}`,
        description: 'Set the namespace and release version for Dynamo installation.',
      },
      {
        title: 'Fetch and Install Dynamo CRDs',
        command: `helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-${version}.tgz && helm install dynamo-crds dynamo-crds-${version}.tgz --namespace default`,
        description: 'Install the Dynamo Custom Resource Definitions.',
      },
      {
        title: 'Fetch and Install Dynamo Platform',
        command: `helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-${version}.tgz && helm install dynamo-platform dynamo-platform-${version}.tgz --namespace dynamo-system --create-namespace`,
        description: 'Install the Dynamo platform which manages inference deployments.',
      },
    ];
  }

  getHelmRepos(): HelmRepo[] {
    // No repos needed - we use direct fetch URLs
    return [];
  }

  getHelmCharts(): HelmChart[] {
    const version = getDynamoVersion();
    return [
      {
        name: 'dynamo-crds',
        chart: `dynamo-crds-${version}.tgz`,
        fetchUrl: `https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-${version}.tgz`,
        namespace: 'default',
        createNamespace: false,
      },
      {
        name: 'dynamo-platform',
        chart: `dynamo-platform-${version}.tgz`,
        fetchUrl: `https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-${version}.tgz`,
        namespace: 'dynamo-system',
        createNamespace: true,
      },
    ];
  }

  async checkInstallation(k8sApi: {
    customObjectsApi: unknown;
    coreV1Api: unknown;
    apiExtensionsApi?: unknown;
  }): Promise<InstallationStatus> {
    const coreV1Api = k8sApi.coreV1Api as k8s.CoreV1Api;
    const apiExtensionsApi = k8sApi.apiExtensionsApi as k8s.ApiextensionsV1Api | undefined;

    logger.debug('Checking Dynamo installation status');

    try {
      // Check if CRD exists by looking for any Dynamo CRDs
      let crdFound = false;
      
      // List of known Dynamo CRDs to check for
      const dynamoCRDs = [
        `dynamocomponentdeployments.${DynamoProvider.API_GROUP}`,
        `dynamographdeploymentrequests.${DynamoProvider.API_GROUP}`,
        `dynamomodels.${DynamoProvider.API_GROUP}`,
        `${DynamoProvider.CRD_PLURAL}.${DynamoProvider.API_GROUP}`,
      ];
      
      if (apiExtensionsApi) {
        try {
          const crdsResponse = await apiExtensionsApi.listCustomResourceDefinition();
          const installedCRDs = crdsResponse.body.items.map(crd => crd.metadata?.name || '');
          
          // Check if any Dynamo CRD is installed
          crdFound = dynamoCRDs.some(crdName => installedCRDs.includes(crdName));
          logger.debug({ crdFound, installedDynamoCRDs: installedCRDs.filter(name => name.includes('dynamo')) }, 'Dynamo CRD check via apiextensions');
        } catch (error) {
          logger.warn({ error }, 'Failed to list CRDs via apiextensions API');
        }
      }
      
      // Fallback: try to list custom objects if apiExtensionsApi didn't work
      if (!crdFound && k8sApi.customObjectsApi) {
        const customObjectsApi = k8sApi.customObjectsApi as k8s.CustomObjectsApi;
        try {
          await customObjectsApi.listNamespacedCustomObject(
            DynamoProvider.API_GROUP,
            DynamoProvider.API_VERSION,
            this.defaultNamespace,
            DynamoProvider.CRD_PLURAL
          );
          crdFound = true;
          logger.debug('Dynamo CRD found via custom objects API');
        } catch (error: unknown) {
          const k8sError = error as { response?: { statusCode?: number } };
          // 404 means CRD doesn't exist, other errors might be permissions
          if (k8sError?.response?.statusCode === 404) {
            logger.debug('Dynamo CRD not found via custom objects API');
          }
        }
      }

      // Check if operator is running
      let operatorRunning = false;
      try {
        const pods = await coreV1Api.listNamespacedPod(
          this.defaultNamespace,
          undefined,
          undefined,
          undefined,
          undefined,
          'app.kubernetes.io/name=dynamo-operator'
        );
        operatorRunning = pods.body.items.some(
          pod => pod.status?.phase === 'Running'
        );
      } catch {
        // Namespace might not exist
        operatorRunning = false;
      }

      const installed = crdFound && operatorRunning;
      logger.info({ installed, crdFound, operatorRunning }, 'Dynamo installation check complete');

      return {
        installed,
        crdFound,
        operatorRunning,
        message: installed
          ? 'Dynamo is installed and running'
          : !crdFound
          ? 'Dynamo CRD not found. Please install the Dynamo operator.'
          : 'Dynamo operator is not running',
      };
    } catch (error) {
      logger.error({ error }, 'Error checking Dynamo installation');
      return {
        installed: false,
        message: `Error checking installation: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  getMetricsConfig(): MetricsEndpointConfig | null {
    return {
      endpointPath: '/metrics',
      port: 8000,
      // Dynamo creates a service named {deployment-name}-frontend
      serviceNamePattern: '{name}-frontend',
    };
  }

  getKeyMetrics(): MetricDefinition[] {
    return [
      // Queue metrics
      {
        name: 'vllm:num_requests_running',
        displayName: 'Running Requests',
        description: 'Number of requests currently running on GPU',
        unit: 'requests',
        type: 'gauge',
        category: 'queue',
      },
      {
        name: 'vllm:num_requests_waiting',
        displayName: 'Waiting Requests',
        description: 'Number of requests waiting to be processed',
        unit: 'requests',
        type: 'gauge',
        category: 'queue',
      },
      // Cache metrics
      {
        name: 'vllm:gpu_cache_usage_perc',
        displayName: 'GPU KV-Cache Usage',
        description: 'GPU KV-cache usage percentage (1 = 100%)',
        unit: '%',
        type: 'gauge',
        category: 'cache',
      },
      {
        name: 'vllm:gpu_prefix_cache_hit_rate',
        displayName: 'Prefix Cache Hit Rate',
        description: 'GPU prefix cache block hit rate',
        unit: '%',
        type: 'gauge',
        category: 'cache',
      },
      // Latency metrics (histograms - use _sum and _count for averages)
      {
        name: 'vllm:e2e_request_latency_seconds',
        displayName: 'Avg Request Latency',
        description: 'End-to-end request latency',
        unit: 'ms',
        type: 'histogram',
        category: 'latency',
      },
      {
        name: 'vllm:time_to_first_token_seconds',
        displayName: 'Avg Time to First Token',
        description: 'Time to first token (TTFT)',
        unit: 'ms',
        type: 'histogram',
        category: 'latency',
      },
      {
        name: 'vllm:time_per_output_token_seconds',
        displayName: 'Avg Time per Token',
        description: 'Time per output token',
        unit: 'ms',
        type: 'histogram',
        category: 'latency',
      },
      // Throughput metrics (counters - calculate rate)
      {
        name: 'vllm:prompt_tokens_total',
        displayName: 'Prompt Tokens',
        description: 'Number of prefill tokens processed',
        unit: 'tokens/s',
        type: 'counter',
        category: 'throughput',
      },
      {
        name: 'vllm:generation_tokens_total',
        displayName: 'Generation Tokens',
        description: 'Number of generation tokens processed',
        unit: 'tokens/s',
        type: 'counter',
        category: 'throughput',
      },
      {
        name: 'vllm:request_success_total',
        displayName: 'Successful Requests',
        description: 'Count of successfully processed requests',
        unit: 'req/s',
        type: 'counter',
        category: 'throughput',
      },
    ];
  }

  supportsGAIE(): boolean {
    return true; // Dynamo supports Gateway API Inference Extension
  }

  generateHTTPRoute(config: DeploymentConfig): Record<string, unknown> {
    const modelName = config.servedModelName || config.modelId;
    
    if (!config.gatewayName || !config.gatewayNamespace) {
      throw new Error('gatewayName and gatewayNamespace are required when enableGatewayRouting is true');
    }
    
    // Dynamo convention: InferencePool name is based on deployment name with -pool suffix
    const inferencePoolName = `${config.name}-pool`;
    
    return {
      apiVersion: 'gateway.networking.k8s.io/v1',
      kind: 'HTTPRoute',
      metadata: {
        name: `${config.name}-route`,
        namespace: config.namespace,
        labels: {
          'app.kubernetes.io/name': 'kubefoundry',
          'app.kubernetes.io/instance': config.name,
          'app.kubernetes.io/managed-by': 'kubefoundry',
          'kubefoundry.io/provider': 'dynamo',
        },
      },
      spec: {
        parentRefs: [
          {
            name: config.gatewayName,
            namespace: config.gatewayNamespace,
          },
        ],
        rules: [
          {
            matches: [
              {
                headers: [
                  {
                    type: 'Exact',
                    name: 'X-Gateway-Model-Name',
                    value: modelName,
                  },
                ],
              },
            ],
            backendRefs: [
              {
                group: 'inference.networking.k8s.io',
                kind: 'InferencePool',
                name: inferencePoolName,
              },
            ],
          },
        ],
      },
    };
  }

  getUninstallResources(): UninstallResources {
    return {
      // Dynamo CRDs installed by dynamo-crds chart
      crds: [
        `dynamocomponentdeployments.${DynamoProvider.API_GROUP}`,
        `dynamographdeploymentrequests.${DynamoProvider.API_GROUP}`,
        `dynamomodels.${DynamoProvider.API_GROUP}`,
        `${DynamoProvider.CRD_PLURAL}.${DynamoProvider.API_GROUP}`,
        `dynamodeployments.${DynamoProvider.API_GROUP}`,
        `dynamojobs.${DynamoProvider.API_GROUP}`,
        `dynamocomponentsets.${DynamoProvider.API_GROUP}`,
      ],
      // Dynamo platform namespace
      namespaces: ['dynamo-system'],
    };
  }
}

// Export singleton instance
export const dynamoProvider = new DynamoProvider();
