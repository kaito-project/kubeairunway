import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { aikitApi, type PremadeModel, type AikitBuildRequest, type AikitBuildResult, type AikitInfrastructureStatus } from '@/lib/api'

/**
 * Hook to fetch the list of premade KAITO models
 */
export function usePremadeModels() {
  return useQuery({
    queryKey: ['aikit-models'],
    queryFn: async () => {
      const data = await aikitApi.listModels()
      return data.models
    },
    staleTime: 5 * 60 * 1000, // 5 minutes - models don't change often
  })
}

/**
 * Hook to fetch a specific premade model by ID
 */
export function usePremadeModel(id: string | undefined) {
  return useQuery({
    queryKey: ['aikit-model', id],
    queryFn: async () => {
      if (!id) return null
      return await aikitApi.getModel(id)
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Hook to build an AIKit image
 * For premade models, returns immediately.
 * For HuggingFace GGUF models, triggers a build.
 */
export function useAikitBuild() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (request: AikitBuildRequest): Promise<AikitBuildResult> => {
      return await aikitApi.build(request)
    },
    onSuccess: () => {
      // Invalidate infrastructure status in case it changed
      queryClient.invalidateQueries({ queryKey: ['aikit-infrastructure'] })
    },
  })
}

/**
 * Hook to preview what image would be built
 */
export function useAikitPreview() {
  return useMutation({
    mutationFn: async (request: AikitBuildRequest) => {
      return await aikitApi.preview(request)
    },
  })
}

/**
 * Hook to fetch AIKit build infrastructure status
 */
export function useAikitInfrastructure() {
  return useQuery<AikitInfrastructureStatus>({
    queryKey: ['aikit-infrastructure'],
    queryFn: async () => {
      return await aikitApi.getInfrastructureStatus()
    },
    refetchInterval: 30000, // Check every 30 seconds
    retry: 1,
  })
}

/**
 * Hook to set up AIKit build infrastructure
 */
export function useAikitSetupInfrastructure() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return await aikitApi.setupInfrastructure()
    },
    onSuccess: () => {
      // Refresh infrastructure status after setup
      queryClient.invalidateQueries({ queryKey: ['aikit-infrastructure'] })
    },
  })
}

/**
 * Convert a premade model to a format compatible with the deployment form
 */
export function premadeModelToModel(premadeModel: PremadeModel) {
  return {
    id: premadeModel.id,
    name: `${premadeModel.name} ${premadeModel.size}`,
    description: premadeModel.description || `${premadeModel.name} - ${premadeModel.license} license`,
    size: premadeModel.size,
    task: 'text-generation' as const,
    conversational: true,
    supportedEngines: ['llamacpp'] as const, // AIKit uses llama.cpp for CPU-capable inference
    license: premadeModel.license,
    // KAITO-specific fields
    image: premadeModel.image,
    modelName: premadeModel.modelName,
    isKaitoModel: true,
  }
}
