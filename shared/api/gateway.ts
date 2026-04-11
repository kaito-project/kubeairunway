/**
 * Gateway API
 *
 * Gateway readiness and model routing information surfaced via the
 * AI Runway backend. See GatewayInfo / GatewayModelInfo in shared/types/deployment.ts
 * for the payload shapes.
 */

import type { RequestFn } from './client';
import type { GatewayInfo } from '../types';

export interface GatewayApi {
  /** Get gateway readiness and endpoint URL */
  getStatus: () => Promise<GatewayInfo>;
}

export function createGatewayApi(request: RequestFn): GatewayApi {
  return {
    getStatus: () => request<GatewayInfo>('/gateway/status'),
  };
}
