import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GpuFitIndicator } from './GpuFitIndicator';
import type { HfModelSearchResult } from '@airunway/shared';
import { Download, Heart, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HfModelCardProps {
  model: HfModelSearchResult;
  gpuCapacityGb?: number;
  gpuCount?: number;
  gpuCapacityLabel?: string;
}

/**
 * Format number with K/M suffixes
 */
function formatCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}K`;
  }
  return count.toString();
}

export function HfModelCard({ model, gpuCapacityGb, gpuCount, gpuCapacityLabel }: HfModelCardProps) {
  const navigate = useNavigate();

  const handleDeploy = () => {
    // Navigate to deploy page with the HF model ID
    navigate(`/deploy/${encodeURIComponent(model.id)}?source=hf`);
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl p-5 group",
        "bg-white/[0.03] border border-white/5",
        "transition-all duration-200 ease-out",
        "hover:border-cyan-500/30 hover:shadow-glow-card hover:-translate-y-0.5"
      )}
    >
      <div className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-white leading-tight truncate group-hover:text-cyan-400 transition-colors duration-200">{model.name}</h3>
            <p className="text-xs text-slate-500 truncate mt-0.5">
              {model.author}
            </p>
          </div>
          {model.gated && (
            <Badge variant="outline" className="shrink-0 gap-1">
              <Lock className="h-3 w-3" />
              Gated
            </Badge>
          )}
        </div>
      </div>

      <div className="flex-1 pt-2">
        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-slate-400 mb-3">
          <div className="flex items-center gap-1">
            <Download className="h-4 w-4" />
            <span>{formatCount(model.downloads)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Heart className="h-4 w-4" />
            <span>{formatCount(model.likes)}</span>
          </div>
        </div>

        {/* GPU Memory bar indicator */}
        <div className="mb-3">
          <GpuFitIndicator
            estimatedGpuMemoryGb={model.estimatedGpuMemoryGb}
            clusterCapacityGb={gpuCapacityGb}
            gpuCount={gpuCount}
            capacityLabel={gpuCapacityLabel}
          />
        </div>

        {/* Supported engines */}
        <div className="flex flex-wrap gap-1">
          {model.supportedEngines.map((engine) => (
            <Badge key={engine} variant="secondary" className="text-xs rounded-full">
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
  );
}
