import { describe, it, expect } from 'vitest';
import { createApiClient } from './index';

describe('createApiClient', () => {
  const config = {
    baseUrl: 'http://localhost:3001',
    getToken: () => null,
  };

  it('exposes the gateway API', () => {
    const client = createApiClient(config);
    expect(client.gateway).toBeDefined();
    expect(typeof client.gateway.getStatus).toBe('function');
    expect(typeof client.gateway.getModels).toBe('function');
  });

  it('exposes the costs API', () => {
    const client = createApiClient(config);
    expect(client.costs).toBeDefined();
    expect(typeof client.costs.estimate).toBe('function');
    expect(typeof client.costs.getNodePoolCosts).toBe('function');
    expect(typeof client.costs.getGpuModels).toBe('function');
    expect(typeof client.costs.normalizeGpu).toBe('function');
  });
});
