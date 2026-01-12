import { useMemo } from 'react'
import { DollarSign, TrendingUp, Info, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { NodePoolInfo, CostBreakdown, CloudProvider } from '@/lib/api'

// GPU pricing data (embedded for client-side calculation)
// This mirrors the backend pricing for instant UI updates
const GPU_PRICING: Record<string, { hourlyRate: { aws?: number; azure?: number; gcp?: number }; memoryGb: number }> = {
  'H100-80GB': { hourlyRate: { aws: 5.50, azure: 5.20, gcp: 5.35 }, memoryGb: 80 },
  'A100-80GB': { hourlyRate: { aws: 4.10, azure: 3.67, gcp: 3.93 }, memoryGb: 80 },
  'A100-40GB': { hourlyRate: { aws: 3.40, azure: 3.06, gcp: 3.22 }, memoryGb: 40 },
  'L40S': { hourlyRate: { aws: 1.85, azure: 1.70, gcp: 1.75 }, memoryGb: 48 },
  'L4': { hourlyRate: { aws: 0.81, azure: 0.75, gcp: 0.70 }, memoryGb: 24 },
  'A10G': { hourlyRate: { aws: 1.01, azure: 0.90, gcp: 0.95 }, memoryGb: 24 },
  'A10': { hourlyRate: { aws: 1.10, azure: 1.00, gcp: 1.05 }, memoryGb: 24 },
  'T4': { hourlyRate: { aws: 0.53, azure: 0.45, gcp: 0.35 }, memoryGb: 16 },
  'V100': { hourlyRate: { aws: 3.06, azure: 2.75, gcp: 2.48 }, memoryGb: 32 },
}

// GPU model aliases for normalization
const GPU_ALIASES: Record<string, string> = {
  'NVIDIA-H100-80GB-HBM3': 'H100-80GB',
  'NVIDIA-H100-SXM5-80GB': 'H100-80GB',
  'NVIDIA-H100-PCIe': 'H100-80GB',
  'H100': 'H100-80GB',
  'NVIDIA-A100-SXM4-80GB': 'A100-80GB',
  'NVIDIA-A100-80GB-PCIe': 'A100-80GB',
  'NVIDIA-A100-SXM4-40GB': 'A100-40GB',
  'NVIDIA-A100-PCIE-40GB': 'A100-40GB',
  'A100': 'A100-40GB',
  'NVIDIA-L40S': 'L40S',
  'NVIDIA-L4': 'L4',
  'NVIDIA-A10G': 'A10G',
  'NVIDIA-A10': 'A10',
  'Tesla-T4': 'T4',
  'NVIDIA-Tesla-T4': 'T4',
  'Tesla-V100-SXM2-16GB': 'V100',
  'Tesla-V100-SXM2-32GB': 'V100',
  'NVIDIA-V100': 'V100',
}

const HOURS_PER_MONTH = 730

/**
 * Normalize GPU model name from Kubernetes label to pricing key
 */
function normalizeGpuModel(gpuLabel: string | undefined): string {
  if (!gpuLabel) return 'A100-40GB' // Default

  // Check direct match
  if (GPU_PRICING[gpuLabel]) return gpuLabel

  // Check aliases
  if (GPU_ALIASES[gpuLabel]) return GPU_ALIASES[gpuLabel]

  // Try to find partial match
  for (const [alias, normalized] of Object.entries(GPU_ALIASES)) {
    if (gpuLabel.toLowerCase().includes(alias.toLowerCase())) {
      return normalized
    }
  }

  // Try to extract from common patterns
  const gpuFamilies = ['H100', 'A100', 'L40S', 'L4', 'A10G', 'A10', 'T4', 'V100']
  for (const family of gpuFamilies) {
    if (gpuLabel.toUpperCase().includes(family)) {
      // Check for memory suffix
      const memMatch = gpuLabel.match(/(\d+)\s*GB/i)
      if (memMatch) {
        const withMem = `${family}-${memMatch[1]}GB`
        if (GPU_PRICING[withMem]) return withMem
      }
      // Return first matching model
      for (const model of Object.keys(GPU_PRICING)) {
        if (model.startsWith(family)) return model
      }
    }
  }

  return 'A100-40GB' // Default fallback
}

/**
 * Calculate cost estimate for a given configuration
 */
function calculateCost(gpuModel: string, gpuCount: number, replicas: number): CostBreakdown | null {
  const normalizedModel = normalizeGpuModel(gpuModel)
  const pricing = GPU_PRICING[normalizedModel]

  if (!pricing) return null

  const totalGpus = gpuCount * replicas
  const rates = [pricing.hourlyRate.aws, pricing.hourlyRate.azure, pricing.hourlyRate.gcp].filter(
    (r): r is number => r !== undefined && r > 0
  )
  const avgRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0

  const hourly = avgRate * totalGpus
  const monthly = hourly * HOURS_PER_MONTH

  const byProvider: { provider: CloudProvider; hourly: number; monthly: number }[] = []
  if (pricing.hourlyRate.aws) byProvider.push({ provider: 'aws', hourly: pricing.hourlyRate.aws * totalGpus, monthly: pricing.hourlyRate.aws * totalGpus * HOURS_PER_MONTH })
  if (pricing.hourlyRate.azure) byProvider.push({ provider: 'azure', hourly: pricing.hourlyRate.azure * totalGpus, monthly: pricing.hourlyRate.azure * totalGpus * HOURS_PER_MONTH })
  if (pricing.hourlyRate.gcp) byProvider.push({ provider: 'gcp', hourly: pricing.hourlyRate.gcp * totalGpus, monthly: pricing.hourlyRate.gcp * totalGpus * HOURS_PER_MONTH })

  return {
    estimate: {
      hourly: Math.round(hourly * 100) / 100,
      monthly: Math.round(monthly * 100) / 100,
      currency: 'USD',
      source: 'static',
      confidence: byProvider.length >= 2 ? 'high' : 'medium',
    },
    perGpu: {
      hourly: Math.round(avgRate * 100) / 100,
      monthly: Math.round(avgRate * HOURS_PER_MONTH * 100) / 100,
    },
    totalGpus,
    gpuModel,
    normalizedGpuModel: normalizedModel,
    byProvider,
    notes: [
      'Prices are approximate on-demand rates',
      'Spot instances can be 60-80% cheaper',
    ],
  }
}

interface CostEstimateProps {
  /** Node pools with GPU info */
  nodePools?: NodePoolInfo[]
  /** Number of GPUs per replica */
  gpuCount: number
  /** Number of replicas */
  replicas: number
  /** Show compact version */
  compact?: boolean
  /** Additional CSS class */
  className?: string
}

/**
 * Display cost estimates for GPU deployments
 */
export function CostEstimate({
  nodePools,
  gpuCount,
  replicas,
  compact = false,
  className = '',
}: CostEstimateProps) {
  // Calculate costs for each node pool
  const poolCosts = useMemo(() => {
    if (!nodePools || nodePools.length === 0) return []

    return nodePools
      .filter((pool) => pool.gpuModel)
      .map((pool) => ({
        pool,
        cost: calculateCost(pool.gpuModel!, gpuCount, replicas),
      }))
      .filter((item) => item.cost !== null)
  }, [nodePools, gpuCount, replicas])

  // If no pools with GPU info, show nothing
  if (poolCosts.length === 0) {
    return null
  }

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount)
  }

  // Compact view - just show primary estimate
  if (compact) {
    const primaryCost = poolCosts[0]?.cost
    if (!primaryCost) return null

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={`flex items-center gap-1.5 text-sm text-muted-foreground ${className}`}>
              <DollarSign className="h-4 w-4" />
              <span>
                ~{formatCurrency(primaryCost.estimate.hourly)}/hr
              </span>
              <span className="text-xs">
                ({formatCurrency(primaryCost.estimate.monthly)}/mo)
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <div className="space-y-1 text-xs">
              <p className="font-medium">
                {primaryCost.totalGpus} × {primaryCost.normalizedGpuModel}
              </p>
              <p>Based on average cloud provider rates</p>
              <p className="text-muted-foreground">Spot instances can be 60-80% cheaper</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Full view - show per-pool breakdown
  return (
    <Card className={className} data-testid="cost-estimate-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="h-4 w-4" />
          Estimated Cost
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                <p className="text-xs">
                  Estimates based on average on-demand cloud rates.
                  Actual costs vary by provider, region, and commitment level.
                  Spot instances can save 60-80%.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {poolCosts.map(({ pool, cost }) => (
          <div key={pool.name} className="space-y-2">
            {poolCosts.length > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{pool.name}</span>
                <Badge variant="outline" className="text-xs">
                  {cost!.normalizedGpuModel}
                </Badge>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Hourly</p>
                <p className="text-lg font-semibold" data-testid="hourly-cost">
                  {formatCurrency(cost!.estimate.hourly)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Monthly (24/7)</p>
                <p className="text-lg font-semibold" data-testid="monthly-cost">
                  {formatCurrency(cost!.estimate.monthly)}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              <span>
                {cost!.totalGpus} GPU{cost!.totalGpus > 1 ? 's' : ''} × {formatCurrency(cost!.perGpu.hourly)}/GPU/hr
              </span>
            </div>

            {/* Provider breakdown */}
            {cost!.byProvider && cost!.byProvider.length > 0 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-1.5">By Provider</p>
                <div className="flex flex-wrap gap-2">
                  {cost!.byProvider.map((provider) => (
                    <Badge key={provider.provider} variant="secondary" className="text-xs font-normal">
                      {provider.provider.toUpperCase()}: {formatCurrency(provider.hourly)}/hr
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Low confidence warning */}
            {cost!.estimate.confidence === 'low' && (
              <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
                <span>Limited pricing data available for this GPU</span>
              </div>
            )}
          </div>
        ))}

        {/* Notes */}
        <div className="pt-2 border-t text-xs text-muted-foreground space-y-0.5">
          <p>• Spot/preemptible instances can save 60-80%</p>
          <p>• Reserved instances (1-3 yr) can save 30-60%</p>
        </div>
      </CardContent>
    </Card>
  )
}

export default CostEstimate
