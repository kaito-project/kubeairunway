import { describe, test, expect, afterEach } from 'bun:test';
import app from '../hono-app';
import { kubernetesService } from '../services/kubernetes';
import { mockServiceMethod } from '../test/helpers';
import {
  mockDeployment,
  mockDeploymentWithPendingPod,
  mockDeploymentManifest,
  mockPodFailureReasons,
} from '../test/fixtures';

describe('Deployment Routes', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    restores.forEach((r) => r());
    restores.length = 0;
  });

  describe('GET /api/deployments/:name/manifest', () => {
    test('returns manifest with resources and primaryResource', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeploymentManifest', async () => mockDeploymentManifest),
      );

      const res = await app.request('/api/deployments/test-deploy/manifest');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.resources).toBeArray();
      expect(data.resources.length).toBeGreaterThan(0);
      expect(data.primaryResource).toBeDefined();
      expect(data.primaryResource.kind).toBe('ModelDeployment');
      expect(data.primaryResource.apiVersion).toBe('kubeairunway.ai/v1alpha1');
    });

    test('returns 404 when manifest not found', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeploymentManifest', async () => null),
      );

      const res = await app.request('/api/deployments/test-deploy/manifest');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/deployments/:name/pending-reasons', () => {
    test('returns failure reasons for pending pods', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeployment', async () => mockDeploymentWithPendingPod),
      );
      restores.push(
        mockServiceMethod(kubernetesService, 'getPodFailureReasons', async () => mockPodFailureReasons),
      );

      const res = await app.request('/api/deployments/pending-deploy/pending-reasons');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.reasons).toBeArray();
      expect(data.reasons.length).toBeGreaterThan(0);
      expect(data.reasons[0].reason).toBe('Insufficient nvidia.com/gpu');
    });

    test('returns empty reasons when no pending pods', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeployment', async () => mockDeployment),
      );

      const res = await app.request('/api/deployments/test-deploy/pending-reasons');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.reasons).toEqual([]);
    });

    test('returns 404 when deployment not found', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeployment', async () => null),
      );

      const res = await app.request('/api/deployments/nonexistent/pending-reasons');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/deployments/:name/logs', () => {
    test('returns logs for deployment', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeployment', async () => mockDeployment),
      );
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeploymentPods', async () => [{ name: 'test-deploy-abc123' }]),
      );
      restores.push(
        mockServiceMethod(kubernetesService, 'getPodLogs', async () => 'log line 1\nlog line 2'),
      );

      const res = await app.request('/api/deployments/test-deploy/logs');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.logs).toBe('log line 1\nlog line 2');
      expect(data.podName).toBe('test-deploy-abc123');
    });

    test('returns empty logs when no pods found', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeployment', async () => mockDeployment),
      );
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeploymentPods', async () => []),
      );

      const res = await app.request('/api/deployments/test-deploy/logs');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.logs).toBe('');
      expect(data.message).toBeDefined();
    });

    test('returns 400 when specified pod not in deployment', async () => {
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeployment', async () => mockDeployment),
      );
      restores.push(
        mockServiceMethod(kubernetesService, 'getDeploymentPods', async () => [{ name: 'test-deploy-abc123' }]),
      );

      const res = await app.request('/api/deployments/test-deploy/logs?podName=wrong-pod');
      expect(res.status).toBe(400);
    });
  });
});
