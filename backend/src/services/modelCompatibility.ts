import type { Engine, HfApiModelResult, HfModelSearchResult } from '@kubeairunway/shared';
import { estimateGpuMemory, formatGpuMemory } from './gpuValidation';

/**
 * Architecture allowlists per inference engine
 * 
 * These are the model architectures that each engine has been verified to support.
 * Models with architectures not in this list may still work, but are not guaranteed.
 */
const ENGINE_ARCHITECTURE_ALLOWLIST: Record<Engine, string[]> = {
  vllm: [
    // LLaMA family
    'LlamaForCausalLM',
    'MistralForCausalLM',
    'MixtralForCausalLM',
    // Qwen family  
    'Qwen2ForCausalLM',
    'Qwen2MoeForCausalLM',
    'Qwen3ForCausalLM',
    // GPT family
    'GPT2LMHeadModel',
    'GPTNeoForCausalLM',
    'GPTNeoXForCausalLM',
    'GPTJForCausalLM',
    'GPTBigCodeForCausalLM',
    // Other popular architectures
    'FalconForCausalLM',
    'PhiForCausalLM',
    'Phi3ForCausalLM',
    'GemmaForCausalLM',
    'Gemma2ForCausalLM',
    'StableLmForCausalLM',
    'StarCoder2ForCausalLM',
    'OPTForCausalLM',
    'BloomForCausalLM',
    'MPTForCausalLM',
    'BaichuanForCausalLM',
    'InternLMForCausalLM',
    'InternLM2ForCausalLM',
    'ChatGLMModel',
    'CohereForCausalLM',
    'DbrxForCausalLM',
    'DeciLMForCausalLM',
    'DeepseekV2ForCausalLM',
    'ExaoneForCausalLM',
    'ArcticForCausalLM',
    'GraniteForCausalLM',
    'GraniteMoeForCausalLM',
    'JambaForCausalLM',
    'MiniCPMForCausalLM',
    'OlmoForCausalLM',
    'Olmo2ForCausalLM',
    'PersimmonForCausalLM',
    'SolarForCausalLM',
    'TeleChat2ForCausalLM',
    'XverseForCausalLM',
  ],
  sglang: [
    // LLaMA family
    'LlamaForCausalLM',
    'MistralForCausalLM',
    'MixtralForCausalLM',
    // Qwen family
    'Qwen2ForCausalLM',
    'Qwen2MoeForCausalLM',
    'Qwen3ForCausalLM',
    // GPT family
    'GPT2LMHeadModel',
    'GPTNeoXForCausalLM',
    'GPTBigCodeForCausalLM',
    // Other
    'GemmaForCausalLM',
    'Gemma2ForCausalLM',
    'PhiForCausalLM',
    'Phi3ForCausalLM',
    'StableLmForCausalLM',
    'InternLM2ForCausalLM',
    'DeepseekV2ForCausalLM',
    'OlmoForCausalLM',
    'Olmo2ForCausalLM',
    'ExaoneForCausalLM',
    'MiniCPMForCausalLM',
  ],
  trtllm: [
    // TensorRT-LLM has more limited but optimized support
    'LlamaForCausalLM',
    'MistralForCausalLM',
    'MixtralForCausalLM',
    'Qwen2ForCausalLM',
    'GPT2LMHeadModel',
    'GPTNeoXForCausalLM',
    'FalconForCausalLM',
    'PhiForCausalLM',
    'GemmaForCausalLM',
    'BloomForCausalLM',
    'MPTForCausalLM',
    'BaichuanForCausalLM',
    'ChatGLMModel',
  ],
  llamacpp: [
    // llama.cpp supports GGUF quantized models - very broad architecture support
    // Used by KAITO/AIKit for CPU-capable inference
    'LlamaForCausalLM',
    'MistralForCausalLM',
    'MixtralForCausalLM',
    'Qwen2ForCausalLM',
    'Qwen2MoeForCausalLM',
    'Qwen3ForCausalLM',
    'GPT2LMHeadModel',
    'GPTNeoForCausalLM',
    'GPTNeoXForCausalLM',
    'PhiForCausalLM',
    'Phi3ForCausalLM',
    'GemmaForCausalLM',
    'Gemma2ForCausalLM',
    'FalconForCausalLM',
    'StableLmForCausalLM',
    'StarCoder2ForCausalLM',
    'BloomForCausalLM',
    'MPTForCausalLM',
    'InternLMForCausalLM',
    'InternLM2ForCausalLM',
    'DeepseekV2ForCausalLM',
    'OlmoForCausalLM',
    'Olmo2ForCausalLM',
    'MiniCPMForCausalLM',
  ],
};

/**
 * Supported pipeline tags for text generation models
 */
const SUPPORTED_PIPELINE_TAGS = [
  'text-generation',
  'text2text-generation',
  'conversational',
];

/**
 * Patterns to infer architecture from model ID/name
 * Used for gated models where config metadata is not available
 * Order matters - more specific patterns should come first
 */
