import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { CheckCircle2, AlertCircle, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Fit levels inspired by llmfit — four tiers from perfect to too-tight.
 *
 * Perfect  – recommended memory met with headroom (< 60% utilization)
 * Good     – fits comfortably (60-80% utilization)
 * Marginal – fits but tight, may leave no headroom (80-100%)
 * TooLarge – exceeds cluster GPU capacity (> 100%)
 */
export type GpuFitLevel = 'perfect' | 'good' | 'marginal' | 'too-large' | 'unknown';

interface GpuFitIndicatorProps {
  estimatedGpuMemoryGb?: number;
  clusterCapacityGb?: number;
  className?: string;
}

/**
 * Determine GPU fit level based on estimated memory vs cluster capacity
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getGpuFitLevel(
  estimatedGpuMemoryGb?: number,
  clusterCapacityGb?: number
): GpuFitLevel {
  if (estimatedGpuMemoryGb === undefined || clusterCapacityGb === undefined || clusterCapacityGb <= 0) {
    return 'unknown';
  }

  const utilization = estimatedGpuMemoryGb / clusterCapacityGb;

  if (utilization > 1) return 'too-large';
  if (utilization > 0.8) return 'marginal';
  if (utilization > 0.6) return 'good';
  return 'perfect';
}

// Keep the old export name/type for backward compat with tests
export type GpuFitStatus = GpuFitLevel;
// eslint-disable-next-line react-refresh/only-export-components
export function getGpuFitStatus(
  estimatedGpuMemoryGb?: number,
  clusterCapacityGb?: number
): GpuFitStatus {
  return getGpuFitLevel(estimatedGpuMemoryGb, clusterCapacityGb);
}

const fitConfig: Record<GpuFitLevel, {
  label: string;
  bar: string;
  text: string;
  icon: typeof CheckCircle2;
  detail: (estGb: number, capGb: number, pct: number) => string;
}> = {
  perfect: {
    label: 'Perfect fit',
    bar: 'from-green-400 to-emerald-500',
    text: 'text-green-400',
    icon: CheckCircle2,
    detail: (est, cap, pct) =>
      `${est.toFixed(1)} GB of ${cap} GB VRAM (${pct}% utilization) — plenty of headroom`,
  },
  good: {
    label: 'Good fit',
    bar: 'from-cyan-400 to-green-400',
    text: 'text-cyan-400',
    icon: CheckCircle2,
    detail: (est, cap, pct) =>
      `${est.toFixed(1)} GB of ${cap} GB VRAM (${pct}% utilization) — fits comfortably`,
  },
  marginal: {
    label: 'Tight fit',
    bar: 'from-amber-400 to-orange-400',
    text: 'text-amber-400',
    icon: AlertCircle,
    detail: (est, cap, pct) =>
      `${est.toFixed(1)} GB of ${cap} GB VRAM (${pct}% utilization) — may not leave headroom for KV cache`,
  },
  'too-large': {
    label: 'Won\u2019t fit',
    bar: 'from-red-400 to-red-500',
    text: 'text-red-400',
    icon: XCircle,
    detail: (est, cap, pct) =>
      `Needs ${est.toFixed(1)} GB but cluster only has ${cap} GB VRAM (${pct}% — exceeds capacity)`,
  },
  unknown: {
    label: 'Unknown',
    bar: 'from-slate-600 to-slate-500',
    text: 'text-slate-400',
    icon: AlertTriangle,
    detail: () => 'Cluster GPU capacity unknown — cannot determine fit',
  },
};

/**
 * Compute upgrade delta — how much more VRAM is needed, inspired by llmfit's plan mode.
 * Returns null when the model already fits comfortably.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getUpgradeDelta(
  estimatedGpuMemoryGb?: number,
  clusterCapacityGb?: number
): { additionalGb: number; targetGb: number } | null {
  if (
    estimatedGpuMemoryGb === undefined ||
    clusterCapacityGb === undefined ||
    clusterCapacityGb <= 0
  ) {
    return null;
  }
  // Only show delta when model exceeds or is marginal (>80%)
  if (estimatedGpuMemoryGb <= clusterCapacityGb * 0.8) return null;

  // Target: 20% headroom beyond what the model needs (mirrors llmfit's 1.2x recommended)
  const targetGb = Math.ceil(estimatedGpuMemoryGb * 1.2);
  const additionalGb = Math.max(targetGb - clusterCapacityGb, 0);
  if (additionalGb === 0) return null;
  return { additionalGb, targetGb };
}

/**
 * GPU Fit Indicator — shows whether a model fits cluster GPU capacity.
 * Inspired by llmfit's fit-level approach: Perfect / Good / Marginal / Won't Fit.
 */
export function GpuFitIndicator({
  estimatedGpuMemoryGb,
  clusterCapacityGb,
  className
}: GpuFitIndicatorProps) {
  const level = getGpuFitLevel(estimatedGpuMemoryGb, clusterCapacityGb);
  const config = fitConfig[level];
  const Icon = config.icon;
  const upgradeDelta = getUpgradeDelta(estimatedGpuMemoryGb, clusterCapacityGb);

  const fillPercent =
    estimatedGpuMemoryGb !== undefined && clusterCapacityGb !== undefined && clusterCapacityGb > 0
      ? Math.min((estimatedGpuMemoryGb / clusterCapacityGb) * 100, 100)
      : 0;

  const utilizationPct = Math.round(fillPercent);

  const tooltipDetail =
    estimatedGpuMemoryGb !== undefined && clusterCapacityGb !== undefined && clusterCapacityGb > 0
      ? config.detail(estimatedGpuMemoryGb, clusterCapacityGb, utilizationPct)
      : estimatedGpuMemoryGb === undefined
        ? 'Model size unknown — deploy with caution'
        : config.detail(estimatedGpuMemoryGb ?? 0, clusterCapacityGb ?? 0, utilizationPct);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('w-full', className)}>
            {/* Fit label + utilization */}
            <div className="flex items-center justify-between mb-1">
              <span className={cn('flex items-center gap-1 text-xs font-medium', config.text)}>
                <Icon className="h-3 w-3" />
                {config.label}
              </span>
              {estimatedGpuMemoryGb !== undefined && clusterCapacityGb !== undefined && (
                <span className="text-xs text-slate-400 tabular-nums">
                  {estimatedGpuMemoryGb.toFixed(1)} / {clusterCapacityGb} GB
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 rounded-full bg-white/5">
              {fillPercent > 0 && (
                <div
                  className={cn(
                    'h-full rounded-full bg-gradient-to-r transition-all duration-300',
                    config.bar
                  )}
                  style={{ width: `${fillPercent}%` }}
                />
              )}
            </div>

            {/* Upgrade delta — how much more VRAM is needed */}
            {upgradeDelta && (
              <p className="text-xs text-slate-500 mt-1">
                +{upgradeDelta.additionalGb} GB VRAM needed for comfortable fit
              </p>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs">{tooltipDetail}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
