import { afterEach, describe, expect, test } from 'bun:test';
import { kubernetesService } from './kubernetes';
import { mockServiceMethod } from '../test/helpers';
import { mockInferenceProviderConfig } from '../test/fixtures';

describe('KubernetesService - Runtime Status', () => {
  const restores: Array<() => void> = [];
  const kaitoOperatorSelector = 'app.kubernetes.io/name=workspace,app.kubernetes.io/instance=kaito-workspace';
  const dynamoOperatorSelector = 'control-plane=controller-manager,app.kubernetes.io/name=dynamo-operator,app.kubernetes.io/instance=dynamo-platform';
  const kuberayOperatorSelector = 'app.kubernetes.io/name=kuberay-operator,app.kubernetes.io/instance=kuberay-operator';

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

  function mockOperatorPods(namespace: string, selector: string, items: any[]) {
    const service = kubernetesService as any;
    const original = service.coreV1Api.listNamespacedPod;
    service.coreV1Api.listNamespacedPod = async (...args: any[]) => {
      expect(args[0]).toBe(namespace);
      expect(args[5]).toBe(selector);
      return { body: { items } };
    };
    restores.push(() => {
      service.coreV1Api.listNamespacedPod = original;
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
    expect(kaito?.version).toBe('0.10.0');
    expect(kaito?.message).toBe('KAITO workspace CRD not found');
  });

  test('uses live Dynamo installation status for Dynamo runtime entries', async () => {
    let kaitoStatusChecks = 0;
    let dynamoStatusChecks = 0;
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
      mockServiceMethod(kubernetesService, 'checkDynamoInstallationStatus', async () => {
        dynamoStatusChecks += 1;
        return {
          installed: false,
          crdFound: false,
          operatorRunning: false,
          message: 'Dynamo CRD not found',
        };
      }),
    );
    mockProviderConfigs([nonKaitoConfig]);

    const runtimes = await kubernetesService.getRuntimesStatus();
    const dynamo = runtimes.find((runtime) => runtime.id === 'dynamo');

    expect(kaitoStatusChecks).toBe(0);
    expect(dynamoStatusChecks).toBe(1);
    expect(dynamo).toBeDefined();
    expect(dynamo?.installed).toBe(false);
    expect(dynamo?.healthy).toBe(false);
    expect(dynamo?.version).toBe('1.2.3');
    expect(dynamo?.message).toBe('Dynamo CRD not found');
  });

  test('reports KAITO as not fully installed when the CRD exists but no ready operator pod is found', async () => {
    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDExists', async () => true),
    );
    mockOperatorPods('kaito-workspace', kaitoOperatorSelector, [
      {
        metadata: { name: 'workspace-operator-abc123' },
        status: {
          phase: 'Running',
          containerStatuses: [
            { ready: false, restartCount: 2 },
          ],
        },
      },
    ]);

    const status = await kubernetesService.checkKaitoInstallationStatus();

    expect(status.installed).toBe(false);
    expect(status.crdFound).toBe(true);
    expect(status.operatorRunning).toBe(false);
    expect(status.message).toBe('KAITO workspace CRD found but no ready KAITO operator pods were detected in kaito-workspace');
  });

  test('reports KAITO as installed when a ready operator pod is found', async () => {
    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDExists', async () => true),
    );
    mockOperatorPods('kaito-workspace', kaitoOperatorSelector, [
      {
        metadata: { name: 'workspace-operator-ready' },
        status: {
          phase: 'Running',
          containerStatuses: [
            { ready: true, restartCount: 0 },
          ],
        },
      },
    ]);

    const status = await kubernetesService.checkKaitoInstallationStatus();

    expect(status.installed).toBe(true);
    expect(status.crdFound).toBe(true);
    expect(status.operatorRunning).toBe(true);
    expect(status.message).toBe('KAITO workspace CRD found and KAITO operator pods are ready');
  });

  test('reports Dynamo as installed when a ready operator pod is found', async () => {
    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDExists', async (crdName: string) => crdName === 'dynamographdeployments.nvidia.com'),
    );
    mockOperatorPods('dynamo-system', dynamoOperatorSelector, [
      {
        metadata: { name: 'dynamo-operator-ready' },
        status: {
          phase: 'Running',
          containerStatuses: [
            { ready: true, restartCount: 0 },
          ],
        },
      },
    ]);

    const status = await kubernetesService.checkDynamoInstallationStatus();

    expect(status.installed).toBe(true);
    expect(status.crdFound).toBe(true);
    expect(status.operatorRunning).toBe(true);
    expect(status.message).toBe('Dynamo CRD found and Dynamo operator pods are ready');
  });

  test('reports Dynamo as not fully installed when the CRD exists but no ready operator pod is found', async () => {
    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDExists', async (crdName: string) => crdName === 'dynamographdeployments.nvidia.com'),
    );
    mockOperatorPods('dynamo-system', dynamoOperatorSelector, [
      {
        metadata: { name: 'dynamo-operator-abc123' },
        status: {
          phase: 'Running',
          containerStatuses: [
            { ready: false, restartCount: 1 },
          ],
        },
      },
    ]);

    const status = await kubernetesService.checkDynamoInstallationStatus();

    expect(status.installed).toBe(false);
    expect(status.crdFound).toBe(true);
    expect(status.operatorRunning).toBe(false);
    expect(status.message).toBe('Dynamo CRD found but no ready Dynamo operator pods were detected in dynamo-system');
  });


  test('reports KubeRay as not fully installed when the CRD exists but no ready operator pod is found', async () => {
    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDExists', async (crdName: string) => crdName === 'rayservices.ray.io'),
    );
    mockOperatorPods('ray-system', kuberayOperatorSelector, [
      {
        metadata: { name: 'kuberay-operator-starting' },
        status: {
          phase: 'Running',
          containerStatuses: [
            { ready: false, restartCount: 1 },
          ],
        },
      },
    ]);

    const status = await kubernetesService.checkKubeRayInstallationStatus();

    expect(status.installed).toBe(false);
    expect(status.crdFound).toBe(true);
    expect(status.operatorRunning).toBe(false);
    expect(status.message).toBe('KubeRay CRD found but no ready KubeRay operator pods were detected in ray-system');
  });

  test('reports KubeRay as installed when a ready operator pod is found', async () => {
    restores.push(
      mockServiceMethod(kubernetesService, 'checkCRDExists', async (crdName: string) => crdName === 'rayservices.ray.io'),
    );
    mockOperatorPods('ray-system', kuberayOperatorSelector, [
      {
        metadata: { name: 'kuberay-operator-ready' },
        status: {
          phase: 'Running',
          containerStatuses: [
            { ready: true, restartCount: 0 },
          ],
        },
      },
    ]);

    const status = await kubernetesService.checkKubeRayInstallationStatus();

    expect(status.installed).toBe(true);
    expect(status.crdFound).toBe(true);
    expect(status.operatorRunning).toBe(true);
    expect(status.message).toBe('KubeRay CRD found and KubeRay operator pods are ready');
  });
});
