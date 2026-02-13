import { Badge } from '@/components/ui/badge'

interface InstanceStatusBadgeProps {
  status: 'connected' | 'disconnected' | 'error'
  message?: string
}

const statusConfig = {
  connected: { label: 'Connected', variant: 'success' as const },
  disconnected: { label: 'Disconnected', variant: 'warning' as const },
  error: { label: 'Error', variant: 'destructive' as const },
}

export function InstanceStatusBadge({ status, message }: InstanceStatusBadgeProps) {
  const config = statusConfig[status]

  return (
    <Badge variant={config.variant} dot title={message}>
      {config.label}
    </Badge>
  )
}
