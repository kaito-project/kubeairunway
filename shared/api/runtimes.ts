/**
 * Runtimes API
 */

import type { RequestFn } from './client';
import type { RuntimesStatusResponse } from '../types';

export interface RuntimesApi {
  /** Get status of all runtimes (installation and health) */
  getStatus: () => Promise<RuntimesStatusResponse>;
}

export function createRuntimesApi(request: RequestFn): RuntimesApi {
  return {
    getStatus: () => request<RuntimesStatusResponse>('/runtimes/status'),
  };
}
