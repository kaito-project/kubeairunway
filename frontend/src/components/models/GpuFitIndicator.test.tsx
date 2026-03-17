import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GpuFitIndicator } from './GpuFitIndicator';

describe('GpuFitIndicator', () => {
  it('renders the full cluster topology label when provided', () => {
    render(
      <GpuFitIndicator
        estimatedGpuMemoryGb={906}
        clusterCapacityGb={80}
        gpuCount={16}
        capacityLabel="2x8x80 GB"
      />
    );

    expect(screen.getByText('906.0 / 1280 GB (2x8x80 GB)')).toBeInTheDocument();
  });
});
