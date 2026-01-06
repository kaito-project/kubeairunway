import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useDeployment, useDeleteDeployment } from '@/hooks/useDeployments'
import { useToast } from '@/hooks/useToast'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DeploymentStatusBadge } from '@/components/deployments/DeploymentStatusBadge'
import { MetricsTab } from '@/components/metrics'
import { formatRelativeTime, generateAynaUrl } from '@/lib/utils'
import { Loader2, ArrowLeft, Trash2, Copy, Terminal, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAutoscalerDetection, usePendingReasons } from '@/hooks/useAutoscaler'
import { PendingExplanation } from '@/components/deployments/PendingExplanation'
import { DeploymentLogs } from '@/components/deployments/DeploymentLogs'

export function DeploymentDetailsPage() {
  const { name } = useParams<{ name: string }>()
  const [searchParams] = useSearchParams()
  const namespace = searchParams.get('namespace') || undefined
  const navigate = useNavigate()
  const { toast } = useToast()
  const deleteDeployment = useDeleteDeployment()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const { data: deployment, isLoading, error } = useDeployment(name, namespace)

  // Autoscaler detection and pending reasons (only fetch when deployment is Pending)
  const { data: autoscaler } = useAutoscalerDetection()
  const { data: pendingReasons, isLoading: isPendingReasonsLoading } = usePendingReasons(
    deployment?.name || '',
    deployment?.namespace || '',
    deployment?.phase === 'Pending'
  )

  const handleDelete = async () => {
    if (!deployment) return

    try {
      await deleteDeployment.mutateAsync({
        name: deployment.name,
        namespace: deployment.namespace,
      })
      toast({
        title: 'Deployment Deleted',
        description: `${deployment.name} has been deleted`,
        variant: 'success',
      })
      navigate('/deployments')
    } catch (error) {
      toast({
        title: 'Delete Failed',
        description: error instanceof Error ? error.message : 'Failed to delete deployment',
        variant: 'destructive',
      })
    }
  }

  const copyPortForwardCommand = () => {
    if (!deployment) return
    // Parse frontendService which may include port (e.g., "name:8000" or "name-vllm:8000")
    const [serviceName, servicePort] = (deployment.frontendService || `${deployment.name}-frontend:8000`).split(':')
    const command = `kubectl port-forward svc/${serviceName} 8000:${servicePort || '8000'} -n ${deployment.namespace}`
    navigator.clipboard.writeText(command)
    toast({
      title: 'Copied to clipboard',
      description: 'Port-forward command copied',
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !deployment) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-destructive">
          Deployment not found
        </p>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          The requested deployment could not be found
        </p>
        <Button onClick={() => navigate('/deployments')}>
          Back to Deployments
        </Button>
      </div>
    )
  }

  // Parse frontendService which may include port (e.g., "name:5000" or "name-vllm:8000")
  const [serviceName, servicePort] = (deployment.frontendService || `${deployment.name}-frontend:8000`).split(':')
  const portForwardCommand = `kubectl port-forward svc/${serviceName} 8000:${servicePort || '8000'} -n ${deployment.namespace}`

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/deployments')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{deployment.name}</h1>
            <p className="text-muted-foreground">
              {deployment.namespace} • Created {formatRelativeTime(deployment.createdAt)}
            </p>
          </div>
        </div>

        <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>

      {/* Status Overview */}
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-5">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Phase</p>
              <DeploymentStatusBadge phase={deployment.phase} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Runtime</p>
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
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Replicas</p>
              <p className="font-medium">
                {deployment.replicas.ready}/{deployment.replicas.desired} Ready
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Engine</p>
              <Badge variant="outline">{deployment.engine.toUpperCase()}</Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Mode</p>
              <p className="font-medium capitalize">{deployment.mode}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Model Info */}
      <Card>
        <CardHeader>
          <CardTitle>Model</CardTitle>
          <CardDescription>{deployment.modelId}</CardDescription>
        </CardHeader>
      </Card>

      {/* Pending Explanation - shown when deployment is Pending */}
      {deployment.phase === 'Pending' && (
        <PendingExplanation
          reasons={pendingReasons?.reasons || []}
          autoscaler={autoscaler}
          isLoading={isPendingReasonsLoading}
        />
      )}

      {/* Port Forward Instructions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Terminal className="h-5 w-5" />
            <CardTitle>Access Model</CardTitle>
          </div>
          <CardDescription>
            Run this command to access the deployed model locally
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded-lg bg-muted p-3 text-sm font-mono overflow-x-auto">
              {portForwardCommand}
            </code>
            <Button variant="outline" size="icon" onClick={copyPortForwardCommand}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            After running the command, access the model at http://localhost:8000
          </p>

          {/* Ayna Integration */}
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t">
            <a href={generateAynaUrl({
              model: deployment.modelId,
              provider: 'openai',
              endpoint: 'http://localhost:8000',
              type: 'chat',
            })}>
              <Button variant="outline">
                <MessageSquare className="mr-2 h-4 w-4" />
                Open in Ayna
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Metrics */}
      <MetricsTab
        deploymentName={deployment.name}
        namespace={deployment.namespace}
        provider={deployment.provider}
      />

      {/* Logs */}
      <DeploymentLogs
        deploymentName={deployment.name}
        namespace={deployment.namespace}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Deployment</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{deployment.name}</strong>?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteDeployment.isPending}
            >
              {deleteDeployment.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
