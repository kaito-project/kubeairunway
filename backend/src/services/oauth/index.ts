import { EntraOAuthProvider } from './entra';
import { GitHubOAuthProvider } from './github';
import type { OAuthProvider } from './types';
import logger from '../../lib/logger';

const providers = new Map<string, OAuthProvider>();

/**
 * Initialize OAuth providers from environment variables.
 * Called on app startup when HUB_MODE is enabled.
 */
export function initializeOAuthProviders(): void {
  const enabledProviders = (process.env.ENABLED_AUTH_PROVIDERS || '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (enabledProviders.includes('entra')) {
    const clientId = process.env.AZURE_CLIENT_ID;
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    if (clientId && tenantId) {
      providers.set('entra', new EntraOAuthProvider(clientId, tenantId, clientSecret));
      logger.info('Azure Entra ID OAuth provider initialized');
    } else {
      logger.warn('Entra OAuth enabled but AZURE_CLIENT_ID or AZURE_TENANT_ID not set');
    }
  }

  if (enabledProviders.includes('github')) {
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (clientId && clientSecret) {
      providers.set('github', new GitHubOAuthProvider(clientId, clientSecret));
      logger.info('GitHub OAuth provider initialized');
    } else {
      logger.warn('GitHub OAuth enabled but GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not set');
    }
  }
}

export function getOAuthProvider(type: string): OAuthProvider | undefined {
  return providers.get(type);
}

export function getEnabledProviders(): Array<{ type: string; enabled: boolean }> {
  return Array.from(providers.entries()).map(([type]) => ({ type, enabled: true }));
}

/** Clear all registered providers (for testing only) */
export function clearOAuthProviders(): void {
  providers.clear();
}
