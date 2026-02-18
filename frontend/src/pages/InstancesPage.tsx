import { useNavigate } from 'react-router-dom'
import { useInstances } from '@/hooks/useInstances'
import { useInstanceContext } from '@/hooks/useInstanceContext'
import { useQueries } from '@tanstack/react-query'
import { instancesApi } from '@/lib/api'
import { InstanceCard } from '@/components/instances/InstanceCard'
import { SkeletonGrid } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { RefreshCw, Server } from 'lucide-react'

export function InstancesPage() {
  const navigate = useNavigate()
  const { setCurrentInstance } = useInstanceContext()
  const { data: instances, isLoading, error, refetch, isFetching } = useInstances()

  // Fetch health for all instances in parallel
  const healthQueries = useQueries({
    queries: (instances ?? []).map((inst) => ({
      queryKey: ['instance-health', inst.id],
      queryFn: () => instancesApi.getHealth(inst.id),
      staleTime: 30 * 1000,
      refetchInterval: 30 * 1000,
    })),
  })

  const handleSelectInstance = (instanceId: string) => {
    const instance = instances?.find(i => i.id === instanceId)
    setCurrentInstance(instanceId, instance?.name || instance?.displayName || null)
    navigate('/')
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Instances</h1>
          <p className="text-muted-foreground mt-1">
            Select a cluster instance to manage
          </p>
        </div>
        <SkeletonGrid count={6} className="lg:grid-cols-3" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-destructive">
          Failed to load instances
        </p>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    )
  }

  if (!instances || instances.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Instances</h1>
        </div>
        <EmptyState
          preset="custom"
          icon={Server}
          title="No instances available"
          description="No cluster instances have been registered yet. Contact your administrator to add instances."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Server className="h-7 w-7 text-primary" />
            Instances
          </h1>
          <p className="text-muted-foreground mt-1">
            Select a cluster instance to manage
            <span className="ml-2 text-foreground font-medium">
              · {instances.length} available
            </span>
          </p>
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={() => refetch()}
          disabled={isFetching}
          className="shrink-0"
        >
          <RefreshCw className={`h-4 w-4 transition-transform ${isFetching ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {instances.map((instance, index) => (
          <InstanceCard
            key={instance.id}
            instance={instance}
            health={healthQueries[index]?.data}
            onSelect={handleSelectInstance}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center animate-fade-in">
        Status refreshes automatically every 30 seconds
      </p>
    </div>
  )
}
