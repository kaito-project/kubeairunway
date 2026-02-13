import { useClusterStatus } from '@/hooks/useClusterStatus'
import { useAuth } from '@/hooks/useAuth'
import { useInstanceContext } from '@/hooks/useInstanceContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InstanceBreadcrumb } from '@/components/instances/InstanceBreadcrumb'
import { Wifi, WifiOff, Menu } from 'lucide-react'
import { useSidebar } from './MainLayout'

export function Header() {
  const { data: clusterStatus, isLoading } = useClusterStatus()
  const { hubMode } = useAuth()
  const { currentInstanceId } = useInstanceContext()
  const { toggle } = useSidebar()

  return (
    <header className="border-b bg-card">
      <div className="flex h-14 md:h-16 items-center justify-between px-4 md:px-6 gap-4">
        {/* Left side: hamburger + instance breadcrumb */}
        <div className="flex items-center gap-3 min-w-0">
          {/* Hamburger menu - mobile only */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0 -ml-2"
            onClick={toggle}
            aria-label="Toggle navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Instance breadcrumb in hub mode */}
          {hubMode && currentInstanceId && <InstanceBreadcrumb />}
        </div>

        {/* Right side: status badges */}
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          {/* Connection status */}
          <div className="flex items-center">
            {isLoading ? (
              <Badge variant="outline" pulse className="gap-1.5">
                <span className="h-2 w-2 rounded-full bg-yellow-500" />
                <span className="hidden sm:inline">Connecting...</span>
              </Badge>
            ) : clusterStatus?.connected ? (
              <Badge variant="success" className="gap-1.5">
                <Wifi className="h-3 w-3" />
                <span className="hidden sm:inline">Connected</span>
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1.5">
                <WifiOff className="h-3 w-3" />
                <span className="hidden sm:inline">Disconnected</span>
              </Badge>
            )}
          </div>

          {/* Cluster name - hide on small screens */}
          {clusterStatus?.clusterName && (
            <Badge variant="outline" className="hidden lg:inline-flex max-w-[150px]">
              <span className="truncate">{clusterStatus.clusterName}</span>
            </Badge>
          )}
        </div>
      </div>
    </header>
  )
}
