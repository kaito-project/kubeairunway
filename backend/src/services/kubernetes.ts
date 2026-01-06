import * as k8s from '@kubernetes/client-node';
import { configService } from './config';
import { providerRegistry } from '../providers';
import type { DeploymentStatus, PodStatus, ClusterStatus, PodPhase, DeploymentConfig, RuntimeStatus } from '@kubefoundry/shared';
import type { InstallationStatus } from '../providers/types';
import { withRetry, isK8sRetryableError } from '../lib/retry';
import logger from '../lib/logger';

/**
 * GPU availability information from cluster nodes
 */
export interface GPUAvailability {
  available: boolean;
  totalGPUs: number;
  gpuNodes: string[];
}

/**
 * GPU Operator installation status
 */
export interface GPUOperatorStatus {
  installed: boolean;
  crdFound: boolean;
  operatorRunning: boolean;
  gpusAvailable: boolean;
  totalGPUs: number;
  gpuNodes: string[];
  message: string;
}

/**
 * Per-node GPU information including allocation status
 */
export interface NodeGpuInfo {
  nodeName: string;
  totalGpus: number;      // nvidia.com/gpu allocatable on this node
  allocatedGpus: number;  // Sum of GPU requests from pods on this node
  availableGpus: number;  // totalGpus - allocatedGpus
}

/**
 * Cluster-wide GPU capacity for fit validation
 */
export interface ClusterGpuCapacity {
  totalGpus: number;              // Sum of allocatable GPUs across all nodes
  allocatedGpus: number;          // Sum of GPU requests from all pods
  availableGpus: number;          // totalGpus - allocatedGpus
  maxContiguousAvailable: number; // Highest available GPUs on any single node
  maxNodeGpuCapacity: number;     // Largest GPU count on any single node
  gpuNodeCount: number;           // Total number of nodes with GPUs
  totalMemoryGb?: number;         // Total GPU memory per GPU (e.g., 80 for A100 80GB)
  nodes: NodeGpuInfo[];           // Per-node breakdown
}

class KubernetesService {
  private kc: k8s.KubeConfig;
  private customObjectsApi: k8s.CustomObjectsApi;
  private coreV1Api: k8s.CoreV1Api;
  private apiExtensionsApi: k8s.ApiextensionsV1Api;
  private defaultNamespace: string;

  constructor() {
    this.kc = new k8s.KubeConfig();

    try {
      this.kc.loadFromDefault();
    } catch {
      logger.warn('No kubeconfig found, using mock mode');
    }

    this.customObjectsApi = this.kc.makeApiClient(k8s.CustomObjectsApi);
    this.coreV1Api = this.kc.makeApiClient(k8s.CoreV1Api);
    this.apiExtensionsApi = this.kc.makeApiClient(k8s.ApiextensionsV1Api);
    this.defaultNamespace = process.env.DEFAULT_NAMESPACE || 'kubefoundry-system';
  }

