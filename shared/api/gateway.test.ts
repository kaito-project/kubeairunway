import { describe, it, expect, vi } from 'vitest';
import { createGatewayApi } from './gateway';
import type { RequestFn } from './client';

describe('createGatewayApi', () => {
  describe('getStatus', () => {
    it('calls request with /gateway/status and returns the resolved value', async () => {
      const mockResponse = {
        available: true,
        endpoint: 'http://gateway.example.com',
      };
      const request = vi.fn().mockResolvedValue(mockResponse) as unknown as RequestFn;

      const api = createGatewayApi(request);
      const result = await api.getStatus();

      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith('/gateway/status');
      expect(result).toEqual(mockResponse);
    });
  });
});
