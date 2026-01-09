/**
 * Runtimes Status Page
 *
 * Shows installation status and health of KAITO, KubeRay, and Dynamo runtimes.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  SectionBox,
  Loader,
  StatusLabel,
  StatusLabelProps,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useApiClient } from '../lib/api-client';
import type { RuntimesStatusResponse, RuntimeStatus } from '@kubefoundry/shared';
import { ConnectionError } from '../components/ConnectionBanner';

function getStatusColor(runtime: RuntimeStatus): StatusLabelProps['status'] {
  if (runtime.healthy) return 'success';
  if (runtime.installed && !runtime.healthy) return 'warning';
  return 'error';
}

function getStatusText(runtime: RuntimeStatus): string {
  if (runtime.healthy) return 'Healthy';
  if (runtime.installed && !runtime.healthy) return 'Degraded';
  return 'Not Installed';
}

function getRuntimeDescription(runtimeId: string): string {
  switch (runtimeId) {
    case 'kaito':
      return 'Kubernetes AI Toolchain Operator - Deploy AI models with GPU node provisioning';
    case 'kuberay':
      return 'KubeRay - Run Ray distributed computing workloads on Kubernetes';
    case 'dynamo':
      return 'NVIDIA Dynamo - Deploy and serve AI models with NVIDIA optimizations';
    default:
      return '';
  }
}

export function RuntimesStatus() {
  const api = useApiClient();

  const [runtimesStatus, setRuntimesStatus] = useState<RuntimesStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  // Fetch runtimes status
  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.runtimes.getStatus();
      setRuntimesStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch runtimes status');
    } finally {
      setLoading(false);
    }
  }, [api]);

  // Install runtime
  const handleInstall = useCallback(
    async (runtimeId: string) => {
      setInstalling(runtimeId);

      try {
        await api.installation.installProvider(runtimeId);
        // Refresh status after install
        await fetchStatus();
      } catch (err) {
        alert(`Failed to install ${runtimeId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setInstalling(null);
      }
    },
    [api, fetchStatus]
  );

  // Initial fetch
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading) {
    return <Loader title="Loading runtimes status..." />;
  }

  if (error) {
    return (
      <SectionBox title="Runtimes">
        <ConnectionError error={error} onRetry={fetchStatus} />
      </SectionBox>
    );
  }

  const runtimes = runtimesStatus?.runtimes || [];

  return (
    <SectionBox
      title="Runtime Status"
      headerProps={{
        actions: [
          <button
            key="refresh"
            onClick={fetchStatus}
            style={{
              padding: '6px 12px',
              backgroundColor: 'transparent',
              border: '1px solid rgba(128, 128, 128, 0.3)',
              borderRadius: '4px',
              cursor: 'pointer',
              color: 'inherit',
            }}
          >
            Refresh
          </button>,
        ],
      }}
    >
      <div style={{ display: 'grid', gap: '16px' }}>
        {runtimes.map((runtime) => (
          <div
            key={runtime.id}
            style={{
              border: '1px solid rgba(128, 128, 128, 0.3)',
              borderRadius: '8px',
              padding: '20px',
              backgroundColor: 'transparent',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <div>
                <h3 style={{ margin: '0 0 4px 0', fontSize: '18px', textTransform: 'uppercase' }}>
                  {runtime.name}
                </h3>
                <p style={{ margin: 0, fontSize: '14px', opacity: 0.7 }}>
                  {getRuntimeDescription(runtime.id)}
                </p>
              </div>
              <StatusLabel status={getStatusColor(runtime)}>
                {getStatusText(runtime)}
              </StatusLabel>
            </div>

            {/* Status details */}
            <div style={{ fontSize: '14px', marginBottom: '16px' }}>
              {runtime.version && (
                <div style={{ opacity: 0.7 }}>
                  Version: <strong>{runtime.version}</strong>
                </div>
              )}
              {runtime.message && (
                <div style={{ color: !runtime.healthy ? '#f44336' : 'inherit', opacity: runtime.healthy ? 0.7 : 1, marginTop: '4px' }}>
                  {runtime.message}
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {!runtime.installed && (
                <button
                  onClick={() => handleInstall(runtime.id)}
                  disabled={installing === runtime.id}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#1976d2',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: installing === runtime.id ? 'wait' : 'pointer',
                    opacity: installing === runtime.id ? 0.7 : 1,
                  }}
                >
                  {installing === runtime.id ? 'Installing...' : 'Install'}
                </button>
              )}
              {runtime.installed && (
                <button
                  onClick={() => handleInstall(runtime.id)}
                  disabled={installing === runtime.id}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'transparent',
                    color: 'inherit',
                    border: '1px solid rgba(128, 128, 128, 0.3)',
                    borderRadius: '4px',
                    cursor: installing === runtime.id ? 'wait' : 'pointer',
                  }}
                >
                  Upgrade
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {runtimes.length === 0 && (
        <div style={{ padding: '24px', textAlign: 'center', opacity: 0.7 }}>
          No runtimes found. Check your connection to the KubeFoundry backend.
        </div>
      )}
    </SectionBox>
  );
}
