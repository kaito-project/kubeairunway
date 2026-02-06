/**
 * Health API
 */

import type { RequestFn } from './client';
import type { ClusterStatusResponse } from '../types';

export interface HealthCheckResponse {
  status: string;
  timestamp: string;
}

export interface ClusterNode {
  name: string;
  ready: boolean;
  gpuCount: number;
}

export interface HealthApi {
  /** Check API health */
  check: () => Promise<HealthCheckResponse>;

  /** Get cluster status */
  clusterStatus: () => Promise<ClusterStatusResponse>;

  /** Get cluster nodes */
  getClusterNodes: () => Promise<{ nodes: ClusterNode[] }>;
}

export function createHealthApi(request: RequestFn): HealthApi {
  return {
    check: () => request<HealthCheckResponse>('/health'),

    clusterStatus: () => request<ClusterStatusResponse>('/cluster/status'),

    getClusterNodes: () => request<{ nodes: ClusterNode[] }>('/cluster/nodes'),
  };
}
