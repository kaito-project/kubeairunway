import { describe, test, expect } from 'bun:test';
import {
  normalizeGpuModel,
  estimateCost,
  estimateNodePoolCosts,
  getSupportedGpuModels,
  costEstimationService,
} from './costEstimation';
import type { NodePoolInfo } from '@kubefoundry/shared';

describe('normalizeGpuModel', () => {
  test('normalizes A100-80GB variants', () => {
    expect(normalizeGpuModel('NVIDIA-A100-SXM4-80GB')).toBe('A100-80GB');
    expect(normalizeGpuModel('NVIDIA-A100-80GB-PCIe')).toBe('A100-80GB');
    expect(normalizeGpuModel('A100-80GB')).toBe('A100-80GB');
  });

  test('normalizes A100-40GB variants', () => {
    expect(normalizeGpuModel('NVIDIA-A100-SXM4-40GB')).toBe('A100-40GB');
    expect(normalizeGpuModel('NVIDIA-A100-PCIE-40GB')).toBe('A100-40GB');
    expect(normalizeGpuModel('A100')).toBe('A100-40GB');
  });

  test('normalizes H100 variants', () => {
    expect(normalizeGpuModel('NVIDIA-H100-80GB-HBM3')).toBe('H100-80GB');
    expect(normalizeGpuModel('NVIDIA-H100-SXM5-80GB')).toBe('H100-80GB');
    expect(normalizeGpuModel('H100')).toBe('H100-80GB');
  });

  test('normalizes T4 variants', () => {
    expect(normalizeGpuModel('Tesla-T4')).toBe('T4');
    expect(normalizeGpuModel('NVIDIA-Tesla-T4')).toBe('T4');
    expect(normalizeGpuModel('T4')).toBe('T4');
  });

  test('normalizes L4 variants', () => {
    expect(normalizeGpuModel('NVIDIA-L4')).toBe('L4');
    expect(normalizeGpuModel('L4')).toBe('L4');
  });

  test('normalizes L40S variants', () => {
    expect(normalizeGpuModel('NVIDIA-L40S')).toBe('L40S');
    expect(normalizeGpuModel('L40S')).toBe('L40S');
  });

  test('normalizes V100 variants', () => {
    expect(normalizeGpuModel('Tesla-V100-SXM2-16GB')).toBe('V100');
    expect(normalizeGpuModel('NVIDIA-V100')).toBe('V100');
  });

  test('returns default for unknown GPU', () => {
    expect(normalizeGpuModel('Unknown-GPU-Model')).toBe('A100-40GB');
    expect(normalizeGpuModel('')).toBe('A100-40GB');
  });
});

describe('estimateCost', () => {
  test('calculates cost for single GPU deployment', () => {
    const result = estimateCost({
      gpuType: 'A100-80GB',
      gpuCount: 1,
      replicas: 1,
    });

    expect(result.totalGpus).toBe(1);
    expect(result.normalizedGpuModel).toBe('A100-80GB');
    expect(result.estimate.hourly).toBeGreaterThan(0);
    expect(result.estimate.monthly).toBeGreaterThan(0);
    expect(result.estimate.currency).toBe('USD');
    expect(result.estimate.source).toBe('static');
    expect(result.estimate.confidence).toBe('high');
  });

  test('calculates cost for multi-GPU deployment', () => {
    const result = estimateCost({
      gpuType: 'A100-80GB',
      gpuCount: 4,
      replicas: 2,
    });

    expect(result.totalGpus).toBe(8);
    expect(result.estimate.hourly).toBeGreaterThan(result.perGpu.hourly);
    // 8 GPUs should cost 8x a single GPU
    expect(result.estimate.hourly).toBeCloseTo(result.perGpu.hourly * 8, 1);
  });

  test('calculates monthly based on 730 hours by default', () => {
    const result = estimateCost({
      gpuType: 'T4',
      gpuCount: 1,
      replicas: 1,
    });

    // Monthly should be approximately hourly * 730 (small variance due to rounding)
    const expectedMonthly = result.estimate.hourly * 730;
    expect(result.estimate.monthly).toBeGreaterThan(expectedMonthly * 0.99);
    expect(result.estimate.monthly).toBeLessThan(expectedMonthly * 1.02);
  });

  test('respects custom hours per month', () => {
    const result = estimateCost({
      gpuType: 'T4',
      gpuCount: 1,
      replicas: 1,
      hoursPerMonth: 160, // 8 hours/day, 20 days/month
    });

    // Monthly should be approximately hourly * 160 (small variance due to rounding)
    const expectedMonthly = result.estimate.hourly * 160;
    expect(result.estimate.monthly).toBeGreaterThan(expectedMonthly * 0.99);
    expect(result.estimate.monthly).toBeLessThan(expectedMonthly * 1.02);
  });

  test('includes provider-specific breakdown', () => {
    const result = estimateCost({
      gpuType: 'A100-80GB',
      gpuCount: 1,
      replicas: 1,
    });

    expect(result.byProvider).toBeDefined();
    expect(result.byProvider!.length).toBeGreaterThan(0);

    const awsBreakdown = result.byProvider!.find((p) => p.provider === 'aws');
    expect(awsBreakdown).toBeDefined();
    expect(awsBreakdown!.hourly).toBeGreaterThan(0);
  });

  test('handles unknown GPU gracefully', () => {
    const result = estimateCost({
      gpuType: 'Unknown-GPU',
      gpuCount: 1,
      replicas: 1,
    });

    // Should fall back to default A100-40GB pricing
    expect(result.normalizedGpuModel).toBe('A100-40GB');
    expect(result.estimate.hourly).toBeGreaterThan(0);
  });
});

