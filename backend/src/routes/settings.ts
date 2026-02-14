import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { configService } from '../services/config';
import { authService } from '../services/auth';
import { providerRegistry, listProviderInfo } from '../providers';
import logger from '../lib/logger';

const updateSettingsSchema = z.object({
  defaultNamespace: z.string().optional(),
});

const providerIdParamsSchema = z.object({
  id: z.string().min(1),
});

const settings = new Hono()
  .get('/', async (c) => {
    logger.debug('Fetching settings');
    const config = await configService.getConfig();
    const providers = listProviderInfo();

    return c.json({
      config,
      providers,
      auth: {
        enabled: authService.isAuthEnabled(),
        hubMode: process.env.HUB_MODE === 'true' || process.env.HUB_MODE === '1',
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
  })
  .get('/providers', async (c) => {
    const providers = listProviderInfo();
    return c.json({ providers });
  })
  .get('/providers/:id', zValidator('param', providerIdParamsSchema), async (c) => {
    const { id } = c.req.valid('param');
    const provider = providerRegistry.getProviderOrNull(id);

    if (!provider) {
      throw new HTTPException(404, { message: `Provider not found: ${id}` });
    }

    return c.json({
      id: provider.id,
      name: provider.name,
      description: provider.description,
      defaultNamespace: provider.defaultNamespace,
      crdConfig: provider.getCRDConfig(),
      installationSteps: provider.getInstallationSteps(),
      helmRepos: provider.getHelmRepos(),
      helmCharts: provider.getHelmCharts(),
    });
  });

export default settings;
