import type {
  CostBreakdown,
  CostEstimate,
  CostEstimateRequest,
  NodePoolCostEstimate,
} from '@kubefoundry/shared';
import type { NodePoolInfo } from '@kubefoundry/shared';
import { logger } from '../lib/logger';

/** Hours per month assuming 24/7 operation */
const DEFAULT_HOURS_PER_MONTH = 730;

/**
 * GPU model info for normalization (moved from static JSON)
 * This is now only used for GPU name normalization, not pricing.
 * Actual pricing comes from cloudPricing.ts via cloud provider APIs.
 */
interface GpuModelInfo {
  aliases: string[];
  memoryGb: number;
  generation: string;
}

const GPU_MODELS: Record<string, GpuModelInfo> = {
  'H100-80GB': {
    aliases: ['NVIDIA-H100-80GB-HBM3', 'H100', 'NVIDIA H100'],
    memoryGb: 80,
    generation: 'Hopper',
  },
  'A100-80GB': {
    aliases: ['NVIDIA-A100-SXM4-80GB', 'NVIDIA-A100-80GB-PCIe', 'A100-80GB', 'A100 80GB'],
    memoryGb: 80,
    generation: 'Ampere',
  },
  'A100-40GB': {
    aliases: ['NVIDIA-A100-SXM4-40GB', 'NVIDIA-A100-40GB-PCIe', 'A100-40GB', 'A100 40GB', 'A100'],
    memoryGb: 40,
    generation: 'Ampere',
  },
  L40S: {
    aliases: ['NVIDIA-L40S', 'L40S'],
    memoryGb: 48,
    generation: 'Ada Lovelace',
  },
  L4: {
    aliases: ['NVIDIA-L4', 'L4'],
    memoryGb: 24,
    generation: 'Ada Lovelace',
  },
  A10G: {
    aliases: ['NVIDIA-A10G', 'A10G', 'NVIDIA A10G'],
    memoryGb: 24,
    generation: 'Ampere',
  },
  A10: {
    aliases: ['NVIDIA-A10', 'A10', 'NVIDIA A10'],
    memoryGb: 24,
    generation: 'Ampere',
  },
  T4: {
    aliases: ['NVIDIA-Tesla-T4', 'Tesla-T4', 'T4', 'NVIDIA T4'],
    memoryGb: 16,
    generation: 'Turing',
  },
  V100: {
    aliases: ['NVIDIA-Tesla-V100', 'Tesla-V100', 'V100', 'V100-SXM2-16GB', 'V100-PCIE-16GB'],
    memoryGb: 16,
    generation: 'Volta',
  },
};

const DEFAULT_GPU = 'A10';

/**
 * Normalize GPU model name from Kubernetes node label to our GPU key
 *
 * @param gpuLabel - The raw GPU label from nvidia.com/gpu.product
 * @returns Normalized GPU model name
 */
export function normalizeGpuModel(gpuLabel: string): string {
  if (!gpuLabel) {
    return DEFAULT_GPU;
  }

  const normalizedLabel = gpuLabel.trim();

  // Check each GPU model for matching aliases
  for (const [modelKey, modelData] of Object.entries(GPU_MODELS)) {
    // Check exact match with model key
    if (normalizedLabel.toLowerCase() === modelKey.toLowerCase()) {
      return modelKey;
    }

    // Check aliases
    for (const alias of modelData.aliases) {
      if (normalizedLabel.toLowerCase() === alias.toLowerCase()) {
        return modelKey;
      }
      // Also check if the label contains the alias (for partial matches)
      if (normalizedLabel.toLowerCase().includes(alias.toLowerCase())) {
        return modelKey;
      }
    }
  }

  // Try to extract GPU model from common patterns
  // Pattern: NVIDIA-A100-SXM4-80GB -> A100-80GB
  const memoryMatch = normalizedLabel.match(/(\d+)\s*GB/i);
  const memoryGb = memoryMatch ? parseInt(memoryMatch[1], 10) : null;

  // Check for known GPU families
  const gpuFamilies = ['H100', 'A100', 'L40S', 'L40', 'L4', 'A10G', 'A10', 'T4', 'V100', 'MI300'];
  for (const family of gpuFamilies) {
    if (normalizedLabel.toUpperCase().includes(family)) {
      // If we have memory info, try to find exact match
      if (memoryGb) {
        const modelWithMemory = `${family}-${memoryGb}GB`;
        if (GPU_MODELS[modelWithMemory]) {
          return modelWithMemory;
        }
      }
      // Return first matching model for this family
      for (const modelKey of Object.keys(GPU_MODELS)) {
        if (modelKey.startsWith(family)) {
          return modelKey;
        }
      }
    }
  }

  logger.warn({ gpuLabel }, 'Could not normalize GPU model, using default');
  return DEFAULT_GPU;
}

/**
 * Get GPU model info (memory, generation) for a GPU model
 * Note: For actual pricing, use cloudPricing.ts
 */
export function getGpuInfo(gpuModel: string): GpuModelInfo | undefined {
  const normalizedModel = normalizeGpuModel(gpuModel);
  return GPU_MODELS[normalizedModel];
}

/**
 * @deprecated Use cloudPricing.ts for real-time pricing
 * This function is kept for backward compatibility but returns low-confidence estimates
 */
export function estimateCost(request: CostEstimateRequest): CostBreakdown {
  const normalizedGpuModel = normalizeGpuModel(request.gpuType);
  const gpuInfo = GPU_MODELS[normalizedGpuModel];

  const totalGpus = request.gpuCount * request.replicas;

  // Return low-confidence result indicating that real-time pricing should be used
  return {
    estimate: {
      hourly: 0,
      monthly: 0,
      currency: 'USD',
      source: 'static',
      confidence: 'low',
    },
    perGpu: { hourly: 0, monthly: 0 },
    totalGpus,
    gpuModel: request.gpuType,
    normalizedGpuModel,
    notes: [
      'Static pricing has been removed. Use real-time pricing from cloud provider APIs.',
      gpuInfo ? `GPU: ${normalizedGpuModel} (${gpuInfo.memoryGb}GB, ${gpuInfo.generation})` : `Unknown GPU: ${request.gpuType}`,
    ],
  };
}

/**
 * @deprecated Use cloudPricing.ts for real-time pricing
 * Estimate costs for each node pool in the cluster
 */
export function estimateNodePoolCosts(
  nodePools: NodePoolInfo[],
  gpuCount: number,
  replicas: number
): NodePoolCostEstimate[] {
  return nodePools
    .filter((pool) => pool.gpuModel) // Only pools with known GPU models
    .map((pool) => {
      const costBreakdown = estimateCost({
        gpuType: pool.gpuModel!,
        gpuCount,
        replicas,
      });

      return {
        poolName: pool.name,
        gpuModel: pool.gpuModel!,
        availableGpus: pool.availableGpus,
        costBreakdown,
      };
    });
}

/**
 * Get all supported GPU models with their info
 * Note: For actual pricing, use cloudPricing.ts
 */
export function getSupportedGpuModels(): Array<{
  model: string;
  memoryGb: number;
  generation: string;
}> {
  return Object.entries(GPU_MODELS).map(([model, data]) => ({
    model,
    memoryGb: data.memoryGb,
    generation: data.generation,
  }));
}

/**
 * Cost estimation service singleton
 * Note: For actual pricing, use cloudPricingService from cloudPricing.ts
 */
export const costEstimationService = {
  normalizeGpuModel,
  getGpuInfo,
  estimateCost,
  estimateNodePoolCosts,
  getSupportedGpuModels,
};
