/**
 * Models API
 */

import type { RequestFn } from './client';
import type { Model } from '../types';

export interface ModelsApi {
  /** List all available models */
  list: () => Promise<{ models: Model[] }>;

  /** Get a specific model by ID */
  get: (id: string) => Promise<Model>;
}

export function createModelsApi(request: RequestFn): ModelsApi {
  return {
    list: () => request<{ models: Model[] }>('/models'),

    get: (id: string) => request<Model>(`/models/${encodeURIComponent(id)}`),
  };
}
