import * as k8s from '@kubernetes/client-node';
import { configService } from './config';
import type { DeploymentStatus, PodStatus, ClusterStatus, PodPhase, DeploymentConfig, RuntimeStatus, ModelDeployment } from '@kubefoundry/shared';
import { toModelDeploymentManifest, toDeploymentStatus } from '@kubefoundry/shared';
import { withRetry } from '../lib/retry';
import logger from '../lib/logger';

// ModelDeployment CRD configuration
const MODEL_DEPLOYMENT_CRD = {
  apiGroup: 'kubefoundry.kubefoundry.ai',
  apiVersion: 'v1alpha1',
  plural: 'modeldeployments',
  kind: 'ModelDeployment',
};

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

/**
 * Installation status for CRDs
 */
export interface InstallationStatus {
  installed: boolean;
  crdFound?: boolean;
  operatorRunning?: boolean;
  version?: string;
  message?: string;
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

  async listDeployments(namespace: string): Promise<DeploymentStatus[]> {
    logger.debug({ namespace }, 'listDeployments called');

    try {
      logger.debug(
        { apiGroup: MODEL_DEPLOYMENT_CRD.apiGroup, apiVersion: MODEL_DEPLOYMENT_CRD.apiVersion, plural: MODEL_DEPLOYMENT_CRD.plural },
        'Calling listNamespacedCustomObject for ModelDeployment'
      );

      const response = await withRetry(
        () => this.customObjectsApi.listNamespacedCustomObject(
          MODEL_DEPLOYMENT_CRD.apiGroup,
          MODEL_DEPLOYMENT_CRD.apiVersion,
          namespace,
          MODEL_DEPLOYMENT_CRD.plural
        ),
        { operationName: 'listDeployments' }
      );

      logger.debug({ statusCode: response.response.statusCode }, 'listNamespacedCustomObject success');

      const items = (response.body as { items?: ModelDeployment[] }).items || [];
      logger.debug({ count: items.length }, 'Found ModelDeployments');

      // Convert each ModelDeployment to DeploymentStatus
      const deployments: DeploymentStatus[] = [];
      for (const item of items) {
        const pods = await this.getDeploymentPods(item.metadata.name, namespace);
        deployments.push(toDeploymentStatus(item, pods));
      }

      // Sort by creation time (newest first)
      deployments.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateB - dateA;
      });

