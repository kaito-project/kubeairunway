import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { installationApi, type HelmStatus, type InstallationStatus, type InstallResult } from '@/lib/api'

export function useHelmStatus() {
  return useQuery<HelmStatus>({
    queryKey: ['helm-status'],
    queryFn: () => installationApi.getHelmStatus(),
    staleTime: 60000, // Cache for 1 minute
  })
}

export function useProviderInstallationStatus(providerId: string) {
  return useQuery<InstallationStatus>({
    queryKey: ['provider-installation-status', providerId],
    queryFn: () => installationApi.getProviderStatus(providerId),
    enabled: !!providerId,
    refetchInterval: 30000, // Refetch every 30 seconds
  })
}

export function useProviderCommands(providerId: string) {
  return useQuery({
    queryKey: ['provider-commands', providerId],
    queryFn: () => installationApi.getProviderCommands(providerId),
    enabled: !!providerId,
  })
}

export function useInstallProvider() {
  const queryClient = useQueryClient()

  return useMutation<InstallResult, Error, string>({
    mutationFn: (providerId: string) => installationApi.installProvider(providerId),
    onSuccess: (_, providerId) => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: ['provider-installation-status', providerId] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
}

export function useUpgradeProvider() {
  const queryClient = useQueryClient()

  return useMutation<InstallResult, Error, string>({
    mutationFn: (providerId: string) => installationApi.upgradeProvider(providerId),
    onSuccess: (_, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['provider-installation-status', providerId] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
    },
  })
}

export function useUninstallProvider() {
  const queryClient = useQueryClient()

  return useMutation<InstallResult, Error, string>({
    mutationFn: (providerId: string) => installationApi.uninstallProvider(providerId),
    onSuccess: (_, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['provider-installation-status', providerId] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
    },
  })
}

export function useUninstallProviderCRDs() {
  const queryClient = useQueryClient()

  return useMutation<InstallResult, Error, string>({
    mutationFn: (providerId: string) => installationApi.uninstallProviderCRDs(providerId),
    onSuccess: (_, providerId) => {
      queryClient.invalidateQueries({ queryKey: ['provider-installation-status', providerId] })
      queryClient.invalidateQueries({ queryKey: ['cluster-status'] })
      queryClient.invalidateQueries({ queryKey: ['runtimes-status'] })
    },
  })
}
