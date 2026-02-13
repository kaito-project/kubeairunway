import type { Context, Next } from 'hono';

/**
 * Middleware that extracts instance context from the request.
 * In hub mode, requests can include ?instance_id=xxx or X-Instance-Id header.
 * The instance context is stored on the request context for downstream handlers.
 */
export async function instanceContextMiddleware(c: Context, next: Next) {
  const instanceId = c.req.query('instance_id') || c.req.header('X-Instance-Id');

  if (instanceId) {
    c.set('instanceId', instanceId);
  }

  await next();
}