  async checkClusterConnection(): Promise<ClusterStatus> {
    try {
      await withRetry(
        () => this.coreV1Api.listNamespace(),
        { operationName: 'checkClusterConnection', maxRetries: 2 }
      );
      const currentContext = this.kc.getCurrentContext();
      return {
        connected: true,
        namespace: this.defaultNamespace,
        clusterName: currentContext,
      };
    } catch (error) {
      return {
        connected: false,
        namespace: this.defaultNamespace,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async listDeployments(namespace: string, providerId?: string): Promise<DeploymentStatus[]> {
    logger.debug({ namespace, providerId }, 'listDeployments called');

    // If a specific provider is requested, only query that provider
    if (providerId) {
      return this.listDeploymentsForProvider(namespace, providerId);
    }

    // Query all providers and merge results
    const allProviders = providerRegistry.listProviderIds();
    const allDeployments: DeploymentStatus[] = [];

    // Query each provider in parallel
    const results = await Promise.all(
      allProviders.map(pid => this.listDeploymentsForProvider(namespace, pid))
    );

    for (const deployments of results) {
      allDeployments.push(...deployments);
    }

    // Sort by creation time (newest first)
    allDeployments.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA;
    });

    logger.debug({ count: allDeployments.length }, 'Found total deployments across all providers');
    return allDeployments;
  }

  /**
   * List deployments for a specific provider
   */
  private async listDeploymentsForProvider(namespace: string, providerId: string): Promise<DeploymentStatus[]> {
    const provider = providerRegistry.getProvider(providerId);
    const crdConfig = provider.getCRDConfig();

    try {
      logger.debug(
        { providerId, apiGroup: crdConfig.apiGroup, apiVersion: crdConfig.apiVersion, plural: crdConfig.plural },
        'Calling listNamespacedCustomObject'
      );

      const response = await withRetry(
        () => this.customObjectsApi.listNamespacedCustomObject(
          crdConfig.apiGroup,
          crdConfig.apiVersion,
          namespace,
          crdConfig.plural
        ),
        { operationName: `listDeployments:${providerId}` }
      );

      logger.debug({ statusCode: response.response.statusCode }, 'listNamespacedCustomObject success');

      const items = (response.body as { items?: unknown[] }).items || [];
      logger.debug({ count: items.length, providerId }, 'Found deployments for provider');
      return items.map((item) => provider.parseStatus(item));
    } catch (error: any) {
      // Check for CRD not found (404) or permission denied (403)
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (error?.message === 'HTTP request failed' || statusCode === 404 || statusCode === 403) {
        // This is expected when the provider CRD is not installed - don't log as error
        logger.debug({ namespace, providerId }, 'CRD not found in namespace (provider may not be installed)');
        return [];
      }

      // Log unexpected errors
      logger.error({ error: error?.message || error, providerId }, 'Unexpected error listing deployments');
      return [];
    }
  }

  /**
   * @deprecated Use listDeployments without providerId to get all deployments
   */
  async listDeploymentsLegacy(namespace: string, providerId?: string): Promise<DeploymentStatus[]> {
    logger.debug({ namespace }, 'listDeploymentsLegacy called');

    // Get the provider (use specified or active provider)
    const activeProviderId = providerId || await configService.getActiveProviderId();
    const provider = providerRegistry.getProvider(activeProviderId);
    const crdConfig = provider.getCRDConfig();

    try {
      logger.debug(
        { apiGroup: crdConfig.apiGroup, apiVersion: crdConfig.apiVersion, plural: crdConfig.plural },
        'Calling listNamespacedCustomObject'
      );

      const response = await withRetry(
        () => this.customObjectsApi.listNamespacedCustomObject(
          crdConfig.apiGroup,
          crdConfig.apiVersion,
          namespace,
          crdConfig.plural
        ),
        { operationName: 'listDeployments' }
      );

      logger.debug({ statusCode: response.response.statusCode }, 'listNamespacedCustomObject success');

      const items = (response.body as { items?: unknown[] }).items || [];
      logger.debug({ count: items.length }, 'Found deployments');
      return items.map((item) => provider.parseStatus(item));
    } catch (error: any) {
      // Check for CRD not found (404) or permission denied (403)
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (error?.message === 'HTTP request failed' || statusCode === 404 || statusCode === 403) {
        // This is expected when the provider CRD is not installed - don't log as error
        logger.debug({ namespace }, 'CRD not found in namespace (provider may not be installed)');
        return [];
      }

      // Log unexpected errors
      logger.error({ error: error?.message || error }, 'Unexpected error listing deployments');
      return [];
    }
  }

  async getDeployment(name: string, namespace: string, providerId?: string): Promise<DeploymentStatus | null> {
    // If provider is specified, only check that provider
    if (providerId) {
      return this.getDeploymentFromProvider(name, namespace, providerId);
    }

    // Try all providers until we find the deployment
    const allProviders = providerRegistry.listProviderIds();
    for (const pid of allProviders) {
      const deployment = await this.getDeploymentFromProvider(name, namespace, pid);
      if (deployment) {
        return deployment;
      }
    }

    logger.debug({ name, namespace }, 'Deployment not found in any provider');
    return null;
  }

  /**
   * Get a deployment from a specific provider
   */
  private async getDeploymentFromProvider(name: string, namespace: string, providerId: string): Promise<DeploymentStatus | null> {
    try {
      const provider = providerRegistry.getProvider(providerId);
      const crdConfig = provider.getCRDConfig();

      const response = await withRetry(
        () => this.customObjectsApi.getNamespacedCustomObject(
          crdConfig.apiGroup,
          crdConfig.apiVersion,
          namespace,
          crdConfig.plural,
          name
        ),
        { operationName: `getDeployment:${providerId}` }
      );

      return provider.parseStatus(response.body);
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 404) {
        // Not found in this provider, will try others
        return null;
      }
      logger.error({ error, name, namespace, providerId }, 'Error getting deployment from provider');
      return null;
    }
  }

  async createDeployment(config: DeploymentConfig, providerId?: string): Promise<void> {
    // Get the provider - prefer config.provider, then explicit providerId, then fall back to active provider
    const resolvedProviderId = config.provider || providerId || await configService.getActiveProviderId();
    const provider = providerRegistry.getProvider(resolvedProviderId);
    const crdConfig = provider.getCRDConfig();

    // Generate manifest using provider
    const manifest = provider.generateManifest(config) as Record<string, unknown>;

    // Add kubefoundry.io/provider label for easier querying
    const metadata = manifest.metadata as Record<string, unknown> || {};
    const labels = (metadata.labels as Record<string, string>) || {};
    labels['kubefoundry.io/provider'] = resolvedProviderId;
    metadata.labels = labels;
    manifest.metadata = metadata;

    await withRetry(
      () => this.customObjectsApi.createNamespacedCustomObject(
        crdConfig.apiGroup,
        crdConfig.apiVersion,
        config.namespace,
        crdConfig.plural,
        manifest
      ),
      { operationName: 'createDeployment' }
    );

    // For KAITO vLLM deployments, create a separate service targeting port 8000
    // KAITO controller creates its service with hardcoded targetPort 5000, which doesn't work for vLLM
    const kaitoConfig = config as { modelSource?: string };
    if (resolvedProviderId === 'kaito' && kaitoConfig.modelSource === 'vllm') {
      try {
        await this.createService(
          config.name,
          config.namespace,
          8000,  // service port
          8000,  // target port (vLLM listens on 8000)
          { 'kaito.sh/workspace': config.name }  // KAITO pod selector
        );
      } catch (error) {
        logger.warn({ error, name: config.name }, 'Failed to create vLLM service, deployment may not be accessible');
      }
    }
  }

