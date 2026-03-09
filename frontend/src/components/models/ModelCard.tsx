import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { type Model } from '@/lib/api'
import { Cpu, HardDrive, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ModelCardProps {
  model: Model
}

export function ModelCard({ model }: ModelCardProps) {
  const navigate = useNavigate()

  const handleDeploy = () => {
    navigate(`/deploy/${encodeURIComponent(model.id)}`)
  }

  return (
    <div
      className={cn(
        "flex flex-col h-full group rounded-2xl p-5",
        "bg-white/[0.03] border border-white/5",
        "transition-all duration-200 ease-out",
        "hover:border-cyan-500/30 hover:shadow-glow-card hover:-translate-y-0.5"
      )}
    >
      <div className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-lg font-semibold text-white leading-tight truncate group-hover:text-cyan-400 transition-colors duration-200">
            {model.name}
          </h3>
          <Badge variant="outline" className="shrink-0 font-mono text-xs">
            {model.size}
          </Badge>
        </div>
        <p className="text-xs text-slate-500 font-mono truncate mt-1">
          {model.id}
        </p>
      </div>

      <div className="flex-1">
        <p className="text-sm text-slate-500 mb-4 line-clamp-2">
          {model.description}
        </p>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-slate-400">
            <Cpu className="h-4 w-4 shrink-0" />
            <span className="truncate">GPU: {model.minGpuMemory || 'N/A'}</span>
          </div>

          {model.contextLength && (
            <div className="flex items-center gap-2 text-slate-400">
              <Layers className="h-4 w-4 shrink-0" />
              <span>Context: {model.contextLength.toLocaleString()}</span>
            </div>
          )}

          <div className="flex items-center gap-2 text-slate-400">
            <HardDrive className="h-4 w-4 shrink-0" />
            <span className="capitalize">{model.task.replace('-', ' ')}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-4">
          {model.supportedEngines.map((engine) => (
            <Badge
              key={engine}
              variant="secondary"
              className="text-xs font-medium rounded-full"
            >
              {engine.toUpperCase()}
            </Badge>
          ))}
        </div>
      </div>

      <div className="pt-4">
        <Button
          variant="ghost"
          onClick={handleDeploy}
          className="w-full text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10 rounded-xl"
        >
          Deploy →
        </Button>
      </div>
    </div>
  )
}
