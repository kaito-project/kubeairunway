import { Hono } from 'hono';
import { kubernetesService } from '../services/kubernetes';
import logger from '../lib/logger';
import type { GatewayInfo, GatewayModelInfo } from '@kubeairunway/shared';

const gateway = new Hono()
  .get('/status', async (c) => {
    try {
      const status: GatewayInfo = await kubernetesService.getGatewayStatus();
      return c.json(status);
    } catch (error) {
      logger.error({ error }, 'Error getting gateway status');
      return c.json({ available: false } satisfies GatewayInfo);
    }
  })
  .get('/models', async (c) => {
    try {
      const models: GatewayModelInfo[] = await kubernetesService.getGatewayModels();
      return c.json({ models });
    } catch (error) {
      logger.error({ error }, 'Error listing gateway models');
      return c.json({ models: [] });
    }
  });

export default gateway;
