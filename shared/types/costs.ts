/**
 * Cost estimation types for GPU-based deployments
 */

export type CloudProvider = 'aws' | 'azure' | 'gcp';

/**
 * Pricing information for a specific GPU model
 */
export interface GpuPricing {
  /** GPU model identifier (e.g., "A100-80GB") */
  model: string;
  /** Per-GPU hourly cost by cloud provider (USD) */
  hourlyRate: {
    aws?: number;
    azure?: number;
    gcp?: number;
  };
  /** Average hourly rate across all providers */
  averageHourlyRate: number;
  /** GPU memory in GB */
  memoryGb: number;
  /** Last updated timestamp */
  lastUpdated: string;
}

/**
 * Cost estimate for a deployment configuration
 */
export interface CostEstimate {
  /** Hourly cost in USD */
  hourly: number;
  /** Monthly cost in USD (assumes 730 hours/month) */
  monthly: number;
  /** Currency code */
  currency: 'USD';
  /** Source of the pricing data */
  source: 'static' | 'opencost' | 'cloud-api';
  /** Confidence level of the estimate */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Detailed cost breakdown for a deployment
 */
export interface CostBreakdown {
  /** Total estimated cost */
  estimate: CostEstimate;
  /** Cost per GPU */
  perGpu: {
    hourly: number;
    monthly: number;
  };
  /** Total number of GPUs */
  totalGpus: number;
  /** GPU model used for pricing */
  gpuModel: string;
  /** Normalized GPU model (mapped from node label) */
  normalizedGpuModel: string;
  /** Provider-specific pricing if available */
  byProvider?: {
    provider: CloudProvider;
    hourly: number;
    monthly: number;
  }[];
  /** Helpful notes for the user */
  notes: string[];
}

/**
 * Cost estimate per node pool
 */
export interface NodePoolCostEstimate {
  /** Node pool name */
  poolName: string;
  /** GPU model in this pool */
  gpuModel: string;
  /** Number of GPUs available in this pool */
  availableGpus: number;
  /** Cost breakdown for this pool */
  costBreakdown: CostBreakdown;
}

/**
 * Request to estimate deployment costs
 */
export interface CostEstimateRequest {
  /** GPU type (from node label or normalized) */
  gpuType: string;
  /** Number of GPUs per replica */
  gpuCount: number;
  /** Number of replicas */
  replicas: number;
  /** Hours per month (default: 730 for 24/7) */
  hoursPerMonth?: number;
}

/**
 * Response with cost estimates
 */
export interface CostEstimateResponse {
  /** Whether the estimate was successful */
  success: boolean;
  /** Cost breakdown */
  breakdown?: CostBreakdown;
  /** Error message if unsuccessful */
  error?: string;
}
