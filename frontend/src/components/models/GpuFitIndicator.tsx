import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type GpuFitStatus = 'fits' | 'warning' | 'exceeds' | 'unknown';

interface GpuFitIndicatorProps {
  estimatedGpuMemoryGb?: number;
  clusterCapacityGb?: number;
  className?: string;
}

/**
 * Determine GPU fit status based on estimated memory vs cluster capacity
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getGpuFitStatus(
  estimatedGpuMemoryGb?: number,
  clusterCapacityGb?: number
): GpuFitStatus {
  if (estimatedGpuMemoryGb === undefined) {
    return 'unknown';
  }
  
  if (clusterCapacityGb === undefined) {
    return 'unknown';
  }
  
  // If estimated memory exceeds capacity, it won't fit
  if (estimatedGpuMemoryGb > clusterCapacityGb) {
    return 'exceeds';
  }
  
  // If within 80% of capacity, show warning (tight fit)
  if (estimatedGpuMemoryGb > clusterCapacityGb * 0.8) {
    return 'warning';
  }
  
  return 'fits';
}

/**
 * Get tooltip message for GPU fit status
 */
function getTooltipMessage(
  status: GpuFitStatus,
  estimatedGpuMemoryGb?: number,
  clusterCapacityGb?: number
): string {
  switch (status) {
    case 'fits':
      return `Estimated ${estimatedGpuMemoryGb}GB VRAM fits within cluster capacity (${clusterCapacityGb}GB available)`;
    case 'warning':
      return `Estimated ${estimatedGpuMemoryGb}GB VRAM is close to cluster capacity (${clusterCapacityGb}GB available). Deployment may be tight.`;
    case 'exceeds':
      return `Estimated ${estimatedGpuMemoryGb}GB VRAM exceeds cluster capacity (${clusterCapacityGb}GB available). Deployment may fail.`;
    case 'unknown':
      if (estimatedGpuMemoryGb === undefined) {
        return 'Model size unknown. Deploy with caution.';
      }
      return 'Cluster GPU capacity unknown. Cannot determine fit.';
  }
}

const gradientMap: Record<GpuFitStatus, string> = {
  fits: 'from-cyan-400 to-green-400',
  warning: 'from-cyan-400 to-amber-400',
  exceeds: 'from-cyan-400 to-red-400',
  unknown: 'from-slate-600 to-slate-500',
};

/**
 * GPU Fit Indicator component — bar-based
 * Shows a gradient progress bar indicating whether model fits cluster GPU capacity
 */
export function GpuFitIndicator({ 
  estimatedGpuMemoryGb, 
  clusterCapacityGb,
  className 
}: GpuFitIndicatorProps) {
  const status = getGpuFitStatus(estimatedGpuMemoryGb, clusterCapacityGb);
  const message = getTooltipMessage(status, estimatedGpuMemoryGb, clusterCapacityGb);

  // Calculate fill percentage (cap at 100%)
  const fillPercent =
    estimatedGpuMemoryGb !== undefined && clusterCapacityGb !== undefined && clusterCapacityGb > 0
      ? Math.min((estimatedGpuMemoryGb / clusterCapacityGb) * 100, 100)
      : 0;

  const label =
    estimatedGpuMemoryGb !== undefined && clusterCapacityGb !== undefined
      ? `${estimatedGpuMemoryGb.toFixed(1)} GB / ${clusterCapacityGb} GB`
      : estimatedGpuMemoryGb !== undefined
        ? `~${estimatedGpuMemoryGb.toFixed(1)} GB`
        : undefined;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('w-full', className)}>
            {label && (
              <div className="flex justify-end mb-1">
                <span className="text-xs text-slate-400">{label}</span>
              </div>
            )}
            <div className="w-full h-1.5 rounded-full bg-white/5">
              {fillPercent > 0 && (
                <div
                  className={cn(
                    'h-full rounded-full bg-gradient-to-r transition-all duration-300',
                    gradientMap[status]
                  )}
                  style={{ width: `${fillPercent}%` }}
                />
              )}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs">{message}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
