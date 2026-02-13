import { Link, useLocation } from 'react-router-dom'
import { Box, Layers, Settings, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const navigation = [
  { name: 'Models', href: '/', icon: Box },
  { name: 'Deployments', href: '/deployments', icon: Layers },
  { name: 'Settings', href: '/settings', icon: Settings },
]

interface SidebarProps {
  /** Callback when a navigation item is clicked (used for mobile to close drawer) */
  onNavigate?: () => void
}

export function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation()

  const handleNavClick = () => {
    onNavigate?.()
  }

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card overflow-hidden shadow-soft-sm md:shadow-none">
      {/* Header with logo */}
      <div className="flex h-16 items-center justify-between border-b px-4 md:px-6">
        <Link to="/" className="flex items-center gap-2" onClick={handleNavClick}>
          <img src="/logo.png" alt="KubeAIRunway" className="h-8 w-8" />
          <span className="text-xl font-bold text-foreground">KubeAIRunway</span>
        </Link>
        
        {/* Close button - mobile only */}
        {onNavigate && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden -mr-2"
            onClick={onNavigate}
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-3 md:p-4">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={handleNavClick}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium',
                'transition-all duration-150 ease-out',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-soft-sm'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground active:scale-[0.98]'
              )}
            >
              <item.icon className={cn(
                'h-5 w-5 transition-transform duration-150',
                isActive && 'scale-110'
              )} />
              {item.name}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