  async deleteDeployment(name: string, namespace: string, providerId?: string): Promise<void> {
    // If provider is specified, delete from that provider
    if (providerId) {
      await this.deleteDeploymentFromProvider(name, namespace, providerId);
      // Also try to delete vLLM service if it exists
      await this.deleteService(`${name}-vllm`, namespace);
      return;
    }

    // First, find which provider has this deployment
    const deployment = await this.getDeployment(name, namespace);
    if (!deployment) {
      throw new Error(`Deployment '${name}' not found in namespace '${namespace}'`);
    }

    // Use the provider from the deployment status
    await this.deleteDeploymentFromProvider(name, namespace, deployment.provider);
    
    // Also try to delete vLLM service if it exists (for KAITO vLLM deployments)
    await this.deleteService(`${name}-vllm`, namespace);
  }

  /**
   * Delete a deployment from a specific provider
   */
  private async deleteDeploymentFromProvider(name: string, namespace: string, providerId: string): Promise<void> {
    const provider = providerRegistry.getProvider(providerId);
    const crdConfig = provider.getCRDConfig();

    await withRetry(
      () => this.customObjectsApi.deleteNamespacedCustomObject(
        crdConfig.apiGroup,
        crdConfig.apiVersion,
        namespace,
        crdConfig.plural,
        name
      ),
      { operationName: 'deleteDeployment' }
    );
  }

  async getDeploymentPods(name: string, namespace: string): Promise<PodStatus[]> {
    // Try multiple label selectors since different providers use different labels
    const labelSelectors = [
      `app.kubernetes.io/instance=${name}`,  // Standard K8s label (Dynamo, KubeRay)
      `kaito.sh/workspace=${name}`,          // KAITO workspace label
      `app=${name}`,                         // Common fallback
    ];

    for (const labelSelector of labelSelectors) {
      try {
        const response = await withRetry(
          () => this.coreV1Api.listNamespacedPod(
            namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            labelSelector
          ),
          { operationName: 'getDeploymentPods', maxRetries: 1 }
        );

        if (response.body.items.length > 0) {
          logger.debug({ name, namespace, labelSelector, podCount: response.body.items.length }, 'Found pods with selector');
          return response.body.items.map((pod): PodStatus => ({
            name: pod.metadata?.name || 'unknown',
            phase: (pod.status?.phase as PodPhase) || 'Unknown',
            ready: pod.status?.containerStatuses?.every((cs) => cs.ready) || false,
            restarts: pod.status?.containerStatuses?.reduce((sum, cs) => sum + cs.restartCount, 0) || 0,
            node: pod.spec?.nodeName,
          }));
        }
      } catch (error) {
        logger.debug({ error, name, namespace, labelSelector }, 'Error trying label selector');
        // Continue to next selector
      }
    }

    // KubeRay creates pods with ray.io/cluster label set to a generated RayCluster name
    // The RayCluster name is the RayService name with a random suffix, so we need to
    // find pods where the ray.io/cluster label starts with the deployment name
    try {
      const response = await withRetry(
        () => this.coreV1Api.listNamespacedPod(
          namespace,
          undefined,
          undefined,
          undefined,
          undefined,
          'ray.io/cluster' // Just filter to Ray pods, then filter by name prefix
        ),
        { operationName: 'getDeploymentPods:kuberay', maxRetries: 1 }
      );

      // Filter pods where ray.io/cluster label starts with the deployment name
      const matchingPods = response.body.items.filter(pod => {
        const clusterLabel = pod.metadata?.labels?.['ray.io/cluster'] || '';
        return clusterLabel.startsWith(name);
      });

      if (matchingPods.length > 0) {
        logger.debug({ name, namespace, podCount: matchingPods.length }, 'Found KubeRay pods by cluster label prefix');
        return matchingPods.map((pod): PodStatus => ({
          name: pod.metadata?.name || 'unknown',
          phase: (pod.status?.phase as PodPhase) || 'Unknown',
          ready: pod.status?.containerStatuses?.every((cs) => cs.ready) || false,
          restarts: pod.status?.containerStatuses?.reduce((sum, cs) => sum + cs.restartCount, 0) || 0,
          node: pod.spec?.nodeName,
        }));
      }
    } catch (error) {
      logger.debug({ error, name, namespace }, 'Error trying KubeRay cluster label selector');
    }

    logger.debug({ name, namespace }, 'No pods found with any label selector');
    return [];
  }

