import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { GpuFitIndicator, getGpuFitStatus } from './GpuFitIndicator';
import type { HfModelSearchResult } from '@kubeairunway/shared';
import { Cpu, Download, Heart, Lock } from 'lucide-react';

interface HfModelCardProps {
  model: HfModelSearchResult;
  gpuCapacityGb?: number;
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

export function HfModelCard({ model, gpuCapacityGb }: HfModelCardProps) {
  const navigate = useNavigate();

  const handleDeploy = () => {
    // Navigate to deploy page with the HF model ID
    navigate(`/deploy/${encodeURIComponent(model.id)}?source=hf`);
  };

  // Get GPU fit status for styling
  const gpuFitStatus = getGpuFitStatus(model.estimatedGpuMemoryGb, gpuCapacityGb);
  const exceedsCapacity = gpuFitStatus === 'exceeds';
  const isWarning = gpuFitStatus === 'warning';

  return (
    <Card className="flex flex-col transition-colors hover:border-nvidia/50">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-lg leading-tight truncate">{model.name}</CardTitle>
            <CardDescription className="text-xs text-muted-foreground truncate">
              {model.author}
            </CardDescription>
          </div>
          {model.gated && (
            <Badge variant="outline" className="shrink-0 gap-1">
              <Lock className="h-3 w-3" />
              Gated
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 pt-2">
        {/* Stats row */}
        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-3">
          <div className="flex items-center gap-1">
            <Download className="h-4 w-4" />
            <span>{formatCount(model.downloads)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Heart className="h-4 w-4" />
            <span>{formatCount(model.likes)}</span>
          </div>
        </div>

        {/* GPU Memory estimate */}
        {model.estimatedGpuMemory && (
          <div className="flex items-center gap-2 text-sm mb-3">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            <span className={exceedsCapacity ? 'text-destructive' : isWarning ? 'text-yellow-600' : 'text-muted-foreground'}>
              ~{model.estimatedGpuMemory} VRAM
            </span>
            <GpuFitIndicator 
              estimatedGpuMemoryGb={model.estimatedGpuMemoryGb} 
              clusterCapacityGb={gpuCapacityGb} 
            />
          </div>
        )}

        {!model.estimatedGpuMemory && (
          <div className="flex items-center gap-2 text-sm mb-3">
            <Cpu className="h-4 w-4 text-muted-foreground" />
            <span className="text-amber-500">Unknown size</span>
            <GpuFitIndicator 
              estimatedGpuMemoryGb={undefined} 
              clusterCapacityGb={gpuCapacityGb} 
            />
          </div>
        )}

        {/* Supported engines */}
        <div className="flex flex-wrap gap-1">
          {model.supportedEngines.map((engine) => (
            <Badge key={engine} variant="secondary" className="text-xs">
              {engine.toUpperCase()}
            </Badge>
          ))}
        </div>
      </CardContent>

      <CardFooter>
        <Button 
          onClick={handleDeploy} 
          className="w-full"
          variant={exceedsCapacity ? 'destructive' : isWarning ? 'outline' : 'default'}
        >
          {exceedsCapacity ? 'Deploy (May Fail)' : isWarning ? 'Deploy (Tight Fit)' : 'Deploy Model'}
        </Button>
      </CardFooter>
    </Card>
  );
}
