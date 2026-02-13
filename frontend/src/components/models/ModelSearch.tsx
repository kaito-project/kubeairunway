import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Engine } from '@kubeairunway/shared'

interface ModelSearchProps {
  search: string
  onSearchChange: (value: string) => void
  selectedEngines: Engine[]
  onEngineToggle: (engine: Engine) => void
}

const engines: { value: Engine; label: string }[] = [
  { value: 'vllm', label: 'vLLM' },
  { value: 'sglang', label: 'SGLang' },
  { value: 'trtllm', label: 'TensorRT-LLM' },
  { value: 'llamacpp', label: 'Llama.cpp' },
]

export function ModelSearch({
  search,
  onSearchChange,
  selectedEngines,
  onEngineToggle,
}: ModelSearchProps) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-10"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="text-sm text-muted-foreground">Engines:</span>
        {engines.map((engine) => {
          const isSelected = selectedEngines.includes(engine.value)
          return (
            <Badge
              key={engine.value}
              variant={isSelected ? 'default' : 'outline'}
              className={cn(
                'cursor-pointer transition-colors',
                isSelected && 'bg-nvidia hover:bg-nvidia-dark'
              )}
              onClick={() => onEngineToggle(engine.value)}
            >
              {engine.label}
            </Badge>
          )
        })}
      </div>
    </div>
  )
}
