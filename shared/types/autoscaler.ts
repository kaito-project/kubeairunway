/**
 * Autoscaler detection and status types
 */

export type AutoscalerType = 'none' | 'aks-managed' | 'cluster-autoscaler' | 'unknown';

export interface AutoscalerDetectionResult {
  type: AutoscalerType;
  detected: boolean;
  healthy: boolean;
  message: string;
  nodeGroupCount?: number;
  lastActivity?: string;
}

export interface AutoscalerStatusInfo {
  health: string;
  lastUpdateTime?: string;
  nodeGroups?: Array<{
    name: string;
    minSize: number;
    maxSize: number;
    currentSize: number;
  }>;
}

/**
 * Enhanced cluster capacity with node pool information
 */
export interface NodePoolInfo {
  name: string;
  gpuCount: number;
  nodeCount: number;
  availableGpus: number;
  gpuModel?: string;
  /** Cloud provider instance type (e.g., Standard_NV36ads_A10_v5) */
  instanceType?: string;
  /** Cloud provider region */
  region?: string;
}

export interface DetailedClusterCapacity {
  totalGpus: number;
  allocatedGpus: number;
  availableGpus: number;
  maxContiguousAvailable: number;
  maxNodeGpuCapacity: number;
  gpuNodeCount: number;
  totalMemoryGb?: number;
  nodePools: NodePoolInfo[];
}

/**
 * Pod failure reason information
 */
export interface PodFailureReason {
  reason: string;
  message: string;
  isResourceConstraint: boolean;
  resourceType?: 'gpu' | 'cpu' | 'memory';
  canAutoscalerHelp: boolean;
}
