import { describe, test, expect, afterEach } from 'bun:test';
import { getProviderHealth } from './providerHealth';
import { kubernetesService } from './kubernetes';
import { mockServiceMethod } from '../test/helpers';
import {
  mockKaitoCRNewShimHealthy,
  mockKaitoCRNewShimEnoPartial,
  mockKaitoCROldShim,
  mockKaitoCRStale,
  mockEnoStorageClass,
  mockHelmStorageClass,
} from '../test/fixtures';

describe('getProviderHealth', () => {
  const restores: Array<() => void> = [];
  afterEach(() => {
    restores.forEach((r) => r());
    restores.length = 0;
  });

  // --- Passthrough ---

  test('returns healthy for new-shim CR with UpstreamHealthy condition', async () => {
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCRNewShimHealthy));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => null));

    const h = await getProviderHealth('kaito');
    expect(h.healthy).toBe(true);
    expect(h.reason).toBe('UpstreamHealthy');
    expect(h.stale).toBe(false);
  });

  test('returns unhealthy for new-shim CR with EnoPartialInstall', async () => {
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCRNewShimEnoPartial));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => null));

    const h = await getProviderHealth('kaito');
    expect(h.healthy).toBe(false);
    expect(h.reason).toBe('EnoPartialInstall');
    expect(h.managedBy).toBe('Eno');
  });

  // --- Staleness ---

  test('returns stale when heartbeat is older than threshold', async () => {
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCRStale));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => null));

    const h = await getProviderHealth('kaito');
    expect(h.healthy).toBe(false);
    expect(h.reason).toBe('ShimStale');
    expect(h.stale).toBe(true);
  });

  // --- Eno detection ---

  test('sets managedBy=Eno from UpstreamManagedBy condition without StorageClass fallback', async () => {
    let storageClassCalls = 0;
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCRNewShimEnoPartial));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => { storageClassCalls++; return null; }));

    const h = await getProviderHealth('kaito');
    expect(h.managedBy).toBe('Eno');
    expect(storageClassCalls).toBe(0);
  });

  test('sets managedBy=Eno via KAITO StorageClass fallback when no condition', async () => {
    const cr = {
      ...mockKaitoCRNewShimHealthy,
      status: {
        ...mockKaitoCRNewShimHealthy.status,
        conditions: mockKaitoCRNewShimHealthy.status.conditions.filter((c: any) => c.type !== 'UpstreamManagedBy'),
      },
    };
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => cr));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => mockEnoStorageClass));

    const h = await getProviderHealth('kaito');
    expect(h.managedBy).toBe('Eno');
    expect(h.healthy).toBe(true); // informational, doesn't affect health
  });

  test('does not set managedBy for non-KAITO providers', async () => {
    const dynamoCR = { ...mockKaitoCRNewShimHealthy, metadata: { name: 'dynamo' } };
    let storageClassCalls = 0;
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => dynamoCR));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => { storageClassCalls++; return null; }));

    const h = await getProviderHealth('dynamo');
    expect(h.managedBy).toBeUndefined();
    expect(storageClassCalls).toBe(0);
  });

  // --- Old-shim override ---

  test('fires old-shim override when KAITO + Eno StorageClass + no UpstreamReady condition', async () => {
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCROldShim));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => mockEnoStorageClass));

    const h = await getProviderHealth('kaito');
    expect(h.healthy).toBe(false);
    expect(h.reason).toBe('EnoPartialInstallSuspected');
    expect(h.managedBy).toBe('Eno');
    expect(h.message).toContain('--enable-ai-toolchain-operator');
  });

  test('old-shim override does NOT fire against new shims', async () => {
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCRNewShimEnoPartial));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => mockEnoStorageClass));

    const h = await getProviderHealth('kaito');
    expect(h.reason).toBe('EnoPartialInstall'); // passthrough, not Suspected
  });

  test('old-shim override does NOT fire without Eno signal', async () => {
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCROldShim));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => mockHelmStorageClass));

    const h = await getProviderHealth('kaito');
    expect(h.healthy).toBe(true);
    expect(h.reason).not.toBe('EnoPartialInstallSuspected');
  });

  test('old-shim override does NOT fire on non-KAITO providers', async () => {
    const cr = { ...mockKaitoCROldShim, metadata: { name: 'kuberay' } };
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => cr));
    restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => mockEnoStorageClass));

    const h = await getProviderHealth('kuberay');
    expect(h.managedBy).toBeUndefined();
    expect(h.reason).not.toBe('EnoPartialInstallSuspected');
  });

  // --- Error ---

  test('throws when provider not found', async () => {
    restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null));

    await expect(getProviderHealth('nonexistent')).rejects.toThrow('provider not found');
  });
});
