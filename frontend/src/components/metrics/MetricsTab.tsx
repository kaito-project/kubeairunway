import { useState } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MetricGrid } from './MetricCard'
import { MetricsUnavailable } from './MetricsUnavailable'
import { useMetrics, type ComputedMetrics } from '@/hooks/useMetrics'
import { RefreshCw, Pause, Play, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricsTabProps {
  deploymentName: string
  namespace: string
  provider: string
  className?: string
}

type MetricCategory = 'all' | 'queue' | 'latency' | 'throughput' | 'cache' | 'errors'

const categoryLabels: Record<MetricCategory, string> = {
  all: 'All',
  queue: 'Queue',
  latency: 'Latency',
  throughput: 'Throughput',
  cache: 'Cache',
  errors: 'Errors',
}

const categoryIcons: Record<MetricCategory, string> = {
  all: '📊',
  queue: '📋',
  latency: '⏱️',
  throughput: '🚀',
  cache: '💾',
  errors: '⚠️',
}

/**
 * Format a date for display
 */
function formatLastUpdated(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  return date.toLocaleTimeString()
}

/**
 * Get available categories from metrics
 */
function getAvailableCategories(metrics: ComputedMetrics | undefined): MetricCategory[] {
  if (!metrics?.available || metrics.metrics.length === 0) {
    return ['all']
  }

  const categories = new Set<MetricCategory>(['all'])
  for (const metric of metrics.metrics) {
    categories.add(metric.category)
  }

  // Return in consistent order
  const order: MetricCategory[] = ['all', 'queue', 'latency', 'throughput', 'cache', 'errors']
  return order.filter((cat) => categories.has(cat))
}

/**
 * Metrics display component with category tabs and auto-refresh
 */
export function MetricsTab({ deploymentName, namespace, provider, className }: MetricsTabProps) {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [activeCategory, setActiveCategory] = useState<MetricCategory>('all')

  const { metrics, isLoading, error, refetch, dataUpdatedAt } = useMetrics(
    deploymentName,
    namespace,
    provider,
    {
      enabled: true,
      refetchInterval: autoRefresh ? 10000 : undefined,
    }
  )

  const availableCategories = getAvailableCategories(metrics)

  // Reset to 'all' if current category is not available
  if (!availableCategories.includes(activeCategory)) {
    setActiveCategory('all')
  }

  const handleRefresh = () => {
    refetch()
  }

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh)
  }

  return (
    <div className={cn("glass-panel", className)}>
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            <h2 className="text-lg font-heading">Metrics</h2>
          </div>
          <div className="flex items-center gap-2">
            {metrics?.available && (
              <span className="text-xs text-muted-foreground">
                Updated {formatLastUpdated(new Date(dataUpdatedAt))}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={toggleAutoRefresh}
              className={cn(
                autoRefresh && "text-green-500 border-green-500/50"
              )}
            >
              {autoRefresh ? (
                <>
                  <Pause className="h-3 w-3 mr-1" />
                  Auto
                </>
              ) : (
                <>
                  <Play className="h-3 w-3 mr-1" />
                  Paused
                </>
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time inference metrics from the deployment
        </p>
      </div>
      <div>
        {/* Show unavailable state */}
        {(isLoading && !metrics) && (
          <MetricsUnavailable isLoading />
        )}

        {(!isLoading && (error || !metrics?.available)) && (
          <MetricsUnavailable 
            error={metrics?.error || (error as Error)?.message}
            runningOffCluster={metrics?.runningOffCluster}
          />
        )}

        {/* Show metrics when available */}
        {metrics?.available && (
          <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as MetricCategory)}>
            <TabsList className="mb-4">
              {availableCategories.map((category) => {
                const count = category === 'all'
                  ? metrics.metrics.length
                  : metrics.metrics.filter((m) => m.category === category).length

                return (
                  <TabsTrigger key={category} value={category}>
                    <span className="mr-1">{categoryIcons[category]}</span>
                    {categoryLabels[category]}
                    <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-xs">
                      {count}
                    </Badge>
                  </TabsTrigger>
                )
              })}
            </TabsList>

            {availableCategories.map((category) => (
              <TabsContent key={category} value={category}>
                <MetricGrid
                  metrics={
                    category === 'all'
                      ? metrics.metrics
                      : metrics.metrics.filter((m) => m.category === category)
                  }
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>
    </div>
  )
}
