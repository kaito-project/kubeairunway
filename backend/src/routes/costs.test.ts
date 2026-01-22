import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import app from '../hono-app';
import { cloudPricingService } from '../services/cloudPricing';

// Mock fetch globally for pricing API tests
const originalFetch = globalThis.fetch;

function mockFetch(response: unknown, options?: { ok?: boolean; status?: number }) {
  // @ts-expect-error - mocking fetch for tests
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: options?.ok ?? true,
      status: options?.status ?? 200,
      statusText: 'OK',
      json: () => Promise.resolve(response),
    } as Response)
  );
}

describe('Costs Routes', () => {
  beforeEach(() => {
    cloudPricingService.clearCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('POST /api/costs/estimate', () => {
    test('validates gpuType is required', async () => {
      const res = await app.request('/api/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gpuCount: 1,
          replicas: 1,
        }),
      });
      expect(res.status).toBe(400);
    });

    test('validates gpuCount is required', async () => {
      const res = await app.request('/api/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gpuType: 'A100-80GB',
          replicas: 1,
        }),
      });
      expect(res.status).toBe(400);
    });

    test('validates replicas is required', async () => {
      const res = await app.request('/api/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gpuType: 'A100-80GB',
          gpuCount: 1,
        }),
      });
      expect(res.status).toBe(400);
    });

    test('validates gpuCount must be at least 1', async () => {
      const res = await app.request('/api/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gpuType: 'A100-80GB',
          gpuCount: 0,
          replicas: 1,
        }),
      });
      expect(res.status).toBe(400);
    });

    test('validates replicas must be at least 1', async () => {
      const res = await app.request('/api/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gpuType: 'A100-80GB',
          gpuCount: 1,
          replicas: 0,
        }),
      });
      expect(res.status).toBe(400);
    });

    test('returns cost estimate for valid request', async () => {
      const res = await app.request('/api/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gpuType: 'A100-80GB',
          gpuCount: 1,
          replicas: 1,
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.breakdown).toBeDefined();
      expect(data.breakdown.totalGpus).toBe(1);
      expect(data.breakdown.normalizedGpuModel).toBe('A100-80GB');
      expect(data.breakdown.estimate).toBeDefined();
    });

    test('returns cost estimate with custom hoursPerMonth', async () => {
      const res = await app.request('/api/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gpuType: 'T4',
          gpuCount: 2,
          replicas: 3,
          hoursPerMonth: 500,
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.breakdown.totalGpus).toBe(6);
    });

    test('normalizes GPU model names', async () => {
      const res = await app.request('/api/costs/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gpuType: 'NVIDIA-A100-SXM4-80GB',
          gpuCount: 1,
          replicas: 1,
        }),
      });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.breakdown.normalizedGpuModel).toBe('A100-80GB');
    });
  });

  describe('GET /api/costs/instance-price', () => {
    test('requires instanceType parameter', async () => {
      const res = await app.request('/api/costs/instance-price');
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('instanceType is required');
    });

    test('returns error for unknown provider', async () => {
      // Note: 'unknownformat' (no dashes) doesn't match any cloud provider pattern
      const res = await app.request('/api/costs/instance-price?instanceType=unknownformat');
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('Could not detect cloud provider');
    });

    test('returns pricing for Azure instance type', async () => {
      mockFetch({
        Items: [
          {
            retailPrice: 3.5,
            currencyCode: 'USD',
            armRegionName: 'eastus',
            effectiveStartDate: '2024-01-01',
            productName: 'Virtual Machines NC Series',
            meterName: 'NC24ads A100 v4',
            unitOfMeasure: '1 Hour',
          },
        ],
      });

      const res = await app.request(
        '/api/costs/instance-price?instanceType=Standard_NC24ads_A100_v4&region=eastus'
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.price).toBeDefined();
      expect(data.price.hourlyPrice).toBe(3.5);
      expect(data.price.currency).toBe('USD');
      expect(data.price.provider).toBe('azure');
    });

    test('returns 404 when price not found', async () => {
      mockFetch({ Items: [] });

      const res = await app.request(
        '/api/costs/instance-price?instanceType=Standard_Unknown_Instance'
      );
      expect(res.status).toBe(404);

      const data = await res.json();
      expect(data.success).toBe(false);
    });

    test('includes cached flag in response', async () => {
      mockFetch({
        Items: [
          {
            retailPrice: 3.5,
            currencyCode: 'USD',
            armRegionName: 'eastus',
            effectiveStartDate: '2024-01-01',
            productName: 'Virtual Machines NC Series',
            meterName: 'NC24ads A100 v4',
            unitOfMeasure: '1 Hour',
          },
        ],
      });

      // First request - not cached
      const res1 = await app.request(
        '/api/costs/instance-price?instanceType=Standard_NC24ads_A100_v4'
      );
      const data1 = await res1.json();
      expect(data1.cached).toBe(false);

      // Second request - cached
      const res2 = await app.request(
        '/api/costs/instance-price?instanceType=Standard_NC24ads_A100_v4'
      );
      const data2 = await res2.json();
      expect(data2.cached).toBe(true);
    });
  });

  describe('GET /api/costs/gpu-models', () => {
    test('returns list of supported GPU models', async () => {
      const res = await app.request('/api/costs/gpu-models');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.models).toBeDefined();
      expect(Array.isArray(data.models)).toBe(true);
      expect(data.models.length).toBeGreaterThan(0);
    });

    test('each model has required fields', async () => {
      const res = await app.request('/api/costs/gpu-models');
      expect(res.status).toBe(200);

      const data = await res.json();
      for (const model of data.models) {
        expect(model.model).toBeDefined();
        expect(typeof model.memoryGb).toBe('number');
        expect(model.generation).toBeDefined();
      }
    });

    test('includes A100-80GB model', async () => {
      const res = await app.request('/api/costs/gpu-models');
      expect(res.status).toBe(200);

      const data = await res.json();
      const a100 = data.models.find((m: { model: string }) => m.model === 'A100-80GB');
      expect(a100).toBeDefined();
      expect(a100.memoryGb).toBe(80);
    });
  });

  describe('GET /api/costs/normalize-gpu', () => {
    test('requires label parameter', async () => {
      const res = await app.request('/api/costs/normalize-gpu');
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('GPU label is required');
    });

    test('normalizes NVIDIA A100 label', async () => {
      const res = await app.request(
        '/api/costs/normalize-gpu?label=NVIDIA-A100-SXM4-80GB'
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.originalLabel).toBe('NVIDIA-A100-SXM4-80GB');
      expect(data.normalizedModel).toBe('A100-80GB');
      expect(data.gpuInfo).toBeDefined();
      expect(data.gpuInfo.memoryGb).toBe(80);
    });

    test('normalizes Tesla T4 label', async () => {
      const res = await app.request('/api/costs/normalize-gpu?label=Tesla-T4');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.normalizedModel).toBe('T4');
    });

    test('normalizes H100 label', async () => {
      const res = await app.request('/api/costs/normalize-gpu?label=NVIDIA-H100-80GB-HBM3');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.normalizedModel).toBe('H100-80GB');
    });
  });

  describe('GET /api/costs/node-pools', () => {
    test('returns node pool costs with cache stats', async () => {
      // This endpoint requires K8s, so we test the response structure
      // when K8s returns an error or empty data
      const res = await app.request('/api/costs/node-pools');

      // May succeed with empty data or fail with K8s error
      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.nodePoolCosts).toBeDefined();
        expect(Array.isArray(data.nodePoolCosts)).toBe(true);
        expect(data.pricingSource).toBeDefined();
        expect(data.cacheStats).toBeDefined();
      }
    });

    test('accepts gpuCount and replicas query params', async () => {
      const res = await app.request('/api/costs/node-pools?gpuCount=2&replicas=3');

      // May succeed or fail depending on K8s
      expect([200, 500]).toContain(res.status);
    });

    test('accepts realtime=false to disable realtime pricing', async () => {
      const res = await app.request('/api/costs/node-pools?realtime=false');

      expect([200, 500]).toContain(res.status);

      if (res.status === 200) {
        const data = await res.json();
        expect(data.pricingSource).toBe('static');
      }
    });

    test('accepts computeType=cpu for CPU-only pools', async () => {
      const res = await app.request('/api/costs/node-pools?computeType=cpu');

      expect([200, 500]).toContain(res.status);
    });
  });
});
