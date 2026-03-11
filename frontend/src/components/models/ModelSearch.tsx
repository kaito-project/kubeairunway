import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
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
        <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder="Search models..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-12 h-12 rounded-2xl bg-white/[0.03] border-white/5 text-base placeholder:text-slate-500"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {engines.map((engine) => {
          const isSelected = selectedEngines.includes(engine.value)
          return (
            <button
              key={engine.value}
              className={cn(
                'px-3 py-1.5 text-sm rounded-full transition-all duration-200 border',
                isSelected
                  ? 'border-cyan-400 bg-cyan-400/10 text-cyan-400'
                  : 'border-white/5 bg-white/[0.03] text-slate-400 hover:border-white/10 hover:text-slate-300'
              )}
              onClick={() => onEngineToggle(engine.value)}
            >
              {engine.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
