/**
 * GPU Operator API
 */

import type { RequestFn } from './client';
import type {
  GPUOperatorStatus,
  GPUOperatorInstallResult,
  ClusterGpuCapacity,
  DetailedClusterCapacity,
} from '../types';

export interface GpuOperatorApi {
  /** Get GPU operator status */
  getStatus: () => Promise<GPUOperatorStatus>;

  /** Install GPU operator */
  install: () => Promise<GPUOperatorInstallResult>;

  /** Get cluster GPU capacity */
  getCapacity: () => Promise<ClusterGpuCapacity>;

  /** Get detailed cluster GPU capacity */
  getDetailedCapacity: () => Promise<DetailedClusterCapacity>;
}

export function createGpuOperatorApi(request: RequestFn): GpuOperatorApi {
  return {
    getStatus: () => request<GPUOperatorStatus>('/installation/gpu-operator/status'),

    install: () =>
      request<GPUOperatorInstallResult>('/installation/gpu-operator/install', {
        method: 'POST',
      }),

    getCapacity: () => request<ClusterGpuCapacity>('/installation/gpu-capacity'),

    getDetailedCapacity: () =>
      request<DetailedClusterCapacity>('/installation/gpu-capacity/detailed'),
  };
}
