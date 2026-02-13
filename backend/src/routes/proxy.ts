import { Hono } from 'hono';
import { clusterProxy } from '../services/cluster-proxy';
import { requireInstanceAccess } from '../middleware/rbac';
import logger from '../lib/logger';

const proxy = new Hono()
  .use('/instances/:instanceId/*', requireInstanceAccess())
  .get('/instances/:instanceId/deployments', async (c) => {
    const instanceId = c.req.param('instanceId');
    const namespace = c.req.query('namespace');

    try {
      const deployments = await clusterProxy.proxyListDeployments(instanceId, namespace);
      return c.json(deployments);
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to proxy deployment list');
      return c.json({ error: { message: 'Failed to list deployments', statusCode: 502 } }, 502);
    }
  })

  .get('/instances/:instanceId/deployments/:name', async (c) => {
    const instanceId = c.req.param('instanceId');
    const name = c.req.param('name');
    const namespace = c.req.query('namespace') || 'default';

    try {
      const deployment = await clusterProxy.proxyGetDeployment(instanceId, name, namespace);
      return c.json(deployment);
    } catch (error) {
      logger.error({ error, instanceId, name }, 'Failed to proxy get deployment');
      return c.json({ error: { message: 'Failed to get deployment', statusCode: 502 } }, 502);
    }
  })

  .post('/instances/:instanceId/deployments', async (c) => {
    const instanceId = c.req.param('instanceId');
    const namespace = c.req.query('namespace') || 'default';
    const body = await c.req.json();

    try {
      const result = await clusterProxy.proxyCreateDeployment(instanceId, namespace, body);
      return c.json(result, 201);
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to proxy create deployment');
      return c.json({ error: { message: 'Failed to create deployment', statusCode: 502 } }, 502);
    }
  })

  .delete('/instances/:instanceId/deployments/:name', async (c) => {
    const instanceId = c.req.param('instanceId');
    const name = c.req.param('name');
    const namespace = c.req.query('namespace') || 'default';

    try {
      await clusterProxy.proxyDeleteDeployment(instanceId, name, namespace);
      return c.json({ message: 'Deleted' });
    } catch (error) {
      logger.error({ error, instanceId, name }, 'Failed to proxy delete deployment');
      return c.json({ error: { message: 'Failed to delete deployment', statusCode: 502 } }, 502);
    }
  })

  .get('/instances/:instanceId/health', async (c) => {
    const instanceId = c.req.param('instanceId');

    try {
      const health = await clusterProxy.proxyGetClusterHealth(instanceId);
      return c.json(health);
    } catch (error) {
      logger.error({ error, instanceId }, 'Failed to proxy cluster health');
      return c.json({ error: { message: 'Failed to get cluster health', statusCode: 502 } }, 502);
    }
  });

export default proxy;
