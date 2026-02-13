/**
 * NVIDIA AI Configurator types for optimal inference configuration
 */

/**
 * Optimization target for AI Configurator
 */
export type OptimizationTarget = 'throughput' | 'latency';

/**
 * Input parameters for AI Configurator analysis
 */
export interface AIConfiguratorInput {
  modelId: string;           // HuggingFace model ID
  gpuType: string;           // e.g., "A100-80GB", "H100"
  gpuCount: number;          // Number of GPUs available
  optimizeFor?: OptimizationTarget; // What to optimize for (default: throughput)
  maxLatencyMs?: number;     // Target latency constraint (optional)
}

/**
 * Recommended configuration from AI Configurator
 */
export interface AIConfiguratorConfig {
  tensorParallelDegree: number;
  pipelineParallelDegree?: number;
  maxBatchSize: number;
  maxNumSeqs?: number;
  gpuMemoryUtilization: number;  // 0.0 - 1.0
  maxModelLen: number;           // Context length
  quantization?: 'fp16' | 'fp8' | 'int8' | 'int4' | 'auto';
  // Disaggregated mode config
  prefillTensorParallel?: number;
  decodeTensorParallel?: number;
  prefillReplicas?: number;
  decodeReplicas?: number;
}

/**
 * Estimated performance metrics from AI Configurator
 */
export interface AIConfiguratorPerformance {
  throughputTokensPerSec: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  gpuUtilization: number;  // 0.0 - 1.0
}

/**
 * Supported backend/engine type
 */
export type AIConfiguratorBackend = 'vllm' | 'sglang' | 'trtllm';

/**
 * Full result from AI Configurator analysis
 */
export interface AIConfiguratorResult {
  success: boolean;
  config: AIConfiguratorConfig;
  estimatedPerformance?: AIConfiguratorPerformance;
  mode: 'aggregated' | 'disaggregated';
  replicas: number;
  warnings?: string[];
  error?: string;
  // Backend information
  backend?: AIConfiguratorBackend;
  supportedBackends?: AIConfiguratorBackend[];
}

/**
 * Status of AI Configurator availability
 */
export interface AIConfiguratorStatus {
  available: boolean;
  version?: string;
  error?: string;
  /** True when KubeAIRunway is running inside a Kubernetes cluster (AI Configurator not applicable) */
  runningInCluster?: boolean;
}
