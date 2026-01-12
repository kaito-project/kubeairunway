import type {
  CostBreakdown,
  CostEstimate,
  CostEstimateRequest,
  CloudProvider,
  NodePoolCostEstimate,
} from '@kubefoundry/shared';
import type { NodePoolInfo } from '@kubefoundry/shared';
import gpuPricingData from '../data/gpu-pricing.json';
import logger from '../lib/logger';

/** Hours per month assuming 24/7 operation */
const DEFAULT_HOURS_PER_MONTH = 730;

/** GPU pricing data structure from JSON */
interface GpuModelPricing {
  aliases: string[];
  memoryGb: number;
  hourlyRate: {
    aws?: number;
    azure?: number;
    gcp?: number;
  };
  generation: string;
  notes: string;
}

interface GpuPricingDatabase {
  version: string;
  lastUpdated: string;
  currency: string;
  notes: string[];
  gpuModels: Record<string, GpuModelPricing>;
  defaultGpu: {
    model: string;
    reason: string;
  };
}

const pricingDb = gpuPricingData as GpuPricingDatabase;

/**
 * Normalize GPU model name from Kubernetes node label to our pricing key
 *
 * @param gpuLabel - The raw GPU label from nvidia.com/gpu.product
 * @returns Normalized GPU model name that matches our pricing database
 */
export function normalizeGpuModel(gpuLabel: string): string {
  if (!gpuLabel) {
    return pricingDb.defaultGpu.model;
  }

  const normalizedLabel = gpuLabel.trim();

  // Check each GPU model for matching aliases
  for (const [modelKey, modelData] of Object.entries(pricingDb.gpuModels)) {
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
        if (pricingDb.gpuModels[modelWithMemory]) {
          return modelWithMemory;
        }
      }
      // Return first matching model for this family
      for (const modelKey of Object.keys(pricingDb.gpuModels)) {
        if (modelKey.startsWith(family)) {
          return modelKey;
        }
      }
    }
  }

  logger.warn({ gpuLabel }, 'Could not normalize GPU model, using default');
  return pricingDb.defaultGpu.model;
}

/**
 * Get pricing information for a GPU model
 */
export function getGpuPricing(gpuModel: string): GpuModelPricing | undefined {
  const normalizedModel = normalizeGpuModel(gpuModel);
  return pricingDb.gpuModels[normalizedModel];
}

/**
 * Calculate average hourly rate across all providers
 */
function calculateAverageRate(hourlyRate: { aws?: number; azure?: number; gcp?: number }): number {
  const rates = [hourlyRate.aws, hourlyRate.azure, hourlyRate.gcp].filter(
    (r): r is number => r !== undefined && r > 0
  );

  if (rates.length === 0) {
    return 0;
  }

  return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
}

/**
 * Estimate deployment cost based on GPU configuration
 */
export function estimateCost(request: CostEstimateRequest): CostBreakdown {
  const normalizedGpuModel = normalizeGpuModel(request.gpuType);
  const pricing = pricingDb.gpuModels[normalizedGpuModel];

  const totalGpus = request.gpuCount * request.replicas;
  const hoursPerMonth = request.hoursPerMonth ?? DEFAULT_HOURS_PER_MONTH;

  // If no pricing found, return with low confidence
  if (!pricing) {
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
      notes: [`No pricing data available for GPU model: ${request.gpuType}`],
    };
  }

  const avgHourlyPerGpu = calculateAverageRate(pricing.hourlyRate);
  const totalHourly = avgHourlyPerGpu * totalGpus;
  const totalMonthly = totalHourly * hoursPerMonth;

  // Build provider-specific breakdown
  const byProvider: { provider: CloudProvider; hourly: number; monthly: number }[] = [];
  const hourlyRates = pricing.hourlyRate;
  
  if (hourlyRates.aws && hourlyRates.aws > 0) {
    byProvider.push({
      provider: 'aws',
      hourly: hourlyRates.aws * totalGpus,
      monthly: hourlyRates.aws * totalGpus * hoursPerMonth,
    });
  }
  if (hourlyRates.azure && hourlyRates.azure > 0) {
    byProvider.push({
      provider: 'azure',
      hourly: hourlyRates.azure * totalGpus,
      monthly: hourlyRates.azure * totalGpus * hoursPerMonth,
    });
  }
  if (hourlyRates.gcp && hourlyRates.gcp > 0) {
    byProvider.push({
      provider: 'gcp',
      hourly: hourlyRates.gcp * totalGpus,
      monthly: hourlyRates.gcp * totalGpus * hoursPerMonth,
    });
  }

  // Determine confidence level
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (byProvider.length < 2) {
    confidence = 'medium';
  }
  if (avgHourlyPerGpu === 0) {
    confidence = 'low';
  }

  // Build notes
  const notes: string[] = [];
  if (pricing.notes) {
    notes.push(pricing.notes);
  }
  notes.push(...pricingDb.notes);

  const estimate: CostEstimate = {
    hourly: Math.round(totalHourly * 100) / 100,
    monthly: Math.round(totalMonthly * 100) / 100,
    currency: 'USD',
    source: 'static',
    confidence,
  };

  return {
    estimate,
    perGpu: {
      hourly: Math.round(avgHourlyPerGpu * 100) / 100,
      monthly: Math.round(avgHourlyPerGpu * hoursPerMonth * 100) / 100,
    },
    totalGpus,
    gpuModel: request.gpuType,
    normalizedGpuModel,
    byProvider: byProvider.length > 0 ? byProvider : undefined,
    notes,
  };
}

/**
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
 * Get all supported GPU models with their pricing
 */
export function getSupportedGpuModels(): Array<{
  model: string;
  memoryGb: number;
  avgHourlyRate: number;
  generation: string;
}> {
  return Object.entries(pricingDb.gpuModels).map(([model, data]) => ({
    model,
    memoryGb: data.memoryGb,
    avgHourlyRate: calculateAverageRate(data.hourlyRate),
    generation: data.generation,
  }));
}

/**
 * Cost estimation service singleton
 */
export const costEstimationService = {
  normalizeGpuModel,
  getGpuPricing,
  estimateCost,
  estimateNodePoolCosts,
  getSupportedGpuModels,
  getPricingLastUpdated: () => pricingDb.lastUpdated,
};
