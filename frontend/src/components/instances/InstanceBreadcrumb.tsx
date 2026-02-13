import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useInstances } from '@/hooks/useInstances'
import { useInstanceContext } from '@/hooks/useInstanceContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronRight, ChevronDown, ArrowLeft, Server } from 'lucide-react'
import { cn } from '@/lib/utils'

export function InstanceBreadcrumb() {
  const { currentInstanceId, currentInstanceName, setCurrentInstance } = useInstanceContext()
  const { data: instances } = useInstances()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [open])

  if (!currentInstanceId) return null

  const displayName = currentInstanceName || currentInstanceId

  return (
    <div ref={ref} className="relative flex items-center gap-1 text-sm">
      <Link
        to="/instances"
        className="text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setCurrentInstance(null)}
      >
        Instances
      </Link>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 font-medium h-8 px-2"
        onClick={() => setOpen(!open)}
      >
        <Server className="h-3.5 w-3.5 text-primary" />
        <span className="max-w-[150px] truncate">{displayName}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95">
          <Link
            to="/instances"
            className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setCurrentInstance(null)
              setOpen(false)
            }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to all instances
          </Link>
          <div className="-mx-1 my-1 h-px bg-muted" />
          {instances?.map((inst) => (
            <button
              key={inst.id}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground text-left',
                inst.id === currentInstanceId && 'bg-accent font-medium'
              )}
              onClick={() => {
                setCurrentInstance(inst.id, inst.displayName || inst.name)
                setOpen(false)
              }}
            >
              <Server className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate">{inst.displayName || inst.name}</span>
              {inst.id === currentInstanceId && (
                <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">
                  current
                </Badge>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
