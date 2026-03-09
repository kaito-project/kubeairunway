import { type Model } from '@/lib/api'
import { ModelCard } from './ModelCard'
import { EmptyState } from '@/components/ui/empty-state'
import { useNavigate } from 'react-router-dom'

interface ModelGridProps {
  models: Model[]
}

export function ModelGrid({ models }: ModelGridProps) {
  const navigate = useNavigate()

  if (models.length === 0) {
    return (
      <EmptyState
        preset="no-results"
        title="No models found"
        description="Try adjusting your search terms or filters to find what you're looking for."
        actionLabel="Clear Filters"
        onAction={() => {
          // Trigger a page refresh to clear filters
          navigate('/models', { replace: true })
          window.location.reload()
        }}
      />
    )
  }

  return (
    <div className="grid gap-6 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {models.map((model, index) => (
        <div
          key={model.id}
          className="animate-fade-in"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <ModelCard model={model} />
        </div>
      ))}
    </div>
  )
}