      return deployments;
    } catch (error: any) {
      // Check for CRD not found (404) or permission denied (403)
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (error?.message === 'HTTP request failed' || statusCode === 404 || statusCode === 403) {
        // This is expected when the ModelDeployment CRD is not installed
        logger.debug({ namespace }, 'ModelDeployment CRD not found in namespace');
        return [];
      }

      // Log unexpected errors
      logger.error({ error: error?.message || error }, 'Unexpected error listing deployments');
      return [];
    }
  }

  async getDeployment(name: string, namespace: string): Promise<DeploymentStatus | null> {
    try {
      const response = await withRetry(
        () => this.customObjectsApi.getNamespacedCustomObject(
          MODEL_DEPLOYMENT_CRD.apiGroup,
          MODEL_DEPLOYMENT_CRD.apiVersion,
          namespace,
          MODEL_DEPLOYMENT_CRD.plural,
          name
        ),
        { operationName: 'getDeployment' }
      );

      const md = response.body as ModelDeployment;
      const pods = await this.getDeploymentPods(name, namespace);
      return toDeploymentStatus(md, pods);
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 404) {
        logger.debug({ name, namespace }, 'ModelDeployment not found');
        return null;
      }
      logger.error({ error, name, namespace }, 'Error getting deployment');
      return null;
    }
  }

  /**
   * Get the raw Custom Resource manifest for a deployment
   * Returns the full CR object as stored in Kubernetes
   */
  async getDeploymentManifest(name: string, namespace: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await withRetry(
        () => this.customObjectsApi.getNamespacedCustomObject(
          MODEL_DEPLOYMENT_CRD.apiGroup,
          MODEL_DEPLOYMENT_CRD.apiVersion,
          namespace,
          MODEL_DEPLOYMENT_CRD.plural,
          name
        ),
        { operationName: 'getDeploymentManifest' }
      );

      return response.body as Record<string, unknown>;
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 404) {
        logger.debug({ name, namespace }, 'ModelDeployment manifest not found');
        return null;
      }
      logger.error({ error, name, namespace }, 'Error getting deployment manifest');
      return null;
    }
  }

  async createDeployment(config: DeploymentConfig): Promise<void> {
    // Generate ModelDeployment manifest from config
    const manifest = toModelDeploymentManifest(config) as Record<string, unknown>;

    logger.info({ name: config.name, namespace: config.namespace }, 'Creating ModelDeployment');

    await withRetry(
      () => this.customObjectsApi.createNamespacedCustomObject(
        MODEL_DEPLOYMENT_CRD.apiGroup,
        MODEL_DEPLOYMENT_CRD.apiVersion,
        config.namespace,
        MODEL_DEPLOYMENT_CRD.plural,
        manifest
      ),
      { operationName: 'createDeployment' }
    );

    logger.info({ name: config.name, namespace: config.namespace }, 'ModelDeployment created');
  }

  async deleteDeployment(name: string, namespace: string): Promise<void> {
    // First, check if deployment exists
    const deployment = await this.getDeployment(name, namespace);
    if (!deployment) {
      throw new Error(`Deployment '${name}' not found in namespace '${namespace}'`);
    }

    logger.info({ name, namespace }, 'Deleting ModelDeployment');

    await withRetry(
      () => this.customObjectsApi.deleteNamespacedCustomObject(
        MODEL_DEPLOYMENT_CRD.apiGroup,
        MODEL_DEPLOYMENT_CRD.apiVersion,
        namespace,
        MODEL_DEPLOYMENT_CRD.plural,
        name
      ),
      { operationName: 'deleteDeployment' }
    );

    logger.info({ name, namespace }, 'ModelDeployment deleted');
  }

  async getDeploymentPods(name: string, namespace: string): Promise<PodStatus[]> {
    // Try multiple label selectors since different providers use different labels
    const labelSelectors = [
      `app.kubernetes.io/instance=${name}`,  // Standard K8s label (Dynamo, KubeRay)
      `kubefoundry.kubefoundry.ai/deployment=${name}`,  // KubeFoundry label
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
   * Check if the ModelDeployment CRD is installed in the cluster
   */
  async checkCRDInstallation(): Promise<InstallationStatus> {
    try {
      await withRetry(
        () => this.apiExtensionsApi.readCustomResourceDefinition(
          `${MODEL_DEPLOYMENT_CRD.plural}.${MODEL_DEPLOYMENT_CRD.apiGroup}`
        ),
        { operationName: 'checkCRDInstallation', maxRetries: 1 }
      );

      return {
        installed: true,
        crdFound: true,
        message: 'ModelDeployment CRD is installed',
      };
    } catch (error: any) {
      const statusCode = error?.statusCode || error?.response?.statusCode;
      if (statusCode === 404) {
        return {
          installed: false,
          crdFound: false,
          message: 'ModelDeployment CRD not found. Please install KubeFoundry controller.',
        };
      }
      logger.error({ error }, 'Error checking CRD installation');
      return {
        installed: false,
        crdFound: false,
        message: `Error checking CRD: ${error?.message || 'Unknown error'}`,
      };
    }
  }

  /**
   * Check if a specific CRD exists in the cluster
   */
  async checkCRDExists(crdName: string): Promise<boolean> {
    try {
      await withRetry(
        () => this.apiExtensionsApi.readCustomResourceDefinition(crdName),
        { operationName: `checkCRDExists:${crdName}`, maxRetries: 1 }
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get status of all runtimes (providers) in the cluster.
   * Returns installation and health status for each runtime.
   */
  async getRuntimesStatus(): Promise<RuntimeStatus[]> {
    const runtimes: RuntimeStatus[] = [];

    // Check if KubeFoundry controller is installed by checking for the CRD
    const crdStatus = await this.checkCRDInstallation();

    // List InferenceProviderConfig resources to discover registered providers
    if (crdStatus.installed) {
      try {
        const response = await withRetry(
          () => this.customObjectsApi.listClusterCustomObject(
            MODEL_DEPLOYMENT_CRD.apiGroup,
            MODEL_DEPLOYMENT_CRD.apiVersion,
            'inferenceproviderconfigs'
          ),
          { operationName: 'listInferenceProviderConfigs', maxRetries: 1 }
        );

        const items = (response.body as any)?.items || [];
        for (const item of items) {
          const name = item.metadata?.name || 'unknown';
          const status = item.status || {};
          const installation = item.spec?.installation || {};
          const displayName = installation.description
            ? name.charAt(0).toUpperCase() + name.slice(1)
            : name.charAt(0).toUpperCase() + name.slice(1);

          runtimes.push({
            id: name,
            name: displayName,
            installed: true,
            healthy: status.ready === true,
            version: status.version,
            message: status.ready ? 'Provider ready' : 'Provider not ready',
          });
        }
      } catch (error: any) {
        const statusCode = error?.statusCode || error?.response?.statusCode;
        if (statusCode !== 404) {
          logger.warn({ error: error?.message || error }, 'Failed to list InferenceProviderConfigs');
        }
      }
    }

    return runtimes;
  }

  /**
   * Get a specific InferenceProviderConfig by name from the cluster.
   * Returns the full CRD object or null if not found.
   */
  async getInferenceProviderConfig(name: string): Promise<any | null> {
    try {
      const response = await withRetry(
        () => this.customObjectsApi.getClusterCustomObject(
          MODEL_DEPLOYMENT_CRD.apiGroup,
          MODEL_DEPLOYMENT_CRD.apiVersion,
          'inferenceproviderconfigs',
          name
        ),
        { operationName: `getInferenceProviderConfig:${name}`, maxRetries: 1 }
      );
      return (response as any).body || response;
    } catch {
      return null;
    }
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
        instanceType?: string;
        region?: string;
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

            // Get GPU model from labels - try multiple sources
            const gpuModel =
              node.metadata?.labels?.['nvidia.com/gpu.product'] ||
              this.extractGpuModelFromInstanceType(node.metadata?.labels) ||
              node.metadata?.labels?.['accelerator'];

            // Get instance type from standard Kubernetes labels
            const instanceType =
              node.metadata?.labels?.['node.kubernetes.io/instance-type'] ||
              node.metadata?.labels?.['beta.kubernetes.io/instance-type'];

            // Get region from labels
            const region =
              node.metadata?.labels?.['topology.kubernetes.io/region'] ||
              node.metadata?.labels?.['failure-domain.beta.kubernetes.io/region'];

            // Find available GPUs for this node
            const nodeInfo = basicCapacity.nodes.find(n => n.nodeName === nodeName);
            const nodeAvailableGpus = nodeInfo?.availableGpus || 0;

            if (!nodePoolMap.has(nodePoolName)) {
              nodePoolMap.set(nodePoolName, {
                gpuCount: 0,
                nodeCount: 0,
                availableGpus: 0,
                gpuModel,
                instanceType,
                region,
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
            // Update instance type if not set
            if (!poolInfo.instanceType && instanceType) {
              poolInfo.instanceType = instanceType;
            }
            // Update region if not set
            if (!poolInfo.region && region) {
              poolInfo.region = region;
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
          instanceType: info.instanceType,
          region: info.region,
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
   * Get all node pools in the cluster (both CPU and GPU).
   * Used for cost estimation of CPU-based deployments.
   */
  async getAllNodePools(): Promise<import('@kubefoundry/shared').NodePoolInfo[]> {
    try {
      const nodesResponse = await withRetry(
        () => this.coreV1Api.listNode(),
        { operationName: 'getAllNodePools:listNodes' }
      );

      const nodePoolMap = new Map<string, {
        nodeCount: number;
        gpuCount: number;
        availableGpus: number;
        gpuModel?: string;
        instanceType?: string;
        region?: string;
      }>();

      for (const node of nodesResponse.body.items) {
        // Determine node pool name from labels
        const nodePoolName =
          node.metadata?.labels?.['agentpool'] ||
          node.metadata?.labels?.['kubernetes.azure.com/agentpool'] ||
          node.metadata?.labels?.['cloud.google.com/gke-nodepool'] ||
          node.metadata?.labels?.['eks.amazonaws.com/nodegroup'] ||
          'default';

        // Get instance type from standard Kubernetes labels
        const instanceType =
          node.metadata?.labels?.['node.kubernetes.io/instance-type'] ||
          node.metadata?.labels?.['beta.kubernetes.io/instance-type'];

        // Get region from labels
        const region =
          node.metadata?.labels?.['topology.kubernetes.io/region'] ||
          node.metadata?.labels?.['failure-domain.beta.kubernetes.io/region'];

        // Check for GPU capacity
        const gpuCapacity = node.status?.allocatable?.['nvidia.com/gpu'];
        const gpuCount = gpuCapacity ? parseInt(gpuCapacity, 10) : 0;

        // Get GPU model from labels if this node has GPUs
        const gpuModel = gpuCount > 0 ? (
          node.metadata?.labels?.['nvidia.com/gpu.product'] ||
          this.extractGpuModelFromInstanceType(node.metadata?.labels)
        ) : undefined;

        if (!nodePoolMap.has(nodePoolName)) {
          nodePoolMap.set(nodePoolName, {
            nodeCount: 0,
            gpuCount: 0,
            availableGpus: 0,
            gpuModel,
            instanceType,
            region,
          });
        }

        const poolInfo = nodePoolMap.get(nodePoolName)!;
        poolInfo.nodeCount += 1;
        poolInfo.gpuCount += gpuCount;

        // Update instance type if not set
        if (!poolInfo.instanceType && instanceType) {
          poolInfo.instanceType = instanceType;
        }
        // Update region if not set
        if (!poolInfo.region && region) {
          poolInfo.region = region;
        }
        // Update GPU model if not set
        if (!poolInfo.gpuModel && gpuModel) {
          poolInfo.gpuModel = gpuModel;
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
          instanceType: info.instanceType,
          region: info.region,
        });
      }

      return nodePools;
    } catch (error) {
      logger.error({ error }, 'Error getting all node pools');
      return [];
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
   * Extract GPU model from cloud provider instance type labels
   * Supports Azure, AWS, and GCP instance type naming conventions
   */
  private extractGpuModelFromInstanceType(
    labels: Record<string, string> | undefined
  ): string | undefined {
    if (!labels) return undefined;

    // Get instance type from standard Kubernetes labels
    const instanceType =
      labels['node.kubernetes.io/instance-type'] ||
      labels['beta.kubernetes.io/instance-type'];

    if (!instanceType) return undefined;

    const instanceLower = instanceType.toLowerCase();

    // Azure NV-series GPU mapping
    // Standard_NV36ads_A10_v5 -> A10
    // Standard_NC24ads_A100_v4 -> A100
    // Standard_ND96asr_A100_v4 -> A100
    // Standard_NC6s_v3 (V100), Standard_NC24s_v3, etc.
    // Standard_NV6 (M60 - older)
    if (instanceLower.includes('_a10')) return 'A10';
    if (instanceLower.includes('_a100')) return 'A100-80GB';
    if (instanceLower.includes('_h100')) return 'H100';
    if (instanceLower.includes('nc') && instanceLower.includes('_v3'))
      return 'V100';
    if (instanceLower.includes('nc') && instanceLower.includes('t4'))
      return 'T4';

    // AWS instance type mapping
    // p4d.24xlarge -> A100
    // p5.48xlarge -> H100
    // g4dn.xlarge -> T4
    // g5.xlarge -> A10G
    // g6.xlarge -> L4
    // g6e.xlarge -> L40S
    if (instanceLower.startsWith('p5')) return 'H100';
    if (instanceLower.startsWith('p4d') || instanceLower.startsWith('p4de'))
      return 'A100-40GB';
    if (instanceLower.startsWith('p3')) return 'V100';
    if (instanceLower.startsWith('g4dn') || instanceLower.startsWith('g4ad'))
      return 'T4';
    if (instanceLower.startsWith('g5g') || instanceLower.startsWith('g5.'))
      return 'A10G';
    if (instanceLower.startsWith('g6e')) return 'L40S';
    if (instanceLower.startsWith('g6.')) return 'L4';

    // GCP machine type mapping
    // a2-highgpu-1g (A100 40GB)
    // a2-ultragpu-1g (A100 80GB)
    // a3-highgpu-8g (H100)
    // n1-standard-4 with nvidia-tesla-t4
    // g2-standard-4 (L4)
    if (instanceLower.startsWith('a3')) return 'H100';
    if (instanceLower.startsWith('a2-ultra')) return 'A100-80GB';
    if (instanceLower.startsWith('a2')) return 'A100-40GB';
    if (instanceLower.startsWith('g2')) return 'L4';

    return undefined;
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
