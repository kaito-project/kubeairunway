import { Badge } from '@/components/ui/badge'
import { type DeploymentStatus } from '@/lib/api'
import { CheckCircle2, Clock, Loader2, XCircle, Power } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DeploymentStatusBadgeProps {
  phase: DeploymentStatus['phase']
  /** Show icon alongside text */
  showIcon?: boolean
  /** Compact mode - icon only */
  compact?: boolean
}

const statusConfig: Record<DeploymentStatus['phase'], {
  className: string
  icon: typeof Clock
  pulse: boolean
  label: string
}> = {
  Pending: {
    className: 'bg-amber-400/10 text-amber-400',
    icon: Clock,
    pulse: true,
    label: 'Pending',
  },
  Deploying: {
    className: 'bg-blue-500/10 text-blue-500',
    icon: Loader2,
    pulse: true,
    label: 'Deploying',
  },
  Running: {
    className: 'bg-green-500/10 text-green-500',
    icon: CheckCircle2,
    pulse: false,
    label: 'Running',
  },
  Failed: {
    className: 'bg-red-400/10 text-red-400',
    icon: XCircle,
    pulse: false,
    label: 'Failed',
  },
  Terminating: {
    className: 'bg-slate-400/10 text-slate-400',
    icon: Power,
    pulse: true,
    label: 'Terminating',
  },
}

export function DeploymentStatusBadge({ 
  phase, 
  showIcon = true,
  compact = false 
}: DeploymentStatusBadgeProps) {
  const config = statusConfig[phase]
  const Icon = config.icon

  return (
    <Badge 
      variant="outline"
      pulse={config.pulse}
      className={cn(
        'gap-1.5 border-0',
        config.className,
        compact && 'px-1.5'
      )}
    >
      {showIcon && (
        <Icon 
          className={cn(
            'h-3 w-3',
            phase === 'Deploying' && 'animate-spin'
          )} 
        />
      )}
      {!compact && config.label}
    </Badge>
  )
}
