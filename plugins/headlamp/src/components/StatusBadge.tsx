/**
 * Status Badge Component
 *
 * Displays deployment status with appropriate colors.
 */

interface StatusBadgeProps {
  status: string;
  size?: 'small' | 'medium';
}

const statusColors: Record<string, { bg: string; text: string }> = {
  running: { bg: '#e8f5e9', text: '#2e7d32' },
  ready: { bg: '#e8f5e9', text: '#2e7d32' },
  healthy: { bg: '#e8f5e9', text: '#2e7d32' },
  available: { bg: '#e8f5e9', text: '#2e7d32' },
  pending: { bg: '#fff3e0', text: '#e65100' },
  creating: { bg: '#fff3e0', text: '#e65100' },
  starting: { bg: '#fff3e0', text: '#e65100' },
  upgrading: { bg: '#e3f2fd', text: '#1565c0' },
  updating: { bg: '#e3f2fd', text: '#1565c0' },
  failed: { bg: '#ffebee', text: '#c62828' },
  error: { bg: '#ffebee', text: '#c62828' },
  crashed: { bg: '#ffebee', text: '#c62828' },
  notinstalled: { bg: '#f5f5f5', text: '#616161' },
  unknown: { bg: '#f5f5f5', text: '#616161' },
};

export function StatusBadge({ status, size = 'medium' }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase().replace(/[_-]/g, '');
  const colors = statusColors[normalizedStatus] || statusColors.unknown;

  const fontSize = size === 'small' ? '11px' : '12px';
  const padding = size === 'small' ? '2px 6px' : '4px 10px';

  return (
    <span
      style={{
        display: 'inline-block',
        padding,
        borderRadius: '4px',
        backgroundColor: colors.bg,
        color: colors.text,
        fontSize,
        fontWeight: 500,
        textTransform: 'capitalize',
      }}
    >
      {status}
    </span>
  );
}
