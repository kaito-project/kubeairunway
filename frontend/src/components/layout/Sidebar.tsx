import { Link, useLocation } from 'react-router-dom'
import { Box, Layers, Settings, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useClusterStatus } from '@/hooks/useClusterStatus'

const navigation = [
  { name: 'Models', href: '/', icon: Box },
  { name: 'Deployments', href: '/deployments', icon: Layers },
  { name: 'Settings', href: '/settings', icon: Settings },
]

interface SidebarProps {
  /** Callback when a navigation item is clicked (used for mobile to close drawer) */
  onNavigate?: () => void
}

function ClusterStatusDot() {
  const { data, isLoading } = useClusterStatus()

  const connected = data?.connected ?? false
  const connecting = isLoading

  let dotClass: string
  let label: string
  if (connecting) {
    dotClass = 'h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse'
    label = 'Connecting…'
  } else if (connected) {
    dotClass = 'h-2.5 w-2.5 rounded-full bg-emerald-500'
    label = 'Connected'
  } else {
    dotClass = 'h-2.5 w-2.5 rounded-full bg-red-500'
    label = 'Disconnected'
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className={dotClass} />
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  )
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation()

  const handleNavClick = () => {
    onNavigate?.()
  }

  return (
    <div
      className={cn(
        'flex h-full w-60 flex-col bg-background border-r border-white/5 overflow-hidden',
        onNavigate && 'shadow-soft-sm'
      )}
    >
      {/* Logo */}
      <div className="flex h-14 items-center border-b border-white/5 px-4 shrink-0">
        <Link
          to="/"
          className="flex items-center gap-2 min-w-0"
          onClick={handleNavClick}
        >
          <img src="/logo.png" alt="AIRunway" className="h-8 w-8 shrink-0" />
          <span className="text-xl font-bold text-foreground whitespace-nowrap">
            AIRunway
          </span>
        </Link>

        {onNavigate && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto -mr-2"
            onClick={onNavigate}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 flex flex-col items-stretch gap-1 px-2 py-4">
        {navigation.map((item) => {
          const isActive =
            location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={handleNavClick}
              className={cn(
                'relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                'transition-all duration-150 ease-out',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-[0.98]'
              )}
            >
              <span
                className={cn(
                  'absolute left-0 w-1 h-8 rounded-full bg-primary transition-all duration-200 ease-out origin-center',
                  isActive
                    ? 'opacity-100 scale-y-100'
                    : 'opacity-0 scale-y-0'
                )}
              />
              <item.icon
                className={cn(
                  'h-5 w-5 shrink-0 transition-transform duration-150',
                  isActive && 'scale-110'
                )}
              />
              <span className="whitespace-nowrap text-slate-300">
                {item.name}
              </span>
            </Link>
          )
        })}
      </nav>

      {/* Cluster status */}
      <div className="shrink-0 border-t border-white/5 py-3 px-2">
        <ClusterStatusDot />
      </div>
    </div>
  )
}
