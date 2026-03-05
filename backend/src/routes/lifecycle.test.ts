import { describe, test, expect, afterEach } from 'bun:test';
import app from '../hono-app';
import { kubernetesService } from '../services/kubernetes';
import { configService } from '../services/config';
import { mockServiceMethod } from '../test/helpers';
import { mockDeployment } from '../test/fixtures';

describe('Deployment Lifecycle Flow', () => {
  let restores: (() => void)[] = [];

  afterEach(() => {
    restores.forEach((r) => r());
    restores = [];
  });

  test('create → get → delete → verify deleted', async () => {
    // Mock default namespace
    restores.push(mockServiceMethod(configService, 'getDefaultNamespace', async () => 'default'));

    // 1. Create deployment
    restores.push(mockServiceMethod(kubernetesService, 'createDeployment', async () => {}));
    restores.push(
      mockServiceMethod(kubernetesService, 'getClusterGpuCapacity', async () => ({
        totalGpus: 4,
        allocatedGpus: 0,
        availableGpus: 4,
        maxContiguousAvailable: 4,
        maxNodeGpuCapacity: 4,
        gpuNodeCount: 1,
        nodes: [],
      }))
    );

    const createRes = await app.request('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'test-deploy',
        modelId: 'meta-llama/Llama-3.1-8B-Instruct',
        engine: 'vllm',
      }),
    });
    expect(createRes.status).toBe(201);
    const createData = await createRes.json();
    expect(createData.name).toBe('test-deploy');

    // 2. Get deployment
    restores.push(
      mockServiceMethod(kubernetesService, 'getDeployment', async () => mockDeployment)
    );

    const getRes = await app.request('/api/deployments/test-deploy');
    expect(getRes.status).toBe(200);
    const getResData = await getRes.json();
    expect(getResData.name).toBe('test-deploy');

    // 3. Delete deployment
    restores.push(mockServiceMethod(kubernetesService, 'deleteDeployment', async () => {}));

    const deleteRes = await app.request('/api/deployments/test-deploy', { method: 'DELETE' });
    expect(deleteRes.status).toBe(200);

    // 4. Verify deleted — mock getDeployment to return null
    restores.push(mockServiceMethod(kubernetesService, 'getDeployment', async () => null));

    const verifyRes = await app.request('/api/deployments/test-deploy');
    expect(verifyRes.status).toBe(404);
  });

  test('POST with invalid body returns 400', async () => {
    restores.push(mockServiceMethod(configService, 'getDefaultNamespace', async () => 'default'));

    const res = await app.request('/api/deployments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('DELETE nonexistent deployment returns 404', async () => {
    restores.push(mockServiceMethod(configService, 'getDefaultNamespace', async () => 'default'));
    restores.push(
      mockServiceMethod(kubernetesService, 'deleteDeployment', async () => {
        throw new Error('Deployment not found');
      })
    );

    const res = await app.request('/api/deployments/nonexistent-deploy', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });
});
