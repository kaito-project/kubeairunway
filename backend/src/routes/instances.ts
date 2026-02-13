import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { instanceRepository } from '../services/database';
import { instanceManager } from '../services/instance-manager';
import logger from '../lib/logger';

const createInstanceSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, {
    message: 'Name must be lowercase alphanumeric with optional hyphens',
  }),
  displayName: z.string().min(1).max(255),
  endpointUrl: z.string().url(),
  credentialRef: z.string().min(1),
});

const updateInstanceSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  endpointUrl: z.string().url().optional(),
  credentialRef: z.string().min(1).optional(),
});

const app = new Hono();

// GET / — List all instances
app.get('/', async (c) => {
  try {
    const instances = await instanceRepository.listAll();
    return c.json(instances);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to list instances');
    return c.json({ error: { message: 'Failed to list instances', statusCode: 500 } }, 500);
  }
});

// GET /:id — Get instance details
app.get('/:id', async (c) => {
  try {
    const instance = await instanceRepository.findById(c.req.param('id'));
    if (!instance) {
      return c.json({ error: { message: 'Instance not found', statusCode: 404 } }, 404);
    }
    return c.json(instance);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to get instance');
    return c.json({ error: { message: 'Failed to get instance', statusCode: 500 } }, 500);
  }
});

// POST / — Register new instance
app.post('/', zValidator('json', createInstanceSchema), async (c) => {
  try {
    const data = c.req.valid('json');

    // Check for duplicate name
    const existing = await instanceRepository.findByName(data.name);
    if (existing) {
      return c.json({ error: { message: 'Instance with this name already exists', statusCode: 409 } }, 409);
    }

    const instance = await instanceManager.registerInstance(data);
    return c.json(instance, 201);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to register instance');
    return c.json({ error: { message: 'Failed to register instance', statusCode: 500 } }, 500);
  }
});

// PUT /:id — Update instance
app.put('/:id', zValidator('json', updateInstanceSchema), async (c) => {
  try {
    const id = c.req.param('id');
    const data = c.req.valid('json');

    const existing = await instanceRepository.findById(id);
    if (!existing) {
      return c.json({ error: { message: 'Instance not found', statusCode: 404 } }, 404);
    }

    const updated = await instanceRepository.update(id, data);
    return c.json(updated);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to update instance');
    return c.json({ error: { message: 'Failed to update instance', statusCode: 500 } }, 500);
  }
});

// DELETE /:id — Deregister instance
app.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const deleted = await instanceRepository.delete(id);
    if (!deleted) {
      return c.json({ error: { message: 'Instance not found', statusCode: 404 } }, 404);
    }
    return c.json({ message: 'Instance deleted' });
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to delete instance');
    return c.json({ error: { message: 'Failed to delete instance', statusCode: 500 } }, 500);
  }
});

// GET /:id/health — Real-time health check
app.get('/:id/health', async (c) => {
  try {
    const health = await instanceManager.getInstanceHealth(c.req.param('id'));
    return c.json(health);
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'Failed to check instance health');
    return c.json({ error: { message: 'Failed to check instance health', statusCode: 500 } }, 500);
  }
});

export default app;
