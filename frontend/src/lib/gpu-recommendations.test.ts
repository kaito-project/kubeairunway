import { describe, expect, it } from 'vitest';
import {
  calculateGpuRecommendation,
  calculateMultiNode,
  calculatePipelineParallel,
  formatGpuCount,
} from './gpu-recommendations';
import type { Model, DetailedClusterCapacity } from './api';

// Helper to create a minimal model for testing
function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'test-model',
    name: 'Test Model',
    provider: 'kuberay',
    description: 'A test model',
    ...overrides,
  } as Model;
}

// Helper to create cluster capacity
function createCapacity(overrides: Partial<DetailedClusterCapacity> = {}): DetailedClusterCapacity {
  return {
    totalGpus: 8,
    allocatedGpus: 4,
    availableGpus: 4,
    maxContiguousAvailable: 4,
    maxNodeGpuCapacity: 8,
    gpuNodeCount: 1,
    totalMemoryGb: 80, // A100 80GB
    nodePools: [],
    ...overrides,
  };
}

describe('calculateGpuRecommendation', () => {
  describe('fallback behavior', () => {
    it('returns 1 GPU when model is undefined', () => {
      const result = calculateGpuRecommendation(undefined, createCapacity());
      expect(result.recommendedGpus).toBe(1);
      expect(result.reason).toBe('Starting with 1 GPU per replica');
    });

    it('returns 1 GPU when clusterCapacity is undefined', () => {
      const result = calculateGpuRecommendation(createModel(), undefined);
      expect(result.recommendedGpus).toBe(1);
      expect(result.reason).toBe('Starting with 1 GPU per replica');
    });

    it('returns 1 GPU when both are undefined', () => {
      const result = calculateGpuRecommendation(undefined, undefined);
      expect(result.recommendedGpus).toBe(1);
    });
  });

  describe('parameter count detection', () => {
    it('uses parameterCount field when available', () => {
      const model = createModel({ parameterCount: 8_000_000_000 }); // 8B
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      // 8B params * 2 bytes * 1.2 = 19.2GB, fits in 1 A100 80GB
      expect(result.recommendedGpus).toBe(1);
      expect(result.reason).toContain('8.0B params');
    });

    it('uses parameters field when parameterCount is not available', () => {
      const model = createModel({ parameters: 70_000_000_000 }); // 70B
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      // 70B params * 2 bytes * 1.2 = 168GB, needs 3 A100 80GB
      expect(result.recommendedGpus).toBeGreaterThan(1);
      expect(result.reason).toContain('70.0B params');
    });

    it('parses size field when no parameterCount (e.g., "7B")', () => {
      const model = createModel({ size: '7B' });
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.recommendedGpus).toBe(1);
      expect(result.reason).toContain('7.0B params');
    });

    it('parses size field with decimal (e.g., "3.5B")', () => {
      const model = createModel({ size: '3.5B' });
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.recommendedGpus).toBe(1);
      expect(result.reason).toContain('3.5B params');
    });

    it('handles lowercase size field (e.g., "13b")', () => {
      const model = createModel({ size: '13b' });
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.reason).toContain('13.0B params');
    });
  });

  describe('memory estimation', () => {
    it('prefers estimatedGpuMemoryGb over calculated memory', () => {
      const model = createModel({
        parameterCount: 8_000_000_000, // Would calculate 19.2GB
        estimatedGpuMemoryGb: 16, // But model says 16GB
      });
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.reason).toContain('16GB needed');
    });

    it('parses minGpuMemory when estimatedGpuMemoryGb not available', () => {
      const model = createModel({
        parameterCount: 8_000_000_000,
        minGpuMemory: '16GB',
      });
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.reason).toContain('16GB needed');
    });

    it('falls back to calculated memory when no estimates provided', () => {
      const model = createModel({ parameterCount: 8_000_000_000 });
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      // 8B * 2 * 1.2 = 19.2GB
      expect(result.reason).toContain('19GB needed');
    });

    it('uses estimatedGpuMemoryGb when no param count available', () => {
      const model = createModel({ estimatedGpuMemoryGb: 40 });
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.recommendedGpus).toBe(1);
      expect(result.reason).toContain('40GB');
    });
  });

  describe('GPU count calculation', () => {
    it('calculates 1 GPU for small models on large GPUs', () => {
      const model = createModel({ parameterCount: 3_000_000_000, minGpuMemory: '8GB' });
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.recommendedGpus).toBe(1);
    });

    it('calculates multiple GPUs for large models', () => {
      const model = createModel({ parameterCount: 70_000_000_000, estimatedGpuMemoryGb: 140 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 8 });
      const result = calculateGpuRecommendation(model, capacity);
      
      // 140GB / 80GB = 1.75 -> ceil = 2
      expect(result.recommendedGpus).toBe(2);
    });

    it('returns multi-node recommendation when model exceeds single node capacity', () => {
      const model = createModel({ parameterCount: 400_000_000_000, estimatedGpuMemoryGb: 800 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 4 });
      const result = calculateGpuRecommendation(model, capacity);

      // 800GB / 80GB = 10 GPUs needed, 4 per node -> 3 nodes
      expect(result.recommendedGpus).toBe(4); // gpusPerNode
      expect(result.multiNode).toBeDefined();
      expect(result.multiNode!.nodeCount).toBe(3); // ceil(10/4) = 3
      expect(result.multiNode!.gpusPerNode).toBe(4);
      expect(result.multiNode!.totalGpus).toBe(12); // 3 * 4
      expect(result.multiNode!.pipelineParallelSize).toBe(3);
      expect(result.reason).toContain('distributed across 3 nodes');
    });
  });

  describe('alternatives generation', () => {
    it('generates alternatives that divide evenly into maxNodeGpuCapacity', () => {
      const model = createModel({ parameterCount: 13_000_000_000, estimatedGpuMemoryGb: 80 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 8 });
      const result = calculateGpuRecommendation(model, capacity);
      
      // 80GB / 80GB = 1 GPU recommended
      // Alternatives should be divisors of 8: [2, 4, 8]
      expect(result.recommendedGpus).toBe(1);
      expect(result.alternatives).toBeDefined();
      expect(result.alternatives).toContain(2);
    });

    it('excludes the recommended value from alternatives', () => {
      const model = createModel({ parameterCount: 13_000_000_000, estimatedGpuMemoryGb: 160 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 8 });
      const result = calculateGpuRecommendation(model, capacity);
      
      // 160GB / 80GB = 2 GPUs recommended
      expect(result.recommendedGpus).toBe(2);
      expect(result.alternatives).not.toContain(2);
    });

    it('returns at most 2 alternatives', () => {
      const model = createModel({ parameterCount: 1_000_000_000, estimatedGpuMemoryGb: 40 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 8 });
      const result = calculateGpuRecommendation(model, capacity);
      
      if (result.alternatives) {
        expect(result.alternatives.length).toBeLessThanOrEqual(2);
      }
    });
  });

  describe('unknown model size handling', () => {
    it('returns fallback for model without any size info', () => {
      const model = createModel({}); // No parameterCount, parameters, size, or estimatedGpuMemoryGb
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.recommendedGpus).toBe(1);
      expect(result.reason).toBe('Model size unknown - using 1 GPU');
    });
  });

  describe('edge cases', () => {
    it('handles zero GPU memory gracefully', () => {
      const model = createModel({ parameterCount: 8_000_000_000 });
      const capacity = createCapacity({ totalMemoryGb: 0 });
      const result = calculateGpuRecommendation(model, capacity);
      
      // Should fall back to parameter-based heuristic
      expect(result.recommendedGpus).toBeGreaterThanOrEqual(1);
    });

    it('handles very small models', () => {
      const model = createModel({ parameterCount: 100_000_000, estimatedGpuMemoryGb: 1 }); // 100M params
      const capacity = createCapacity({ totalMemoryGb: 80 });
      const result = calculateGpuRecommendation(model, capacity);
      
      expect(result.recommendedGpus).toBe(1);
    });

    it('handles maxNodeGpuCapacity of 1 with multi-node', () => {
      const model = createModel({ parameterCount: 70_000_000_000, estimatedGpuMemoryGb: 160 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 1 });
      const result = calculateGpuRecommendation(model, capacity);

      expect(result.recommendedGpus).toBe(1);
      expect(result.multiNode).toBeDefined();
      expect(result.multiNode!.nodeCount).toBe(2); // ceil(2/1) = 2
      expect(result.reason).toContain('distributed across 2 nodes');
    });
  });

  describe('multi-node recommendations', () => {
    it('returns multiNode when model exceeds single node', () => {
      // Qwen2.5-72B scenario: ~146GB on 1-GPU 80GB nodes
      const model = createModel({ parameterCount: 72_000_000_000, estimatedGpuMemoryGb: 146 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 1 });
      const result = calculateGpuRecommendation(model, capacity);

      expect(result.recommendedGpus).toBe(1);
      expect(result.multiNode).toBeDefined();
      expect(result.multiNode!.nodeCount).toBe(2);
      expect(result.multiNode!.gpusPerNode).toBe(1);
      expect(result.multiNode!.totalGpus).toBe(2);
      expect(result.multiNode!.pipelineParallelSize).toBe(2);
    });

    it('returns multiNode for multi-GPU nodes when model still exceeds', () => {
      // 800GB model on 4-GPU 80GB nodes (320GB per node)
      const model = createModel({ parameterCount: 400_000_000_000, estimatedGpuMemoryGb: 800 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 4 });
      const result = calculateGpuRecommendation(model, capacity);

      expect(result.multiNode).toBeDefined();
      expect(result.multiNode!.nodeCount).toBe(3); // ceil(10/4)
      expect(result.multiNode!.gpusPerNode).toBe(4);
      expect(result.multiNode!.pipelineParallelSize).toBe(3);
    });

    it('does not return multiNode when model fits on one node', () => {
      const model = createModel({ parameterCount: 8_000_000_000, estimatedGpuMemoryGb: 16 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 8 });
      const result = calculateGpuRecommendation(model, capacity);

      expect(result.recommendedGpus).toBe(1);
      expect(result.multiNode).toBeUndefined();
    });

    it('returns multiNode in parameter-based heuristic fallback', () => {
      // Very large model (80B+) with no GPU memory info -> heuristic = 8 GPUs, max 2
      const model = createModel({ parameterCount: 100_000_000_000 });
      const capacity = createCapacity({ totalMemoryGb: 0, maxNodeGpuCapacity: 2 });
      const result = calculateGpuRecommendation(model, capacity);

      // Heuristic: 100B -> 8 GPUs base, max node = 2
      expect(result.recommendedGpus).toBe(2);
      expect(result.multiNode).toBeDefined();
      expect(result.multiNode!.nodeCount).toBe(4); // ceil(8/2)
      expect(result.multiNode!.pipelineParallelSize).toBe(4);
    });

    it('includes estimatedMemoryGb in result for recalculation', () => {
      const model = createModel({ parameterCount: 70_000_000_000, estimatedGpuMemoryGb: 140 });
      const capacity = createCapacity({ totalMemoryGb: 80, maxNodeGpuCapacity: 8 });
      const result = calculateGpuRecommendation(model, capacity);

      expect(result.estimatedMemoryGb).toBe(140);
    });
  });
});

