import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
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
