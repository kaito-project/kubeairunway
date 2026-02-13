import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { ClusterProxy } from '../cluster-proxy';

describe('ClusterProxy', () => {
  let proxy: ClusterProxy;
  let mockFindById: ReturnType<typeof mock>;
  let mockGetCredential: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFindById = mock(() => Promise.resolve(null));
    mockGetCredential = mock(() => undefined);
    proxy = new ClusterProxy(
      { findById: mockFindById } as any,
      { getCredential: mockGetCredential } as any
    );
  });

  test('getKubeConfig throws for unknown instance', async () => {
    mockFindById.mockResolvedValue(null);

    await expect(proxy.getKubeConfig('nonexistent-id')).rejects.toThrow(
      'Instance not found: nonexistent-id'
    );
  });

  test('getKubeConfig throws when credential is missing', async () => {
    mockFindById.mockResolvedValue({
      id: 'inst-1',
      name: 'test-cluster',
      displayName: 'Test Cluster',
      status: 'connected',
    });
    mockGetCredential.mockReturnValue(undefined);

    await expect(proxy.getKubeConfig('inst-1')).rejects.toThrow(
      'No credential found for instance: test-cluster'
    );
  });

  test('makeApiClient throws for unknown instance', async () => {
    mockFindById.mockResolvedValue(null);

    await expect(
      proxy.makeApiClient('nonexistent-id', class {} as any)
    ).rejects.toThrow('Instance not found: nonexistent-id');
  });

  test('getKubeConfig returns kubeConfig when instance and credential exist', async () => {
    const fakeKubeConfig = { makeApiClient: mock(() => ({})) };
    mockFindById.mockResolvedValue({
      id: 'inst-1',
      name: 'test-cluster',
      displayName: 'Test Cluster',
      status: 'connected',
    });
    mockGetCredential.mockReturnValue({
      instanceName: 'test-cluster',
      kubeConfig: fakeKubeConfig,
      lastLoaded: new Date(),
    });

    const result = await proxy.getKubeConfig('inst-1');
    expect(result).toBe(fakeKubeConfig);
    expect(mockFindById).toHaveBeenCalledWith('inst-1');
    expect(mockGetCredential).toHaveBeenCalledWith('test-cluster');
  });
});
