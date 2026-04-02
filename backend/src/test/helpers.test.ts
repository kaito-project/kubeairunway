import { describe, test, expect, afterEach } from 'bun:test';
import { mockFetchByUrl } from './helpers';

describe('mockFetchByUrl', () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  test('routes responses by URL substring match', async () => {
    restore = mockFetchByUrl({
      '/oauth/token': { body: { access_token: 'test-token' } },
      '/api/whoami-v2': { body: { name: 'testuser' } },
    });

    const tokenRes = await fetch('https://huggingface.co/oauth/token', { method: 'POST' });
    expect(tokenRes.ok).toBe(true);
    const tokenData = await tokenRes.json();
    expect(tokenData.access_token).toBe('test-token');

    const whoamiRes = await fetch('https://huggingface.co/api/whoami-v2');
    expect(whoamiRes.ok).toBe(true);
    const whoamiData = await whoamiRes.json();
    expect(whoamiData.name).toBe('testuser');
  });

  test('returns 404 for unmatched URLs', async () => {
    restore = mockFetchByUrl({
      '/oauth/token': { body: { access_token: 'test-token' } },
    });

    const res = await fetch('https://example.com/unknown');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  test('supports custom status and ok fields', async () => {
    restore = mockFetchByUrl({
      '/api/fail': { body: { error: 'bad request' }, ok: false, status: 400 },
    });

    const res = await fetch('https://example.com/api/fail');
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('bad request');
  });

  test('restores original fetch after calling restore', async () => {
    const originalFetch = globalThis.fetch;
    restore = mockFetchByUrl({
      '/test': { body: { mocked: true } },
    });
    expect(globalThis.fetch).not.toBe(originalFetch);

    restore();
    restore = undefined;
    expect(globalThis.fetch).toBe(originalFetch);
  });
});
