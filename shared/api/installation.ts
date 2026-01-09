/**
 * Installation API
 */

import type { RequestFn } from './client';
import type { HelmStatus, InstallationStatus, InstallResult } from '../types';

export interface ProviderCommandsResponse {
  providerId: string;
  providerName: string;
  commands: string[];
  steps: Array<{ title: string; command?: string; description: string }>;
}

export interface InstallationApi {
  /** Get Helm installation status */
  getHelmStatus: () => Promise<HelmStatus>;

  /** Get provider installation status */
  getProviderStatus: (providerId: string) => Promise<InstallationStatus>;

  /** Get provider installation commands */
  getProviderCommands: (providerId: string) => Promise<ProviderCommandsResponse>;

  /** Install a provider */
  installProvider: (providerId: string) => Promise<InstallResult>;

  /** Upgrade a provider */
  upgradeProvider: (providerId: string) => Promise<InstallResult>;

  /** Uninstall a provider */
  uninstallProvider: (providerId: string) => Promise<InstallResult>;

  /** Uninstall provider CRDs */
  uninstallProviderCRDs: (providerId: string) => Promise<InstallResult>;
}

export function createInstallationApi(request: RequestFn): InstallationApi {
  return {
    getHelmStatus: () => request<HelmStatus>('/installation/helm/status'),

    getProviderStatus: (providerId: string) =>
      request<InstallationStatus>(
        `/installation/providers/${encodeURIComponent(providerId)}/status`
      ),

    getProviderCommands: (providerId: string) =>
      request<ProviderCommandsResponse>(
        `/installation/providers/${encodeURIComponent(providerId)}/commands`
      ),

    installProvider: (providerId: string) =>
      request<InstallResult>(
        `/installation/providers/${encodeURIComponent(providerId)}/install`,
        { method: 'POST' }
      ),

    upgradeProvider: (providerId: string) =>
      request<InstallResult>(
        `/installation/providers/${encodeURIComponent(providerId)}/upgrade`,
        { method: 'POST' }
      ),

    uninstallProvider: (providerId: string) =>
      request<InstallResult>(
        `/installation/providers/${encodeURIComponent(providerId)}/uninstall`,
        { method: 'POST' }
      ),

    uninstallProviderCRDs: (providerId: string) =>
      request<InstallResult>(
        `/installation/providers/${encodeURIComponent(providerId)}/uninstall-crds`,
        { method: 'POST' }
      ),
  };
}
