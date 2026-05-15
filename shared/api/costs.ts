/**
 * Costs API
 *
 * Deployment cost estimation across cloud providers and node pools.
 * Response shapes are inlined because they are endpoint-specific and
 * don't need their own type module.
 */

import type { RequestFn } from './client';
import type {
  CostEstimateRequest,
  CostEstimateResponse,
  NodePoolCostEstimate,
  GpuModelSummary,
} from '../types';

export interface NodePoolCostsResponse {
  nodePoolCosts: NodePoolCostEstimate[];
  pricingSource: 'realtime-with-fallback' | 'static';
}

export interface GpuModelsResponse {
  models: GpuModelSummary[];
  note?: string;
}

export interface CostsNormalizeGpuResponse {
  originalLabel: string;
  normalizedModel: string;
  gpuInfo: {
    memoryGb: number;
    generation: string;
  } | null;
}

export interface CostsApi {
  /** Estimate deployment cost based on GPU configuration */
  estimate: (input: CostEstimateRequest) => Promise<CostEstimateResponse>;
  getNodePoolCosts: (
    gpuCount?: number,
    replicas?: number,
    computeType?: 'gpu' | 'cpu',
  ) => Promise<NodePoolCostsResponse>;
  getGpuModels: () => Promise<GpuModelsResponse>;
  /** Normalize a GPU model name to our pricing key */
  normalizeGpu: (label: string) => Promise<CostsNormalizeGpuResponse>;
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
      request<CostsNormalizeGpuResponse>(
        `/costs/normalize-gpu?label=${encodeURIComponent(label)}`,
      ),
  };
}
