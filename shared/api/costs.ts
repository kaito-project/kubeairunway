/**
 * Costs API
 *
 * Deployment cost estimation across cloud providers and node pools.
 * Response shapes for `getNodePoolCosts`, `getGpuModels`, and `normalizeGpu`
 * are inlined because they are endpoint-specific wrappers that don't need
 * their own type module — matching the pattern in health.ts.
 */

import type { RequestFn } from './client';
import type {
  CostEstimateRequest,
  CostEstimateResponse,
  NodePoolCostEstimate,
} from '../types';

export interface NodePoolCostsResponse {
  success: boolean;
  nodePoolCosts: NodePoolCostEstimate[];
  pricingSource: 'realtime-with-fallback' | 'static';
  cacheStats: {
    size: number;
    ttlMs: number;
    maxEntries: number;
  };
}

export interface GpuModelsResponse {
  success: boolean;
  models: Array<{
    model: string;
    memoryGb: number;
    generation: string;
  }>;
  note: string;
}

export interface NormalizeGpuResponse {
  success: boolean;
  originalLabel: string;
  normalizedModel: string;
  pricing: {
    memoryGb: number;
    generation: string;
    hourlyRate: { aws?: number; azure?: number; gcp?: number };
  } | null;
}

export interface CostsApi {
  /** Estimate deployment cost based on GPU configuration */
  estimate: (input: CostEstimateRequest) => Promise<CostEstimateResponse>;
  /** Get cost estimates for all node pools in the cluster */
  getNodePoolCosts: (
    gpuCount?: number,
    replicas?: number,
    computeType?: 'gpu' | 'cpu',
  ) => Promise<NodePoolCostsResponse>;
  /** Get list of supported GPU models with specifications */
  getGpuModels: () => Promise<GpuModelsResponse>;
  /** Normalize a GPU model name to our pricing key */
  normalizeGpu: (label: string) => Promise<NormalizeGpuResponse>;
}

export function createCostsApi(request: RequestFn): CostsApi {
  return {
    estimate: (input) =>
      request<CostEstimateResponse>('/costs/estimate', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    getNodePoolCosts: (gpuCount = 1, replicas = 1, computeType = 'gpu') =>
      request<NodePoolCostsResponse>(
        `/costs/node-pools?gpuCount=${gpuCount}&replicas=${replicas}&computeType=${computeType}`,
      ),
    getGpuModels: () => request<GpuModelsResponse>('/costs/gpu-models'),
    normalizeGpu: (label) =>
      request<NormalizeGpuResponse>(
        `/costs/normalize-gpu?label=${encodeURIComponent(label)}`,
      ),
  };
}
