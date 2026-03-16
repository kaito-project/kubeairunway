import type { Model, DetailedClusterCapacity } from './api';

export interface MultiNodeRecommendation {
  nodeCount: number;
  gpusPerNode: number;
  totalGpus: number;
  pipelineParallelSize: number;
}

export interface GpuRecommendation {
  recommendedGpus: number;
  reason: string;
  alternatives?: number[];
  multiNode?: MultiNodeRecommendation;
  /** Estimated GPU memory needed in GB (for recalculation on GPU change) */
  estimatedMemoryGb?: number;
}

/**
 * Calculate recommended GPUs per replica based on model characteristics and cluster capacity
 */
export function calculateGpuRecommendation(
  model: Model | undefined,
  clusterCapacity: DetailedClusterCapacity | undefined
): GpuRecommendation {
  // Default fallback
  const fallback: GpuRecommendation = {
    recommendedGpus: 1,
    reason: 'Starting with 1 GPU per replica',
  };

  if (!model || !clusterCapacity) {
    return fallback;
  }

  const maxNodeGpus = clusterCapacity.maxNodeGpuCapacity;
  const gpuMemoryGb = clusterCapacity.totalMemoryGb; // Memory per GPU

  // Get parameter count from various possible fields
  let parameterCount = model.parameterCount || model.parameters;

  // If not found, try parsing from size field (e.g., "3B", "7B", "70B")
  if (!parameterCount && model.size) {
    const sizeMatch = model.size.match(/(\d+\.?\d*)\s*B/i);
    if (sizeMatch) {
      parameterCount = parseFloat(sizeMatch[1]) * 1_000_000_000;
    }
  }

  // If we don't have parameter count, check if model provides estimatedGpuMemoryGb
  if (!parameterCount) {
    if (model.estimatedGpuMemoryGb && gpuMemoryGb) {
      const gpusNeeded = Math.ceil(model.estimatedGpuMemoryGb / gpuMemoryGb);
      if (gpusNeeded > maxNodeGpus) {
        const multiNode = buildMultiNode(gpusNeeded, maxNodeGpus);
        return {
          recommendedGpus: multiNode.gpusPerNode,
          reason: `Model needs ~${model.estimatedGpuMemoryGb}GB memory - distributed across ${multiNode.nodeCount} nodes`,
          multiNode,
          estimatedMemoryGb: model.estimatedGpuMemoryGb,
        };
      }
      return {
        recommendedGpus: gpusNeeded,
        reason: `Model needs ~${model.estimatedGpuMemoryGb}GB memory`,
        estimatedMemoryGb: model.estimatedGpuMemoryGb,
      };
    }
    return {
      recommendedGpus: Math.min(1, maxNodeGpus),
      reason: 'Model size unknown - using 1 GPU',
    };
  }

  // Estimate memory needed (rough heuristic: 2 bytes per parameter for FP16)
  // Add 20% overhead for KV cache and activations
  const paramsInBillions = parameterCount / 1_000_000_000;
  let estimatedMemoryGb = (paramsInBillions * 2 * 1.2);

  // Prefer model's own memory estimate if provided (more accurate)
  if (model.estimatedGpuMemoryGb) {
    estimatedMemoryGb = model.estimatedGpuMemoryGb;
  } else if (model.minGpuMemory) {
    // Parse minGpuMemory (e.g., "16GB" -> 16)
    const memMatch = model.minGpuMemory.match(/(\d+)\s*GB/i);
    if (memMatch) {
      estimatedMemoryGb = parseInt(memMatch[1]);
    }
  }

  // If we know GPU memory, use memory-based calculation
  if (gpuMemoryGb && gpuMemoryGb > 0) {
    const gpusNeeded = Math.ceil(estimatedMemoryGb / gpuMemoryGb);

    let multiNode: MultiNodeRecommendation | undefined;
    let cappedRecommendation: number;

    if (gpusNeeded > maxNodeGpus) {
      multiNode = buildMultiNode(gpusNeeded, maxNodeGpus);
      cappedRecommendation = multiNode.gpusPerNode;
    } else {
      cappedRecommendation = gpusNeeded;
    }

    const alternatives = generateAlternatives(cappedRecommendation, maxNodeGpus);

    let reason = `~${estimatedMemoryGb.toFixed(0)}GB needed (${paramsInBillions.toFixed(1)}B params)`;
    if (multiNode) {
      reason += ` - distributed across ${multiNode.nodeCount} nodes`;
    }

    return {
      recommendedGpus: cappedRecommendation,
      reason,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      multiNode,
      estimatedMemoryGb,
    };
  }

  // Fallback: use parameter-based heuristic if GPU memory is unknown
  let baseRecommendation = 1;
  let sizeCategory = 'small';

  if (paramsInBillions < 3) {
    baseRecommendation = 1;
    sizeCategory = 'small';
  } else if (paramsInBillions < 13) {
    baseRecommendation = 2;
    sizeCategory = 'medium';
  } else if (paramsInBillions < 70) {
    baseRecommendation = 4;
    sizeCategory = 'large';
  } else {
    baseRecommendation = 8;
    sizeCategory = 'very large';
  }

  let multiNode: MultiNodeRecommendation | undefined;
  let cappedRecommendation: number;

  if (baseRecommendation > maxNodeGpus) {
    multiNode = buildMultiNode(baseRecommendation, maxNodeGpus);
    cappedRecommendation = multiNode.gpusPerNode;
  } else {
    cappedRecommendation = baseRecommendation;
  }

  // Generate alternatives based on node pool optimization
  const alternatives = generateAlternatives(cappedRecommendation, maxNodeGpus);

  // Build reason message
  let reason = `${sizeCategory} model (${paramsInBillions.toFixed(1)}B params)`;

  if (multiNode) {
    reason += ` - distributed across ${multiNode.nodeCount} nodes`;
  }

  return {
    recommendedGpus: cappedRecommendation,
    reason,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
    multiNode,
    estimatedMemoryGb,
  };
}

