import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { configService } from '../services/config';
import { authService } from '../services/auth';
import logger from '../lib/logger';

const updateSettingsSchema = z.object({
  defaultNamespace: z.string().optional(),
});

const settings = new Hono()
  .get('/', async (c) => {
    logger.debug('Fetching settings');
    const config = await configService.getConfig();

    return c.json({
      config,
      auth: {
        enabled: authService.isAuthEnabled(),
      },
    });
  })
  .put('/', zValidator('json', updateSettingsSchema), async (c) => {
    // Settings PUT requires authentication when auth is enabled
    if (authService.isAuthEnabled()) {
      const authHeader = c.req.header('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new HTTPException(401, { message: 'Authentication required' });
      }
      const token = authHeader.slice(7);
      const result = await authService.validateToken(token);
      if (!result.valid) {
        throw new HTTPException(401, { message: result.error || 'Invalid token' });
      }
    }

    const data = c.req.valid('json');
    logger.info({ updates: data }, 'Updating settings');

    const updatedConfig = await configService.setConfig(data);
    logger.info({ config: updatedConfig }, 'Settings updated successfully');

    return c.json({
      message: 'Settings updated successfully',
      config: updatedConfig,
    });
  });

export default settings;
