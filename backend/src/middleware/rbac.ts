import type { Context, Next } from 'hono';
import { rbacService } from '../services/rbac';

/**
 * Middleware: require the user to be an admin
 */
export function requireAdmin() {
  return async (c: Context, next: Next) => {
    const hubUser = c.get('hubUser');
    if (!hubUser) {
      return c.json({ error: { message: 'Not authenticated', statusCode: 401 } }, 401);
    }

    const isAdmin = await rbacService.canManage(hubUser.sub);
    if (!isAdmin) {
      return c.json({ error: { message: 'Admin access required', statusCode: 403 } }, 403);
    }

    await next();
  };
}

/**
 * Middleware: require access to the instance specified by :instanceId param
 */
export function requireInstanceAccess() {
  return async (c: Context, next: Next) => {
    const hubUser = c.get('hubUser');
    if (!hubUser) {
      return c.json({ error: { message: 'Not authenticated', statusCode: 401 } }, 401);
    }

    const instanceId = c.req.param('instanceId') || c.req.query('instance_id');
    if (!instanceId) {
      return c.json({ error: { message: 'Instance ID required', statusCode: 400 } }, 400);
    }

    const hasAccess = await rbacService.canAccessInstance(hubUser.sub, instanceId);
    if (!hasAccess) {
      return c.json({ error: { message: 'Access denied to this instance', statusCode: 403 } }, 403);
    }

    await next();
  };
}
