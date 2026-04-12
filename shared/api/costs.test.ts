import { describe, it, expect } from 'vitest';
import { createCostsApi } from './costs';
import { mockRequest } from './test-helpers';
import type { CostEstimateRequest, CostEstimateResponse } from '../types';

describe('createCostsApi', () => {
  describe('estimate', () => {
    it('POSTs to /costs/estimate with the request body and returns the resolved value', async () => {
      const mockResponse: CostEstimateResponse = {
        success: true,
        breakdown: {
          estimate: {
            hourly: 1.0,
            monthly: 730,
            currency: 'USD',
            source: 'static',
            confidence: 'medium',
          },
          perGpu: { hourly: 1.0, monthly: 730 },
          totalGpus: 1,
          gpuModel: 'A100',
          normalizedGpuModel: 'A100',
          notes: [],
        },
      };
      const request = mockRequest(mockResponse);

      const input: CostEstimateRequest = {
        gpuType: 'A100',
        gpuCount: 1,
        replicas: 1,
      };

      const api = createCostsApi(request);
      const result = await api.estimate(input);

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('/costs/estimate', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      expect(result).toEqual(mockResponse);
    });
  });
});
