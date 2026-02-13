import { Hono } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';
import { getOAuthProvider, getEnabledProviders } from '../services/oauth';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../services/oauth/pkce';
import { sessionService } from '../services/session';
import { userRepository, roleRepository } from '../services/database';
import logger from '../lib/logger';

// In-memory PKCE state store with TTL cleanup
const stateStore = new Map<string, { codeVerifier: string; provider: string; createdAt: number }>();

setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000; // 10 minutes
  for (const [state, data] of stateStore.entries()) {
    if (now - data.createdAt > maxAge) {
      stateStore.delete(state);
    }
  }
}, 5 * 60 * 1000);

const CALLBACK_BASE_URL = process.env.AUTH_CALLBACK_URL || '';

function getCallbackUrl(provider: string, reqUrl: string): string {
  if (CALLBACK_BASE_URL) {
    return `${CALLBACK_BASE_URL}/api/auth/callback/${provider}`;
  }
  const url = new URL(reqUrl);
  return `${url.protocol}//${url.host}/api/auth/callback/${provider}`;
}

const isSecure = () => process.env.NODE_ENV === 'production';

const ACCESS_MAX_AGE = 15 * 60; // 15 minutes
const REFRESH_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

const auth = new Hono()
  // List enabled OAuth providers
  .get('/providers', (c) => {
    const providers = getEnabledProviders();
    return c.json(providers);
  })

  // Initiate OAuth login flow
  .get('/login/:provider', async (c) => {
    const providerType = c.req.param('provider');
    const provider = getOAuthProvider(providerType);

    if (!provider) {
      return c.json({ error: { message: `Unknown provider: ${providerType}`, statusCode: 400 } }, 400);
    }

    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    stateStore.set(state, { codeVerifier, provider: providerType, createdAt: Date.now() });

    const redirectUri = getCallbackUrl(providerType, c.req.url);
    const authUrl = provider.getAuthUrl(redirectUri, state, codeChallenge);

    logger.debug({ provider: providerType, state }, 'Initiating OAuth login');
    return c.redirect(authUrl);
  })

  // Handle OAuth callback
  .get('/callback/:provider', async (c) => {
    const providerType = c.req.param('provider');
    const code = c.req.query('code');
    const state = c.req.query('state');

    if (!code || !state) {
      return c.json({ error: { message: 'Missing code or state parameter', statusCode: 400 } }, 400);
    }

    const stored = stateStore.get(state);
    if (!stored || stored.provider !== providerType) {
      return c.json({ error: { message: 'Invalid or expired state', statusCode: 400 } }, 400);
    }
    stateStore.delete(state);

    const provider = getOAuthProvider(providerType);
    if (!provider) {
      return c.json({ error: { message: `Unknown provider: ${providerType}`, statusCode: 400 } }, 400);
    }

    try {
      const redirectUri = getCallbackUrl(providerType, c.req.url);
      const tokens = await provider.exchangeCode(code, redirectUri, stored.codeVerifier);
      const userInfo = await provider.getUserInfo(tokens);

      // Upsert user and update last login
      const user = await userRepository.upsertFromOAuth({
        email: userInfo.email,
        displayName: userInfo.displayName,
        provider: providerType,
        providerId: userInfo.providerId,
        avatarUrl: userInfo.avatarUrl,
      });

      await userRepository.updateLastLogin(user.id);

      // If this is an Entra login and we got group IDs, sync them
      if (providerType === 'entra' && userInfo.groups && userInfo.groups.length > 0) {
        const { groupSyncService } = await import('../services/group-sync');
        await groupSyncService.syncUserGroups(user.id, userInfo.groups);
      }

      // Create session
      const session = await sessionService.createSession(user.id);

      // Set httpOnly cookies
      setCookie(c, 'kf_access_token', session.accessToken, {
        httpOnly: true,
        secure: isSecure(),
        sameSite: 'Lax',
        path: '/',
        maxAge: ACCESS_MAX_AGE,
      });

      setCookie(c, 'kf_refresh_token', session.refreshToken, {
        httpOnly: true,
        secure: isSecure(),
        sameSite: 'Lax',
        path: '/api/auth',
        maxAge: REFRESH_MAX_AGE,
      });

      logger.info({ userId: user.id, provider: providerType }, 'User logged in via OAuth');
      return c.redirect('/');
    } catch (error) {
      logger.error({ error, provider: providerType }, 'OAuth callback failed');
      return c.json(
        { error: { message: error instanceof Error ? error.message : 'OAuth callback failed', statusCode: 500 } },
        500
      );
    }
  })

  // Logout
  .post('/logout', async (c) => {
    const accessToken = getCookie(c, 'kf_access_token');
    if (accessToken) {
      await sessionService.invalidateSession(accessToken);
    }

    deleteCookie(c, 'kf_access_token', { path: '/' });
    deleteCookie(c, 'kf_refresh_token', { path: '/api/auth' });

    return c.json({ message: 'Logged out' });
  })

  // Get current user info
  .get('/me', async (c) => {
    const user = c.get('hubUser') as { sub: string; email: string; displayName: string; provider: string } | undefined;
    if (!user) {
      return c.json({ error: { message: 'Not authenticated', statusCode: 401 } }, 401);
    }

    try {
      const roles = await roleRepository.getUserRoles(user.sub);
      return c.json({
        id: user.sub,
        email: user.email,
        displayName: user.displayName,
        provider: user.provider,
        instances: roles,
      });
    } catch (error) {
      logger.error({ error }, 'Failed to get user info');
      return c.json({ error: { message: 'Failed to get user info', statusCode: 500 } }, 500);
    }
  })

  // Refresh session
  .post('/refresh', async (c) => {
    const refreshToken = getCookie(c, 'kf_refresh_token');
    if (!refreshToken) {
      return c.json({ error: { message: 'No refresh token', statusCode: 401 } }, 401);
    }

    const session = await sessionService.refreshSession(refreshToken);
    if (!session) {
      deleteCookie(c, 'kf_access_token', { path: '/' });
      deleteCookie(c, 'kf_refresh_token', { path: '/api/auth' });
      return c.json({ error: { message: 'Invalid refresh token', statusCode: 401 } }, 401);
    }

    setCookie(c, 'kf_access_token', session.accessToken, {
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'Lax',
      path: '/',
      maxAge: ACCESS_MAX_AGE,
    });

    setCookie(c, 'kf_refresh_token', session.refreshToken, {
      httpOnly: true,
      secure: isSecure(),
      sameSite: 'Lax',
      path: '/api/auth',
      maxAge: REFRESH_MAX_AGE,
    });

    return c.json({ expiresIn: session.expiresIn });
  });

export default auth;
