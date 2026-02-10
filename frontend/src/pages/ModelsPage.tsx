import { useState, useMemo } from 'react'
import { useModels } from '@/hooks/useModels'
import { useGpuCapacity } from '@/hooks/useGpuOperator'
import { ModelGrid } from '@/components/models/ModelGrid'
import { ModelSearch } from '@/components/models/ModelSearch'
import { HfModelSearch } from '@/components/models/HfModelSearch'
import { SkeletonGrid } from '@/components/ui/skeleton'
import { BookMarked, Search, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Engine } from '@kubeairunway/shared'

type Tab = 'curated' | 'huggingface'

export function ModelsPage() {
  const { data: models, isLoading, error } = useModels()
  const { data: gpuCapacity } = useGpuCapacity()
  const [search, setSearch] = useState('')
  const [selectedEngines, setSelectedEngines] = useState<Engine[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('curated')

  const filteredModels = useMemo(() => {
    if (!models) return []

    return models.filter((model) => {
      // Filter by search
      const searchMatch = search === '' ||
        model.name.toLowerCase().includes(search.toLowerCase()) ||
        model.id.toLowerCase().includes(search.toLowerCase()) ||
        model.description.toLowerCase().includes(search.toLowerCase())

      // Filter by engine
      const engineMatch = selectedEngines.length === 0 ||
        selectedEngines.some((engine) => model.supportedEngines.includes(engine))

      return searchMatch && engineMatch
    })
  }, [models, search, selectedEngines])

  const handleEngineToggle = (engine: Engine) => {
    setSelectedEngines((prev) =>
      prev.includes(engine)
        ? prev.filter((e) => e !== engine)
        : [...prev, engine]
    )
  }

  if (isLoading && activeTab === 'curated') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Model Catalog</h1>
          <p className="text-muted-foreground mt-1">
            Select a model to deploy to your Kubernetes cluster
          </p>
        </div>
        <SkeletonGrid count={8} className="lg:grid-cols-4" />
      </div>
    )
  }

  if (error && activeTab === 'curated') {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-destructive">
          Failed to load models
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            Model Catalog
            <Sparkles className="h-6 w-6 text-nvidia" />
          </h1>
          <p className="text-muted-foreground mt-1">
            Select a model to deploy to your Kubernetes cluster
          </p>
        </div>
        {models && (
          <p className="text-sm text-muted-foreground tabular-nums">
            {filteredModels.length} of {models.length} models
          </p>
        )}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setActiveTab('curated')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px rounded-t-md',
            activeTab === 'curated'
              ? 'border-primary text-primary bg-primary/5'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          <BookMarked className={cn(
            "h-4 w-4 transition-transform duration-200",
            activeTab === 'curated' && "scale-110"
          )} />
          Curated Models
        </button>
        <button
          onClick={() => setActiveTab('huggingface')}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px rounded-t-md',
            activeTab === 'huggingface'
              ? 'border-primary text-primary bg-primary/5'
              : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          <Search className={cn(
            "h-4 w-4 transition-transform duration-200",
            activeTab === 'huggingface' && "scale-110"
          )} />
          Search HuggingFace
        </button>
      </div>

      {/* Curated models tab */}
      {activeTab === 'curated' && (
        <>
          <ModelSearch
            search={search}
            onSearchChange={setSearch}
            selectedEngines={selectedEngines}
            onEngineToggle={handleEngineToggle}
          />
          <ModelGrid models={filteredModels} />
        </>
      )}

      {/* HuggingFace search tab */}
      {activeTab === 'huggingface' && (
        <HfModelSearch gpuCapacityGb={gpuCapacity?.totalMemoryGb} />
      )}
    </div>
  )
}