const ARCHITECTURE_INFERENCE_PATTERNS: Array<{ pattern: RegExp; architecture: string }> = [
  // LLaMA family (case insensitive, can be part of word like "TinyLlama")
  { pattern: /llama[-_]?3/i, architecture: 'LlamaForCausalLM' },
  { pattern: /llama[-_]?2/i, architecture: 'LlamaForCausalLM' },
  { pattern: /llama/i, architecture: 'LlamaForCausalLM' },
  // Mistral family (mixtral must come before mistral)
  { pattern: /\bmixtral/i, architecture: 'MixtralForCausalLM' },
  { pattern: /\bmistral/i, architecture: 'MistralForCausalLM' },
  // Qwen family (more specific versions first)
  { pattern: /\bqwen[-_]?3/i, architecture: 'Qwen3ForCausalLM' },
  { pattern: /\bqwen/i, architecture: 'Qwen2ForCausalLM' },
  // Gemma family (gemma-2 or gemma2 for Gemma 2, otherwise Gemma 1)
  { pattern: /\bgemma[-_]?2(?:-|$)/i, architecture: 'Gemma2ForCausalLM' },
  { pattern: /\bgemma2\b/i, architecture: 'Gemma2ForCausalLM' },
  { pattern: /\bgemma\b/i, architecture: 'GemmaForCausalLM' },
  // Phi family
  { pattern: /\bphi[-_]?3/i, architecture: 'Phi3ForCausalLM' },
  { pattern: /\bphi/i, architecture: 'PhiForCausalLM' },
  // Falcon
  { pattern: /\bfalcon/i, architecture: 'FalconForCausalLM' },
  // DeepSeek
  { pattern: /\bdeepseek/i, architecture: 'DeepseekV2ForCausalLM' },
  // Granite
  { pattern: /\bgranite/i, architecture: 'GraniteForCausalLM' },
  // OLMo
  { pattern: /\bolmo[-_]?2/i, architecture: 'Olmo2ForCausalLM' },
  { pattern: /\bolmo/i, architecture: 'OlmoForCausalLM' },
];

/**
 * Infer architecture from model ID when config is not available
 * This is used for gated models where the HuggingFace API doesn't return full metadata
 */
export function inferArchitectureFromModelId(modelId: string): string[] {
  for (const { pattern, architecture } of ARCHITECTURE_INFERENCE_PATTERNS) {
    if (pattern.test(modelId)) {
      return [architecture];
    }
  }
  return [];
}

/**
 * Check which engines support a given architecture
 */
export function getSupportedEngines(architectures: string[]): Engine[] {
  const engines: Engine[] = [];
  
  for (const engine of ['vllm', 'sglang', 'trtllm', 'llamacpp'] as Engine[]) {
    const allowlist = ENGINE_ARCHITECTURE_ALLOWLIST[engine];
    const isSupported = architectures.some(arch => allowlist.includes(arch));
    if (isSupported) {
      engines.push(engine);
    }
  }
  
  return engines;
}

/**
 * Check if a model's pipeline tag is compatible with our engines
 */
export function isPipelineTagCompatible(pipelineTag?: string): boolean {
  if (!pipelineTag) return false;
  return SUPPORTED_PIPELINE_TAGS.includes(pipelineTag);
}

/**
 * Get incompatibility reason for a model
 */
export function getIncompatibilityReason(
  pipelineTag?: string,
  libraryName?: string,
  architectures?: string[],
  supportedEngines?: Engine[]
): string | undefined {
  if (!pipelineTag) {
    return 'Model has no pipeline tag';
  }
  
  if (!isPipelineTagCompatible(pipelineTag)) {
    return `Pipeline tag "${pipelineTag}" is not supported for inference`;
  }
  
  if (libraryName && libraryName !== 'transformers' && libraryName !== 'vllm') {
    return `Library "${libraryName}" is not supported`;
  }
  
  if (!architectures || architectures.length === 0) {
    return 'Model architecture is unknown';
  }
  
  if (!supportedEngines || supportedEngines.length === 0) {
    return `Architecture "${architectures[0]}" is not supported by any engine`;
  }
  
  return undefined;
}

/**
 * Parse parameter count from model name/ID
 * Handles common naming conventions like "8B", "70B", "1.5B", "0.6B", "405B", "7b", etc.
 * 
 * @param modelId - Model ID or name (e.g., "meta-llama/Llama-3.1-8B-Instruct")
 * @returns Parameter count or undefined if not parseable
 */
