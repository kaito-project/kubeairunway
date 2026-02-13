import * as k8s from '@kubernetes/client-node';
import { credentialManager } from './credentials';
import { instanceRepository } from './database';
import logger from '../lib/logger';

class ClusterProxy {
  private instanceRepo: typeof instanceRepository;
  private credMgr: typeof credentialManager;

  constructor(
    instanceRepo?: typeof instanceRepository,
    credMgr?: typeof credentialManager
  ) {
    this.instanceRepo = instanceRepo || instanceRepository;
    this.credMgr = credMgr || credentialManager;
  }

  /**
   * Resolves a KubeConfig for the given instance by looking up
   * the instance in the DB and fetching the stored credential.
   */
  async getKubeConfig(instanceId: string): Promise<k8s.KubeConfig> {
    const instance = await this.instanceRepo.findById(instanceId);
    if (!instance) {
      throw new Error(`Instance not found: ${instanceId}`);
    }

    const cred = this.credMgr.getCredential(instance.name);
    if (!cred) {
      throw new Error(`No credential found for instance: ${instance.name}`);
    }

    return cred.kubeConfig;
  }

  /**
   * Creates a typed Kubernetes API client for the given instance.
   */
  async makeApiClient<T>(instanceId: string, apiClass: new (...args: any[]) => T): Promise<T> {
    const kubeConfig = await this.getKubeConfig(instanceId);
    return kubeConfig.makeApiClient(apiClass);
  }

  /**
   * Lists deployments (K8s Deployments) from the target cluster.
   */
  async proxyListDeployments(instanceId: string, namespace?: string): Promise<any> {
    const appsApi = await this.makeApiClient(instanceId, k8s.AppsV1Api);

    if (namespace) {
      const response = await appsApi.listNamespacedDeployment({ namespace });
      return response;
    }

    const response = await appsApi.listDeploymentForAllNamespaces();
    return response;
  }

  /**
   * Gets a specific deployment from the target cluster.
   */
  async proxyGetDeployment(instanceId: string, name: string, namespace: string): Promise<any> {
    const appsApi = await this.makeApiClient(instanceId, k8s.AppsV1Api);
    const response = await appsApi.readNamespacedDeployment({ name, namespace });
    return response;
  }

  /**
   * Creates a deployment on the target cluster.
   */
  async proxyCreateDeployment(instanceId: string, namespace: string, body: any): Promise<any> {
    const appsApi = await this.makeApiClient(instanceId, k8s.AppsV1Api);
    const response = await appsApi.createNamespacedDeployment({ namespace, body });
    return response;
  }

  /**
   * Deletes a deployment on the target cluster.
   */
  async proxyDeleteDeployment(instanceId: string, name: string, namespace: string): Promise<any> {
    const appsApi = await this.makeApiClient(instanceId, k8s.AppsV1Api);
    const response = await appsApi.deleteNamespacedDeployment({ name, namespace });
    return response;
  }

  /**
   * Gets cluster health info: nodes, GPU capacity, and namespace list.
   */
  async proxyGetClusterHealth(instanceId: string): Promise<{
    nodeCount: number;
    gpuCapacity: { total: number; used: number };
    namespaces: string[];
  }> {
    const coreApi = await this.makeApiClient(instanceId, k8s.CoreV1Api);

    // Fetch nodes
    const nodesResponse = await coreApi.listNode();
    const nodes = nodesResponse.items || [];

    let gpuTotal = 0;
    let gpuUsed = 0;
    for (const node of nodes) {
      const capacity = node.status?.capacity?.['nvidia.com/gpu'];
      const allocatable = node.status?.allocatable?.['nvidia.com/gpu'];
      if (capacity) {
        const total = parseInt(capacity, 10) || 0;
        const alloc = parseInt(allocatable || '0', 10) || 0;
        gpuTotal += total;
        gpuUsed += total - alloc;
      }
    }

    // Fetch namespaces
    const nsResponse = await coreApi.listNamespace();
    const namespaces = (nsResponse.items || []).map(
      (ns: any) => ns.metadata?.name || ''
    ).filter(Boolean);

    return {
      nodeCount: nodes.length,
      gpuCapacity: { total: gpuTotal, used: gpuUsed },
      namespaces,
    };
  }
}

export { ClusterProxy };
export const clusterProxy = new ClusterProxy();
