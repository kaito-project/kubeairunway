/**
 * Settings API
 */

import type { RequestFn } from './client';
import type { Settings, ProviderInfo, ProviderDetails } from '../types';

export interface UpdateSettingsRequest {
  defaultNamespace?: string;
}

export interface UpdateSettingsResponse {
  message: string;
  config: Settings['config'];
}

export interface SettingsApi {
  /** Get current settings */
  get: () => Promise<Settings>;

  /** Update settings */
  update: (settings: UpdateSettingsRequest) => Promise<UpdateSettingsResponse>;

  /** List all available providers */
  listProviders: () => Promise<{ providers: ProviderInfo[] }>;

  /** Get details for a specific provider */
  getProvider: (id: string) => Promise<ProviderDetails>;
}

export function createSettingsApi(request: RequestFn): SettingsApi {
  return {
    get: () => request<Settings>('/settings'),

    update: (settings: UpdateSettingsRequest) =>
      request<UpdateSettingsResponse>('/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),

    listProviders: () => request<{ providers: ProviderInfo[] }>('/settings/providers'),

    getProvider: (id: string) =>
      request<ProviderDetails>(`/settings/providers/${encodeURIComponent(id)}`),
  };
}
