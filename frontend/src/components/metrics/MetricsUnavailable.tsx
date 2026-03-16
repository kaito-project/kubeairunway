import { AlertCircle, Cloud, Loader2, Server } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricsUnavailableProps {
  error?: string
  isLoading?: boolean
  runningOffCluster?: boolean
  className?: string
}

/**
 * Component to display when metrics are not available
 */
export function MetricsUnavailable({ error, isLoading, runningOffCluster, className }: MetricsUnavailableProps) {
  if (isLoading) {
    return (
      <div className={cn("glass-panel", className)}>
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
          <p className="text-sm text-muted-foreground">
            Loading metrics...
          </p>
        </div>
      </div>
    )
  }

  // Check if running off-cluster first (explicit flag from backend)
  if (runningOffCluster) {
    return (
      <div className={cn("glass-panel", className)}>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Server className="h-8 w-8 text-blue-500 mb-4" />
          <h3 className="font-semibold mb-1">Running in Local Mode</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            AIRunway is running in local mode.
          </p>
          <p className="text-xs text-muted-foreground mt-4 max-w-md bg-[#0A0A0A] p-3 rounded-xl">
            💡 <strong>To enable metrics:</strong> Deploy AIRunway in production to enable metrics. 
            Metrics are available when running in production mode.
          </p>
        </div>
      </div>
    )
  }

  // Determine the type of error for better messaging
  const isNetworkError = error?.includes('Unable to connect') || 
                         error?.includes('DNS') ||
                         error?.includes('timeout') ||
                         error?.includes('in-cluster') ||
                         error?.includes('resolve')
  
  const isNotRunning = error?.includes('not running') ||
                       error?.includes('not ready') ||
                       error?.includes('ENOTFOUND') ||
                       error?.includes('Connection refused')

  let icon = <AlertCircle className="h-8 w-8 text-muted-foreground mb-4" />
  let title = 'Metrics Unavailable'
  let description = error || 'Unable to fetch metrics from the deployment'
  let hint = ''

  if (isNetworkError || isNotRunning) {
    icon = <Cloud className="h-8 w-8 text-muted-foreground mb-4" />
    title = 'Cannot Connect to Metrics'
    description = 'Unable to reach the metrics endpoint'
    hint = 'The deployment may not be ready yet, or the metrics endpoint is not accessible.'
  }

  return (
    <div className={cn("glass-panel", className)}>
      <div className="flex flex-col items-center justify-center py-12 text-center">
        {icon}
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          {description}
        </p>
        {hint && (
          <p className="text-xs text-muted-foreground mt-4 max-w-md bg-[#0A0A0A] p-3 rounded-xl">
            💡 {hint}
          </p>
        )}
      </div>
    </div>
  )
}
