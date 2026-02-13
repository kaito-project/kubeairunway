import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { EntraOAuthProvider } from '../entra';
import { GitHubOAuthProvider } from '../github';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '../pkce';
import { initializeOAuthProviders, getOAuthProvider, getEnabledProviders, clearOAuthProviders } from '../index';

// --- PKCE Tests ---

describe('PKCE helpers', () => {
  test('generateCodeVerifier returns a base64url string of expected length', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('generateCodeVerifier produces unique values', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  test('generateCodeChallenge produces a valid S256 challenge', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge.length).toBeGreaterThan(0);
  });

  test('generateCodeChallenge is deterministic for the same verifier', async () => {
    const verifier = 'test-verifier-string';
    const a = await generateCodeChallenge(verifier);
    const b = await generateCodeChallenge(verifier);
    expect(a).toBe(b);
  });

  test('generateState returns a valid UUID', () => {
    const state = generateState();
    expect(state).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// --- Entra OAuth Provider Tests ---

describe('EntraOAuthProvider', () => {
  const provider = new EntraOAuthProvider('test-client-id', 'test-tenant-id', 'test-secret');

  test('has correct type', () => {
    expect(provider.type).toBe('entra');
  });

  test('implements OAuthProvider interface', () => {
    expect(typeof provider.getAuthUrl).toBe('function');
    expect(typeof provider.exchangeCode).toBe('function');
    expect(typeof provider.getUserInfo).toBe('function');
    expect(typeof provider.refreshToken).toBe('function');
  });

  test('getAuthUrl generates correct authorization URL', () => {
    const url = provider.getAuthUrl('http://localhost:3000/callback', 'test-state', 'test-challenge');
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://login.microsoftonline.com');
    expect(parsed.pathname).toBe('/test-tenant-id/oauth2/v2.0/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('openid profile email User.Read');
    expect(parsed.searchParams.get('state')).toBe('test-state');
    expect(parsed.searchParams.get('code_challenge')).toBe('test-challenge');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('exchangeCode calls the correct token endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'mock-access-token',
            refresh_token: 'mock-refresh-token',
            id_token: 'header.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJuYW1lIjoiVGVzdCIsIm9pZCI6IjEyMyJ9.sig',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = mockFetch;

    try {
      const tokens = await provider.exchangeCode('auth-code', 'http://localhost:3000/callback', 'verifier');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://login.microsoftonline.com/test-tenant-id/oauth2/v2.0/token');
      expect(options.method).toBe('POST');

      const body = new URLSearchParams(options.body);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('client_id')).toBe('test-client-id');
      expect(body.get('client_secret')).toBe('test-secret');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('code_verifier')).toBe('verifier');

      expect(tokens.accessToken).toBe('mock-access-token');
      expect(tokens.refreshToken).toBe('mock-refresh-token');
      expect(tokens.expiresIn).toBe(3600);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('exchangeCode throws on error response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response('error', { status: 400 })));

    try {
      await expect(provider.exchangeCode('bad', 'http://localhost:3000/callback', 'v')).rejects.toThrow(
        'Entra token exchange failed: 400',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('getUserInfo extracts user info from Graph API and ID token', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock((url: string) => {
      if (url === 'https://graph.microsoft.com/v1.0/me') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'graph-oid',
              displayName: 'Test User',
              mail: 'test@example.com',
              userPrincipalName: 'test@example.com',
            }),
            { status: 200 },
          ),
        );
      }
      if (url === 'https://graph.microsoft.com/v1.0/me/memberOf') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              value: [
                { '@odata.type': '#microsoft.graph.group', id: 'group-1' },
                { '@odata.type': '#microsoft.graph.group', id: 'group-2' },
                { '@odata.type': '#microsoft.graph.directoryRole', id: 'role-1' },
              ],
            }),
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    globalThis.fetch = mockFetch;

    try {
      const userInfo = await provider.getUserInfo({
        accessToken: 'test-access-token',
        idToken: 'h.' + btoa(JSON.stringify({ email: 'id@example.com', name: 'ID User', oid: 'id-oid' })) + '.s',
      });

      expect(userInfo.email).toBe('test@example.com');
      expect(userInfo.displayName).toBe('Test User');
      expect(userInfo.providerId).toBe('graph-oid');
      expect(userInfo.groups).toEqual(['group-1', 'group-2']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('getUserInfo uses ID token groups claim when available', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ id: 'oid-1', displayName: 'User', mail: 'u@test.com' }),
          { status: 200 },
        ),
      ),
    );

    try {
      const idPayload = btoa(JSON.stringify({ groups: ['g1', 'g2'], oid: 'oid-1' }));
      const userInfo = await provider.getUserInfo({
        accessToken: 'tok',
        idToken: `h.${idPayload}.s`,
      });

      // Should use ID token groups, not call memberOf
      expect(userInfo.groups).toEqual(['g1', 'g2']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// --- GitHub OAuth Provider Tests ---

describe('GitHubOAuthProvider', () => {
  const provider = new GitHubOAuthProvider('gh-client-id', 'gh-client-secret');

  test('has correct type', () => {
    expect(provider.type).toBe('github');
  });

  test('implements OAuthProvider interface', () => {
    expect(typeof provider.getAuthUrl).toBe('function');
    expect(typeof provider.exchangeCode).toBe('function');
    expect(typeof provider.getUserInfo).toBe('function');
  });

  test('getAuthUrl generates correct authorization URL', () => {
    const url = provider.getAuthUrl('http://localhost:3000/callback', 'test-state', 'test-challenge');
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://github.com');
    expect(parsed.pathname).toBe('/login/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('gh-client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback');
    expect(parsed.searchParams.get('scope')).toBe('read:user user:email read:org');
    expect(parsed.searchParams.get('state')).toBe('test-state');
    expect(parsed.searchParams.get('code_challenge')).toBe('test-challenge');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('exchangeCode calls the correct token endpoint', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'gho_mock_token',
            token_type: 'bearer',
          }),
          { status: 200 },
        ),
      ),
    );
    globalThis.fetch = mockFetch;

    try {
      const tokens = await provider.exchangeCode('auth-code', 'http://localhost:3000/callback', 'verifier');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://github.com/login/oauth/access_token');
      expect(options.method).toBe('POST');
      expect(options.headers.Accept).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.client_id).toBe('gh-client-id');
      expect(body.client_secret).toBe('gh-client-secret');
      expect(body.code).toBe('auth-code');

      expect(tokens.accessToken).toBe('gho_mock_token');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('exchangeCode throws on GitHub OAuth error response', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: 'bad_verification_code', error_description: 'The code has expired' }),
          { status: 200 },
        ),
      ),
    );

    try {
      await expect(provider.exchangeCode('bad', 'http://localhost:3000/callback', 'v')).rejects.toThrow(
        'GitHub OAuth error: The code has expired',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('getUserInfo fetches user profile and orgs', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock((url: string) => {
      if (url === 'https://api.github.com/user') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 12345,
              login: 'testuser',
              name: 'Test User',
              email: 'test@github.com',
              avatar_url: 'https://avatars.githubusercontent.com/u/12345',
            }),
            { status: 200 },
          ),
        );
      }
      if (url === 'https://api.github.com/user/orgs') {
        return Promise.resolve(
          new Response(JSON.stringify([{ login: 'org1' }, { login: 'org2' }]), { status: 200 }),
        );
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    globalThis.fetch = mockFetch;

    try {
      const userInfo = await provider.getUserInfo({ accessToken: 'gho_test' });

      expect(userInfo.email).toBe('test@github.com');
      expect(userInfo.displayName).toBe('Test User');
      expect(userInfo.providerId).toBe('12345');
      expect(userInfo.avatarUrl).toBe('https://avatars.githubusercontent.com/u/12345');
      expect(userInfo.groups).toEqual(['org1', 'org2']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('getUserInfo falls back to /user/emails when email is null', async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = mock((url: string) => {
      if (url === 'https://api.github.com/user') {
        return Promise.resolve(
          new Response(
            JSON.stringify({ id: 99, login: 'nomail', name: null, email: null }),
            { status: 200 },
          ),
        );
      }
      if (url === 'https://api.github.com/user/emails') {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { email: 'secondary@test.com', primary: false, verified: true },
              { email: 'primary@test.com', primary: true, verified: true },
            ]),
            { status: 200 },
          ),
        );
      }
      if (url === 'https://api.github.com/user/orgs') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      return Promise.resolve(new Response('', { status: 404 }));
    });
    globalThis.fetch = mockFetch;

    try {
      const userInfo = await provider.getUserInfo({ accessToken: 'gho_test' });

      expect(userInfo.email).toBe('primary@test.com');
      expect(userInfo.displayName).toBe('nomail');
      expect(userInfo.providerId).toBe('99');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// --- Provider Registry Tests ---

describe('OAuth Provider Registry', () => {
  const envBackup: Record<string, string | undefined> = {};
  const envKeys = [
    'ENABLED_AUTH_PROVIDERS',
    'AZURE_CLIENT_ID',
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_SECRET',
    'GITHUB_CLIENT_ID',
    'GITHUB_CLIENT_SECRET',
  ];

  beforeEach(() => {
    clearOAuthProviders();
    for (const key of envKeys) {
      envBackup[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (envBackup[key] !== undefined) {
        process.env[key] = envBackup[key];
      } else {
        delete process.env[key];
      }
    }
  });

  test('initializes no providers when ENABLED_AUTH_PROVIDERS is empty', () => {
    initializeOAuthProviders();
    expect(getEnabledProviders()).toEqual([]);
  });

  test('initializes Entra provider with correct env vars', () => {
    process.env.ENABLED_AUTH_PROVIDERS = 'entra';
    process.env.AZURE_CLIENT_ID = 'test-client';
    process.env.AZURE_TENANT_ID = 'test-tenant';
    process.env.AZURE_CLIENT_SECRET = 'test-secret';

    initializeOAuthProviders();

    const provider = getOAuthProvider('entra');
    expect(provider).toBeDefined();
    expect(provider!.type).toBe('entra');
    expect(getEnabledProviders()).toContainEqual({ type: 'entra', enabled: true });
  });

  test('initializes GitHub provider with correct env vars', () => {
    process.env.ENABLED_AUTH_PROVIDERS = 'github';
    process.env.GITHUB_CLIENT_ID = 'gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';

    initializeOAuthProviders();

    const provider = getOAuthProvider('github');
    expect(provider).toBeDefined();
    expect(provider!.type).toBe('github');
  });

  test('initializes multiple providers', () => {
    process.env.ENABLED_AUTH_PROVIDERS = 'entra,github';
    process.env.AZURE_CLIENT_ID = 'az-id';
    process.env.AZURE_TENANT_ID = 'az-tenant';
    process.env.GITHUB_CLIENT_ID = 'gh-id';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret';

    initializeOAuthProviders();

    expect(getEnabledProviders().length).toBe(2);
    expect(getOAuthProvider('entra')).toBeDefined();
    expect(getOAuthProvider('github')).toBeDefined();
  });

  test('skips provider when required env vars are missing', () => {
    process.env.ENABLED_AUTH_PROVIDERS = 'entra,github';
    // Missing all required vars

    initializeOAuthProviders();

    expect(getOAuthProvider('entra')).toBeUndefined();
    expect(getOAuthProvider('github')).toBeUndefined();
  });

  test('returns undefined for unknown provider', () => {
    expect(getOAuthProvider('unknown')).toBeUndefined();
  });
});
