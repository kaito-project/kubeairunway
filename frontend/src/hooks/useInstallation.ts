import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { installationApi, type HelmStatus, type InstallationStatus, type InstallResult } from '@/lib/api'

export function useHelmStatus() {
  return useQuery<HelmStatus>({
    queryKey: ['helm-status'],
    queryFn: () => installationApi.getHelmStatus(),
    staleTime: 60000, // Cache for 1 minute
    retry: false,
  })
}

/**
 * Hook to get installation status for a specific provider
 */
export function useProviderInstallationStatus(providerId: string) {
  return useQuery<InstallationStatus>({
    queryKey: ['provider-installation-status', providerId],
    queryFn: () => installationApi.getProviderStatus(providerId),
    enabled: !!providerId,
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}

/**
 * Hook to get installation commands for a specific provider
 */
export function useProviderCommands(providerId: string) {
  return useQuery({
    queryKey: ['provider-commands', providerId],
    queryFn: () => installationApi.getProviderCommands(providerId),
    enabled: !!providerId,
    staleTime: 300000, // Cache for 5 minutes
  })
}

/**
 * Hook to install a provider
 */
export function useInstallProvider() {
  const queryClient = useQueryClient()

  return useMutation<InstallResult, Error, string>({
    mutationFn: (providerId: string) => installationApi.installProvider(providerId),
    onSuccess: (_data, providerId) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['provider-installation-status', providerId] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['runtimes-status'] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
    },
  })
}

/**
 * Hook to upgrade a provider
 */
export function useUpgradeProvider() {
  const queryClient = useQueryClient()

  return useMutation<InstallResult, Error, string>({
    mutationFn: (providerId: string) => installationApi.upgradeProvider(providerId),
    onSuccess: (_data, providerId) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['provider-installation-status', providerId] })
      queryClient.invalidateQueries({ queryKey: ['runtimes-status'] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
      queryClient.invalidateQueries({ queryKey: ['runtimes-status'] })
    },
  })
}

/**
 * Hook to uninstall a provider
 */
export function useUninstallProvider() {
  const queryClient = useQueryClient()

  return useMutation<InstallResult, Error, string>({
    mutationFn: (providerId: string) => installationApi.uninstallProvider(providerId),
    onSuccess: (_data, providerId) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['provider-installation-status', providerId] })
      queryClient.invalidateQueries({ queryKey: ['runtimes-status'] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
      queryClient.invalidateQueries({ queryKey: ['runtimes-status'] })
    },
  })
}

/**
 * Hook to uninstall a provider's CRDs
 */
export function useUninstallProviderCRDs() {
  const queryClient = useQueryClient()

  return useMutation<InstallResult, Error, string>({
    mutationFn: (providerId: string) => installationApi.uninstallProviderCRDs(providerId),
    onSuccess: (_data, providerId) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['provider-installation-status', providerId] })
      queryClient.invalidateQueries({ queryKey: ['runtimes-status'] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
    },
  })
}
