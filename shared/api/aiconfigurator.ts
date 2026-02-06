/**
 * AI Configurator API
 */

import type { RequestFn } from './client';
import type {
  AIConfiguratorInput,
  AIConfiguratorResult,
  AIConfiguratorStatus,
} from '../types';

export interface NormalizeGpuResponse {
  gpuProduct: string;
  normalized: string;
}

export interface AIConfiguratorApi {
  /** Check if AI Configurator is available */
  getStatus: () => Promise<AIConfiguratorStatus>;

  /** Analyze model + GPU and get optimal configuration */
  analyze: (input: AIConfiguratorInput) => Promise<AIConfiguratorResult>;

  /** Normalize GPU product string to AI Configurator format */
  normalizeGpu: (gpuProduct: string) => Promise<NormalizeGpuResponse>;
}

export function createAIConfiguratorApi(request: RequestFn): AIConfiguratorApi {
  return {
    getStatus: () => request<AIConfiguratorStatus>('/aiconfigurator/status'),

    analyze: (input: AIConfiguratorInput) =>
      request<AIConfiguratorResult>('/aiconfigurator/analyze', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    normalizeGpu: (gpuProduct: string) =>
      request<NormalizeGpuResponse>('/aiconfigurator/normalize-gpu', {
        method: 'POST',
        body: JSON.stringify({ gpuProduct }),
      }),
  };
}
