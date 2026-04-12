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

export interface CostsApi {
  /** Estimate deployment cost based on GPU configuration */
  estimate: (input: CostEstimateRequest) => Promise<CostEstimateResponse>;
}

export function createCostsApi(request: RequestFn): CostsApi {
  return {
    estimate: (input) =>
      request<CostEstimateResponse>('/costs/estimate', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  };
}
