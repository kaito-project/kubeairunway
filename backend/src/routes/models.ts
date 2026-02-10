import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { huggingFaceService } from '../services/huggingface';
import models from '../data/models.json';
import logger from '../lib/logger';

const modelSearchQuerySchema = z.object({
  q: z.string().min(2, 'Search query must be at least 2 characters'),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .pipe(z.number().int().min(1).max(50)),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 0))
    .pipe(z.number().int().min(0)),
});

const modelsRoute = new Hono()
  .get('/', (c) => {
    return c.json({ models: models.models });
  })
  .get('/search', zValidator('query', modelSearchQuerySchema), async (c) => {
    const { q, limit, offset } = c.req.valid('query');

    // Extract HuggingFace token from dedicated header (not Authorization, which is for cluster auth)
    const hfToken = c.req.header('X-HF-Token') || undefined;

    try {
      const results = await huggingFaceService.searchModels(
        { query: q, limit, offset },
        hfToken
      );
      return c.json(results);
    } catch (error) {
      logger.error({ error, query: q }, 'Model search failed');
      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : 'Model search failed',
      });
    }
  })
  .get('/:modelId{.+}/gguf-files', async (c) => {
    const modelId = c.req.param('modelId');
    
    // Extract HuggingFace token from dedicated header (not Authorization, which is for cluster auth)
    const hfToken = c.req.header('X-HF-Token') || undefined;

    try {
      const ggufFiles = await huggingFaceService.getGgufFiles(modelId, hfToken);
      return c.json({ files: ggufFiles });
    } catch (error) {
      logger.error({ error, modelId }, 'Failed to fetch GGUF files');
      throw new HTTPException(500, {
        message: error instanceof Error ? error.message : 'Failed to fetch GGUF files',
      });
    }
  })
  .get('/:id{.+}', (c) => {
    const modelId = c.req.param('id');
    const model = models.models.find((m) => m.id === modelId);

    if (!model) {
      throw new HTTPException(404, { message: 'Model not found' });
    }

    return c.json(model);
  });

export default modelsRoute;
