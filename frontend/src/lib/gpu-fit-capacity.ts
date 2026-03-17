import type { ClusterGpuCapacity, DetailedClusterCapacity } from '@/lib/api';

export interface GpuFitCapacityDisplay {
  gpuCount?: number;
  capacityLabel?: string;
}

type BasicGpuFitCapacity = Pick<ClusterGpuCapacity, 'totalGpus' | 'totalMemoryGb' | 'nodes'>;
type DetailedGpuFitCapacity = Pick<DetailedClusterCapacity, 'totalGpus' | 'totalMemoryGb' | 'nodePools' | 'gpuNodeCount'>;
type GpuFitCapacitySource = BasicGpuFitCapacity | DetailedGpuFitCapacity;

export function getGpuFitCapacityDisplay(
  capacity?: GpuFitCapacitySource
): GpuFitCapacityDisplay {
  if (!capacity) {
    return {};
  }

  return {
    gpuCount: capacity.totalGpus,
    capacityLabel: formatGpuTopologyLabel(capacity),
  };
}

function formatGpuTopologyLabel(capacity: GpuFitCapacitySource): string | undefined {
  const totalMemoryGb = capacity.totalMemoryGb;
  if (!totalMemoryGb || totalMemoryGb <= 0 || capacity.totalGpus <= 0) {
    return undefined;
  }

  if ('nodes' in capacity) {
    const perNodeGpuCounts = capacity.nodes
      .map((node) => node.totalGpus)
      .filter((gpuCount) => gpuCount > 0);

    return formatFromPerNodeCounts(perNodeGpuCounts, capacity.totalGpus, totalMemoryGb);
  }

  const perNodeGpuCounts = capacity.nodePools.flatMap((pool) => {
    if (pool.nodeCount <= 0 || pool.gpuCount <= 0 || pool.gpuCount % pool.nodeCount !== 0) {
      return [];
    }

    const gpusPerNode = pool.gpuCount / pool.nodeCount;
    return Array.from({ length: pool.nodeCount }, () => gpusPerNode);
  });

  if (perNodeGpuCounts.length > 0) {
    return formatFromPerNodeCounts(perNodeGpuCounts, capacity.totalGpus, totalMemoryGb);
  }

  return formatFallbackLabel(capacity.totalGpus, capacity.gpuNodeCount, totalMemoryGb);
}

function formatFromPerNodeCounts(
  perNodeGpuCounts: number[],
  totalGpus: number,
  totalMemoryGb: number
): string | undefined {
  if (perNodeGpuCounts.length === 0) {
    return formatFallbackLabel(totalGpus, undefined, totalMemoryGb);
  }

  const nodeGroups = new Map<number, number>();
  for (const gpuCount of perNodeGpuCounts) {
    nodeGroups.set(gpuCount, (nodeGroups.get(gpuCount) || 0) + 1);
  }

  if (nodeGroups.size === 1) {
    const [gpusPerNode, nodeCount] = Array.from(nodeGroups.entries())[0];
    if (nodeCount > 1) {
      return `${nodeCount}x${gpusPerNode}x${totalMemoryGb} GB`;
    }

    if (gpusPerNode > 1) {
      return `${gpusPerNode}x${totalMemoryGb} GB`;
    }

    return `${totalMemoryGb} GB`;
  }

  return formatFallbackLabel(totalGpus, perNodeGpuCounts.length, totalMemoryGb);
}

function formatFallbackLabel(
  totalGpus: number,
  nodeCount: number | undefined,
  totalMemoryGb: number
): string {
  if (nodeCount && nodeCount > 1) {
    return `${totalGpus}x${totalMemoryGb} GB across ${nodeCount} nodes`;
  }

  if (totalGpus > 1) {
    return `${totalGpus}x${totalMemoryGb} GB`;
  }

  return `${totalMemoryGb} GB`;
}
