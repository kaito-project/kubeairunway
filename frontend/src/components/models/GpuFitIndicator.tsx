import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react';
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

/**
 * GPU Fit Indicator component
 * Shows icon with tooltip indicating whether model fits cluster GPU capacity
 */
export function GpuFitIndicator({ 
  estimatedGpuMemoryGb, 
  clusterCapacityGb,
  className 
}: GpuFitIndicatorProps) {
  const status = getGpuFitStatus(estimatedGpuMemoryGb, clusterCapacityGb);
  const message = getTooltipMessage(status, estimatedGpuMemoryGb, clusterCapacityGb);
  
  const Icon = {
    fits: CheckCircle2,
    warning: AlertTriangle,
    exceeds: XCircle,
    unknown: HelpCircle,
  }[status];
  
  const colorClass = {
    fits: 'text-green-500',
    warning: 'text-yellow-500',
    exceeds: 'text-red-500',
    unknown: 'text-muted-foreground',
  }[status];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('inline-flex', className)}>
            <Icon className={cn('h-4 w-4', colorClass)} />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs">{message}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
