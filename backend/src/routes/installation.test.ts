import { describe, test, expect, afterEach } from 'bun:test';
import app from '../hono-app';
import { kubernetesService } from '../services/kubernetes';
import { helmService } from '../services/helm';
import { mockServiceMethod } from '../test/helpers';
import {
  mockInferenceProviderConfig,
  mockKaitoCROldShim,
  mockKaitoCRNewShimHealthy,
  mockEnoStorageClass,
} from '../test/fixtures';

describe('Installation Provider Routes', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    restores.forEach((r) => r());
    restores.length = 0;
  });

  // ==========================================================================
  // GET /api/installation/providers/:providerId/status
  // ==========================================================================

  describe('GET /api/installation/providers/:providerId/status', () => {
    test('returns provider status when found', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(kubernetesService, 'getStorageClass', async () => null),
      );

      const res = await app.request('/api/installation/providers/kaito/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.providerId).toBe('kaito');
      expect(data.providerName).toBe('Kaito');
      expect(data.installed).toBe(true);
      expect(data.installationSteps).toBeDefined();
      expect(data.helmCommands).toBeDefined();
    });

    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/status');
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // GET /api/installation/providers/:providerId/commands
  // ==========================================================================

  describe('GET /api/installation/providers/:providerId/commands', () => {
    test('returns commands when provider found', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
      );

      const res = await app.request('/api/installation/providers/kaito/commands');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.providerId).toBe('kaito');
      expect(data.providerName).toBe('Kaito');
      expect(data.commands).toBeDefined();
      expect(data.steps).toBeDefined();
    });

    test('includes helm values in generated commands when present', async () => {
      const configWithValues = {
        ...mockInferenceProviderConfig,
        spec: {
          ...mockInferenceProviderConfig.spec,
          installation: {
            ...mockInferenceProviderConfig.spec.installation,
            helmCharts: [
              {
                ...mockInferenceProviderConfig.spec.installation.helmCharts[0],
                values: {
                  'global.grove.install': true,
                },
              },
            ],
          },
        },
      };

      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => configWithValues),
      );

      const res = await app.request('/api/installation/providers/kaito/commands');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.commands.some((command: string) => command.includes('--set-json global.grove.install=true'))).toBe(true);
    });

    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/commands');
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // POST /api/installation/providers/:providerId/install
  // ==========================================================================

  describe('POST /api/installation/providers/:providerId/install', () => {
    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/install', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    test('returns 400 when helm is not available', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: false, error: 'not found' })),
      );

      const res = await app.request('/api/installation/providers/kaito/install', { method: 'POST' });
      expect(res.status).toBe(400);
    });

    test('returns 200 on successful install', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: true, version: '3.14.0' })),
        mockServiceMethod(kubernetesService, 'getStorageClass', async () => null),
        mockServiceMethod(helmService, 'installProvider', async () => ({
          success: true,
          results: [{ step: 'install', result: { success: true, stdout: 'ok', stderr: '' } }],
        })),
      );

      const res = await app.request('/api/installation/providers/kaito/install', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.results).toBeDefined();
    });
  });

  // ==========================================================================
  // GET /api/installation/providers/:providerId/status (health-aware)
  // ==========================================================================

  describe('GET /api/installation/providers/:providerId/status (health-aware)', () => {
    test('returns installed=false with Eno-suspected message for old-shim KAITO', async () => {
      restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCROldShim));
      restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => mockEnoStorageClass));

      const res = await app.request('/api/installation/providers/kaito/status');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.installed).toBe(false);
      expect(data.operatorRunning).toBe(false);
      expect(data.managedBy).toBe('Eno');
      expect(data.message).toContain('--enable-ai-toolchain-operator');
    });

    test('returns installed=true for healthy new-shim KAITO', async () => {
      restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockKaitoCRNewShimHealthy));
      restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => null));

      const res = await app.request('/api/installation/providers/kaito/status');
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.installed).toBe(true);
      expect(data.operatorRunning).toBe(true);
    });
  });

  // ==========================================================================
  // POST /api/installation/providers/:providerId/install pre-flight
  // ==========================================================================

  describe('POST /api/installation/providers/:providerId/install pre-flight', () => {
    test('returns 409 with structured conflict when Eno owns StorageClass', async () => {
      restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig));
      restores.push(mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: true })));
      restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => mockEnoStorageClass));
      let installCalled = 0;
      restores.push(mockServiceMethod(helmService, 'installProvider', async () => { installCalled++; return { success: true, results: [] }; }));

      const res = await app.request('/api/installation/providers/kaito/install', { method: 'POST' });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('InstallConflict');
      expect(body.conflict.source).toBe('eno');
      expect(body.conflict.resource.name).toBe('kaito-local-nvme-disk');
      expect(installCalled).toBe(0);
    });

    test('proceeds with helm install when no conflict (happy path)', async () => {
      restores.push(mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig));
      restores.push(mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: true })));
      restores.push(mockServiceMethod(kubernetesService, 'getStorageClass', async () => null));
      let installCalled = 0;
      restores.push(mockServiceMethod(helmService, 'installProvider', async () => { installCalled++; return { success: true, results: [] }; }));

      const res = await app.request('/api/installation/providers/kaito/install', { method: 'POST' });
      expect(res.status).toBe(200);
      expect(installCalled).toBe(1);
    });
  });

  // ==========================================================================
  // POST /api/installation/providers/:providerId/uninstall
  // ==========================================================================

  describe('POST /api/installation/providers/:providerId/uninstall', () => {
    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/uninstall', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    test('returns 200 on successful uninstall', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(helmService, 'checkHelmAvailable', async () => ({ available: true, version: '3.14.0' })),
        mockServiceMethod(helmService, 'uninstall', async () => ({ success: true, stdout: 'ok', stderr: '' })),
      );

      const res = await app.request('/api/installation/providers/kaito/uninstall', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  // ==========================================================================
  // POST /api/installation/providers/:providerId/uninstall-crds
  // ==========================================================================

  describe('POST /api/installation/providers/:providerId/uninstall-crds', () => {
    test('returns 404 for unknown provider', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => null),
      );

      const res = await app.request('/api/installation/providers/unknown/uninstall-crds', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    test('returns 200 on successful CRD removal', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getInferenceProviderConfig', async () => mockInferenceProviderConfig),
        mockServiceMethod(kubernetesService, 'deleteInferenceProviderConfig', async () => undefined),
      );

      const res = await app.request('/api/installation/providers/kaito/uninstall-crds', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });
});

describe('Gateway Installation Routes', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    restores.forEach((r) => r());
    restores.length = 0;
  });

  // ==========================================================================
  // GET /api/installation/gateway/status
  // ==========================================================================

  describe('GET /api/installation/gateway/status', () => {
    test('returns gateway CRD status when CRDs are installed', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'checkGatewayCRDStatus', async () => ({
          gatewayApiInstalled: true,
          inferenceExtInstalled: true,
          pinnedVersion: 'v1.3.1',
          gatewayAvailable: true,
          gatewayEndpoint: '10.0.0.50',
          message: 'Gateway API and Inference Extension CRDs are installed. Gateway is available.',
          installCommands: [
            'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/latest/download/standard-install.yaml',
            'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api-inference-extension/releases/download/v1.3.1/manifests.yaml',
          ],
        })),
      );

      const res = await app.request('/api/installation/gateway/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.gatewayApiInstalled).toBe(true);
      expect(data.inferenceExtInstalled).toBe(true);
      expect(data.pinnedVersion).toBe('v1.3.1');
      expect(data.gatewayAvailable).toBe(true);
      expect(data.gatewayEndpoint).toBe('10.0.0.50');
      expect(data.installCommands).toHaveLength(2);
    });

    test('returns status when CRDs are not installed', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'checkGatewayCRDStatus', async () => ({
          gatewayApiInstalled: false,
          inferenceExtInstalled: false,
          pinnedVersion: 'v1.3.1',
          gatewayAvailable: false,
          message: 'Gateway API and Inference Extension CRDs are not installed.',
          installCommands: [
            'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api/releases/latest/download/standard-install.yaml',
            'kubectl apply -f https://github.com/kubernetes-sigs/gateway-api-inference-extension/releases/download/v1.3.1/manifests.yaml',
          ],
        })),
      );

      const res = await app.request('/api/installation/gateway/status');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.gatewayApiInstalled).toBe(false);
      expect(data.inferenceExtInstalled).toBe(false);
      expect(data.gatewayAvailable).toBe(false);
    });
  });

  // ==========================================================================
  // POST /api/installation/gateway/install-crds
  // ==========================================================================

  describe('POST /api/installation/gateway/install-crds', () => {
    test('returns 200 on successful CRD installation', async () => {
      restores.push(
        mockServiceMethod(helmService, 'applyManifestUrl', async () => ({
          success: true,
          stdout: 'customresourcedefinition.apiextensions.k8s.io/gateways.gateway.networking.k8s.io created',
          stderr: '',
          exitCode: 0,
        })),
      );

      const res = await app.request('/api/installation/gateway/install-crds', { method: 'POST' });
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.results).toHaveLength(2);
      expect(data.results[0].step).toBe('gateway-api-crds');
      expect(data.results[1].step).toBe('inference-extension-crds');
    });

    test('returns 500 when Gateway API CRD installation fails', async () => {
      let callCount = 0;
      restores.push(
        mockServiceMethod(helmService, 'applyManifestUrl', async () => {
          callCount++;
          if (callCount === 1) {
            return {
              success: false,
              stdout: '',
              stderr: 'connection refused',
              exitCode: 1,
            };
          }
          return { success: true, stdout: 'ok', stderr: '', exitCode: 0 };
        }),
      );

      const res = await app.request('/api/installation/gateway/install-crds', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });
});
