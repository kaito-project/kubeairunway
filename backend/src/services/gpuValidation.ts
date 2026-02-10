import type { DeploymentConfig } from '@kubeairunway/shared';
import type { ClusterGpuCapacity } from './kubernetes';

/**
 * GPU memory estimation constants
 * Based on FP16 inference: ~2 bytes per parameter + overhead
 */
const BYTES_PER_PARAM_FP16 = 2;
const OVERHEAD_MULTIPLIER = 1.2; // 20% overhead for KV cache, activations, etc.
const BYTES_PER_GB = 1024 * 1024 * 1024;

/**
 * Estimate GPU memory required for a model based on parameter count
 * Returns estimated memory in GB
 * 
 * @param parameterCount - Number of parameters in the model
 * @returns Estimated GPU memory in GB
 */
export function estimateGpuMemory(parameterCount: number): number {
  const bytesRequired = parameterCount * BYTES_PER_PARAM_FP16 * OVERHEAD_MULTIPLIER;
  const gbRequired = bytesRequired / BYTES_PER_GB;
  // Round up to nearest GB
  return Math.ceil(gbRequired);
}

/**
 * Format GPU memory as a human-readable string
 * 
 * @param gpuMemoryGb - GPU memory in GB
 * @returns Formatted string (e.g., "16GB")
 */
export function formatGpuMemory(gpuMemoryGb: number): string {
  return `${gpuMemoryGb}GB`;
}

/**
 * Parse GPU memory string to GB number
 * 
 * @param gpuMemoryStr - GPU memory string (e.g., "16GB", "8192MB")
 * @returns GPU memory in GB, or undefined if invalid
 */
export function parseGpuMemory(gpuMemoryStr: string): number | undefined {
  const match = gpuMemoryStr.match(/^(\d+(?:\.\d+)?)\s*(GB|MB|TB)?$/i);
  if (!match) return undefined;
  
  const value = parseFloat(match[1]);
  const unit = (match[2] || 'GB').toUpperCase();
  
  switch (unit) {
    case 'TB':
      return value * 1024;
    case 'GB':
      return value;
    case 'MB':
      return value / 1024;
    default:
      return value;
  }
}

/**
 * Types of GPU fit warnings
 */
export type GpuWarningType =
  | 'total_insufficient'      // Not enough total GPUs in cluster
  | 'contiguous_insufficient' // No single node has enough GPUs for a worker
  | 'model_minimum';          // Configured GPUs per worker is below model minimum

/**
 * Individual GPU fit warning
 */
export interface GpuWarning {
  type: GpuWarningType;
  message: string;
  required: number;
  available: number;
}

/**
 * Result of GPU fit validation
 */
export interface GpuFitResult {
  fits: boolean;
  warnings: GpuWarning[];
}

/**
 * Calculate total GPUs required for a deployment configuration
 */
export function calculateRequiredGpus(config: DeploymentConfig): {
  total: number;
  maxPerWorker: number;
  prefillPerWorker: number;
  decodePerWorker: number;
} {
  const gpusPerReplica = config.resources?.gpu ?? 1;

  if (config.mode === 'disaggregated') {
    const prefillReplicas = config.prefillReplicas ?? 1;
    const decodeReplicas = config.decodeReplicas ?? 1;
    const prefillGpus = config.prefillGpus ?? gpusPerReplica;
    const decodeGpus = config.decodeGpus ?? gpusPerReplica;

    const total = (prefillReplicas * prefillGpus) + (decodeReplicas * decodeGpus);
    const maxPerWorker = Math.max(prefillGpus, decodeGpus);

    return {
      total,
      maxPerWorker,
      prefillPerWorker: prefillGpus,
      decodePerWorker: decodeGpus,
    };
  }

  // Aggregated mode
  const total = config.replicas * gpusPerReplica;
  return {
    total,
    maxPerWorker: gpusPerReplica,
    prefillPerWorker: gpusPerReplica,
    decodePerWorker: gpusPerReplica,
  };
}

/**
 * Validate whether a deployment configuration fits the cluster's GPU capacity
 *
 * @param config - The deployment configuration
 * @param capacity - The cluster's current GPU capacity
 * @param modelMinGpus - Minimum GPUs required by the model (optional, defaults to 1)
 * @returns GpuFitResult with fit status and any warnings
 */
export function validateGpuFit(
  config: DeploymentConfig,
  capacity: ClusterGpuCapacity,
  modelMinGpus: number = 1
): GpuFitResult {
  const warnings: GpuWarning[] = [];
  const required = calculateRequiredGpus(config);

  // Check 1: Total cluster capacity
  if (required.total > capacity.availableGpus) {
    warnings.push({
      type: 'total_insufficient',
      message: `Deployment requires ${required.total} GPU(s) but only ${capacity.availableGpus} are available in the cluster`,
      required: required.total,
      available: capacity.availableGpus,
    });
  }

  // Check 2: Contiguous GPUs per worker (scheduling check)
  // A worker must be scheduled on a single node, so we need at least one node
  // with enough free GPUs
  if (required.maxPerWorker > capacity.maxContiguousAvailable) {
    warnings.push({
      type: 'contiguous_insufficient',
      message: `Each worker requires ${required.maxPerWorker} GPU(s) but the largest available block on any node is ${capacity.maxContiguousAvailable} GPU(s)`,
      required: required.maxPerWorker,
      available: capacity.maxContiguousAvailable,
    });
  }

  // Check 3: Model minimum requirements
  // Ensure configured GPUs per worker meets model's minimum
  const configuredGpusPerWorker = config.mode === 'disaggregated'
    ? Math.min(required.prefillPerWorker, required.decodePerWorker)
    : required.maxPerWorker;

  if (configuredGpusPerWorker < modelMinGpus) {
    warnings.push({
      type: 'model_minimum',
      message: `Model requires at least ${modelMinGpus} GPU(s) per worker but configuration specifies ${configuredGpusPerWorker}`,
      required: modelMinGpus,
      available: configuredGpusPerWorker,
    });
  }

  return {
    fits: warnings.length === 0,
    warnings,
  };
}

/**
 * Format GPU warnings as user-friendly messages
 */
export function formatGpuWarnings(result: GpuFitResult): string[] {
  return result.warnings.map((warning) => {
    switch (warning.type) {
      case 'total_insufficient':
        return `⚠️ Insufficient cluster GPUs: ${warning.message}`;
      case 'contiguous_insufficient':
        return `⚠️ Scheduling constraint: ${warning.message}`;
      case 'model_minimum':
        return `⚠️ Model requirement: ${warning.message}`;
      default:
        return `⚠️ ${warning.message}`;
    }
  });
}
