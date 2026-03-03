import { describe, test, expect, afterEach, mock } from 'bun:test';
import app from '../hono-app';

// Mock globalThis.fetch to prevent real HuggingFace API calls.
// Service-level mocking doesn't work reliably because huggingface.test.ts
// clears the module cache, causing a different singleton instance.
const originalFetch = globalThis.fetch;

function mockFetchResponse(response: unknown, options?: { ok?: boolean; status?: number }) {
  // @ts-expect-error - mocking fetch for tests
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: options?.ok ?? true,
      status: options?.status ?? 200,
      statusText: 'OK',
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    } as Response)
  );
}

describe('Models Routes', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('GET /api/models/search', () => {
    test('returns 400 when q param is missing', async () => {
      const res = await app.request('/api/models/search');
      expect(res.status).toBe(400);
    });

    test('returns 400 when q param is too short', async () => {
      const res = await app.request('/api/models/search?q=a');
      expect(res.status).toBe(400);
    });

    test('returns search results for valid query', async () => {
      // Mock HuggingFace API response (searchModels calls fetch internally)
      mockFetchResponse([
        {
          _id: 'meta-llama/Llama-3.1-8B',
          id: 'meta-llama/Llama-3.1-8B',
          modelId: 'meta-llama/Llama-3.1-8B',
          pipeline_tag: 'text-generation',
          library_name: 'transformers',
          config: { model_type: 'llama' },
        },
      ]);

      const res = await app.request('/api/models/search?q=llama');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.models).toBeDefined();
      expect(Array.isArray(data.models)).toBe(true);
      expect(data.query).toBe('llama');
    });

    test('returns 200 with limit and offset params', async () => {
      mockFetchResponse([]);

      const res = await app.request('/api/models/search?q=llama&limit=5&offset=10');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.models).toBeDefined();
      expect(Array.isArray(data.models)).toBe(true);
    });

    test('returns 500 when HuggingFace API fails', async () => {
      mockFetchResponse('Internal Server Error', { ok: false, status: 500 });

      const res = await app.request('/api/models/search?q=llama');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/models/:modelId/gguf-files', () => {
    test('returns gguf files for a model', async () => {
      mockFetchResponse({
        siblings: [
          { rfilename: 'model-q4_0.gguf' },
          { rfilename: 'model-q8_0.gguf' },
          { rfilename: 'README.md' },
        ],
      });

      const res = await app.request('/api/models/Qwen/Qwen3-0.6B/gguf-files');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.files).toBeDefined();
      expect(Array.isArray(data.files)).toBe(true);
      expect(data.files).toHaveLength(2);
      expect(data.files).toContain('model-q4_0.gguf');
      expect(data.files).toContain('model-q8_0.gguf');
    });

    test('returns 500 when HuggingFace API fails', async () => {
      mockFetchResponse('Not Found', { ok: false, status: 404 });

      const res = await app.request('/api/models/unknown/model/gguf-files');
      expect(res.status).toBe(500);
    });
  });
});
