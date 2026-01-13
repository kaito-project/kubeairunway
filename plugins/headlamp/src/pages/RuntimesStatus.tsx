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
  if (runtime.installed) return 'warning'; // CRD exists but operator not running
  return 'error';
}

function getStatusText(runtime: RuntimeStatus): string {
  if (runtime.healthy) return 'Healthy';
  if (runtime.installed) return 'Unhealthy'; // CRD exists but operator not running
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
  const [uninstalling, setUninstalling] = useState<string | null>(null);

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

  // Uninstall runtime
  const handleUninstall = useCallback(
    async (runtimeId: string) => {
      setUninstalling(runtimeId);

      try {
        const result = await api.installation.uninstallProvider(runtimeId);
        if (result.success) {
          // Refresh status after uninstall
          await fetchStatus();
        } else {
          alert(`Uninstall failed: ${result.message}`);
        }
      } catch (err) {
        alert(`Failed to uninstall ${runtimeId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setUninstalling(null);
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

            {/* Status details - CRD and Operator */}
            <div style={{ fontSize: '14px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ opacity: 0.7 }}>CRD</span>
                <StatusLabel status={runtime.installed ? 'success' : 'error'}>
                  {runtime.installed ? 'Installed' : 'Not Installed'}
                </StatusLabel>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ opacity: 0.7 }}>Operator</span>
                <StatusLabel status={runtime.healthy ? 'success' : 'error'}>
                  {runtime.healthy ? 'Running' : 'Not Running'}
                </StatusLabel>
              </div>
              {runtime.version && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.7 }}>
                  <span>Version</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{runtime.version}</span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {/* Show Install button if not fully installed (CRD missing or operator not running) */}
              {!runtime.healthy && (
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
                  {installing === runtime.id ? 'Installing...' : `Install ${runtime.name}`}
                </button>
              )}
              {/* Show Upgrade and Uninstall only when fully healthy */}
              {runtime.healthy && (
                <>
                  <button
                    onClick={() => handleInstall(runtime.id)}
                    disabled={installing === runtime.id || uninstalling === runtime.id}
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
                  <button
                    onClick={() => handleUninstall(runtime.id)}
                    disabled={uninstalling === runtime.id || installing === runtime.id}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: uninstalling === runtime.id ? '#d32f2f' : 'transparent',
                      color: uninstalling === runtime.id ? 'white' : '#d32f2f',
                      border: '1px solid #d32f2f',
                      borderRadius: '4px',
                      cursor: uninstalling === runtime.id ? 'wait' : 'pointer',
                      opacity: uninstalling === runtime.id ? 0.7 : 1,
                    }}
                  >
                    {uninstalling === runtime.id ? 'Uninstalling...' : 'Uninstall'}
                  </button>
                </>
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
