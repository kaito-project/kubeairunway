/**
 * Plugin Storage Utilities
 *
 * Provides access to Headlamp's plugin settings storage.
 * Falls back to localStorage if Headlamp storage is not available.
 */

const PLUGIN_ID = 'kubeairunway-headlamp-plugin';
const STORAGE_PREFIX = `headlamp_plugin_${PLUGIN_ID}_`;

// Helper to access Headlamp's pluginLib with proper typing
function getPluginLib(): Record<string, unknown> | undefined {
  if (typeof window !== 'undefined') {
    return (window as { pluginLib?: Record<string, unknown> }).pluginLib;
  }
  return undefined;
}

/**
 * Get a plugin setting value
 */
export function getPluginSettingsValue(key: string): string | null {
  try {
    const pluginLib = getPluginLib();
    // Try Headlamp's plugin storage API if available
    if (pluginLib && typeof pluginLib.getPluginSettingsValue === 'function') {
      return pluginLib.getPluginSettingsValue(PLUGIN_ID, key) as string | null;
    }

    // Fall back to localStorage
    return localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
}

/**
 * Set a plugin setting value
 */
export function setPluginSettingsValue(key: string, value: string): void {
  try {
    const pluginLib = getPluginLib();
    // Try Headlamp's plugin storage API if available
    if (pluginLib && typeof pluginLib.setPluginSettingsValue === 'function') {
      pluginLib.setPluginSettingsValue(PLUGIN_ID, key, value);
      return;
    }

    // Fall back to localStorage
    localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  } catch {
    console.warn('[KubeAIRunway] Failed to save setting:', key);
  }
}

/**
 * Remove a plugin setting
 */
export function removePluginSettingsValue(key: string): void {
  try {
    const pluginLib = getPluginLib();
    // Try Headlamp's plugin storage API if available
    if (pluginLib && typeof pluginLib.removePluginSettingsValue === 'function') {
      pluginLib.removePluginSettingsValue(PLUGIN_ID, key);
      return;
    }

    // Fall back to localStorage
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    console.warn('[KubeAIRunway] Failed to remove setting:', key);
  }
}

/**
 * Get all plugin settings
 */
export function getAllPluginSettings(): Record<string, string> {
  const settings: Record<string, string> = {};

  try {
    // Scan localStorage for our prefix
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        const settingKey = key.substring(STORAGE_PREFIX.length);
        const value = localStorage.getItem(key);
        if (value !== null) {
          settings[settingKey] = value;
        }
      }
    }
  } catch {
    console.warn('[KubeAIRunway] Failed to read settings');
  }

  return settings;
}
