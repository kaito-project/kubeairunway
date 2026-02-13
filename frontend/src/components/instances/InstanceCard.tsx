import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { InstanceStatusBadge } from './InstanceStatusBadge'
import { ArrowRight, Server, Layers } from 'lucide-react'

interface InstanceHealth {
  gpuCapacity?: { total: number; used: number }
  deploymentCount?: number
}

export interface InstanceCardProps {
  instance: {
    id: string
    name: string
    displayName: string
    status: 'connected' | 'disconnected' | 'error'
    statusMessage?: string
  }
  health?: InstanceHealth
  onSelect: (instanceId: string) => void
}

export function InstanceCard({ instance, health, onSelect }: InstanceCardProps) {
  const gpu = health?.gpuCapacity
  const gpuPercent = gpu && gpu.total > 0 ? (gpu.used / gpu.total) * 100 : 0

  return (
    <Card interactive className="flex flex-col" onClick={() => onSelect(instance.id)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Server className="h-5 w-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold truncate">{instance.displayName}</h3>
              <p className="text-xs text-muted-foreground truncate">{instance.name}</p>
            </div>
          </div>
          <InstanceStatusBadge status={instance.status} message={instance.statusMessage} />
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        {gpu && gpu.total > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>GPU</span>
              <span className="tabular-nums">{gpu.used}/{gpu.total}</span>
            </div>
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${gpuPercent}%` }}
              />
            </div>
          </div>
        )}

        {health?.deploymentCount !== undefined && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span>{health.deploymentCount} deployment{health.deploymentCount !== 1 ? 's' : ''}</span>
          </div>
        )}
      </CardContent>

      <CardFooter>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={(e) => {
            e.stopPropagation()
            onSelect(instance.id)
          }}
        >
          Open
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </CardFooter>
    </Card>
  )
}
