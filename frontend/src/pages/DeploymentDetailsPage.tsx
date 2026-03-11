import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useDeployment, useDeleteDeployment } from '@/hooks/useDeployments'
import { useToast } from '@/hooks/useToast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DeploymentStatusBadge } from '@/components/deployments/DeploymentStatusBadge'
import { MetricsTab } from '@/components/metrics'
import { formatRelativeTime, generateAynaUrl } from '@/lib/utils'
import { Loader2, ArrowLeft, Trash2, Copy, Terminal, MessageSquare, Globe } from 'lucide-react'
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
import { ManifestViewer } from '@/components/deployments/ManifestViewer'



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

  // Gateway endpoint (when available)
  const hasGateway = !!deployment.gateway?.endpoint
  const gatewayEndpoint = deployment.gateway?.endpoint
  const gatewayModelName = deployment.gateway?.modelName || deployment.modelId
  const gatewayBaseUrl = gatewayEndpoint
    ? (() => {
        // Parse endpoint to determine URL — omit port 80
        const host = gatewayEndpoint
        const url = host.includes('://') ? host : `http://${host}`
        try {
          const parsed = new URL(url)
          if (parsed.port === '80' || (!parsed.port && parsed.protocol === 'http:')) {
            return `${parsed.protocol}//${parsed.hostname}/v1`
          }
          return `${parsed.protocol}//${parsed.host}/v1`
        } catch {
          return `http://${host}/v1`
        }
      })()
    : undefined

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-slide-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/deployments')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-heading">{deployment.name}</h1>
            <p className="text-muted-foreground">
              Created {formatRelativeTime(deployment.createdAt)}
            </p>
          </div>
        </div>

        <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete
        </Button>
      </div>

      {/* Status Overview */}
      <div className="glass-panel animate-slide-up" style={{ animationDelay: '50ms', animationFillMode: 'both' }}>
        <h2 className="text-lg font-heading mb-4">Status</h2>
        <div className="grid gap-4 sm:grid-cols-5">
          <div>
            <p className="text-label text-slate-500 mb-1">Phase</p>
            <DeploymentStatusBadge phase={deployment.phase} />
          </div>
          <div>
            <p className="text-label text-slate-500 mb-1">Runtime</p>
            <Badge
              variant="secondary"
            >
              {deployment.provider}
            </Badge>
          </div>
          <div>
            <p className="text-label text-slate-500 mb-1">Replicas</p>
            <p className="font-medium">
              {deployment.replicas.ready}/{deployment.replicas.desired} Ready
            </p>
          </div>
          <div>
            <p className="text-label text-slate-500 mb-1">Engine</p>
            <Badge variant="outline">{deployment.engine?.toUpperCase() ?? 'Pending'}</Badge>
          </div>
          <div>
            <p className="text-label text-slate-500 mb-1">Mode</p>
            <p className="font-medium capitalize">{deployment.mode}</p>
          </div>
        </div>
      </div>

      {/* Model Info */}
      <div className="glass-panel animate-slide-up" style={{ animationDelay: '100ms', animationFillMode: 'both' }}>
        <h2 className="text-lg font-heading">Model</h2>
        <p className="text-sm text-muted-foreground mt-1">{deployment.modelId}</p>
      </div>

      {/* Pending Explanation - shown when deployment is Pending */}
      {deployment.phase === 'Pending' && (
        <PendingExplanation
          reasons={pendingReasons?.reasons || []}
          autoscaler={autoscaler}
          isLoading={isPendingReasonsLoading}
        />
      )}

      {/* Access Model */}
      <div className="glass-panel animate-slide-up" style={{ animationDelay: '150ms', animationFillMode: 'both' }}>
        <div className="flex items-center gap-2 mb-1">
          <Terminal className="h-5 w-5" />
          <h2 className="text-lg font-heading">Access Model</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {hasGateway ? 'Access the deployed model through the gateway endpoint' : 'Run this command to access the deployed model locally'}
        </p>
        <div className="space-y-4">
          {hasGateway && gatewayBaseUrl ? (
            <>
              {/* Gateway Endpoint - Primary */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Globe className="h-4 w-4 text-green-500" />
                  Gateway Endpoint
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-xl bg-[#0A0A0A] p-3 text-sm font-mono-code overflow-x-auto">
                    {gatewayBaseUrl}
                  </code>
                  <Button variant="outline" size="icon" onClick={() => {
                    navigator.clipboard.writeText(gatewayBaseUrl)
                    toast({ title: 'Copied to clipboard', description: 'Gateway URL copied' })
                  }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Curl Example */}
              <div className="space-y-2">
                <span className="text-sm font-medium">Example Request</span>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-xl bg-[#0A0A0A] p-3 text-xs font-mono-code overflow-x-auto whitespace-pre-wrap">
                    {`curl ${gatewayBaseUrl}/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${gatewayModelName}", "messages": [{"role": "user", "content": "Hello"}]}'`}
                  </code>
                  <Button variant="outline" size="icon" onClick={() => {
                    navigator.clipboard.writeText(`curl ${gatewayBaseUrl}/chat/completions -H "Content-Type: application/json" -d '{"model": "${gatewayModelName}", "messages": [{"role": "user", "content": "Hello"}]}'`)
                    toast({ title: 'Copied to clipboard', description: 'Curl command copied' })
                  }}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Ayna Integration */}
              <div className="flex flex-wrap gap-2 pt-2 border-t">
                <a href={generateAynaUrl({
                  model: gatewayModelName,
                  provider: 'openai',
                  endpoint: gatewayBaseUrl.replace(/\/v1$/, ''),
                  type: 'chat',
                })}>
                  <Button variant="outline">
                    <MessageSquare className="mr-2 h-4 w-4" />
                    Open in Ayna
                  </Button>
                </a>
              </div>

              {/* Port Forward - Secondary */}
              <details className="pt-2 border-t">
                <summary className="text-sm font-medium cursor-pointer text-muted-foreground hover:text-foreground">
                  Alternative: Port Forward
                </summary>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-xl bg-[#0A0A0A] p-3 text-sm font-mono-code overflow-x-auto">
                      {portForwardCommand}
                    </code>
                    <Button variant="outline" size="icon" onClick={copyPortForwardCommand}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    After running the command, access the model at http://localhost:8000
                  </p>
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <code className="flex-1 rounded-xl bg-[#0A0A0A] p-3 text-sm font-mono-code overflow-x-auto">
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
            </>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="animate-slide-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
        <MetricsTab
          deploymentName={deployment.name}
          namespace={deployment.namespace}
          provider={deployment.provider}
        />
      </div>

      {/* Manifest */}
      <div className="animate-slide-up" style={{ animationDelay: '250ms', animationFillMode: 'both' }}>
        <ManifestViewer
          mode="deployed"
          deploymentName={deployment.name}
          namespace={deployment.namespace}
          provider={deployment.provider}
        />
      </div>

      {/* Logs */}
      <div className="animate-slide-up" style={{ animationDelay: '300ms', animationFillMode: 'both' }}>
        <DeploymentLogs
          deploymentName={deployment.name}
          namespace={deployment.namespace}
        />
      </div>

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
