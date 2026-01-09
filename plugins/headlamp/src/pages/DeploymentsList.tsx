/**
 * Deployments List Page
 *
 * Displays all deployments across namespaces with filtering and status.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  SectionBox,
  SimpleTable,
  Link as HeadlampLink,
  Loader,
  StatusLabel,
  StatusLabelProps,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { useApiClient } from '../lib/api-client';
import type { DeploymentStatus, DeploymentPhase } from '@kubefoundry/shared';
import { ConnectionError } from '../components/ConnectionBanner';

// Status color mapping
function getStatusColor(phase: DeploymentPhase): StatusLabelProps['status'] {
  switch (phase) {
    case 'Running':
      return 'success';
    case 'Pending':
    case 'Deploying':
      return 'warning';
    case 'Failed':
    case 'Terminating':
      return 'error';
    default:
      return '';
  }
}

// Runtime badge colors
function getRuntimeColor(runtime: string): string {
  switch (runtime?.toLowerCase()) {
    case 'kaito':
      return '#1976d2';
    case 'kuberay':
      return '#9c27b0';
    case 'dynamo':
      return '#2e7d32';
    default:
      return '#666';
  }
}

export function DeploymentsList() {
  const api = useApiClient();
  const [deployments, setDeployments] = useState<DeploymentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [namespace, setNamespace] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);

  // Fetch deployments
  const fetchDeployments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.deployments.list(namespace || undefined);
      setDeployments(result.deployments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch deployments');
      setDeployments([]);
    } finally {
      setLoading(false);
    }
  }, [api, namespace]);

  // Initial fetch and refresh
  useEffect(() => {
    fetchDeployments();
  }, [fetchDeployments, refreshKey]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshKey((k) => k + 1);
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  // Handle delete
  const handleDelete = useCallback(
    async (name: string, ns: string) => {
      if (!confirm(`Are you sure you want to delete deployment "${name}"?`)) {
        return;
      }

      try {
        await api.deployments.delete(name, ns);
        setRefreshKey((k) => k + 1);
      } catch (err) {
        alert(`Failed to delete deployment: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    },
    [api]
  );

  // Table columns
  const columns = [
    {
      label: 'Name',
      getter: (item: DeploymentStatus) => (
        <HeadlampLink routeName="Deployment Details" params={{ name: item.name, namespace: item.namespace }}>
          {item.name}
        </HeadlampLink>
      ),
    },
    {
      label: 'Namespace',
      getter: (item: DeploymentStatus) => item.namespace,
    },
    {
      label: 'Model',
      getter: (item: DeploymentStatus) => item.modelId || '-',
    },
    {
      label: 'Provider',
      getter: (item: DeploymentStatus) => (
        <span
          style={{
            padding: '2px 8px',
            borderRadius: '4px',
            backgroundColor: getRuntimeColor(item.provider),
            color: 'white',
            fontSize: '12px',
            fontWeight: 500,
          }}
        >
          {item.provider}
        </span>
      ),
    },
    {
      label: 'Status',
      getter: (item: DeploymentStatus) => (
        <StatusLabel status={getStatusColor(item.phase)}>
          {item.phase}
        </StatusLabel>
      ),
    },
    {
      label: 'Replicas',
      getter: (item: DeploymentStatus) =>
        `${item.replicas?.ready || 0}/${item.replicas?.desired || 1}`,
    },
    {
      label: 'Engine',
      getter: (item: DeploymentStatus) => item.engine || '-',
    },
    {
      label: 'Age',
      getter: (item: DeploymentStatus) => {
        if (!item.createdAt) return '-';
        const created = new Date(item.createdAt);
        const now = new Date();
        const diffMs = now.getTime() - created.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffDays > 0) return `${diffDays}d`;
        if (diffHours > 0) return `${diffHours}h`;
        return `${diffMins}m`;
      },
    },
    {
      label: 'Actions',
      getter: (item: DeploymentStatus) => (
        <div style={{ display: 'flex', gap: '8px' }}>
          <HeadlampLink
            routeName="Deployment Details"
            params={{ name: item.name, namespace: item.namespace }}
            style={{ color: '#1976d2', textDecoration: 'none' }}
          >
            View
          </HeadlampLink>
          <button
            onClick={() => handleDelete(item.name, item.namespace)}
            style={{
              background: 'none',
              border: 'none',
              color: '#d32f2f',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <SectionBox
      title="Deployments"
      headerProps={{
        actions: [
          <div key="filter" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              placeholder="Filter by namespace..."
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              style={{
                padding: '6px 12px',
                border: '1px solid rgba(128, 128, 128, 0.3)',
                borderRadius: '4px',
                fontSize: '14px',
                width: '200px',
                backgroundColor: 'transparent',
                color: 'inherit',
              }}
            />
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
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
            </button>
            <HeadlampLink
              routeName="Create Deployment"
              style={{
                padding: '6px 12px',
                backgroundColor: '#1976d2',
                color: 'white',
                borderRadius: '4px',
                textDecoration: 'none',
              }}
            >
              + Create
            </HeadlampLink>
          </div>,
        ],
      }}
    >
      {loading ? (
        <Loader title="Loading deployments..." />
      ) : error ? (
        <ConnectionError error={error} onRetry={fetchDeployments} />
      ) : deployments.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', opacity: 0.7 }}>
          <p>No deployments found.</p>
          <HeadlampLink routeName="Create Deployment" style={{ color: '#1976d2' }}>
            Create your first deployment
          </HeadlampLink>
        </div>
      ) : (
        <SimpleTable
          columns={columns}
          data={deployments}
          rowsPerPage={[10, 25, 50]}
        />
      )}
    </SectionBox>
  );
}
