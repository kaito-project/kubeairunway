import { Hono } from 'hono';
import { kubernetesService } from '../services/kubernetes';
import { BUILD_INFO } from '../build-info';
import logger from '../lib/logger';

const health = new Hono()
  .get('/', (c) => {
    return c.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
    });
  })
  .get('/version', (c) => {
    return c.json(BUILD_INFO);
  })
  .get('/status', async (c) => {
    const clusterStatus = await kubernetesService.checkClusterConnection();

    let providerInstallation = null;

    if (clusterStatus.connected) {
      try {
        providerInstallation = await kubernetesService.checkCRDInstallation();
      } catch (error) {
        logger.error({ error }, 'Error checking provider installation');
      }
    }

    return c.json({
      ...clusterStatus,
      providerInstallation,
    });
  })
  .get('/nodes', async (c) => {
    try {
      const nodes = await kubernetesService.getClusterNodes();
      return c.json({ nodes });
    } catch (error) {
      logger.error({ error }, 'Error getting cluster nodes');
      return c.json({ nodes: [] });
    }
  });

export default health;
