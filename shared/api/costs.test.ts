import { describe, it, expect } from 'vitest';
import {
  createCostsApi,
  type NodePoolCostsResponse,
  type GpuModelsResponse,
  type CostsNormalizeGpuResponse,
} from './costs';
import { mockRequest, mockRequestError } from './test-helpers';
import { ApiError } from './client';
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

  describe('getNodePoolCosts', () => {
    it('builds the query string with provided gpuCount/replicas/computeType', async () => {
      const mockResponse: NodePoolCostsResponse = {
        nodePoolCosts: [],
        pricingSource: 'static',
      };
      const request = mockRequest(mockResponse);

      const api = createCostsApi(request);
      const result = await api.getNodePoolCosts(2, 3, 'gpu');

      expect(request).toHaveBeenCalledWith('/costs/node-pools?gpuCount=2&replicas=3&computeType=gpu');
      expect(result).toEqual(mockResponse);
    });

    it('uses default values (gpuCount=1, replicas=1, computeType=gpu) when called with no args', async () => {
      const mockResponse: NodePoolCostsResponse = {
        nodePoolCosts: [],
        pricingSource: 'realtime-with-fallback',
      };
      const request = mockRequest(mockResponse);

      const api = createCostsApi(request);
      await api.getNodePoolCosts();

      expect(request).toHaveBeenCalledWith('/costs/node-pools?gpuCount=1&replicas=1&computeType=gpu');
    });
  });

  describe('getGpuModels', () => {
    it('calls request with /costs/gpu-models and returns the resolved value', async () => {
      const mockResponse: GpuModelsResponse = {
        models: [
          { model: 'A100', memoryGb: 80, generation: 'ampere' },
          { model: 'H100', memoryGb: 80, generation: 'hopper' },
        ],
        note: 'Static pricing fallback',
      };
      const request = mockRequest(mockResponse);

      const api = createCostsApi(request);
      const result = await api.getGpuModels();

      expect(request).toHaveBeenCalledWith('/costs/gpu-models');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('normalizeGpu', () => {
    it('URL-encodes the label and calls /costs/normalize-gpu', async () => {
      const mockResponse: CostsNormalizeGpuResponse = {
        originalLabel: 'NVIDIA A100 80GB',
        normalizedModel: 'A100-80GB',
        gpuInfo: null,
      };
      const request = mockRequest(mockResponse);

      const api = createCostsApi(request);
      const result = await api.normalizeGpu('NVIDIA A100 80GB');

      // Spaces must be percent-encoded
      expect(request).toHaveBeenCalledWith('/costs/normalize-gpu?label=NVIDIA%20A100%2080GB');
      expect(result).toEqual(mockResponse);
    });

    it('returns a gpuInfo object when the backend has a match', async () => {
      const mockResponse: CostsNormalizeGpuResponse = {
        originalLabel: 'a100',
        normalizedModel: 'A100',
        gpuInfo: {
          memoryGb: 80,
          generation: 'ampere',
        },
      };
      const request = mockRequest(mockResponse);

      const api = createCostsApi(request);
      const result = await api.normalizeGpu('a100');

      expect(request).toHaveBeenCalledWith('/costs/normalize-gpu?label=a100');
      expect(result.gpuInfo?.memoryGb).toBe(80);
    });

    it('URL-encodes slashes in GPU labels', async () => {
      const mockResponse: CostsNormalizeGpuResponse = {
        originalLabel: 'NVIDIA A100/80GB',
        normalizedModel: 'A100-80GB',
        gpuInfo: null,
      };
      const request = mockRequest(mockResponse);

      const api = createCostsApi(request);
      await api.normalizeGpu('NVIDIA A100/80GB');

      expect(request).toHaveBeenCalledWith('/costs/normalize-gpu?label=NVIDIA%20A100%2F80GB');
    });
  });

  describe('error propagation', () => {
    it('rejects with ApiError when estimate request fails', async () => {
      const request = mockRequestError(400, 'Bad Request');
      const api = createCostsApi(request);
      await expect(api.estimate({ gpuType: 'A100', gpuCount: 1, replicas: 1 })).rejects.toThrow(ApiError);
    });

    it('rejects with ApiError when getNodePoolCosts request fails', async () => {
      const request = mockRequestError(503, 'Service Unavailable');
      const api = createCostsApi(request);
      await expect(api.getNodePoolCosts()).rejects.toThrow(ApiError);
    });

    it('rejects with ApiError when getGpuModels request fails', async () => {
      const request = mockRequestError(500, 'Internal Server Error');
      const api = createCostsApi(request);
      await expect(api.getGpuModels()).rejects.toThrow(ApiError);
    });

    it('rejects with ApiError when normalizeGpu request fails', async () => {
      const request = mockRequestError(404, 'Not Found');
      const api = createCostsApi(request);
      await expect(api.normalizeGpu('unknown-gpu')).rejects.toThrow(ApiError);
    });
  });
});
