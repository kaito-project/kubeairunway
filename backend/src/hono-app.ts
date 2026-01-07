import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { compress } from 'hono/compress';
import { HTTPException } from 'hono/http-exception';

import { authService } from './services/auth';
import logger from './lib/logger';
import {
  isCompiled,
  loadStaticFiles,
  getStaticFileResponse,
  getIndexHtmlResponse,
  hasStaticFiles,
} from './static';
import type { UserInfo } from '@kubefoundry/shared';

// Import route modules
import {
  health,
  models,
  settings,
  deployments,
  installation,
  oauth,
  secrets,
  autoscaler,
  runtimes,
  aikit,
  aiconfigurator,
} from './routes';

// Load static files at startup
await loadStaticFiles();

const compiled = isCompiled();
logger.info(
  { mode: compiled ? 'compiled' : 'development' },
  `🔧 Running in ${compiled ? 'compiled binary' : 'development'} mode`
);

// ============================================================================
// Main App
// ============================================================================

const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const app = new Hono();

// Global middleware
app.use('*', compress());
app.use(
  '*',
  cors({
    origin: CORS_ORIGIN,
  })
);

// Request logging
app.use('*', async (c, next) => {
  logger.info({ method: c.req.method, url: c.req.url }, `${c.req.method} ${c.req.path}`);
  await next();
});

// ============================================================================
// Auth Middleware
// ============================================================================

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/api/health',
  '/api/cluster/status',
  '/api/settings',  // Settings is public (read-only auth config needed by frontend)
  '/api/oauth',     // OAuth routes must be public for initial authentication
];

// Auth middleware for protected API routes
app.use('/api/*', async (c, next) => {
  // Skip auth if not enabled
  if (!authService.isAuthEnabled()) {
    return next();
  }

  // Skip auth for public routes
  const path = c.req.path;
  if (PUBLIC_ROUTES.some(route => path === route || path.startsWith(route + '/'))) {
    return next();
  }

  // Extract bearer token
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      { error: { message: 'Authentication required', statusCode: 401 } },
      401
    );
  }

  const token = authHeader.slice(7); // Remove 'Bearer ' prefix

  // Validate token via Kubernetes TokenReview
  const result = await authService.validateToken(token);

  if (!result.valid) {
    logger.warn({ error: result.error }, 'Token validation failed');
    return c.json(
      { error: { message: result.error || 'Invalid token', statusCode: 401 } },
      401
    );
  }

  // Attach user info to context for logging/audit
  c.set('user', result.user as UserInfo);
  logger.debug({ username: result.user?.username }, 'Authenticated request');

  return next();
});

// API Routes
app.route('/api/health', health);
app.route('/api/cluster', health);
app.route('/api/models', models);
app.route('/api/settings', settings);
app.route('/api/deployments', deployments);
app.route('/api/installation', installation);
app.route('/api/oauth', oauth);
app.route('/api/secrets', secrets);
app.route('/api/autoscaler', autoscaler);
app.route('/api/runtimes', runtimes);
app.route('/api/aikit', aikit);
app.route('/api/aiconfigurator', aiconfigurator);

// Static file serving middleware - uses Bun.file() for zero-copy serving
app.use('*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) {
    return next();
  }

  if (hasStaticFiles()) {
    const response = getStaticFileResponse(c.req.path);
    if (response) {
      return response;
    }
  }

  return next();
});

// SPA fallback
app.notFound((c) => {
  // If it's an API route that wasn't matched, return 404 JSON
  if (c.req.path.startsWith('/api/')) {
    logger.warn(
      { method: c.req.method, url: c.req.url, statusCode: 404 },
      `No route matched: ${c.req.method} ${c.req.url}`
    );
    return c.json(
      { error: { message: `Route not found: ${c.req.method} ${c.req.path}`, statusCode: 404 } },
      404
    );
  }

  // Serve index.html for SPA routing - uses Bun.file() for zero-copy serving
  if (hasStaticFiles()) {
    const response = getIndexHtmlResponse();
    if (response) {
      return response;
    }
  }

  return c.text('Frontend not available. Run with frontend build or in development mode.', 404);
});

// Global error handler
app.onError((err, c) => {
  logger.error({ error: err, stack: err.stack }, `Error: ${err.message}`);

  if (err instanceof HTTPException) {
    return c.json(
      {
        error: {
          message: err.message,
          statusCode: err.status,
        },
      },
      err.status
    );
  }

  return c.json(
    {
      error: {
        message: err.message || 'Internal Server Error',
        statusCode: 500,
      },
    },
    500
  );
});

// Export for RPC type inference
export type AppType = typeof app;

export default app;
