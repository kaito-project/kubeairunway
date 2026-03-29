/**
 * Gateway API
 */

import type { RequestFn } from './client';
import type { GatewayCRDStatus, GatewayCRDInstallResult } from '../types';

export interface GatewayApi {
  /** Get Gateway CRD installation status */
  getStatus: () => Promise<GatewayCRDStatus>;

  /** Install Gateway API and Inference Extension CRDs */
  installCrds: () => Promise<GatewayCRDInstallResult>;
}

export function createGatewayApi(request: RequestFn): GatewayApi {
  return {
    getStatus: () => request<GatewayCRDStatus>('/installation/gateway/status'),

    installCrds: () =>
      request<GatewayCRDInstallResult>('/installation/gateway/install-crds', {
        method: 'POST',
      }),
  };
}
