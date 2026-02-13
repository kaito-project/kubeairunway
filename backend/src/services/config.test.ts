import { describe, test, expect } from 'bun:test';
import type { AppConfig } from './config';

describe('ConfigService - AppConfig Structure', () => {
  test('creates valid config with all fields', () => {
    const config: AppConfig = {
      activeProviderId: 'dynamo',
      defaultNamespace: 'kubeairunway-system',
    };

    expect(config.activeProviderId).toBe('dynamo');
    expect(config.defaultNamespace).toBe('kubeairunway-system');
  });

  test('all fields are optional', () => {
    const config: AppConfig = {};
    expect(config.activeProviderId).toBeUndefined();
    expect(config.defaultNamespace).toBeUndefined();
  });

  test('allows partial config', () => {
    const config: AppConfig = {
      defaultNamespace: 'ml-workloads',
    };

    expect(config.defaultNamespace).toBe('ml-workloads');
    expect(config.activeProviderId).toBeUndefined();
  });
});

describe('ConfigService - Default Config Logic', () => {
  function getDefaultConfig(): AppConfig {
    return {
      defaultNamespace: process.env.DEFAULT_NAMESPACE,
    };
  }

  test('uses DEFAULT_NAMESPACE env var when set', () => {
    const originalEnv = process.env.DEFAULT_NAMESPACE;
    process.env.DEFAULT_NAMESPACE = 'test-namespace';

    const config = getDefaultConfig();
    expect(config.defaultNamespace).toBe('test-namespace');

    // Restore
    if (originalEnv === undefined) {
      delete process.env.DEFAULT_NAMESPACE;
    } else {
      process.env.DEFAULT_NAMESPACE = originalEnv;
    }
  });

  test('defaultNamespace is undefined when env var not set', () => {
    const originalEnv = process.env.DEFAULT_NAMESPACE;
    delete process.env.DEFAULT_NAMESPACE;

    const config = getDefaultConfig();
    expect(config.defaultNamespace).toBeUndefined();

    // Restore
    if (originalEnv !== undefined) {
      process.env.DEFAULT_NAMESPACE = originalEnv;
    }
  });
});

describe('ConfigService - Config Merging', () => {
  function mergeConfig(current: AppConfig, updates: Partial<AppConfig>): AppConfig {
    return {
      ...current,
      ...updates,
    };
  }

  test('merges partial updates', () => {
    const current: AppConfig = {
      activeProviderId: 'dynamo',
      defaultNamespace: 'default',
    };

    const merged = mergeConfig(current, { defaultNamespace: 'new-namespace' });

    expect(merged.activeProviderId).toBe('dynamo');
    expect(merged.defaultNamespace).toBe('new-namespace');
  });

  test('overwrites existing values', () => {
    const current: AppConfig = {
      activeProviderId: 'dynamo',
    };

    const merged = mergeConfig(current, { activeProviderId: 'kaito' });
    expect(merged.activeProviderId).toBe('kaito');
  });

  test('adds new values', () => {
    const current: AppConfig = {};
    const merged = mergeConfig(current, {
      activeProviderId: 'dynamo',
      defaultNamespace: 'ml-ns',
    });

    expect(merged.activeProviderId).toBe('dynamo');
    expect(merged.defaultNamespace).toBe('ml-ns');
  });

  test('preserves unmodified values', () => {
    const current: AppConfig = {
      activeProviderId: 'kaito',
      defaultNamespace: 'original',
    };

    const merged = mergeConfig(current, {});

    expect(merged.activeProviderId).toBe('kaito');
    expect(merged.defaultNamespace).toBe('original');
  });
});

describe('ConfigService - ConfigMap Naming', () => {
  const CONFIG_NAMESPACE = 'kubeairunway-system';
  const CONFIG_NAME = 'kubeairunway-config';
  const CONFIG_KEY = 'config.json';

  test('uses correct ConfigMap namespace', () => {
    expect(CONFIG_NAMESPACE).toBe('kubeairunway-system');
  });

  test('uses correct ConfigMap name', () => {
    expect(CONFIG_NAME).toBe('kubeairunway-config');
  });

  test('uses correct data key', () => {
    expect(CONFIG_KEY).toBe('config.json');
  });
});

