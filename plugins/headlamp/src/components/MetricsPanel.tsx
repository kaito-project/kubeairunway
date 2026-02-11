/**
 * Metrics Panel Component
 *
 * Displays deployment metrics in a clean panel format.
 */

import type { MetricsResponse, RawMetricValue } from '@kubefoundry/shared';

interface MetricsPanelProps {
  metrics: MetricsResponse | null;
  onRefresh?: () => void;
}

function formatMetricValue(value: number, name: string): string {
  if (typeof value !== 'number' || isNaN(value)) {
    return 'N/A';
  }

  // Format based on metric name patterns
  if (name.includes('latency') || name.includes('time') || name.includes('duration')) {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)}s`;
    }
    return `${value.toFixed(1)}ms`;
  }
  if (name.includes('percent') || name.includes('ratio') || name.includes('utilization')) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (name.includes('tokens') && name.includes('per')) {
    return `${value.toFixed(1)} tok/s`;
  }

  // Generic number formatting
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }
  return value.toFixed(2);
}

function getDisplayName(name: string): string {
  // Convert prometheus-style metric names to human readable
  return name
    .replace(/^(vllm:|ray_serve_|inference_)/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function MetricsPanel({ metrics, onRefresh }: MetricsPanelProps) {
  if (!metrics || !metrics.available) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', opacity: 0.7 }}>
        <p>{metrics?.error || 'No metrics available yet.'}</p>
        <p style={{ fontSize: '14px', marginTop: '8px' }}>
          {metrics?.runningOffCluster 
            ? 'Metrics require KubeFoundry to be running in-cluster.'
            : 'Metrics will appear once the deployment is running and receiving traffic.'}
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

  const rawMetrics = metrics.metrics || [];

  if (rawMetrics.length === 0) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', opacity: 0.7 }}>
        <p>No metrics collected yet.</p>
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

  // Group metrics by prefix
  const groupedMetrics: Record<string, RawMetricValue[]> = {};

  for (const metric of rawMetrics) {
    const prefix = metric.name.split('_')[0] || 'General';
    const category = prefix.charAt(0).toUpperCase() + prefix.slice(1);
    if (!groupedMetrics[category]) {
      groupedMetrics[category] = [];
    }
    groupedMetrics[category].push(metric);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '12px', opacity: 0.6 }}>
          Last updated: {new Date(metrics.timestamp).toLocaleTimeString()}
        </div>
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

      {Object.entries(groupedMetrics).map(([category, categoryMetrics]) => (
        <div key={category} style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>{category}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
            {categoryMetrics.slice(0, 12).map((metric, idx) => (
              <div
                key={`${metric.name}-${idx}`}
                style={{
                  padding: '16px',
                  backgroundColor: 'rgba(128, 128, 128, 0.1)',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: '24px', fontWeight: 600, marginBottom: '4px', color: '#1976d2' }}>
                  {formatMetricValue(metric.value, metric.name)}
                </div>
                <div style={{ fontSize: '13px', opacity: 0.7 }}>
                  {getDisplayName(metric.name)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
