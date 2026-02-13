import { useQuery } from '@tanstack/react-query'
import { instancesApi } from '@/lib/api'

export function useInstances() {
  return useQuery({
    queryKey: ['instances'],
    queryFn: () => instancesApi.list(),
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 30 * 1000,
  })
}

export function useInstanceHealth(instanceId: string | undefined) {
  return useQuery({
    queryKey: ['instance-health', instanceId],
    queryFn: () => instancesApi.getHealth(instanceId!),
    enabled: !!instanceId,
    staleTime: 30 * 1000,
    refetchInterval: 30 * 1000,
  })
}