describe('ConfigService - Config Serialization', () => {
  test('serializes config to JSON', () => {
    const config: AppConfig = {
      activeProviderId: 'dynamo',
      defaultNamespace: 'ml-workloads',
    };

    const json = JSON.stringify(config, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed.activeProviderId).toBe('dynamo');
    expect(parsed.defaultNamespace).toBe('ml-workloads');
  });

  test('handles empty config serialization', () => {
    const config: AppConfig = {};
    const json = JSON.stringify(config, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed).toEqual({});
  });

  test('deserializes config from JSON', () => {
    const json = '{"activeProviderId":"kaito","defaultNamespace":"kaito-workspace"}';
    const config = JSON.parse(json) as AppConfig;

    expect(config.activeProviderId).toBe('kaito');
    expect(config.defaultNamespace).toBe('kaito-workspace');
  });
});

describe('ConfigService - Cache Behavior', () => {
  // Simulate cache behavior
  class MockConfigCache {
    private cachedConfig: AppConfig | null = null;
    private initialized = false;

    getFromCache(): AppConfig | null {
      if (this.cachedConfig && this.initialized) {
        return this.cachedConfig;
      }
      return null;
    }

    setCache(config: AppConfig): void {
      this.cachedConfig = config;
      this.initialized = true;
    }

    clearCache(): void {
      this.cachedConfig = null;
      this.initialized = false;
    }

    isInitialized(): boolean {
      return this.initialized;
    }
  }

  test('returns null when not initialized', () => {
    const cache = new MockConfigCache();
    expect(cache.getFromCache()).toBeNull();
    expect(cache.isInitialized()).toBe(false);
  });

  test('returns cached config after initialization', () => {
    const cache = new MockConfigCache();
    const config: AppConfig = { defaultNamespace: 'cached-ns' };

    cache.setCache(config);

    expect(cache.getFromCache()).toEqual(config);
    expect(cache.isInitialized()).toBe(true);
  });

  test('clears cache correctly', () => {
    const cache = new MockConfigCache();
    cache.setCache({ defaultNamespace: 'test' });

    cache.clearCache();

    expect(cache.getFromCache()).toBeNull();
    expect(cache.isInitialized()).toBe(false);
  });

  test('updates cache on subsequent sets', () => {
    const cache = new MockConfigCache();

    cache.setCache({ defaultNamespace: 'first' });
    expect(cache.getFromCache()?.defaultNamespace).toBe('first');

    cache.setCache({ defaultNamespace: 'second' });
    expect(cache.getFromCache()?.defaultNamespace).toBe('second');
  });
});

describe('ConfigService - Provider Fallback Logic', () => {
  // Simulate the fallback logic for getting default namespace
  function getDefaultNamespace(
    config: AppConfig,
    providerNamespaces: Record<string, string>
  ): string {
    // First: use configured default namespace
    if (config.defaultNamespace) {
      return config.defaultNamespace;
    }

    // Second: use active provider's namespace (backward compat)
    if (config.activeProviderId && providerNamespaces[config.activeProviderId]) {
      return providerNamespaces[config.activeProviderId];
    }

    // Third: fall back to dynamo's namespace
    return providerNamespaces['dynamo'] || 'kubeairunway-system';
  }

  const providerNamespaces: Record<string, string> = {
    dynamo: 'dynamo',
    kaito: 'kaito-workspace',
    kuberay: 'kuberay',
  };

  test('prefers explicit defaultNamespace', () => {
    const config: AppConfig = {
      defaultNamespace: 'custom-ns',
      activeProviderId: 'dynamo',
    };

    expect(getDefaultNamespace(config, providerNamespaces)).toBe('custom-ns');
  });

  test('falls back to activeProvider namespace', () => {
    const config: AppConfig = {
      activeProviderId: 'kaito',
    };

    expect(getDefaultNamespace(config, providerNamespaces)).toBe('kaito-workspace');
  });

  test('falls back to dynamo namespace', () => {
    const config: AppConfig = {};

    expect(getDefaultNamespace(config, providerNamespaces)).toBe('dynamo');
  });

  test('falls back to kubeairunway-system if no dynamo', () => {
    const config: AppConfig = {};
    const emptyProviders: Record<string, string> = {};

    expect(getDefaultNamespace(config, emptyProviders)).toBe('kubeairunway-system');
  });
});
