import { useQuery } from '@tanstack/react-query'
import { modelsApi, huggingFaceApi, type Model, type HfModelSearchResult } from '@/lib/api'
import { getHfAccessToken } from './useHuggingFace'

// Fallback static models for when API is unavailable
const fallbackModels: Model[] = [
  {
    id: 'Qwen/Qwen3-0.6B',
    name: 'Qwen3 0.6B',
    description: 'Tiny model ideal for development, testing, and edge deployments',
    size: '0.6B',
    task: 'text-generation',
    conversational: true,
    contextLength: 32768,
    supportedEngines: ['vllm', 'sglang', 'trtllm'],
    minGpuMemory: '4GB',
  },
  {
    id: 'google/gemma-3-1b-it',
    name: 'Gemma 3 1B Instruct',
    description: "Google's lightweight instruction-tuned model with strong efficiency",
    size: '1B',
    task: 'text-generation',
    conversational: true,
    contextLength: 32768,
    supportedEngines: ['vllm', 'sglang'],
    minGpuMemory: '4GB',
    gated: true,
  },
  {
    id: 'microsoft/Phi-4-mini-instruct',
    name: 'Phi-4 Mini Instruct',
    description: "Microsoft's efficient 3.8B model with 128K context and multilingual support",
    size: '3.8B',
    task: 'text-generation',
    conversational: true,
    contextLength: 131072,
    supportedEngines: ['vllm', 'sglang'],
    minGpuMemory: '8GB',
  },
  {
    id: 'Qwen/Qwen3-4B',
    name: 'Qwen3 4B',
    description: 'Compact model with thinking and non-thinking modes for versatile tasks',
    size: '4B',
    task: 'text-generation',
    conversational: true,
    contextLength: 32768,
    supportedEngines: ['vllm', 'sglang', 'trtllm'],
    minGpuMemory: '10GB',
  },
  {
    id: 'google/gemma-3-4b-it',
    name: 'Gemma 3 4B Instruct',
    description: "Google's multimodal model with 128K context and image understanding",
    size: '4B',
    task: 'image-text-to-text',
    conversational: true,
    contextLength: 131072,
    supportedEngines: ['vllm', 'sglang'],
    minGpuMemory: '10GB',
    gated: true,
  },
  {
    id: 'Qwen/Qwen3-8B',
    name: 'Qwen3 8B',
    description: 'Strong all-around model with dynamic reasoning for complex tasks',
    size: '8B',
    task: 'text-generation',
    conversational: true,
    contextLength: 32768,
    supportedEngines: ['vllm', 'sglang', 'trtllm'],
    minGpuMemory: '18GB',
  },
  {
    id: 'deepseek-ai/DeepSeek-R1-Distill-Llama-8B',
    name: 'DeepSeek R1 Distill 8B',
    description: 'Reasoning-focused distilled model with strong analytical capabilities',
    size: '8B',
    task: 'text-generation',
    conversational: true,
    contextLength: 16384,
    supportedEngines: ['vllm', 'sglang'],
    minGpuMemory: '18GB',
  },
  {
    id: 'mistralai/Ministral-3-8B-Instruct-2512-BF16',
    name: 'Ministral 3 8B Instruct',
    description: "Mistral's latest 8B model with 256K context, vision, and function calling",
    size: '8B',
    task: 'image-text-to-text',
    conversational: true,
    contextLength: 262144,
    supportedEngines: ['vllm', 'sglang'],
    minGpuMemory: '18GB',
  },
]

export function useModels() {
  return useQuery({
    queryKey: ['models'],
    queryFn: async () => {
      try {
        const data = await modelsApi.list()
        return data.models
      } catch {
        // Return fallback models if API is unavailable
        return fallbackModels
      }
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })
}

export function useModel(id: string | undefined) {
  const { data: models } = useModels()

  return useQuery({
    queryKey: ['model', id],
    queryFn: async () => {
      if (!id) return null

      // First try to find in already loaded models
      const localModel = models?.find(m => m.id === id)
      if (localModel) return localModel

      // Otherwise fetch from API
      try {
        return await modelsApi.get(id)
      } catch {
        // Try fallback
        return fallbackModels.find(m => m.id === id) || null
      }
    },
    enabled: !!id,
  })
}

/**
 * Convert HF search result to Model type for deployment form
 */
export function hfModelToModel(hfModel: HfModelSearchResult): Model {
  // Convert parameter count to human-readable size
  let size = 'Unknown';
  if (hfModel.parameterCount) {
    const billions = hfModel.parameterCount / 1_000_000_000;
    if (billions >= 1) {
      size = `${billions.toFixed(1)}B`;
    } else {
      const millions = hfModel.parameterCount / 1_000_000;
      size = `${millions.toFixed(0)}M`;
    }
  }

  return {
    id: hfModel.id,
    name: hfModel.name,
    description: `${hfModel.author}/${hfModel.name} - ${hfModel.pipelineTag}`,
    size,
    task: (hfModel.pipelineTag === 'image-text-to-text' ? 'image-text-to-text' : 'text-generation') as Model['task'],
    conversational: true, // HF search only returns compatible models which are typically instruct/chat
    supportedEngines: hfModel.supportedEngines,
    minGpuMemory: hfModel.estimatedGpuMemory,
    gated: hfModel.gated,
    // Extended fields from HF
    estimatedGpuMemory: hfModel.estimatedGpuMemory,
    estimatedGpuMemoryGb: hfModel.estimatedGpuMemoryGb,
    parameterCount: hfModel.parameterCount,
    fromHfSearch: true,
  };
}

/**
 * Hook to get a model from HuggingFace search
 * Used when deploying a model that came from HF search
 */
export function useHfModel(id: string | undefined) {
  const hfToken = getHfAccessToken();

  return useQuery({
    queryKey: ['hf-model', id],
    queryFn: async (): Promise<Model | null> => {
      if (!id) return null;

      // Search for the exact model ID
      const result = await huggingFaceApi.searchModels(id, {
        limit: 5,
        hfToken: hfToken ?? undefined,
      });

      // Find exact match
      const hfModel = result.models.find(m => m.id === id);
      if (!hfModel) return null;

      return hfModelToModel(hfModel);
    },
    enabled: !!id,
    staleTime: 60000, // 60 seconds
  });
}
