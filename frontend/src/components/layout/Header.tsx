import { Link } from 'react-router-dom'
import { useClusterStatus } from '@/hooks/useClusterStatus'
import { Badge } from '@/components/ui/badge'
import { Wifi, WifiOff, AlertTriangle } from 'lucide-react'

export function Header() {
  const { data: clusterStatus, isLoading } = useClusterStatus()

  const providerInstalled = clusterStatus?.providerInstallation?.installed ?? false
  const showProviderWarning = clusterStatus?.connected && !providerInstalled && !isLoading

  return (
    <header className="border-b bg-card">
      {showProviderWarning && (
        <div className="flex items-center justify-between bg-yellow-100 px-6 py-2 text-sm text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>
              Provider "{clusterStatus?.provider?.name || 'Unknown'}" is not installed in your cluster.
            </span>
          </div>
          <Link
            to="/settings"
            className="font-medium underline hover:no-underline"
          >
            View installation instructions →
          </Link>
        </div>
      )}

      <div className="flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">KubeFoundry - Model Deployment Platform</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {isLoading ? (
              <Badge variant="outline" className="gap-1">
                <div className="h-2 w-2 animate-pulse rounded-full bg-yellow-500" />
                Connecting...
              </Badge>
            ) : clusterStatus?.connected ? (
              <Badge variant="success" className="gap-1">
                <Wifi className="h-3 w-3" />
                Cluster Connected
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <WifiOff className="h-3 w-3" />
                Disconnected
              </Badge>
            )}
          </div>

          {clusterStatus?.provider && (
            <Badge variant={providerInstalled ? 'outline' : 'destructive'}>
              Provider: {clusterStatus.provider.name}
            </Badge>
          )}

          {clusterStatus?.clusterName && (
            <Badge variant="outline">
              Cluster: {clusterStatus.clusterName}
            </Badge>
          )}
        </div>
      </div>
    </header>
  )
}
