/**
 * Metrics API
 *
 * Note: Metrics are primarily accessed via deploymentsApi.getMetrics(),
 * but this module provides a standalone API for direct metrics access.
 */

import type { RequestFn } from './client';
import type { MetricsResponse } from '../types';

export interface MetricsApi {
  /** Get metrics for a specific deployment */
  get: (deploymentName: string, namespace?: string) => Promise<MetricsResponse>;
}

export function createMetricsApi(request: RequestFn): MetricsApi {
  return {
    get: (deploymentName: string, namespace?: string) =>
      request<MetricsResponse>(
        `/deployments/${encodeURIComponent(deploymentName)}/metrics${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`
      ),
  };
}
