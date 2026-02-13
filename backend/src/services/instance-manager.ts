import * as k8s from '@kubernetes/client-node';
import { eq } from 'drizzle-orm';
import { instanceRepository } from './database';
import { credentialManager } from './credentials';
import { getDb, getDbType } from '../db';
import logger from '../lib/logger';

interface HealthInfo {
  status: 'connected' | 'disconnected' | 'error';
  message?: string;
  gpuCapacity?: { total: number; used: number };
  nodeCount?: number;
  deploymentCount?: number;
}

class InstanceManager {
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  async registerInstance(data: {
    name: string;
    displayName: string;
    endpointUrl: string;
    credentialRef: string;
  }) {
    const cred = credentialManager.getCredential(data.credentialRef);
    if (!cred) {
      logger.warn({ credentialRef: data.credentialRef }, 'Credential not found during registration');
    }

    const instance = await instanceRepository.create(data);

    // Best-effort initial health check
    try {
      const health = await this.getInstanceHealth(instance.id);
      logger.info({ instanceId: instance.id, status: health.status }, 'Initial health check completed');
    } catch (err) {
      logger.warn({ instanceId: instance.id, error: (err as Error).message }, 'Initial health check failed');
    }

    // Re-fetch to get updated status
    const updated = await instanceRepository.findById(instance.id);
    return updated || instance;
  }

  async getInstanceHealth(instanceId: string): Promise<HealthInfo> {
    const instance = await instanceRepository.findById(instanceId);
    if (!instance) {
      return { status: 'error', message: 'Instance not found' };
    }

    // Resolve credentialRef from the DB row (not part of HubInstance type)
    const credentialRef = await this.getCredentialRef(instanceId);
    const cred = credentialManager.getCredential(credentialRef || instance.name);

    if (!cred) {
      await instanceRepository.updateStatus(instanceId, 'disconnected', 'No credential available');
      return { status: 'disconnected', message: 'No credential available' };
    }

    try {
      const coreApi = cred.kubeConfig.makeApiClient(k8s.CoreV1Api);
      const nodesResponse = await coreApi.listNode();
      const nodes = nodesResponse.items || [];
      const nodeCount = nodes.length;

      // GPU capacity detection
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

      // Count deployments
      let deploymentCount = 0;
      try {
        const appsApi = cred.kubeConfig.makeApiClient(k8s.AppsV1Api);
        const deploymentsResponse = await appsApi.listDeploymentForAllNamespaces();
        deploymentCount = deploymentsResponse.items?.length || 0;
      } catch {
        // Non-critical, ignore
      }

      const health: HealthInfo = {
        status: 'connected',
        nodeCount,
        deploymentCount,
      };

      if (gpuTotal > 0) {
        health.gpuCapacity = { total: gpuTotal, used: gpuUsed };
      }

      await instanceRepository.updateStatus(instanceId, 'connected');
      return health;
    } catch (err) {
      const message = (err as Error).message || 'Unknown error';
      await instanceRepository.updateStatus(instanceId, 'error', message);
      return { status: 'error', message };
    }
  }

  startHealthCheckLoop(intervalMs = 60000): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      try {
        const instances = await instanceRepository.listAll();
        for (const instance of instances) {
          try {
            const prevStatus = instance.status;
            const health = await this.getInstanceHealth(instance.id);
            if (health.status !== prevStatus) {
              logger.info(
                { instanceId: instance.id, name: instance.name, from: prevStatus, to: health.status },
                'Instance status changed'
              );
            }
          } catch (err) {
            logger.warn(
              { instanceId: instance.id, error: (err as Error).message },
              'Health check failed for instance'
            );
          }
        }
      } catch (err) {
        logger.error({ error: (err as Error).message }, 'Health check loop error');
      }
    }, intervalMs);

    logger.info({ intervalMs }, 'Started health check loop');
  }

  stopHealthCheckLoop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Stopped health check loop');
    }
  }

  private async getCredentialRef(instanceId: string): Promise<string | null> {
    try {
      const schema = getDbType() === 'pg'
        ? await import('../db/schema-pg')
        : await import('../db/schema-sqlite');
      const rows = await (getDb() as any)
        .select({ credentialRef: schema.instances.credentialRef })
        .from(schema.instances)
        .where(eq(schema.instances.id, instanceId));
      return rows.length > 0 ? rows[0].credentialRef : null;
    } catch {
      return null;
    }
  }

  async syncInstancesFromCredentials(): Promise<void> {
    const allCreds = credentialManager.getAllCredentials();
    const allInstances = await instanceRepository.listAll();
    const instanceNames = new Set(allInstances.map((i) => i.name));
    const credNames = new Set(allCreds.map((c) => c.instanceName));

    // Auto-register credentials not in DB
    for (const cred of allCreds) {
      if (!instanceNames.has(cred.instanceName)) {
        try {
          const cluster = cred.kubeConfig.getCurrentCluster();
          const endpointUrl = cluster?.server || 'https://unknown';

          await instanceRepository.create({
            name: cred.instanceName,
            displayName: cred.instanceName,
            endpointUrl,
            credentialRef: cred.instanceName,
          });
          logger.info({ instanceName: cred.instanceName }, 'Auto-registered instance from credential');
        } catch (err) {
          logger.warn(
            { instanceName: cred.instanceName, error: (err as Error).message },
            'Failed to auto-register instance'
          );
        }
      }
    }

    // Mark DB entries without credentials as disconnected
    for (const instance of allInstances) {
      if (!credNames.has(instance.name)) {
        await instanceRepository.updateStatus(instance.id, 'disconnected', 'Credential file not found');
        logger.info({ instanceName: instance.name }, 'Marked instance as disconnected (no credential)');
      }
    }
  }
}

export { InstanceManager, HealthInfo };
export const instanceManager = new InstanceManager();