  /**
   * Check if a provider is installed in the cluster
   */
  async checkProviderInstallation(providerId?: string): Promise<InstallationStatus> {
    const activeProviderId = providerId || await configService.getActiveProviderId();
    const provider = providerRegistry.getProvider(activeProviderId);

    return provider.checkInstallation({
      customObjectsApi: this.customObjectsApi,
      coreV1Api: this.coreV1Api,
      apiExtensionsApi: this.apiExtensionsApi,
    });
  }

  /**
   * Get status of all runtimes (providers) in the cluster.
   * Returns installation and health status for each runtime.
   */
  async getRuntimesStatus(): Promise<RuntimeStatus[]> {
    const allProviders = providerRegistry.listProviders();
    
    const statusPromises = allProviders.map(async (provider): Promise<RuntimeStatus> => {
      try {
        const installStatus = await provider.checkInstallation({
          customObjectsApi: this.customObjectsApi,
          coreV1Api: this.coreV1Api,
          apiExtensionsApi: this.apiExtensionsApi,
        });

        return {
          id: provider.id,
          name: provider.name,
          installed: installStatus.installed || (installStatus.crdFound ?? false),
          healthy: installStatus.installed && (installStatus.operatorRunning ?? true),
          version: installStatus.version,
          message: installStatus.message,
        };
      } catch (error) {
        logger.error({ error, providerId: provider.id }, 'Error checking runtime status');
        return {
          id: provider.id,
          name: provider.name,
          installed: false,
          healthy: false,
          message: error instanceof Error ? error.message : 'Unknown error checking status',
        };
      }
    });

    return Promise.all(statusPromises);
  }

  /**
   * Get the default namespace for the active provider
   */
  async getDefaultNamespace(): Promise<string> {
    return configService.getDefaultNamespace();
  }

  /**
   * Check if NVIDIA GPUs are available on cluster nodes
   */
  async checkGPUAvailability(): Promise<GPUAvailability> {
    try {
      const response = await withRetry(
        () => this.coreV1Api.listNode(),
        { operationName: 'checkGPUAvailability' }
      );
      const nodes = response.body.items;

      let totalGPUs = 0;
      const gpuNodes: string[] = [];

      for (const node of nodes) {
        // Check allocatable resources for nvidia.com/gpu
        const gpuCapacity = node.status?.allocatable?.['nvidia.com/gpu'];
        if (gpuCapacity) {
          const gpuCount = parseInt(gpuCapacity, 10);
          if (gpuCount > 0) {
            totalGPUs += gpuCount;
            gpuNodes.push(node.metadata?.name || 'unknown');
          }
        }
      }

      return {
        available: totalGPUs > 0,
        totalGPUs,
        gpuNodes,
      };
    } catch (error) {
      logger.error({ error }, 'Error checking GPU availability');
      return { available: false, totalGPUs: 0, gpuNodes: [] };
    }
  }

  /**
   * Check if the NVIDIA GPU Operator is installed
   */
  async checkGPUOperatorStatus(): Promise<GPUOperatorStatus> {
    // Check for GPU availability on nodes
    const gpuAvailability = await this.checkGPUAvailability();

    // Check for GPU Operator CRD (ClusterPolicy)
    let crdFound = false;
    try {
      await withRetry(
        () => this.customObjectsApi.listClusterCustomObject(
          'nvidia.com',
          'v1',
          'clusterpolicies'
        ),
        { operationName: 'checkGPUOperatorCRD', maxRetries: 1 }
      );
      crdFound = true;
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode !== 404) {
        logger.error({ error: error?.message || error }, 'Error checking GPU Operator CRD');
      }
      crdFound = false;
    }

    // Check for GPU Operator pods in gpu-operator namespace
    let operatorRunning = false;
    try {
      const pods = await withRetry(
        () => this.coreV1Api.listNamespacedPod(
          'gpu-operator',
          undefined,
          undefined,
          undefined,
          undefined,
          'app=gpu-operator'
        ),
        { operationName: 'checkGPUOperatorPods', maxRetries: 1 }
      );
      operatorRunning = pods.body.items.some(
        (pod) => pod.status?.phase === 'Running'
      );

      // Alternative: check for any running pods in gpu-operator namespace if label didn't match
      if (!operatorRunning) {
        const allPods = await this.coreV1Api.listNamespacedPod('gpu-operator');
        operatorRunning = allPods.body.items.some(
          (pod) => pod.status?.phase === 'Running'
        );
      }
    } catch {
      // Namespace might not exist
      operatorRunning = false;
    }

    const installed = crdFound && operatorRunning;