describe('calculateMultiNode', () => {
  it('returns null when model fits on one node', () => {
    // 16GB model, 80GB GPU, 1 GPU per node = 80GB per node
    const result = calculateMultiNode(16, 80, 1);
    expect(result).toBeNull();
  });

  it('returns multi-node when model exceeds one node', () => {
    // 146GB model, 80GB GPU, 1 GPU per node
    const result = calculateMultiNode(146, 80, 1);
    expect(result).not.toBeNull();
    expect(result!.nodeCount).toBe(2);
    expect(result!.gpusPerNode).toBe(1);
    expect(result!.totalGpus).toBe(2);
    expect(result!.pipelineParallelSize).toBe(2);
  });

  it('reduces nodeCount when GPU count increases', () => {
    // 146GB model, 80GB GPU, 4 GPUs per node = 320GB per node -> fits on 1
    const result = calculateMultiNode(146, 80, 4);
    expect(result).toBeNull();
  });

  it('increases nodeCount when GPU count decreases', () => {
    // 800GB model, 80GB GPU, 2 GPUs per node = 160GB per node
    const result = calculateMultiNode(800, 80, 2);
    expect(result).not.toBeNull();
    expect(result!.nodeCount).toBe(5); // ceil(800/160)
    expect(result!.gpusPerNode).toBe(2);
    expect(result!.pipelineParallelSize).toBe(5);
  });

  it('returns null for zero or negative gpuMemoryGb', () => {
    expect(calculateMultiNode(100, 0, 1)).toBeNull();
    expect(calculateMultiNode(100, -1, 1)).toBeNull();
  });

  it('returns null for zero or negative gpuCount', () => {
    expect(calculateMultiNode(100, 80, 0)).toBeNull();
    expect(calculateMultiNode(100, 80, -1)).toBeNull();
  });
});

describe('calculatePipelineParallel', () => {
  it('returns 1 when model fits on one node', () => {
    expect(calculatePipelineParallel(16, 80, 1)).toBe(1);
  });

  it('matches required node count when model exceeds one node', () => {
    expect(calculatePipelineParallel(146, 80, 1)).toBe(2);
    expect(calculatePipelineParallel(800, 80, 2)).toBe(5);
  });

  it('returns 1 for invalid inputs', () => {
    expect(calculatePipelineParallel(0, 80, 1)).toBe(1);
    expect(calculatePipelineParallel(100, 0, 1)).toBe(1);
    expect(calculatePipelineParallel(100, 80, 0)).toBe(1);
  });
});

describe('formatGpuCount', () => {
  it('returns singular for 1 GPU', () => {
    expect(formatGpuCount(1)).toBe('1 GPU');
  });

  it('returns plural for multiple GPUs', () => {
    expect(formatGpuCount(2)).toBe('2 GPUs');
    expect(formatGpuCount(8)).toBe('8 GPUs');
  });

  it('returns plural for 0 GPUs', () => {
    expect(formatGpuCount(0)).toBe('0 GPUs');
  });
});
