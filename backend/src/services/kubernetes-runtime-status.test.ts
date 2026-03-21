import { afterEach, describe, expect, test } from 'bun:test';
import { kubernetesService } from './kubernetes';
import { mockServiceMethod } from '../test/helpers';
import { mockInferenceProviderConfig } from '../test/fixtures';

describe('KubernetesService - Runtime Status', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    restores.forEach((restore) => restore());
    restores.length = 0;
  });

  function mockProviderConfigs(items: any[]) {
    const service = kubernetesService as any;
    const original = service.customObjectsApi.listClusterCustomObject;
    service.customObjectsApi.listClusterCustomObject = async () => ({ body: { items } });
    restores.push(() => {
      service.customObjectsApi.listClusterCustomObject = original;
    });
  }

  test('uses live KAITO installation status for KAITO runtime entries', async () => {
    let kaitoStatusChecks = 0;

    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDInstallation', async () => ({ installed: true })),
      mockServiceMethod(kubernetesService, 'checkKaitoInstallationStatus', async () => {
        kaitoStatusChecks += 1;
        return {
          installed: false,
          crdFound: false,
          operatorRunning: false,
          message: 'KAITO workspace CRD not found',
        };
      }),
    );
    mockProviderConfigs([mockInferenceProviderConfig]);

    const runtimes = await kubernetesService.getRuntimesStatus();
    const kaito = runtimes.find((runtime) => runtime.id === 'kaito');

    expect(kaitoStatusChecks).toBe(1);
    expect(kaito).toBeDefined();
    expect(kaito?.installed).toBe(false);
    expect(kaito?.healthy).toBe(false);
    expect(kaito?.version).toBe('0.9.0');
    expect(kaito?.message).toBe('KAITO workspace CRD not found');
  });

  test('keeps config-based readiness checks for non-KAITO runtimes', async () => {
    let kaitoStatusChecks = 0;
    const nonKaitoConfig = {
      ...mockInferenceProviderConfig,
      metadata: { ...mockInferenceProviderConfig.metadata, name: 'dynamo' },
      status: {
        ready: false,
        version: '1.2.3',
      },
    };

    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDInstallation', async () => ({ installed: true })),
      mockServiceMethod(kubernetesService, 'checkKaitoInstallationStatus', async () => {
        kaitoStatusChecks += 1;
        return {
          installed: true,
          crdFound: true,
          operatorRunning: true,
          message: 'should not be used',
        };
      }),
    );
    mockProviderConfigs([nonKaitoConfig]);

    const runtimes = await kubernetesService.getRuntimesStatus();
    const dynamo = runtimes.find((runtime) => runtime.id === 'dynamo');

    expect(kaitoStatusChecks).toBe(0);
    expect(dynamo).toBeDefined();
    expect(dynamo?.installed).toBe(true);
    expect(dynamo?.healthy).toBe(false);
    expect(dynamo?.version).toBe('1.2.3');
    expect(dynamo?.message).toBe('Provider not ready');
  });
});
