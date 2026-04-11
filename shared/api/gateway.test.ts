import { describe, it, expect } from 'vitest';
import { createGatewayApi } from './gateway';
import { mockRequest } from './test-helpers';
import type { GatewayInfo, GatewayModelInfo } from '../types';

describe('createGatewayApi', () => {
  describe('getStatus', () => {
    it('calls request with /gateway/status and returns the resolved value', async () => {
      const mockResponse: GatewayInfo = {
        available: true,
        endpoint: 'http://gateway.example.com',
      };
      const request = mockRequest(mockResponse);

      const api = createGatewayApi(request);
      const result = await api.getStatus();

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('/gateway/status');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getModels', () => {
    it('calls request with /gateway/models and returns the resolved value', async () => {
      const mockResponse: { models: GatewayModelInfo[] } = {
        models: [
          { name: 'llama-3', deploymentName: 'llama-d', ready: true },
        ],
      };
      const request = mockRequest(mockResponse);

      const api = createGatewayApi(request);
      const result = await api.getModels();

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('/gateway/models');
      expect(result).toEqual(mockResponse);
    });
  });
});
