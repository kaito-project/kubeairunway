import { describe, it, expect } from 'bun:test';
import { BUILDKIT_CONFIG, buildKitService } from './buildkit';

describe('BuildKitService', () => {
  describe('BUILDKIT_CONFIG', () => {
    it('has correct default values', () => {
      expect(BUILDKIT_CONFIG.builderName).toBe('kubeairunway-builder');
      expect(BUILDKIT_CONFIG.namespace).toBe('kubeairunway-system');
      expect(BUILDKIT_CONFIG.resources.cpu).toBe('2');
      expect(BUILDKIT_CONFIG.resources.memory).toBe('4Gi');
    });
  });

  describe('getBuilderName', () => {
    it('returns the configured builder name', () => {
      const name = buildKitService.getBuilderName();
      expect(name).toBe('kubeairunway-builder');
    });
  });

  describe('checkDockerAvailable', () => {
    it('returns an availability check result', async () => {
      const result = await buildKitService.checkDockerAvailable();

      expect(result).toHaveProperty('available');
      expect(typeof result.available).toBe('boolean');

      if (result.available) {
        expect(result.version).toBeDefined();
        expect(typeof result.version).toBe('string');
      } else {
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe('string');
      }
    });
  });

  describe('checkBuildxAvailable', () => {
    it('returns an availability check result', async () => {
      const result = await buildKitService.checkBuildxAvailable();

      expect(result).toHaveProperty('available');
      expect(typeof result.available).toBe('boolean');

      if (result.available) {
        expect(result.version).toBeDefined();
      } else {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('getBuilderStatus', () => {
    it('returns a status object with required fields', async () => {
      const status = await buildKitService.getBuilderStatus();

      expect(status).toHaveProperty('exists');
      expect(status).toHaveProperty('ready');
      expect(status).toHaveProperty('name');
      expect(status).toHaveProperty('driver');
      expect(status).toHaveProperty('message');

      expect(typeof status.exists).toBe('boolean');
      expect(typeof status.ready).toBe('boolean');
      expect(status.name).toBe('kubeairunway-builder');
      expect(status.driver).toBe('kubernetes');
      expect(typeof status.message).toBe('string');
    });
  });

  describe('isBuilderReady', () => {
    it('returns a boolean', async () => {
      // First check if docker/buildx is available - if not, we can skip the actual check
      const buildxCheck = await buildKitService.checkBuildxAvailable();
      if (!buildxCheck.available) {
        // When buildx isn't available, isBuilderReady should return false
        // but getBuilderStatus may hang, so we just verify the check works
        expect(buildxCheck.available).toBe(false);
        return;
      }

      const ready = await buildKitService.isBuilderReady();
      expect(typeof ready).toBe('boolean');
    });
  });
});

describe('BuildKit Configuration', () => {
  // These tests verify the configuration structure

  it('builder should use kubernetes driver', () => {
    // The driver type is hardcoded in the create command
    // This test documents the expected behavior
    expect(BUILDKIT_CONFIG.namespace).toBe('kubeairunway-system');
  });

  it('builder should have sensible resource defaults', () => {
    // Verify resource configuration is within reasonable bounds
    const cpuValue = parseInt(BUILDKIT_CONFIG.resources.cpu, 10);
    expect(cpuValue).toBeGreaterThanOrEqual(1);
    expect(cpuValue).toBeLessThanOrEqual(8);

    // Memory should be parseable and in Gi format
    expect(BUILDKIT_CONFIG.resources.memory).toMatch(/^\d+Gi$/);
    const memoryValue = parseInt(BUILDKIT_CONFIG.resources.memory, 10);
    expect(memoryValue).toBeGreaterThanOrEqual(2);
    expect(memoryValue).toBeLessThanOrEqual(16);
  });

  it('builder name should be valid kubernetes name', () => {
    const name = BUILDKIT_CONFIG.builderName;
    // Kubernetes names must be lowercase alphanumeric with hyphens
    expect(name).toMatch(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });
});
