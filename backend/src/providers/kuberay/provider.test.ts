import { describe, test, expect } from 'bun:test';
import { KubeRayProvider } from './index';
import type { DeploymentConfig } from '@kubefoundry/shared';

const provider = new KubeRayProvider();

describe('KubeRayProvider', () => {
  describe('provider info', () => {
    test('has correct id and name', () => {
      expect(provider.id).toBe('kuberay');
      expect(provider.name).toBe('KubeRay');
    });

    test('has default namespace', () => {
      expect(provider.defaultNamespace).toBe('kuberay');
    });
  });

  describe('getCRDConfig', () => {
    test('returns correct CRD configuration', () => {
      const config = provider.getCRDConfig();
      expect(config.apiGroup).toBe('ray.io');
      expect(config.apiVersion).toBe('v1');
      expect(config.plural).toBe('rayservices');
      expect(config.kind).toBe('RayService');
    });
  });

  describe('GAIE (Gateway API Inference Extension) support', () => {
    test('supportsGAIE returns false', () => {
      expect(provider.supportsGAIE()).toBe(false);
    });
  });
});
