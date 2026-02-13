/**
 * Backend Discovery Service
 *
 * Discovers the KubeAIRunway backend URL using multiple strategies:
 * 1. Plugin settings (user-configured)
 * 2. In-cluster service discovery
 * 3. Default fallback (localhost for development)
 */

import { getPluginSettingsValue, setPluginSettingsValue } from './plugin-storage';

export interface BackendConfig {
  url: string;
  source: 'settings' | 'service-discovery' | 'default';
}

// Settings keys
const SETTINGS_KEY_BACKEND_URL = 'backendUrl';
const SETTINGS_KEY_BACKEND_NAMESPACE = 'backendNamespace';

// Default values
const DEFAULT_NAMESPACE = 'kubeairunway-system';
const DEFAULT_LOCAL_URL = 'http://localhost:3001';

/**
 * Get the configured backend URL from settings
 */
export function getBackendUrlFromSettings(): string | null {
  return getPluginSettingsValue(SETTINGS_KEY_BACKEND_URL);
}

/**
 * Set the backend URL in settings
 */
export function setBackendUrl(url: string): void {
  setPluginSettingsValue(SETTINGS_KEY_BACKEND_URL, url);
}

/**
 * Get the configured backend namespace from settings
 */
export function getBackendNamespace(): string {
  return getPluginSettingsValue(SETTINGS_KEY_BACKEND_NAMESPACE) || DEFAULT_NAMESPACE;
}

/**
 * Set the backend namespace in settings
 */
export function setBackendNamespace(namespace: string): void {
  setPluginSettingsValue(SETTINGS_KEY_BACKEND_NAMESPACE, namespace);
}

/**
 * Build the in-cluster service URL
 */
function getInClusterServiceUrl(namespace: string): string {
  return `http://kubeairunway.${namespace}.svc:3001`;
}

/**
 * Check if a backend URL is reachable
 */
async function isBackendReachable(url: string, timeout = 3000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${url}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Discover the KubeAIRunway backend
 *
 * Tries in order:
 * 1. User-configured URL from settings
 * 2. In-cluster service discovery
 * 3. Default localhost URL
 */
export async function discoverBackend(): Promise<BackendConfig> {
  // 1. Check plugin settings first
  const settingsUrl = getBackendUrlFromSettings();
  if (settingsUrl) {
    return { url: settingsUrl, source: 'settings' };
  }

  // 2. Try in-cluster service discovery
  const namespace = getBackendNamespace();
  const serviceUrl = getInClusterServiceUrl(namespace);

  // Note: In a browser running inside Headlamp, we can't directly access
  // cluster services without a proxy. This check would work if Headlamp
  // proxies the request, otherwise we skip to default.
  const isInCluster = await isBackendReachable(serviceUrl);
  if (isInCluster) {
    return { url: serviceUrl, source: 'service-discovery' };
  }

  // 3. Default (for development)
  return { url: DEFAULT_LOCAL_URL, source: 'default' };
}

/**
 * Get the cached or discovered backend URL
 * Uses a simple in-memory cache for the current session
 */
let cachedConfig: BackendConfig | null = null;

export async function getBackendConfig(): Promise<BackendConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = await discoverBackend();
  return cachedConfig;
}

/**
 * Clear the cached backend config (call when settings change)
 */
export function clearBackendCache(): void {
  cachedConfig = null;
}

/**
 * Get the backend URL synchronously (returns default if not yet discovered)
 */
export function getBackendUrlSync(): string {
  // Check settings first
  const settingsUrl = getBackendUrlFromSettings();
  if (settingsUrl) {
    return settingsUrl;
  }

  // Use cached config if available
  if (cachedConfig) {
    return cachedConfig.url;
  }

  // Fall back to default
  return DEFAULT_LOCAL_URL;
}
