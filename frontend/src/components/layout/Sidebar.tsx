import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Box, Layers, Settings, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useClusterStatus } from '@/hooks/useClusterStatus'

const navigation = [
  { name: 'Models', href: '/', icon: Box, tooltip: 'Model Catalog' },
  { name: 'Deployments', href: '/deployments', icon: Layers, tooltip: 'Deployments' },
  { name: 'Settings', href: '/settings', icon: Settings, tooltip: 'Settings' },
]

interface SidebarProps {
  /** Callback when a navigation item is clicked (used for mobile to close drawer) */
  onNavigate?: () => void
  /** Whether the rail is expanded (desktop hover/toggle) */
  isExpanded?: boolean
  /** Callback to set expanded state */
  onExpandedChange?: (expanded: boolean) => void
}

function ClusterStatusDot({ isExpanded }: { isExpanded: boolean }) {
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
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2 px-2 py-2 justify-center">
          <span className={dotClass} />
          <span
            className={cn(
              'text-xs text-slate-400 whitespace-nowrap transition-opacity duration-200',
              isExpanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
            )}
          >
            {label}
          </span>
        </div>
      </TooltipTrigger>
      {!isExpanded && (
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      )}
    </Tooltip>
  )
}

export function Sidebar({ onNavigate, isExpanded = false, onExpandedChange }: SidebarProps) {
  const location = useLocation()
  const [hovered, setHovered] = useState(false)

  const isMobileDrawer = !!onNavigate
  const expanded = isMobileDrawer || isExpanded || hovered

  const handleNavClick = () => {
    onNavigate?.()
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          'flex h-full flex-col bg-background border-r border-white/5 overflow-hidden',
          'transition-[width] duration-200 ease-in-out',
          isMobileDrawer
            ? 'w-60 shadow-soft-sm'
            : expanded
              ? 'w-60'
              : 'w-[72px]'
        )}
        onMouseEnter={() => {
          if (!isMobileDrawer) {
            setHovered(true)
            onExpandedChange?.(true)
          }
        }}
        onMouseLeave={() => {
          if (!isMobileDrawer) {
            setHovered(false)
            onExpandedChange?.(false)
          }
        }}
      >
        {/* Logo */}
        <div className="flex h-16 items-center border-b border-white/5 px-4 shrink-0">
          <Link
            to="/"
            className="flex items-center gap-2 min-w-0"
            onClick={handleNavClick}
          >
            <img
              src="/logo.png"
              alt="KubeAIRunway"
              className="h-8 w-8 shrink-0"
            />
            <span
              className={cn(
                'text-xl font-bold text-foreground whitespace-nowrap transition-opacity duration-200',
                expanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
              )}
            >
              KubeAIRunway
            </span>
          </Link>

          {isMobileDrawer && (
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

            const linkContent = (
              <Link
                key={item.name}
                to={item.href}
                onClick={handleNavClick}
                className={cn(
                  'relative flex items-center gap-3 rounded-lg py-2.5 text-sm font-medium',
                  'transition-all duration-150 ease-out',
                  expanded ? 'px-3' : 'justify-center px-0',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-[0.98]'
                )}
              >
                {/* Active pill indicator */}
                {isActive && (
                  <span className="absolute left-0 w-1 h-8 rounded-full bg-primary" />
                )}
                <item.icon
                  className={cn(
                    'h-5 w-5 shrink-0 transition-transform duration-150',
                    isActive && 'scale-110'
                  )}
                />
                <span
                  className={cn(
                    'whitespace-nowrap transition-opacity duration-200',
                    expanded
                      ? 'opacity-100 text-slate-300'
                      : 'opacity-0 w-0 overflow-hidden'
                  )}
                >
                  {item.name}
                </span>
              </Link>
            )

            if (expanded) {
              return <div key={item.name}>{linkContent}</div>
            }

            return (
              <Tooltip key={item.name}>
                <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {item.tooltip}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </nav>

        {/* Cluster status */}
        <div className="shrink-0 border-t border-white/5 py-3 px-2">
          <ClusterStatusDot isExpanded={expanded} />
        </div>
      </div>
    </TooltipProvider>
  )
}
