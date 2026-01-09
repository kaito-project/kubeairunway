import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { SkeletonTable } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DeploymentStatusBadge } from './DeploymentStatusBadge'
import { useDeleteDeployment, type DeploymentStatus } from '@/hooks/useDeployments'
import { useToast } from '@/hooks/useToast'
import { formatRelativeTime, generateAynaUrl } from '@/lib/utils'
import { Eye, Trash2, MessageSquare } from 'lucide-react'

interface DeploymentListProps {
  deployments: DeploymentStatus[]
  isLoading?: boolean
}

/**
 * Format replica status for display
 * For disaggregated mode, shows "P: x/y, D: x/y" format
 * For aggregated mode, shows "x/y" format
 */
function formatReplicaStatus(deployment: DeploymentStatus): string {
  if (deployment.mode === 'disaggregated' && deployment.prefillReplicas && deployment.decodeReplicas) {
    const pReady = deployment.prefillReplicas.ready
    const pDesired = deployment.prefillReplicas.desired
    const dReady = deployment.decodeReplicas.ready
    const dDesired = deployment.decodeReplicas.desired
    return `P: ${pReady}/${pDesired}, D: ${dReady}/${dDesired}`
  }
  return `${deployment.replicas.ready}/${deployment.replicas.desired}`
}

export function DeploymentList({ deployments, isLoading }: DeploymentListProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const deleteDeployment = useDeleteDeployment()
  const [deleteTarget, setDeleteTarget] = useState<DeploymentStatus | null>(null)

  const handleDelete = async () => {
    if (!deleteTarget) return

    try {
      await deleteDeployment.mutateAsync({
        name: deleteTarget.name,
        namespace: deleteTarget.namespace,
      })
      toast({
        title: 'Deployment Deleted',
        description: `${deleteTarget.name} has been deleted`,
        variant: 'success',
      })
      setDeleteTarget(null)
    } catch (error) {
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Failed to delete deployment',
        variant: 'destructive',
      })
    }
  }

  // Loading state with skeleton
  if (isLoading) {
    return <SkeletonTable rows={5} columns={7} className="rounded-lg border" />
  }

  // Empty state
  if (deployments.length === 0) {
    return (
      <EmptyState
        preset="no-deployments"
        title="No deployments yet"
        description="Deploy your first model to start serving inference requests. Choose from our curated model library or search HuggingFace."
        actionLabel="Browse Models"
        onAction={() => navigate('/')}
      />
    )
  }

  return (
    <>
      {/* Mobile Card View */}
      <div className="md:hidden space-y-3">
        {deployments.map((deployment, index) => (
          <div
            key={deployment.name}
            className="rounded-lg border shadow-soft-sm p-4 space-y-3 bg-card"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {/* Header: Name and Status */}
            <div className="flex items-start justify-between gap-2">
              <Link
                to={`/deployments/${deployment.name}?namespace=${deployment.namespace}`}
                className="font-medium hover:text-primary transition-colors text-base break-all"
              >
                {deployment.name}
              </Link>
              <DeploymentStatusBadge phase={deployment.phase} />
            </div>

            {/* Model */}
            <p className="text-sm text-muted-foreground break-all">
              {deployment.modelId}
            </p>

            {/* Badges Row */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {deployment.engine === 'llamacpp' ? 'Llama.cpp' : deployment.engine.toUpperCase()}
              </Badge>
              <Badge
                variant="secondary"
                className={
                  deployment.provider === 'kuberay'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                    : deployment.provider === 'kaito'
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                    : 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                }
              >
                {deployment.provider === 'kuberay' ? 'KubeRay' : deployment.provider === 'kaito' ? 'KAITO' : 'Dynamo'}
              </Badge>
              {deployment.mode === 'disaggregated' && (
                <Badge variant="secondary" className="text-xs">P/D</Badge>
              )}
            </div>

            {/* Meta Row */}
            <div className="flex items-center justify-between text-sm text-muted-foreground pt-1 border-t">
              <span title={deployment.mode === 'disaggregated' ? 'Prefill / Decode replicas' : 'Worker replicas'}>
                Replicas: {formatReplicaStatus(deployment)}
              </span>
              <span>{formatRelativeTime(deployment.createdAt)}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t">
              <Link to={`/deployments/${deployment.name}?namespace=${deployment.namespace}`} className="flex-1">
                <Button size="sm" variant="outline" className="w-full">
                  <Eye className="h-4 w-4 mr-2" />
                  View
                </Button>
              </Link>
              <a
                href={generateAynaUrl({
                  model: deployment.modelId,
                  provider: 'openai',
                  endpoint: 'http://localhost:8000',
                  type: 'chat',
                })}
                className="flex-1"
              >
                <Button size="sm" variant="outline" className="w-full">
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Chat
                </Button>
              </a>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeleteTarget(deployment)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block rounded-lg border shadow-soft-sm overflow-x-auto">
        <table className="w-full min-w-[600px]">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">Name</th>
              <th className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">Model</th>
              <th className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap hidden lg:table-cell">Engine</th>
              <th className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap hidden lg:table-cell">Runtime</th>
              <th className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap hidden xl:table-cell">Replicas</th>
              <th className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap">Age</th>
              <th className="px-4 py-3 text-right text-sm font-medium whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((deployment, index) => (
              <tr
                key={deployment.name}
                className="border-b last:border-0 hover:bg-muted/30 transition-colors duration-150"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <td className="px-4 py-3">
                  <Link
                    to={`/deployments/${deployment.name}?namespace=${deployment.namespace}`}
                    className="font-medium hover:text-primary transition-colors whitespace-nowrap"
                  >
                    {deployment.name}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
                    {deployment.modelId}
                  </span>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <Badge variant="outline">
                    {deployment.engine === 'llamacpp' ? 'Llama.cpp' : deployment.engine.toUpperCase()}
                  </Badge>
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <Badge
                    variant="secondary"
                    className={
                      deployment.provider === 'kuberay'
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                        : deployment.provider === 'kaito'
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                        : 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                    }
                  >
                    {deployment.provider === 'kuberay' ? 'KubeRay' : deployment.provider === 'kaito' ? 'KAITO' : 'Dynamo'}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <DeploymentStatusBadge phase={deployment.phase} />
                </td>
                <td className="px-4 py-3 hidden xl:table-cell">
                  <span className="text-sm whitespace-nowrap" title={deployment.mode === 'disaggregated' ? 'Prefill / Decode replicas' : 'Worker replicas'}>
                    {formatReplicaStatus(deployment)}
                  </span>
                  {deployment.mode === 'disaggregated' && (
                    <Badge variant="secondary" className="ml-2 text-xs">P/D</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatRelativeTime(deployment.createdAt)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link to={`/deployments/${deployment.name}?namespace=${deployment.namespace}`}>
                      <Button size="sm" variant="ghost" title="View details">
                        <Eye className="h-4 w-4" />
                      </Button>
                    </Link>
                    <a
                      href={generateAynaUrl({
                        model: deployment.modelId,
                        provider: 'openai',
                        endpoint: 'http://localhost:8000',
                        type: 'chat',
                      })}
                      title="Open in Ayna"
                    >
                      <Button size="sm" variant="ghost">
                        <MessageSquare className="h-4 w-4" />
                      </Button>
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(deployment)}
                      title="Delete deployment"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Deployment</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              loading={deleteDeployment.isProcessing}
              loadingText="Deleting..."
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
