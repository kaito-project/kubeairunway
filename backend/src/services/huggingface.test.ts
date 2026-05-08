import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';

// Store original fetch
const originalFetch = global.fetch;

describe('HuggingFaceService', () => {
  let mockFetch: ReturnType<typeof mock>;
  let huggingFaceService: typeof import('./huggingface').huggingFaceService;

  beforeEach(async () => {
    // Create mock fetch
    mockFetch = mock(() => Promise.resolve(new Response()));
    // @ts-expect-error - Mocking global fetch for testing
    global.fetch = mockFetch;

    // Clear module cache and re-import
    delete require.cache[require.resolve('./huggingface')];
    const module = await import('./huggingface');
    huggingFaceService = module.huggingFaceService;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('getClientId', () => {
    test('returns the configured client ID', () => {
      const clientId = huggingFaceService.getClientId();
      expect(clientId).toBeDefined();
      expect(typeof clientId).toBe('string');
      expect(clientId.length).toBeGreaterThan(0);
    });
  });

  describe('exchangeCodeForToken', () => {
    test('exchanges authorization code for token successfully', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'hf_test_token_123',
              expires_in: 3600,
              scope: 'openid profile read-repos',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const result = await huggingFaceService.exchangeCodeForToken(
        'test_auth_code',
        'test_code_verifier_1234567890123456789012345678901234567890',
        'http://localhost:3000/oauth/callback'
      );

      expect(result.accessToken).toBe('hf_test_token_123');
      expect(result.expiresIn).toBe(3600);
      expect(result.scope).toBe('openid profile read-repos');

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://huggingface.co/oauth/token');
      expect(options.method).toBe('POST');
      expect(options.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    });

    test('throws error when token exchange fails', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response('Invalid authorization code', { status: 400 })
        )
      );

      await expect(
        huggingFaceService.exchangeCodeForToken(
          'invalid_code',
          'test_code_verifier_1234567890123456789012345678901234567890',
          'http://localhost:3000/oauth/callback'
        )
      ).rejects.toThrow('Failed to exchange authorization code');
    });
  });

  describe('getUserInfo', () => {
    test('fetches user info successfully', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user123',
              name: 'testuser',
              fullname: 'Test User',
              email: 'test@example.com',
              avatarUrl: 'https://huggingface.co/avatars/test.png',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const userInfo = await huggingFaceService.getUserInfo('hf_test_token');

      expect(userInfo.id).toBe('user123');
      expect(userInfo.name).toBe('testuser');
      expect(userInfo.fullname).toBe('Test User');
      expect(userInfo.email).toBe('test@example.com');
      expect(userInfo.avatarUrl).toBe('https://huggingface.co/avatars/test.png');
    });

    test('handles user without optional fields', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user123',
              name: 'testuser',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const userInfo = await huggingFaceService.getUserInfo('hf_test_token');

      expect(userInfo.id).toBe('user123');
      expect(userInfo.name).toBe('testuser');
      expect(userInfo.fullname).toBe('testuser'); // Falls back to name
    });

    test('throws error when user info fetch fails', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 }))
      );

      await expect(huggingFaceService.getUserInfo('invalid_token')).rejects.toThrow(
        'Failed to get user info'
      );
    });
  });

  describe('validateToken', () => {
    test('returns valid result for valid token', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'user123',
              name: 'testuser',
              fullname: 'Test User',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      );

      const result = await huggingFaceService.validateToken('hf_valid_token');

      expect(result.valid).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user?.name).toBe('testuser');
      expect(result.error).toBeUndefined();
    });

    test('returns invalid result for invalid token', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Unauthorized', { status: 401 }))
      );

      const result = await huggingFaceService.validateToken('invalid_token');

      expect(result.valid).toBe(false);
      expect(result.user).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  describe('searchModels', () => {
    test('requests compatibility metadata alongside safetensors so Laguna models are searchable', async () => {
      const requestedExpands: string[][] = [];

      mockFetch.mockImplementation((input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const expands = url.searchParams.getAll('expand[]');
        requestedExpands.push(expands);

        const hasCompatibilityMetadata = ['config', 'pipeline_tag', 'library_name'].every((field) =>
          expands.includes(field)
        );
        const hasDeployMetadata = ['safetensors', 'gated', 'downloads', 'likes'].every((field) =>
          expands.includes(field)
        );

        const models = url.searchParams.get('filter') === 'text-generation'
          ? [
              hasCompatibilityMetadata && hasDeployMetadata
                ? {
                    _id: '69ea86258ae7e80e6ce4d234',
                    id: 'poolside/Laguna-XS.2',
                    modelId: 'poolside/Laguna-XS.2',
                    downloads: 16792,
                    likes: 232,
                    pipeline_tag: 'text-generation',
                    library_name: 'transformers',
                    config: { architectures: ['LagunaForCausalLM'], model_type: 'laguna' },
                    gated: false,
                    safetensors: { total: 33442617088 },
                  }
                : {
                    _id: '69ea86258ae7e80e6ce4d234',
                    id: 'poolside/Laguna-XS.2',
                    modelId: 'poolside/Laguna-XS.2',
                    gated: false,
                    safetensors: { total: 33442617088 },
                  },
            ]
          : [];

        return Promise.resolve(
          new Response(JSON.stringify(models), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      });

      const result = await huggingFaceService.searchModels({ query: 'poolside', limit: 20 });

      expect(result.models).toHaveLength(1);
      expect(result.models[0].id).toBe('poolside/Laguna-XS.2');
      expect(result.models[0].architectures).toEqual(['LagunaForCausalLM']);
      expect(result.models[0].supportedEngines).toEqual(['vllm']);
      expect(result.models[0].parameterCount).toBe(33442617088);
      expect(requestedExpands).toHaveLength(2);
      for (const expands of requestedExpands) {
        expect(expands).toContain('safetensors');
        expect(expands).toContain('gated');
        expect(expands).toContain('config');
        expect(expands).toContain('pipeline_tag');
        expect(expands).toContain('library_name');
        expect(expands).toContain('downloads');
        expect(expands).toContain('likes');
      }
    });
  });

  describe('handleOAuthCallback', () => {
    test('completes full OAuth flow successfully', async () => {
      let callCount = 0;
      mockFetch.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Token exchange
          return Promise.resolve(
            new Response(
              JSON.stringify({
                access_token: 'hf_oauth_token',
                expires_in: 3600,
                scope: 'openid profile read-repos',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        } else {
          // User info
          return Promise.resolve(
            new Response(
              JSON.stringify({
                id: 'user123',
                name: 'testuser',
                fullname: 'Test User',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            )
          );
        }
      });

      const result = await huggingFaceService.handleOAuthCallback(
        'auth_code',
        'code_verifier_1234567890123456789012345678901234567890',
        'http://localhost:3000/oauth/callback'
      );

      expect(result.accessToken).toBe('hf_oauth_token');
      expect(result.tokenType).toBe('Bearer');
      expect(result.expiresIn).toBe(3600);
      expect(result.user.name).toBe('testuser');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test('throws error when token exchange fails in OAuth flow', async () => {
      mockFetch.mockImplementation(() =>
        Promise.resolve(new Response('Invalid code', { status: 400 }))
      );

      await expect(
        huggingFaceService.handleOAuthCallback(
          'invalid_code',
          'code_verifier_1234567890123456789012345678901234567890',
          'http://localhost:3000/oauth/callback'
        )
      ).rejects.toThrow();
    });
  });
});
