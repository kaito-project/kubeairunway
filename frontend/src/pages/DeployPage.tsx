import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useModel, useHfModel } from '@/hooks/useModels'
import { useAutoscalerDetection, useDetailedCapacity } from '@/hooks/useAutoscaler'
import { useRuntimesStatus } from '@/hooks/useRuntimes'
import { DeploymentForm } from '@/components/deployments/DeploymentForm'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, ArrowLeft, Cpu, HardDrive, Layers, ExternalLink } from 'lucide-react'
import { GpuFitIndicator } from '@/components/models/GpuFitIndicator'

export function DeployPage() {
  const { modelId } = useParams<{ modelId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const decodedModelId = modelId ? decodeURIComponent(modelId) : undefined
  const isHfSource = searchParams.get('source') === 'hf'

  // Use appropriate hook based on source
  const localModelQuery = useModel(isHfSource ? undefined : decodedModelId)
  const hfModelQuery = useHfModel(isHfSource ? decodedModelId : undefined)

  const { data: model, isLoading: modelLoading, error } = isHfSource ? hfModelQuery : localModelQuery
  const { data: detailedCapacity } = useDetailedCapacity()
  const { data: autoscaler } = useAutoscalerDetection()
  const { data: runtimesData, isLoading: runtimesLoading } = useRuntimesStatus()

  // Wait for both model and runtimes to load before showing the form
  // This ensures the runtime selector is visible when the form renders
  if (modelLoading || runtimesLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !model) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-destructive">
          Model not found
        </p>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          The requested model could not be found
        </p>
        <Button onClick={() => navigate('/')}>
          Back to Catalog
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Deploy Model</h1>
          <p className="text-muted-foreground mt-1">
            Configure and deploy {model.name}
          </p>
        </div>
      </div>

      {/* Model Summary Card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle>{model.name}</CardTitle>
                {model.fromHfSearch && (
                  <a
                    href={`https://huggingface.co/${model.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
              <CardDescription>{model.id}</CardDescription>
              {model.gated && (
                <Badge variant="outline" className="mt-2 text-yellow-600 border-yellow-500">
                  Gated Model
                </Badge>
              )}
            </div>
            <Badge variant="outline" className="text-lg px-3 py-1">
              {model.size}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">{model.description}</p>

          <div className="flex flex-wrap gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Cpu className="h-4 w-4" />
              {model.estimatedGpuMemory ? (
                  <div className="flex items-center gap-2">
                    <span>GPU: ~{model.estimatedGpuMemory}</span>
                    {detailedCapacity?.totalMemoryGb && model.estimatedGpuMemoryGb && (
                      <GpuFitIndicator
                        estimatedGpuMemoryGb={model.estimatedGpuMemoryGb}
                        clusterCapacityGb={detailedCapacity.totalMemoryGb}
                      />
                    )}
                  </div>
              ) : (
                <span>GPU: {model.minGpuMemory || 'N/A'}</span>
              )}
            </div>

            {model.contextLength && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Layers className="h-4 w-4" />
                <span>Context: {model.contextLength.toLocaleString()}</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              <span className="capitalize">{model.task.replace('-', ' ')}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-4">
            {model.supportedEngines.map((engine) => (
              <Badge key={engine} variant="secondary">
                {engine.toUpperCase()}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Deployment Form */}
      <DeploymentForm
        model={model}
        detailedCapacity={detailedCapacity}
        autoscaler={autoscaler}
        runtimes={runtimesData?.runtimes}
      />
    </div>
  )
}
