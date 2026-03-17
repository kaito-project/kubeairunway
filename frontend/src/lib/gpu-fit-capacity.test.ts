import { describe, expect, it } from 'vitest';
import type { ClusterGpuCapacity, DetailedClusterCapacity } from '@/lib/api';
import { getGpuFitCapacityDisplay } from './gpu-fit-capacity';

function createClusterGpuCapacity(
  overrides: Partial<ClusterGpuCapacity> = {}
): ClusterGpuCapacity {
  return {
    totalGpus: 16,
    allocatedGpus: 0,
    availableGpus: 16,
    maxContiguousAvailable: 8,
    totalMemoryGb: 80,
    nodes: [
      {
        nodeName: 'gpu-node-1',
        totalGpus: 8,
        allocatedGpus: 0,
        availableGpus: 8,
      },
      {
        nodeName: 'gpu-node-2',
        totalGpus: 8,
        allocatedGpus: 0,
        availableGpus: 8,
      },
    ],
    ...overrides,
  };
}

function createDetailedClusterCapacity(
  overrides: Partial<DetailedClusterCapacity> = {}
): DetailedClusterCapacity {
  return {
    totalGpus: 16,
    allocatedGpus: 0,
    availableGpus: 16,
    maxContiguousAvailable: 8,
    maxNodeGpuCapacity: 8,
    gpuNodeCount: 2,
    totalMemoryGb: 80,
    nodePools: [
      {
        name: 'gpu',
        gpuCount: 16,
        nodeCount: 2,
        availableGpus: 16,
        gpuModel: 'NVIDIA-H100-80GB',
      },
    ],
    ...overrides,
  };
}

describe('getGpuFitCapacityDisplay', () => {
  it('uses total cluster GPUs for fit math and shows homogeneous node topology', () => {
    const result = getGpuFitCapacityDisplay(createClusterGpuCapacity());

    expect(result.gpuCount).toBe(16);
    expect(result.capacityLabel).toBe('2x8x80 GB');
  });

  it('derives the same topology label from detailed node-pool data', () => {
    const result = getGpuFitCapacityDisplay(createDetailedClusterCapacity());

    expect(result.gpuCount).toBe(16);
    expect(result.capacityLabel).toBe('2x8x80 GB');
  });

  it('falls back to a cluster-wide label for mixed node sizes', () => {
    const result = getGpuFitCapacityDisplay(
      createDetailedClusterCapacity({
        totalGpus: 12,
        gpuNodeCount: 2,
        nodePools: [
          {
            name: 'large',
            gpuCount: 8,
            nodeCount: 1,
            availableGpus: 8,
          },
          {
            name: 'small',
            gpuCount: 4,
            nodeCount: 1,
            availableGpus: 4,
          },
        ],
      })
    );

    expect(result.gpuCount).toBe(12);
    expect(result.capacityLabel).toBe('12x80 GB across 2 nodes');
  });
});
