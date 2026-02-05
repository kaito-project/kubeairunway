/**
 * Autoscaler API
 */

import type { RequestFn } from './client';
import type {
  AutoscalerDetectionResult,
  AutoscalerStatusInfo,
  PodFailureReason,
} from '../types';

export interface AutoscalerApi {
  /** Detect autoscaler type and health status */
  detect: () => Promise<AutoscalerDetectionResult>;

  /** Get detailed autoscaler status from ConfigMap */
  getStatus: () => Promise<AutoscalerStatusInfo>;

  /** Get reasons why a deployment's pods are pending */
  getPendingReasons: (
    deploymentName: string,
    namespace?: string
  ) => Promise<{ reasons: PodFailureReason[] }>;
}

export function createAutoscalerApi(request: RequestFn): AutoscalerApi {
  return {
    detect: () => request<AutoscalerDetectionResult>('/autoscaler/detection'),

    getStatus: () => request<AutoscalerStatusInfo>('/autoscaler/status'),

    getPendingReasons: (deploymentName: string, namespace?: string) =>
      request<{ reasons: PodFailureReason[] }>(
        `/deployments/${encodeURIComponent(deploymentName)}/pending-reasons${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`
      ),
  };
}
