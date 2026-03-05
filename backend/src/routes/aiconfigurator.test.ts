import { describe, test, expect, afterEach } from 'bun:test';
import app from '../hono-app';
import { aiConfiguratorService } from '../services/aiconfigurator';
import { mockServiceMethod } from '../test/helpers';
import {
  aiConfiguratorStatusAvailable,
  aiConfiguratorStatusUnavailable,
  aiConfiguratorSuccessResult,
} from '../test/fixtures';

describe('AI Configurator Routes', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    restores.forEach((r) => r());
    restores.length = 0;
  });

  describe('GET /api/aiconfigurator/status', () => {
    test('returns available status', async () => {
      restores.push(
        mockServiceMethod(aiConfiguratorService, 'checkStatus', async () => aiConfiguratorStatusAvailable),
      );

      const res = await app.request('/api/aiconfigurator/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.available).toBe(true);
      expect(data.version).toBeDefined();
    });

    test('returns unavailable status', async () => {
      restores.push(
        mockServiceMethod(aiConfiguratorService, 'checkStatus', async () => aiConfiguratorStatusUnavailable),
      );

      const res = await app.request('/api/aiconfigurator/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.available).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('POST /api/aiconfigurator/analyze', () => {
    test('returns 400 for empty body', async () => {
      const res = await app.request('/api/aiconfigurator/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toBe('Invalid request');
    });

    test('returns 400 when gpuType is missing', async () => {
      const res = await app.request('/api/aiconfigurator/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: 'meta-llama/Llama-3.1-8B-Instruct', gpuCount: 1 }),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    test('returns 400 when gpuType is empty string', async () => {
      const res = await app.request('/api/aiconfigurator/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: 'meta-llama/Llama-3.1-8B-Instruct',
          gpuType: '',
          gpuCount: 1,
        }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when gpuCount is negative', async () => {
      const res = await app.request('/api/aiconfigurator/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: 'meta-llama/Llama-3.1-8B-Instruct',
          gpuType: 'H100-80GB',
          gpuCount: -1,
        }),
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when gpuCount is 0', async () => {
      const res = await app.request('/api/aiconfigurator/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: 'meta-llama/Llama-3.1-8B-Instruct',
          gpuType: 'H100-80GB',
          gpuCount: 0,
        }),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBeDefined();
    });

    test('returns 200 with success result for valid body', async () => {
      restores.push(
        mockServiceMethod(aiConfiguratorService, 'analyze', async () => aiConfiguratorSuccessResult),
      );

      const res = await app.request('/api/aiconfigurator/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: 'meta-llama/Llama-3.1-8B-Instruct',
          gpuType: 'H100-80GB',
          gpuCount: 2,
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.config).toBeDefined();
      expect(data.mode).toBeDefined();
      expect(data.replicas).toBeDefined();
    });
  });

  describe('POST /api/aiconfigurator/normalize-gpu', () => {
    test('returns 400 for empty body', async () => {
      const res = await app.request('/api/aiconfigurator/normalize-gpu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toBeDefined();
      expect(data.error.message).toContain('gpuProduct');
    });

    test('returns 200 with normalized GPU type', async () => {
      const res = await app.request('/api/aiconfigurator/normalize-gpu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gpuProduct: 'NVIDIA-A100-SXM4-80GB' }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.gpuProduct).toBe('NVIDIA-A100-SXM4-80GB');
      expect(data.normalized).toBeDefined();
    });
  });
});