export function parseParameterCountFromName(modelId: string): number | undefined {
  // Match patterns like "8B", "70B", "1.5B", "0.6B", "405b", "7B", "1B" etc.
  // Must be preceded by a word boundary, hyphen, or underscore
  // Case insensitive
  const match = modelId.match(/(?:^|[-_./])(\d+(?:\.\d+)?)\s*[Bb](?:$|[-_./]|illion)?/);
  
  if (match) {
    const billions = parseFloat(match[1]);
    if (!isNaN(billions) && billions > 0 && billions < 10000) {
      // Convert billions to actual parameter count
      return billions * 1_000_000_000;
    }
  }
  
  // Also try matching "M" for millions (e.g., "125M", "350M")
  const millionMatch = modelId.match(/(?:^|[-_./])(\d+(?:\.\d+)?)\s*[Mm](?:$|[-_./]|illion)?/);
  
  if (millionMatch) {
    const millions = parseFloat(millionMatch[1]);
    if (!isNaN(millions) && millions > 0 && millions < 10000) {
      return millions * 1_000_000;
    }
  }
  
  return undefined;
}

/**
 * Extract parameter count from HuggingFace model metadata
 */
export function extractParameterCount(model: HfApiModelResult): number | undefined {
  // Try safetensors metadata first (most accurate)
  if (model.safetensors?.total) {
    return model.safetensors.total;
  }
  
  // Try parameters map from safetensors
  if (model.safetensors?.parameters) {
    const params = model.safetensors.parameters;
    // Sum all parameter counts (handles sharded models)
    const total = Object.values(params).reduce<number>((sum, count) => sum + (count as number), 0);
    if (total > 0) return total;
  }
  
  // Fallback: parse parameter count from model name
  // This handles gated models and cases where safetensors metadata is not available
  return parseParameterCountFromName(model.id);
}

/**
 * Process a raw HuggingFace API result into our search result format
 */
export function processHfModel(model: HfApiModelResult): HfModelSearchResult {
  // Get architectures from config, or infer from model ID for gated models
  let architectures = model.config?.architectures || [];
  const isGated = model.gated === true || model.gated === 'auto' || model.gated === 'manual';
  
  // For gated models without architecture info, try to infer it from the model ID
  // The HuggingFace API doesn't return full metadata for gated models without auth
  if (architectures.length === 0) {
    architectures = inferArchitectureFromModelId(model.id);
  }
  
  // Check if this is a GGUF model - GGUF models only support llama.cpp
  // Detection: HuggingFace API sets library_name to 'gguf', or model ID contains 'gguf'
  const libraryName = model.library_name || '';
  const isGgufModel = libraryName === 'gguf' || 
                      model.id.toLowerCase().includes('gguf') ||
                      model.id.toLowerCase().includes('-gguf');
  
  // GGUF models only support llamacpp
  // Non-GGUF models exclude llamacpp (llama.cpp requires GGUF format, not safetensors)
  const supportedEngines: Engine[] = isGgufModel 
    ? ['llamacpp'] 
    : getSupportedEngines(architectures).filter(e => e !== 'llamacpp');
  const pipelineTag = model.pipeline_tag || '';
  
  // For gated models without metadata, assume they're compatible if we could infer architecture
  // This is because gated models (like meta-llama) are typically text-generation models
  const hasInferredCompatibility = architectures.length > 0 && supportedEngines.length > 0;
  // GGUF models are always compatible if detected as such
  const hasGgufCompatibility = isGgufModel && supportedEngines.length > 0;
  const hasExplicitCompatibility = 
    isPipelineTagCompatible(pipelineTag) &&
    supportedEngines.length > 0 &&
    (libraryName === 'transformers' || libraryName === 'vllm' || libraryName === 'gguf' || libraryName === '');
  
  // A model is compatible if either:
  // 1. It has explicit metadata confirming compatibility
  // 2. It's missing metadata but we could infer a supported architecture (likely a gated model)
  // 3. It's a GGUF model (always compatible with llama.cpp)
  const compatible = hasExplicitCompatibility || hasInferredCompatibility || hasGgufCompatibility;
  
  const incompatibilityReason = compatible 
    ? undefined 
    : getIncompatibilityReason(pipelineTag, libraryName, architectures, supportedEngines);
  
  const parameterCount = extractParameterCount(model);
  const gpuMemory = parameterCount ? estimateGpuMemory(parameterCount) : undefined;
  
  // Parse author from model ID (format: "author/model-name")
  const [author, ...nameParts] = model.id.split('/');
  const name = nameParts.join('/') || model.id;
  
  return {
    id: model.id,
    author: author || 'unknown',
    name: name,
    downloads: model.downloads || 0,
    likes: model.likes || 0,
    pipelineTag,
    libraryName,
    architectures,
    gated: isGated,
    parameterCount,
    estimatedGpuMemory: gpuMemory ? formatGpuMemory(gpuMemory) : undefined,
    estimatedGpuMemoryGb: gpuMemory,
    supportedEngines,
    compatible,
    incompatibilityReason,
  };
}

/**
 * Filter and process HuggingFace API results
 * Only returns compatible models
 */
export function filterCompatibleModels(models: HfApiModelResult[]): HfModelSearchResult[] {
  return models
    .map(processHfModel)
    .filter(model => model.compatible);
}

/**
 * Get architecture allowlist for a specific engine
 */
export function getEngineArchitectures(engine: Engine): string[] {
  return [...ENGINE_ARCHITECTURE_ALLOWLIST[engine]];
}
