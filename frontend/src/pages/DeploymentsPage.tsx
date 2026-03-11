import { Link } from 'react-router-dom'
import { useDeployments } from '@/hooks/useDeployments'
import { DeploymentList } from '@/components/deployments/DeploymentList'
import { Button } from '@/components/ui/button'
import { Plus, RefreshCw, Layers } from 'lucide-react'

export function DeploymentsPage() {
  const { data: deployments, isLoading, error, refetch, isFetching } = useDeployments()

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-destructive">
          Failed to load deployments
        </p>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
        <Button onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-heading tracking-tight flex items-center gap-2">
            <Layers className="h-7 w-7 text-cyan-500" />
            Deployments
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your model deployments
            {!isLoading && deployments && deployments.length > 0 && (
              <span className="ml-2 text-foreground font-medium">
                · {deployments.length} active
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            className="shrink-0"
          >
            <RefreshCw className={`h-4 w-4 transition-transform ${isFetching ? 'animate-spin' : ''}`} />
          </Button>

          <Link to="/">
            <Button className="shrink-0">
              <Plus className="mr-2 h-4 w-4" />
              <span className="hidden sm:inline">New Deployment</span>
              <span className="sm:hidden">New</span>
            </Button>
          </Link>
        </div>
      </div>

      <DeploymentList deployments={deployments || []} isLoading={isLoading} />

      {!isLoading && deployments && deployments.length > 0 && (
        <p className="text-xs text-muted-foreground text-center animate-fade-in">
          Status refreshes automatically every 10 seconds
        </p>
      )}
    </div>
  )
}
