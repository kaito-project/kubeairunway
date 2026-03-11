import { cn } from '@/lib/utils'
import type { ComputedMetric } from '@/hooks/useMetrics'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface MetricCardProps {
  metric: ComputedMetric
  className?: string
}

/**
 * Display a single metric value with its name and formatted value
 */
export function MetricCard({ metric, className }: MetricCardProps) {
  const TrendIcon = metric.trend === 'up' 
    ? TrendingUp 
    : metric.trend === 'down' 
      ? TrendingDown 
      : Minus

  const trendColor = metric.trend === 'up'
    ? 'text-green-500'
    : metric.trend === 'down'
      ? 'text-red-500'
      : 'text-muted-foreground'

  return (
    <div className={cn("glass-panel border-l-[3px] border-l-primary", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-label text-slate-500">
            {metric.displayName}
          </p>
          <p className="text-3xl font-bold tabular-nums">
            {metric.formattedValue}
          </p>
        </div>
        {metric.trend && (
          <TrendIcon className={cn("h-4 w-4", trendColor)} />
        )}
      </div>
    </div>
  )
}

interface MetricGridProps {
  metrics: ComputedMetric[]
  className?: string
}

/**
 * Grid layout for displaying multiple metrics
 */
export function MetricGrid({ metrics, className }: MetricGridProps) {
  if (metrics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No metrics available in this category
      </p>
    )
  }

  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {metrics.map((metric, index) => (
        <div
          key={metric.name}
          className="animate-slide-up"
          style={{ animationDelay: `${Math.min(index, 12) * 50}ms`, animationFillMode: 'both' }}
        >
          <MetricCard metric={metric} />
        </div>
      ))}
    </div>
  )
}
