import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAIConfiguratorStatus, useAIConfiguratorAnalyze } from '@/hooks/useAIConfigurator'
import type { AIConfiguratorResult, AIConfiguratorInput, DetailedClusterCapacity } from '@/lib/api'
import {
  Sparkles,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Cpu,
  Layers,
  Zap,
  Clock,
  Wand2
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface AIConfiguratorPanelProps {
  modelId: string
  detailedCapacity?: DetailedClusterCapacity
  onApplyConfig: (config: AIConfiguratorResult) => void
  onDiscard?: () => void
  className?: string
}

export function AIConfiguratorPanel({
  modelId,
  detailedCapacity,
  onApplyConfig,
  onDiscard,
  className
}: AIConfiguratorPanelProps) {
  const { data: status } = useAIConfiguratorStatus()
  const analyzeMutation = useAIConfiguratorAnalyze()
  const [result, setResult] = useState<AIConfiguratorResult | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [optimizeFor, setOptimizeFor] = useState<'throughput' | 'latency'>('throughput')

  const totalAvailableGpus = detailedCapacity?.availableGpus ?? 0

  // Get a reasonable default GPU type based on cluster info
  const defaultGpuType = detailedCapacity?.totalMemoryGb
    ? `A100-${detailedCapacity.totalMemoryGb}GB`
    : 'A100-80GB'

  const handleAnalyze = async () => {
    // Clear previous results when re-analyzing
    setResult(null)

    const input: AIConfiguratorInput = {
      modelId,
      gpuType: defaultGpuType,
      gpuCount: totalAvailableGpus || 1,
      optimizeFor,
    }

    try {
      const analysisResult = await analyzeMutation.mutateAsync(input)
      setResult(analysisResult)
    } catch {
      // Error state is handled by the mutation's error property
    }
  }

  const handleApply = () => {
    if (result) {
      onApplyConfig(result)
    }
  }

  // Don't render if running in-cluster (AI Configurator is local-only)
  if (status?.runningInCluster) {
    return null
  }

  // Don't render if AI Configurator is not available
  if (!status?.available) {
    return (
      <Card className={cn("border-dashed", className)}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">AI Configurator</CardTitle>
            <Badge variant="outline" className="text-xs">Unavailable</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {status?.error || (
              <>
                AI Configurator is not installed.{' '}
                <a
                  href="https://github.com/ai-dynamo/aiconfigurator"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  View installation instructions
                </a>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={cn("border-primary/20", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">AI Configurator</CardTitle>
            <Badge variant="secondary" className="text-xs">
              NVIDIA
            </Badge>
          </div>
        </div>
        <CardDescription>
          Get optimal inference configuration for your model and GPU setup
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Analysis in Progress */}
        {analyzeMutation.isPending && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="font-medium">Analyzing optimal configuration...</p>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
              <p>📊 Evaluating aggregated vs disaggregated serving modes</p>
              <p>🔧 Testing tensor parallel configurations (TP1, TP2, TP4...)</p>
              <p>⚡ Calculating throughput and latency estimates</p>
              <p>🎯 Finding Pareto-optimal configurations</p>
            </div>
          </div>
        )}

        {/* Analysis Error */}
        {analyzeMutation.isError && !analyzeMutation.isPending && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />
            <div className="text-sm text-destructive">
              {analyzeMutation.error?.message || 'Analysis failed'}
            </div>
          </div>
        )}

        {/* Result Display */}
        {result && (
          <div className="space-y-4">
            {/* Success/Warning Banner */}
            {result.success ? (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                <div className="text-sm text-green-700 dark:text-green-400">
                  Optimal configuration found for {modelId}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5" />
                <div className="text-sm text-yellow-700 dark:text-yellow-400">
                  {result.error || 'Using default configuration'}
                </div>
              </div>
            )}

            {/* Key Recommendations */}
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfigItem
                icon={<Cpu className="h-4 w-4" />}
                label="Tensor Parallelism"
                value={`${result.config.tensorParallelDegree} GPU${result.config.tensorParallelDegree > 1 ? 's' : ''}`}
                tooltip="Number of GPUs to split the model across for parallel inference"
              />
              <ConfigItem
                icon={<Layers className="h-4 w-4" />}
                label="Max Context"
                value={`${result.config.maxModelLen.toLocaleString()} tokens`}
                tooltip="Maximum sequence length (context window) for inference"
              />
              <ConfigItem
                icon={<Zap className="h-4 w-4" />}
                label="Batch Size"
                value={`${result.config.maxBatchSize}`}
                tooltip="Maximum number of requests to batch together"
              />
              <ConfigItem
                icon={<Cpu className="h-4 w-4" />}
                label="GPU Memory"
                value={`${Math.round(result.config.gpuMemoryUtilization * 100)}%`}
                tooltip="Fraction of GPU memory to allocate for KV cache"
              />
            </div>

            {/* Estimated Performance */}
            {result.estimatedPerformance && (
              <div className="pt-2 border-t">
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  Estimated Performance
                </h4>
                <div className="grid gap-2 sm:grid-cols-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Throughput</span>
                    <span className="font-mono">{result.estimatedPerformance.throughputTokensPerSec.toLocaleString()} tok/s</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">P50 Latency</span>
                    <span className="font-mono">{result.estimatedPerformance.latencyP50Ms.toFixed(1)} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">P99 Latency</span>
                    <span className="font-mono">{result.estimatedPerformance.latencyP99Ms.toFixed(1)} ms</span>
                  </div>
                </div>
              </div>
            )}

            {/* Mode and Replicas */}
            <div className="flex items-center gap-4 text-sm">
              <Badge variant="outline">{result.mode}</Badge>
              <span className="text-muted-foreground">
                {result.replicas} replica{result.replicas > 1 ? 's' : ''}
              </span>
              {result.config.quantization && (
                <Badge variant="secondary">{result.config.quantization.toUpperCase()}</Badge>
              )}
            </div>

            {/* Warnings */}
            {result.warnings && result.warnings.length > 0 && (
              <div className="space-y-1">
                {result.warnings.map((warning, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="h-3 w-3 mt-0.5 text-yellow-500" />
                    {warning}
                  </div>
                ))}
              </div>
            )}

            {/* Advanced Details Toggle */}
            {(result.config.pipelineParallelDegree || result.config.prefillTensorParallel) && (
              <button
                type="button"
                onClick={() => setShowDetails(!showDetails)}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className={cn(
                  "h-4 w-4 transition-transform",
                  showDetails && "rotate-180"
                )} />
                {showDetails ? 'Hide' : 'Show'} advanced details
              </button>
            )}

            {showDetails && (
              <div className="pt-2 border-t space-y-2 text-sm">
                {result.config.pipelineParallelDegree && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pipeline Parallel</span>
                    <span>{result.config.pipelineParallelDegree}</span>
                  </div>
                )}
                {result.config.maxNumSeqs && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Concurrent Seqs</span>
                    <span>{result.config.maxNumSeqs}</span>
                  </div>
                )}
                {result.mode === 'disaggregated' && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Prefill TP</span>
                      <span>{result.config.prefillTensorParallel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Decode TP</span>
                      <span>{result.config.decodeTensorParallel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Prefill Replicas</span>
                      <span>{result.config.prefillReplicas}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Decode Replicas</span>
                      <span>{result.config.decodeReplicas}</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <Button type="button" onClick={handleApply} className="flex-1">
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Apply Configuration
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleAnalyze}
                disabled={analyzeMutation.isPending}
              >
                {analyzeMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Re-analyze'
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setResult(null)
                  onDiscard?.()
                }}
                className="text-muted-foreground"
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        {/* Initial State - Optimization Target Selection */}
        {!result && !analyzeMutation.isPending && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Optimize for</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOptimizeFor('throughput')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    optimizeFor === 'throughput'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  )}
                >
                  <Zap className="h-4 w-4" />
                  Throughput
                </button>
                <button
                  type="button"
                  onClick={() => setOptimizeFor('latency')}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    optimizeFor === 'latency'
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80 text-muted-foreground"
                  )}
                >
                  <Clock className="h-4 w-4" />
                  Latency
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {optimizeFor === 'throughput'
                  ? 'Maximize tokens/second for batch processing workloads'
                  : 'Minimize time-to-first-token for interactive/chat workloads'}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              Click <strong>Optimize</strong> to analyze your model ({modelId}) with{' '}
              {totalAvailableGpus > 0 ? (
                <>{totalAvailableGpus} available GPU{totalAvailableGpus > 1 ? 's' : ''}</>
              ) : (
                'your cluster GPUs'
              )}.
            </p>
            <Button
              type="button"
              className="w-full"
              onClick={handleAnalyze}
            >
              <Wand2 className="h-4 w-4 mr-2" />
              Optimize
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface ConfigItemProps {
  icon: React.ReactNode
  label: string
  value: string
  tooltip: string
}

function ConfigItem({ icon, label, value, tooltip }: ConfigItemProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50 cursor-help">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {icon}
              {label}
            </div>
            <span className="font-medium text-sm">{value}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
