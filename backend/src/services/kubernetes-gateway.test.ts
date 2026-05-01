import { describe, test, expect, afterEach } from 'bun:test';
import { kubernetesService } from './kubernetes';
import { mockServiceMethod } from '../test/helpers';

/**
 * Tests for kubernetesService.getGatewayStatus().
 *
 * Regression: previously returned available=true whenever the InferencePool CRD
 * existed, regardless of whether any Gateway resource was actually present.
 * It must now mirror the controller's resolveGatewayConfig selection so the
 * Settings page only reports "Available" when the controller would actually
 * be able to attach an HTTPRoute.
 */
describe('kubernetesService.getGatewayStatus', () => {
  const restores: Array<() => void> = [];
  // The customObjectsApi is private; reach in just for tests so we can stub
  // listClusterCustomObject without spinning up a real Kubernetes API server.
  const svc = kubernetesService as unknown as {
    customObjectsApi: { listClusterCustomObject: (...args: unknown[]) => Promise<{ body: unknown }> };
  };

  function mockListGateways(items: unknown[] | Error) {
    const original = svc.customObjectsApi.listClusterCustomObject;
    svc.customObjectsApi.listClusterCustomObject = async (group: string, _version: string, plural: string) => {
      if (group === 'gateway.networking.k8s.io' && plural === 'gateways') {
        if (items instanceof Error) throw items;
        return { body: { items } };
      }
      return { body: { items: [] } };
    };
    restores.push(() => {
      svc.customObjectsApi.listClusterCustomObject = original;
    });
  }

  function mockCRDs({ inferencePool, gatewayApi }: { inferencePool: boolean; gatewayApi: boolean }) {
    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDExists', async (crdName: string) => {
        if (crdName === 'inferencepools.inference.networking.k8s.io') return inferencePool;
        if (crdName === 'gateways.gateway.networking.k8s.io') return gatewayApi;
        return false;
      }),
    );
  }

  afterEach(() => {
    restores.forEach((r) => r());
    restores.length = 0;
  });

  test('returns unavailable when InferencePool CRD is missing', async () => {
    mockCRDs({ inferencePool: false, gatewayApi: true });
    mockListGateways([{ metadata: { name: 'gw' } }]);

    const result = await kubernetesService.getGatewayStatus();
    expect(result).toEqual({ available: false });
  });

  test('returns unavailable when Gateway API CRD is missing', async () => {
    mockCRDs({ inferencePool: true, gatewayApi: false });
    mockListGateways([]);

    const result = await kubernetesService.getGatewayStatus();
    expect(result).toEqual({ available: false });
  });

  test('returns unavailable when CRDs are installed but no Gateway resource exists (issue #235)', async () => {
    mockCRDs({ inferencePool: true, gatewayApi: true });
    mockListGateways([]);

    const result = await kubernetesService.getGatewayStatus();
    expect(result.available).toBe(false);
    expect(result.endpoint).toBeUndefined();
  });

  test('returns available with no endpoint when a Gateway exists but has no addresses yet', async () => {
    mockCRDs({ inferencePool: true, gatewayApi: true });
    mockListGateways([{ metadata: { name: 'gw', namespace: 'default' } }]);

    const result = await kubernetesService.getGatewayStatus();
    expect(result.available).toBe(true);
    expect(result.endpoint).toBeUndefined();
  });

  test('returns available with endpoint when a Gateway exists with status.addresses', async () => {
    mockCRDs({ inferencePool: true, gatewayApi: true });
    mockListGateways([
      {
        metadata: { name: 'gw', namespace: 'default' },
        status: { addresses: [{ value: '10.0.0.50' }] },
      },
    ]);

    const result = await kubernetesService.getGatewayStatus();
    expect(result).toEqual({ available: true, endpoint: '10.0.0.50' });
  });

  test('multiple Gateways without inference-gateway label → unavailable (matches controller)', async () => {
    mockCRDs({ inferencePool: true, gatewayApi: true });
    mockListGateways([
      { metadata: { name: 'gw-a', namespace: 'default' } },
      { metadata: { name: 'gw-b', namespace: 'default' } },
    ]);

    const result = await kubernetesService.getGatewayStatus();
    expect(result.available).toBe(false);
  });

  test('multiple Gateways → picks the one labeled airunway.ai/inference-gateway=true', async () => {
    mockCRDs({ inferencePool: true, gatewayApi: true });
    mockListGateways([
      { metadata: { name: 'gw-a', namespace: 'default' } },
      {
        metadata: {
          name: 'gw-b',
          namespace: 'default',
          labels: { 'airunway.ai/inference-gateway': 'true' },
        },
        status: { addresses: [{ value: 'gw-b.example.com' }] },
      },
    ]);

    const result = await kubernetesService.getGatewayStatus();
    expect(result).toEqual({ available: true, endpoint: 'gw-b.example.com' });
  });

  test('returns unavailable when listing Gateway resources errors', async () => {
    mockCRDs({ inferencePool: true, gatewayApi: true });
    mockListGateways(new Error('forbidden'));

    const result = await kubernetesService.getGatewayStatus();
    expect(result).toEqual({ available: false });
  });
});
