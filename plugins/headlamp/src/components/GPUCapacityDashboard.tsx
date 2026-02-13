/**
 * GPU Capacity Dashboard Component
 *
 * Displays GPU availability and capacity across the cluster.
 */

import type { ClusterGpuCapacity } from '@kubeairunway/shared';

interface GPUCapacityDashboardProps {
  gpuData: ClusterGpuCapacity | null;
  onRefresh?: () => void;
}

export function GPUCapacityDashboard({ gpuData, onRefresh }: GPUCapacityDashboardProps) {
  if (!gpuData) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', opacity: 0.7 }}>
        <p>Loading GPU information...</p>
      </div>
    );
  }

  const { nodes = [], totalGpus = 0, availableGpus = 0 } = gpuData;
  const usedGPUs = totalGpus - availableGpus;
  const utilizationPercent = totalGpus > 0 ? (usedGPUs / totalGpus) * 100 : 0;

  if (totalGpus === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
        <h3 style={{ marginBottom: '8px' }}>No GPU Resources Available</h3>
        <p style={{ opacity: 0.7 }}>
          The cluster does not have any GPU nodes detected.
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            style={{
              marginTop: '16px',
              padding: '8px 16px',
              backgroundColor: 'transparent',
              border: '1px solid rgba(128, 128, 128, 0.3)',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'inherit',
            }}
          >
            Refresh
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        {onRefresh && (
          <button
            onClick={onRefresh}
            style={{
              padding: '6px 12px',
              backgroundColor: 'transparent',
              border: '1px solid rgba(128, 128, 128, 0.3)',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '13px',
              color: 'inherit',
            }}
          >
            Refresh
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {/* Nodes with GPUs */}
        <div
          style={{
            padding: '20px',
            backgroundColor: 'rgba(128, 128, 128, 0.1)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '36px', fontWeight: 600, color: '#1976d2' }}>{nodes.length}</div>
          <div style={{ fontSize: '14px', opacity: 0.7 }}>GPU Nodes</div>
        </div>

        {/* Total GPUs */}
        <div
          style={{
            padding: '20px',
            backgroundColor: 'rgba(128, 128, 128, 0.1)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '36px', fontWeight: 600, color: '#1976d2' }}>{totalGpus}</div>
          <div style={{ fontSize: '14px', opacity: 0.7 }}>Total GPUs</div>
        </div>

        {/* Available GPUs */}
        <div
          style={{
            padding: '20px',
            backgroundColor: availableGpus > 0 ? 'rgba(46, 125, 50, 0.15)' : 'rgba(198, 40, 40, 0.15)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '36px', fontWeight: 600, color: availableGpus > 0 ? '#4caf50' : '#f44336' }}>
            {availableGpus}
          </div>
          <div style={{ fontSize: '14px', opacity: 0.7 }}>Available GPUs</div>
        </div>

        {/* Utilization */}
        <div
          style={{
            padding: '20px',
            backgroundColor: 'rgba(128, 128, 128, 0.1)',
            borderRadius: '8px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '36px', fontWeight: 600, color: '#1976d2' }}>
            {utilizationPercent.toFixed(0)}%
          </div>
          <div style={{ fontSize: '14px', opacity: 0.7 }}>Utilization</div>
        </div>
      </div>

      {/* Utilization bar */}
      <div style={{ marginTop: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '14px', fontWeight: 500 }}>GPU Utilization</span>
          <span style={{ fontSize: '14px', opacity: 0.7 }}>{usedGPUs} / {totalGpus} GPUs in use</span>
        </div>
        <div
          style={{
            width: '100%',
            height: '20px',
            backgroundColor: 'rgba(128, 128, 128, 0.3)',
            borderRadius: '10px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${utilizationPercent}%`,
              height: '100%',
              backgroundColor: utilizationPercent > 90 ? '#f44336' : utilizationPercent > 70 ? '#ff9800' : '#4caf50',
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {/* GPU Memory info if available */}
      {gpuData.totalMemoryGb && (
        <div style={{ marginTop: '24px', padding: '16px', backgroundColor: 'rgba(128, 128, 128, 0.1)', borderRadius: '8px' }}>
          <div style={{ fontWeight: 500, marginBottom: '8px' }}>GPU Memory</div>
          <div style={{ opacity: 0.7 }}>{gpuData.totalMemoryGb} GB per GPU</div>
        </div>
      )}
    </div>
  );
}