    let message: string;
    if (gpuAvailability.available) {
      message = `GPUs enabled: ${gpuAvailability.totalGPUs} GPU(s) on ${gpuAvailability.gpuNodes.length} node(s)`;
    } else if (installed) {
      message = 'GPU Operator installed but no GPUs detected on nodes';
    } else if (crdFound) {
      message = 'GPU Operator CRD found but operator is not running';
    } else {
      message = 'GPU Operator not installed';
    }

    return {
      installed,
      crdFound,
      operatorRunning,
      gpusAvailable: gpuAvailability.available,
      totalGPUs: gpuAvailability.totalGPUs,
      gpuNodes: gpuAvailability.gpuNodes,
      message,
    };
  }

  /**
   * Get detailed GPU capacity including per-node availability.
   * This accounts for GPUs currently allocated to running pods.
   */
  async getClusterGpuCapacity(): Promise<ClusterGpuCapacity> {
    try {
      // Step 1: Get all nodes and their GPU capacity
      const nodesResponse = await withRetry(
        () => this.coreV1Api.listNode(),
        { operationName: 'getClusterGpuCapacity:listNodes' }
      );

      const nodeGpuMap = new Map<string, { total: number; allocated: number }>();
      let detectedGpuMemoryGb: number | undefined;

      for (const node of nodesResponse.body.items) {
        const nodeName = node.metadata?.name || 'unknown';
        const gpuCapacity = node.status?.allocatable?.['nvidia.com/gpu'];
        if (gpuCapacity) {
          const gpuCount = parseInt(gpuCapacity, 10);
          if (gpuCount > 0) {
            nodeGpuMap.set(nodeName, { total: gpuCount, allocated: 0 });

            // Try to detect GPU memory from node labels (prefer nvidia.com/gpu.memory)
            if (!detectedGpuMemoryGb) {
              // Primary: Use nvidia.com/gpu.memory label (value in MiB from GPU Feature Discovery)
              const gpuMemoryMib = node.metadata?.labels?.['nvidia.com/gpu.memory'];
              if (gpuMemoryMib) {
                const memoryMib = parseInt(gpuMemoryMib, 10);
                if (!isNaN(memoryMib) && memoryMib > 0) {
                  detectedGpuMemoryGb = Math.round(memoryMib / 1024); // Convert MiB to GB
                }
              }

              // Fallback: Detect from nvidia.com/gpu.product label
              if (!detectedGpuMemoryGb) {
                const gpuProduct = node.metadata?.labels?.['nvidia.com/gpu.product'];
                if (gpuProduct) {
                  detectedGpuMemoryGb = this.detectGpuMemoryFromProduct(gpuProduct);
                }
              }
            }
          }
        }
      }

      // Step 2: Get all pods across all namespaces and sum their GPU requests per node
      const podsResponse = await withRetry(
        () => this.coreV1Api.listPodForAllNamespaces(),
        { operationName: 'getClusterGpuCapacity:listPods' }
      );

      for (const pod of podsResponse.body.items) {
        // Only count running or pending pods (not completed/failed)
        const phase = pod.status?.phase;
        if (phase !== 'Running' && phase !== 'Pending') {
          continue;
        }

        const nodeName = pod.spec?.nodeName;
        if (!nodeName || !nodeGpuMap.has(nodeName)) {
          continue;
        }

        // Sum GPU requests from all containers in the pod
        let podGpuRequests = 0;
        for (const container of pod.spec?.containers || []) {
          const gpuRequest = container.resources?.requests?.['nvidia.com/gpu'];
          if (gpuRequest) {
            podGpuRequests += parseInt(gpuRequest, 10);
          }
          // Also check limits if requests not specified (limits can imply requests)
          if (!gpuRequest) {
            const gpuLimit = container.resources?.limits?.['nvidia.com/gpu'];
            if (gpuLimit) {
              podGpuRequests += parseInt(gpuLimit, 10);
            }
          }
        }

        if (podGpuRequests > 0) {
          const nodeInfo = nodeGpuMap.get(nodeName)!;
          nodeInfo.allocated += podGpuRequests;
        }
      }

      // Step 3: Build result
      const nodes: NodeGpuInfo[] = [];
      let totalGpus = 0;
      let allocatedGpus = 0;
      let maxContiguousAvailable = 0;
      let maxNodeGpuCapacity = 0;

      for (const [nodeName, info] of nodeGpuMap) {
        const availableOnNode = Math.max(0, info.total - info.allocated);
        nodes.push({
          nodeName,
          totalGpus: info.total,
          allocatedGpus: info.allocated,
          availableGpus: availableOnNode,
        });
        totalGpus += info.total;
        allocatedGpus += info.allocated;
        maxContiguousAvailable = Math.max(maxContiguousAvailable, availableOnNode);
        maxNodeGpuCapacity = Math.max(maxNodeGpuCapacity, info.total);
      }

      return {
        totalGpus,
        allocatedGpus,
        availableGpus: totalGpus - allocatedGpus,
        maxContiguousAvailable,
        maxNodeGpuCapacity,
        gpuNodeCount: nodeGpuMap.size,
        totalMemoryGb: detectedGpuMemoryGb,
        nodes,
      };
    } catch (error) {
      logger.error({ error }, 'Error getting cluster GPU capacity');
      return {
        totalGpus: 0,
        allocatedGpus: 0,
        availableGpus: 0,
        maxContiguousAvailable: 0,
        maxNodeGpuCapacity: 0,
        gpuNodeCount: 0,
        nodes: [],
      };
    }
  }

  /**
   * Get detailed GPU capacity including per-node pool breakdown.
   * This groups nodes by node pool labels and includes GPU model information.
   */
  async getDetailedClusterGpuCapacity(): Promise<import('@kubefoundry/shared').DetailedClusterCapacity> {
    try {
      // Get basic capacity first
      const basicCapacity = await this.getClusterGpuCapacity();

      // Step 1: Get all nodes and group by node pool
      const nodesResponse = await withRetry(
        () => this.coreV1Api.listNode(),
        { operationName: 'getDetailedClusterGpuCapacity:listNodes' }
      );

      const nodePoolMap = new Map<string, {
        gpuCount: number;
        nodeCount: number;
        availableGpus: number;
        gpuModel?: string;
      }>();

      for (const node of nodesResponse.body.items) {
        const nodeName = node.metadata?.name || 'unknown';
        const gpuCapacity = node.status?.allocatable?.['nvidia.com/gpu'];

        if (gpuCapacity) {
          const gpuCount = parseInt(gpuCapacity, 10);
          if (gpuCount > 0) {
            // Determine node pool name from labels
            // AKS uses: agentpool, kubernetes.azure.com/agentpool
            // GKE uses: cloud.google.com/gke-nodepool
            // EKS uses: eks.amazonaws.com/nodegroup
            const nodePoolName =
              node.metadata?.labels?.['agentpool'] ||
              node.metadata?.labels?.['kubernetes.azure.com/agentpool'] ||
              node.metadata?.labels?.['cloud.google.com/gke-nodepool'] ||
              node.metadata?.labels?.['eks.amazonaws.com/nodegroup'] ||
              'default';

            // Get GPU model from labels
            const gpuModel =
              node.metadata?.labels?.['nvidia.com/gpu.product'] ||
              node.metadata?.labels?.['accelerator'];

            // Find available GPUs for this node
            const nodeInfo = basicCapacity.nodes.find(n => n.nodeName === nodeName);
            const nodeAvailableGpus = nodeInfo?.availableGpus || 0;

            if (!nodePoolMap.has(nodePoolName)) {
              nodePoolMap.set(nodePoolName, {
                gpuCount: 0,
                nodeCount: 0,
                availableGpus: 0,
                gpuModel,
              });
            }

            const poolInfo = nodePoolMap.get(nodePoolName)!;
            poolInfo.gpuCount += gpuCount;
            poolInfo.nodeCount += 1;
            poolInfo.availableGpus += nodeAvailableGpus;

            // Update GPU model if not set or if we find a more specific one
            if (!poolInfo.gpuModel && gpuModel) {
              poolInfo.gpuModel = gpuModel;
            }
          }
        }
      }

      // Convert to array
      const nodePools: import('@kubefoundry/shared').NodePoolInfo[] = [];
      for (const [name, info] of nodePoolMap) {
        nodePools.push({
          name,
          gpuCount: info.gpuCount,
          nodeCount: info.nodeCount,
          availableGpus: info.availableGpus,
          gpuModel: info.gpuModel,
        });
      }

      return {
        totalGpus: basicCapacity.totalGpus,
        allocatedGpus: basicCapacity.allocatedGpus,
        availableGpus: basicCapacity.availableGpus,
        maxContiguousAvailable: basicCapacity.maxContiguousAvailable,
        maxNodeGpuCapacity: basicCapacity.maxNodeGpuCapacity,
        gpuNodeCount: basicCapacity.gpuNodeCount,
        totalMemoryGb: basicCapacity.totalMemoryGb,
        nodePools,
      };
    } catch (error) {
      logger.error({ error }, 'Error getting detailed cluster GPU capacity');
      return {
        totalGpus: 0,
        allocatedGpus: 0,
        availableGpus: 0,
        maxContiguousAvailable: 0,
        maxNodeGpuCapacity: 0,
        gpuNodeCount: 0,
        nodePools: [],
      };
    }
  }

  /**
   * Get failure reasons for a pending pod by parsing Kubernetes Events
   */
  async getPodFailureReasons(
    podName: string,
    namespace: string
  ): Promise<import('@kubefoundry/shared').PodFailureReason[]> {
    try {
      // Get events for the pod
      const eventsResponse = await withRetry(
        () => this.coreV1Api.listNamespacedEvent(
          namespace,
          undefined,
          undefined,
          undefined,
          `involvedObject.name=${podName}`
        ),
        { operationName: 'getPodFailureReasons' }
      );

      const reasons: import('@kubefoundry/shared').PodFailureReason[] = [];

      for (const event of eventsResponse.body.items) {
        // Focus on Warning events related to scheduling failures
        if (event.type !== 'Warning') {
          continue;
        }

        const reason = event.reason || 'Unknown';
        const message = event.message || '';

        // Analyze the event to determine if it's a resource constraint
        const isResourceConstraint = reason === 'FailedScheduling' ||
          message.toLowerCase().includes('insufficient');

        let resourceType: 'gpu' | 'cpu' | 'memory' | undefined;
        let canAutoscalerHelp = false;

        if (isResourceConstraint) {
          // Detect resource type from message
          if (message.includes('nvidia.com/gpu')) {
            resourceType = 'gpu';
            canAutoscalerHelp = true; // Autoscaler can add GPU nodes
          } else if (message.toLowerCase().includes('cpu')) {
            resourceType = 'cpu';
            canAutoscalerHelp = true;
          } else if (message.toLowerCase().includes('memory')) {
            resourceType = 'memory';
            canAutoscalerHelp = true;
          }

          // Check for taint-related failures (autoscaler can't help with these)
          if (message.toLowerCase().includes('taint') ||
            message.toLowerCase().includes('toleration')) {
            canAutoscalerHelp = false;
          }

          // Check for node selector failures (autoscaler can't help with these)
          if (message.toLowerCase().includes('node selector') ||
            message.toLowerCase().includes('didn\'t match')) {
            canAutoscalerHelp = false;
          }
        }

        reasons.push({
          reason,
          message,
          isResourceConstraint,
          resourceType,
          canAutoscalerHelp,
        });
      }

      return reasons;
    } catch (error) {
      logger.error({ error, podName, namespace }, 'Error getting pod failure reasons');
      return [];
    }
  }

  /**
   * Detect GPU memory from NVIDIA GPU product name
   * This is a best-effort mapping based on common GPU models
   */
  private detectGpuMemoryFromProduct(gpuProduct: string): number | undefined {
    const product = gpuProduct.toLowerCase();

    // NVIDIA Data Center GPUs
    if (product.includes('a100') && product.includes('80')) return 80;
    if (product.includes('a100') && product.includes('40')) return 40;
    if (product.includes('a100')) return 40; // Default A100 is 40GB
    if (product.includes('h100') && product.includes('80')) return 80;
    if (product.includes('h100')) return 80;
    if (product.includes('h200')) return 141;
    if (product.includes('a10g')) return 24;
    if (product.includes('a10')) return 24;
    if (product.includes('l40s')) return 48;
    if (product.includes('l40')) return 48;
    if (product.includes('l4')) return 24;
    if (product.includes('t4')) return 16;
    if (product.includes('v100') && product.includes('32')) return 32;
    if (product.includes('v100')) return 16;

    // NVIDIA Consumer GPUs
    if (product.includes('4090')) return 24;
    if (product.includes('4080')) return 16;
    if (product.includes('3090')) return 24;
    if (product.includes('3080') && product.includes('12')) return 12;
    if (product.includes('3080')) return 10;

    return undefined;
  }

  /**
   * Get list of cluster node names for deployment targeting
   * Returns all nodes that are Ready and schedulable
   */
  async getClusterNodes(): Promise<{ name: string; ready: boolean; gpuCount: number }[]> {
    try {
      const nodesResponse = await withRetry(
        () => this.coreV1Api.listNode(),
        { operationName: 'getClusterNodes' }
      );

      return nodesResponse.body.items
        .filter(node => {
          // Filter out nodes that are unschedulable (cordoned)
          return !node.spec?.unschedulable;
        })
        .map(node => {
          const nodeName = node.metadata?.name || 'unknown';
          
          // Check if node is Ready
          const readyCondition = node.status?.conditions?.find(c => c.type === 'Ready');
          const isReady = readyCondition?.status === 'True';
          
          // Get GPU count if available
          const gpuCapacity = node.status?.allocatable?.['nvidia.com/gpu'];
          const gpuCount = gpuCapacity ? parseInt(gpuCapacity, 10) : 0;

          return {
            name: nodeName,
            ready: isReady,
            gpuCount,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (error) {
      logger.error({ error }, 'Failed to get cluster nodes');
      return [];
    }
  }

  /**
   * Get logs from a pod
   */
  async getPodLogs(
    podName: string,
    namespace: string,
    options?: {
      container?: string;
      tailLines?: number;
      timestamps?: boolean;
    }
  ): Promise<string> {
    try {
      const response = await withRetry(
        () => this.coreV1Api.readNamespacedPodLog(
          podName,
          namespace,
          options?.container,         // container
          undefined,                  // follow (not supported in this API)
          undefined,                  // insecureSkipTLSVerifyBackend
          undefined,                  // limitBytes
          undefined,                  // pretty
          undefined,                  // previous
          undefined,                  // sinceSeconds
          options?.tailLines ?? 100,  // tailLines
          options?.timestamps ?? false // timestamps
        ),
        { operationName: 'getPodLogs', maxRetries: 2 }
      );

      // Strip ANSI color codes from logs
      const logs = response.body || '';
      // eslint-disable-next-line no-control-regex
      const ansiRegex = /\x1b\[[0-9;]*m/g;
      return logs.replace(ansiRegex, '');
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 404) {
        throw new Error(`Pod '${podName}' not found in namespace '${namespace}'`);
      }
      logger.error({ error, podName, namespace }, 'Error getting pod logs');
      throw new Error(`Failed to get logs for pod '${podName}': ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * Create a Kubernetes Service for a deployment
   * Used when the provider's controller doesn't create the correct service (e.g., KAITO vLLM)
   */
  async createService(
    name: string,
    namespace: string,
    port: number,
    targetPort: number,
    selector: Record<string, string>
  ): Promise<void> {
    const service: k8s.V1Service = {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: {
        name: `${name}-vllm`,
        namespace,
        labels: {
          'app.kubernetes.io/name': 'kubefoundry',
          'app.kubernetes.io/instance': name,
          'app.kubernetes.io/managed-by': 'kubefoundry',
          'kubefoundry.io/service-type': 'vllm',
        },
      },
      spec: {
        type: 'ClusterIP',
        ports: [
          {
            port,
            targetPort: targetPort as unknown as k8s.IntOrString,
            protocol: 'TCP',
            name: 'http',
          },
        ],
        selector,
      },
    };

    try {
      await withRetry(
        () => this.coreV1Api.createNamespacedService(namespace, service),
        { operationName: 'createService' }
      );
      logger.info({ name: `${name}-vllm`, namespace, port, targetPort }, 'Created vLLM service');
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 409) {
        // Service already exists, that's fine
        logger.debug({ name: `${name}-vllm`, namespace }, 'Service already exists');
        return;
      }
      throw error;
    }
  }

  /**
   * Delete a Kubernetes Service
   */
  async deleteService(name: string, namespace: string): Promise<void> {
    try {
      await withRetry(
        () => this.coreV1Api.deleteNamespacedService(name, namespace),
        { operationName: 'deleteService' }
      );
      logger.info({ name, namespace }, 'Deleted service');
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 404) {
        // Service doesn't exist, that's fine
        logger.debug({ name, namespace }, 'Service not found (already deleted)');
        return;
      }
      throw error;
    }
  }

  /**
   * Delete a Custom Resource Definition (CRD) from the cluster
   * @param crdName - Full CRD name (e.g., 'workspaces.kaito.sh')
   * @returns true if deleted or not found, false on error
   */
  async deleteCRD(crdName: string): Promise<{ success: boolean; message: string }> {
    try {
      logger.info({ crdName }, 'Deleting CRD');
      await withRetry(
        () => this.apiExtensionsApi.deleteCustomResourceDefinition(crdName),
        { operationName: 'deleteCRD', maxRetries: 2 }
      );
      logger.info({ crdName }, 'CRD deleted successfully');
      return { success: true, message: `CRD ${crdName} deleted` };
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 404) {
        logger.debug({ crdName }, 'CRD not found (already deleted)');
        return { success: true, message: `CRD ${crdName} not found (already deleted)` };
      }
      logger.error({ error, crdName }, 'Error deleting CRD');
      return { success: false, message: `Failed to delete CRD ${crdName}: ${error?.message || 'Unknown error'}` };
    }
  }

  /**
   * Delete a namespace from the cluster
   * @param namespace - Namespace name to delete
   * @returns true if deleted or not found, false on error
   */
  async deleteNamespace(namespace: string): Promise<{ success: boolean; message: string }> {
    // Protect critical namespaces
    const protectedNamespaces = ['default', 'kube-system', 'kube-public', 'kube-node-lease'];
    if (protectedNamespaces.includes(namespace)) {
      logger.warn({ namespace }, 'Attempted to delete protected namespace');
      return { success: false, message: `Cannot delete protected namespace: ${namespace}` };
    }

    try {
      logger.info({ namespace }, 'Deleting namespace');
      await withRetry(
        () => this.coreV1Api.deleteNamespace(namespace),
        { operationName: 'deleteNamespace', maxRetries: 2 }
      );
      logger.info({ namespace }, 'Namespace deletion initiated');
      return { success: true, message: `Namespace ${namespace} deletion initiated` };
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 404) {
        logger.debug({ namespace }, 'Namespace not found (already deleted)');
        return { success: true, message: `Namespace ${namespace} not found (already deleted)` };
      }
      logger.error({ error, namespace }, 'Error deleting namespace');
      return { success: false, message: `Failed to delete namespace ${namespace}: ${error?.message || 'Unknown error'}` };
    }
  }
}

export const kubernetesService = new KubernetesService();
