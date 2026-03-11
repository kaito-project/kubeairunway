import { useClusterStatus } from '@/hooks/useClusterStatus'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Wifi, WifiOff, Menu, ChevronRight, RefreshCw } from 'lucide-react'
import { useSidebar } from './MainLayout'
import { useLocation, Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'

const routeLabels: Record<string, string> = {
  '': 'Models',
  deployments: 'Deployments',
  deploy: 'Deploy',
  settings: 'Settings',
}

function useBreadcrumbs() {
  const { pathname } = useLocation()
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0) {
    return [{ label: 'Models', path: '/', isLast: true }]
  }

  const crumbs: { label: string; path: string; isLast: boolean }[] = []

  // First segment determines the root
  const root = segments[0]
  if (root === 'deploy') {
    crumbs.push({ label: 'Models', path: '/', isLast: false })
    crumbs.push({ label: 'Deploy', path: '/deploy', isLast: segments.length === 1 })
  } else {
    const rootLabel = routeLabels[root] ?? root
    crumbs.push({ label: rootLabel, path: `/${root}`, isLast: segments.length === 1 })
  }

  // Remaining segments
  for (let i = 1; i < segments.length; i++) {
    const label = decodeURIComponent(segments[i])
    const path = '/' + segments.slice(0, i + 1).join('/')
    crumbs.push({ label, path, isLast: i === segments.length - 1 })
  }

  return crumbs
}

export function Header() {
  const { data: clusterStatus, isLoading } = useClusterStatus()
  const { toggle } = useSidebar()
  const breadcrumbs = useBreadcrumbs()
  const queryClient = useQueryClient()

  return (
    <header className="sticky top-0 z-30 h-14 bg-white/[0.03] backdrop-blur-md border-b border-white/5">
      <div className="flex h-full items-center justify-between px-4 md:px-6 gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0 -ml-2"
            onClick={toggle}
            aria-label="Toggle navigation menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <nav className="hidden md:flex items-center gap-1 min-w-0 text-sm">
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center gap-1 min-w-0">
                {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />}
                {crumb.isLast ? (
                  <span className="text-foreground font-medium truncate">{crumb.label}</span>
                ) : (
                  <Link
                    to={crumb.path}
                    className="text-muted-foreground hover:text-foreground transition-colors truncate"
                  >
                    {crumb.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 md:gap-3 shrink-0">
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

          {clusterStatus?.clusterName && (
            <Badge
              variant="outline"
              className="hidden lg:inline-flex max-w-[150px] bg-white/[0.05] border-white/10 font-mono text-xs"
            >
              <span className="truncate">{clusterStatus.clusterName}</span>
            </Badge>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            onClick={() => queryClient.invalidateQueries()}
            aria-label="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </header>
  )
}