describe('estimateNodePoolCosts', () => {
  test('estimates costs for multiple node pools', () => {
    const nodePools: NodePoolInfo[] = [
      { name: 'a100-pool', gpuCount: 8, nodeCount: 2, availableGpus: 6, gpuModel: 'NVIDIA-A100-SXM4-80GB' },
      { name: 't4-pool', gpuCount: 4, nodeCount: 2, availableGpus: 4, gpuModel: 'Tesla-T4' },
    ];

    const results = estimateNodePoolCosts(nodePools, 2, 1);

    expect(results.length).toBe(2);

    const a100Pool = results.find((r) => r.poolName === 'a100-pool');
    expect(a100Pool).toBeDefined();
    expect(a100Pool!.costBreakdown.normalizedGpuModel).toBe('A100-80GB');

    const t4Pool = results.find((r) => r.poolName === 't4-pool');
    expect(t4Pool).toBeDefined();
    expect(t4Pool!.costBreakdown.normalizedGpuModel).toBe('T4');

    // A100 should be more expensive than T4
    expect(a100Pool!.costBreakdown.estimate.hourly).toBeGreaterThan(t4Pool!.costBreakdown.estimate.hourly);
  });

  test('skips pools without GPU model', () => {
    const nodePools: NodePoolInfo[] = [
      { name: 'gpu-pool', gpuCount: 4, nodeCount: 1, availableGpus: 4, gpuModel: 'NVIDIA-A100-SXM4-80GB' },
      { name: 'cpu-pool', gpuCount: 0, nodeCount: 3, availableGpus: 0 }, // No gpuModel
    ];

    const results = estimateNodePoolCosts(nodePools, 1, 1);

    expect(results.length).toBe(1);
    expect(results[0].poolName).toBe('gpu-pool');
  });
});

describe('getSupportedGpuModels', () => {
  test('returns list of supported GPU models', () => {
    const models = getSupportedGpuModels();

    expect(models.length).toBeGreaterThan(0);

    const a100 = models.find((m) => m.model === 'A100-80GB');
    expect(a100).toBeDefined();
    expect(a100!.memoryGb).toBe(80);
    expect(a100!.avgHourlyRate).toBeGreaterThan(0);
    expect(a100!.generation).toBe('ampere');
  });
});

describe('costEstimationService', () => {
  test('exposes all functions', () => {
    expect(typeof costEstimationService.normalizeGpuModel).toBe('function');
    expect(typeof costEstimationService.estimateCost).toBe('function');
    expect(typeof costEstimationService.estimateNodePoolCosts).toBe('function');
    expect(typeof costEstimationService.getSupportedGpuModels).toBe('function');
    expect(typeof costEstimationService.getPricingLastUpdated).toBe('function');
  });

  test('returns pricing last updated date', () => {
    const lastUpdated = costEstimationService.getPricingLastUpdated();
    expect(lastUpdated).toBeDefined();
    expect(lastUpdated.length).toBeGreaterThan(0);
  });
});