/**
 * Build a MultiNodeRecommendation from total GPUs needed and max per node
 */
function buildMultiNode(gpusNeeded: number, maxNodeGpus: number): MultiNodeRecommendation {
  const nodeCount = Math.ceil(gpusNeeded / maxNodeGpus);
  return {
    nodeCount,
    gpusPerNode: maxNodeGpus,
    totalGpus: nodeCount * maxNodeGpus,
    pipelineParallelSize: nodeCount,
  };
}

/**
 * Calculate multi-node recommendation based on memory requirements and GPU configuration.
 * Reusable by DeploymentForm for recalculation when user changes GPU count.
 *
 * @param estimatedMemoryGb - Total GPU memory needed for the model
 * @param gpuMemoryGb - Memory per GPU in GB
 * @param gpuCount - Number of GPUs per node (user-selected)
 * @returns MultiNodeRecommendation if model doesn't fit on one node, null otherwise
 */
export function calculateMultiNode(
  estimatedMemoryGb: number,
  gpuMemoryGb: number,
  gpuCount: number
): MultiNodeRecommendation | null {
  const pipelineParallelSize = calculatePipelineParallel(estimatedMemoryGb, gpuMemoryGb, gpuCount);
  if (pipelineParallelSize <= 1) return null;

  return {
    nodeCount: pipelineParallelSize,
    gpusPerNode: gpuCount,
    totalGpus: pipelineParallelSize * gpuCount,
    pipelineParallelSize,
  };
}

/**
 * Calculate the pipeline parallel degree needed to fit a model across nodes.
 * Returns 1 when the model fits on a single node or inputs are invalid.
 */
export function calculatePipelineParallel(
  estimatedMemoryGb: number,
  gpuMemoryGb: number,
  gpuCount: number
): number {
  if (estimatedMemoryGb <= 0 || gpuMemoryGb <= 0 || gpuCount <= 0) return 1;

  const totalMemoryPerNode = gpuCount * gpuMemoryGb;
  if (estimatedMemoryGb <= totalMemoryPerNode) return 1;

  return Math.ceil(estimatedMemoryGb / totalMemoryPerNode);
}

/**
 * Generate alternative GPU counts that work well with node pool configurations
 */
function generateAlternatives(recommended: number, maxNodeGpus: number): number[] {
  // Common GPU node sizes: 1, 2, 4, 8
  const commonSizes = [1, 2, 4, 8];

  // Find divisors of maxNodeGpus that are <= maxNodeGpus
  const divisors = commonSizes.filter(
    (size) => size <= maxNodeGpus && maxNodeGpus % size === 0 && size !== recommended
  );

  // Return up to 2 alternatives closest to the recommendation
  return divisors
    .sort((a, b) => Math.abs(a - recommended) - Math.abs(b - recommended))
    .slice(0, 2);
}

/**
 * Format GPU count for display
 */
export function formatGpuCount(gpus: number): string {
  return `${gpus} GPU${gpus !== 1 ? 's' : ''}`;
}
