import { Link, useLocation } from 'react-router-dom'
import { Box, Layers, Settings, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSettings } from '@/hooks/useSettings'

const navigation = [
  { name: 'Models', href: '/', icon: Box },
  { name: 'Deployments', href: '/deployments', icon: Layers },
  { name: 'Installation', href: '/installation', icon: Download },
  { name: 'Settings', href: '/settings', icon: Settings },
]

export function Sidebar() {
  const location = useLocation()
  const { data: settings } = useSettings()
  const providerId = settings?.activeProvider?.id || 'dynamo'

  return (
    <div className="flex h-full w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-6">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold">
            K
          </div>
          <span className="text-xl font-bold text-foreground">KubeFoundry</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href))

          return (
            <Link
              key={item.name}
              to={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          )
        })}
      </nav>

      {/* Provider indicator */}
      <div className="border-t p-4">
        <div className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium',
          providerId === 'kuberay' ? 'bg-ray/10 text-ray' : 'bg-nvidia/10 text-nvidia'
        )}>
          <div className={cn(
            'h-2 w-2 rounded-full',
            providerId === 'kuberay' ? 'bg-ray' : 'bg-nvidia'
          )} />
          {providerId === 'kuberay' ? 'KubeRay' : 'NVIDIA Dynamo'}
        </div>
      </div>
    </div>
  )
}
