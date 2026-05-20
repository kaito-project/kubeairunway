import { kubernetesService } from './kubernetes';

export type ProviderHealth = {
  providerId: string;
  healthy: boolean;
  reason: string;
  message: string;
  managedBy?: 'Eno' | 'Helm' | 'Unknown';
  stale: boolean;
  lastHeartbeat?: string;
};

const STALENESS_THRESHOLD_MS = Number(process.env.PROVIDER_HEALTH_STALENESS_MS ?? 180_000);

const ENO_PARTIAL_INSTALL_SUSPECTED_MESSAGE =
  'This cluster appears to have been set up with `--enable-ai-toolchain-operator`. ' +
  'The deployed KAITO shim is too old to detect this and is reporting stale health. ' +
  'Upgrade the KAITO shim image to get accurate status and prevent stalled deployments.';

const KAITO_ENO_STORAGECLASS = 'kaito-local-nvme-disk';

export async function getProviderHealth(providerId: string): Promise<ProviderHealth> {
  const config = await kubernetesService.getInferenceProviderConfig(providerId);
  if (!config) {
    throw new Error(`provider not found: ${providerId}`);
  }

  const status = config.status ?? {};
  const conditions: Array<any> = status.conditions ?? [];
  const upstreamReady = conditions.find((c: any) => c.type === 'UpstreamReady');
  const upstreamManagedBy = conditions.find((c: any) => c.type === 'UpstreamManagedBy');
  const lastHeartbeat: string | undefined = status.lastHeartbeat;
  const ready: boolean = status.ready === true;

  // Step 4: staleness override
  const stale = lastHeartbeat
    ? Date.now() - new Date(lastHeartbeat).getTime() > STALENESS_THRESHOLD_MS
    : true;

  if (stale) {
    return {
      providerId,
      healthy: false,
      reason: 'ShimStale',
      message: 'The provider is not reporting status. Check that the AI Runway provider shim is running.',
      stale: true,
      lastHeartbeat,
    };
  }

  // Step 5: passthrough
  let health: ProviderHealth = {
    providerId,
    healthy: ready,
    reason: upstreamReady?.reason ?? (ready ? 'Ready' : 'NotReady'),
    message: upstreamReady?.message ?? (ready ? 'Provider is installed and running' : 'Provider is not ready'),
    stale: false,
    lastHeartbeat,
  };

  // Step 6: managedBy detection
  if (upstreamManagedBy?.reason === 'Eno') {
    health.managedBy = 'Eno';
  } else if (providerId === 'kaito') {
    const sc = await kubernetesService.getStorageClass(KAITO_ENO_STORAGECLASS);
    if (sc?.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'Eno') {
      health.managedBy = 'Eno';
    } else if (sc?.metadata?.labels?.['app.kubernetes.io/managed-by'] === 'Helm') {
      health.managedBy = 'Helm';
    } else if (sc) {
      health.managedBy = 'Unknown';
    }
  }

  // Step 7: old-shim override
  if (providerId === 'kaito' && health.managedBy === 'Eno' && !upstreamReady) {
    return {
      ...health,
      healthy: false,
      reason: 'EnoPartialInstallSuspected',
      message: ENO_PARTIAL_INSTALL_SUSPECTED_MESSAGE,
    };
  }

  return health;
}
