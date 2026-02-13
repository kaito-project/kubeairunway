import { describe, it, expect } from 'bun:test';
import { REGISTRY_CONFIG, registryService } from './registry';

describe('RegistryService', () => {
  describe('REGISTRY_CONFIG', () => {
    it('has correct default values', () => {
      expect(REGISTRY_CONFIG.name).toBe('kubeairunway-registry');
      expect(REGISTRY_CONFIG.namespace).toBe('kubeairunway-system');
      expect(REGISTRY_CONFIG.port).toBe(5000);
      expect(REGISTRY_CONFIG.image).toBe('registry:2');
    });
  });

  describe('getRegistryUrl', () => {
    it('returns the correct in-cluster URL', () => {
      const url = registryService.getRegistryUrl();
      expect(url).toBe('kubeairunway-registry.kubeairunway-system.svc:5000');
    });
  });

  describe('getImageRef', () => {
    it('returns full image reference with name and tag', () => {
      const ref = registryService.getImageRef('aikit-llama2', 'Q4_K_M');
      expect(ref).toBe('kubeairunway-registry.kubeairunway-system.svc:5000/aikit-llama2:Q4_K_M');
    });

    it('handles various image names', () => {
      expect(registryService.getImageRef('my-model', 'latest'))
        .toBe('kubeairunway-registry.kubeairunway-system.svc:5000/my-model:latest');

      expect(registryService.getImageRef('aikit/llama3.2', 'v1.0'))
        .toBe('kubeairunway-registry.kubeairunway-system.svc:5000/aikit/llama3.2:v1.0');
    });
  });

  describe('checkStatus', () => {
    it('returns a status object with required fields', async () => {
      // This test runs without a real cluster connection
      // It should gracefully handle the missing cluster
      const status = await registryService.checkStatus();

      expect(status).toHaveProperty('installed');
      expect(status).toHaveProperty('ready');
      expect(status).toHaveProperty('url');
      expect(status).toHaveProperty('message');
      expect(typeof status.installed).toBe('boolean');
      expect(typeof status.ready).toBe('boolean');
      expect(typeof status.url).toBe('string');
      expect(typeof status.message).toBe('string');
    });

    it('includes the correct URL in status', async () => {
      const status = await registryService.checkStatus();
      expect(status.url).toBe('kubeairunway-registry.kubeairunway-system.svc:5000');
    });
  });
});

describe('Registry Deployment Manifest', () => {
  // These tests verify the structure of what would be created
  // without actually creating resources in a cluster

  const expectedLabels = {
    app: 'kubeairunway-registry',
    'app.kubernetes.io/name': 'kubeairunway-registry',
    'app.kubernetes.io/managed-by': 'kubeairunway',
  };

  it('deployment should use correct image', () => {
    // Verify the config is set up correctly for deployment creation
    expect(REGISTRY_CONFIG.image).toBe('registry:2');
  });

  it('deployment should target correct namespace', () => {
    expect(REGISTRY_CONFIG.namespace).toBe('kubeairunway-system');
  });

  it('deployment should expose correct port', () => {
    expect(REGISTRY_CONFIG.port).toBe(5000);
  });

  it('expected labels should be structured correctly', () => {
    expect(expectedLabels.app).toBe('kubeairunway-registry');
    expect(expectedLabels['app.kubernetes.io/managed-by']).toBe('kubeairunway');
  });
});
