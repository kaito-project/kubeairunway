/**
 * Deployments API
 */

import type { RequestFn } from './client';
import type {
  DeploymentConfig,
  DeploymentStatus,
  PodStatus,
  DeploymentsListResponse,
} from '../types';
import type { MetricsResponse, PodLogsResponse } from '../types';

export interface DeploymentListOptions {
  limit?: number;
  offset?: number;
}

export interface DeploymentLogsOptions {
  podName?: string;
  container?: string;
  tailLines?: number;
  timestamps?: boolean;
}

export interface CreateDeploymentResponse {
  message: string;
  name: string;
  namespace: string;
  warnings?: string[];
}

export interface DeleteDeploymentResponse {
  message: string;
}

export interface DeploymentResource {
  kind: string;
  apiVersion: string;
  name: string;
  manifest: Record<string, unknown>;
}

export interface PreviewResponse {
  resources: DeploymentResource[];
  primaryResource: { kind: string; apiVersion: string };
}

export interface ManifestResponse {
  resources: DeploymentResource[];
  primaryResource: { kind: string; apiVersion: string };
}

export interface DeploymentsApi {
  /** List deployments, optionally filtered by namespace */
  list: (
    namespace?: string,
    options?: DeploymentListOptions
  ) => Promise<DeploymentsListResponse>;

  /** Get a specific deployment by name */
  get: (name: string, namespace?: string) => Promise<DeploymentStatus>;

  /** Create a new deployment */
  create: (config: DeploymentConfig) => Promise<CreateDeploymentResponse>;

  /** Delete a deployment */
  delete: (name: string, namespace?: string) => Promise<DeleteDeploymentResponse>;

  /** Get pods for a deployment */
  getPods: (name: string, namespace?: string) => Promise<{ pods: PodStatus[] }>;

  /** Get metrics for a deployment */
  getMetrics: (name: string, namespace?: string) => Promise<MetricsResponse>;

  /** Get logs for a deployment */
  getLogs: (
    name: string,
    namespace?: string,
    options?: DeploymentLogsOptions
  ) => Promise<PodLogsResponse>;

  /** Preview a deployment (dry run) */
  preview: (config: DeploymentConfig) => Promise<PreviewResponse>;

  /** Get the manifest for an existing deployment */
  getManifest: (name: string, namespace?: string) => Promise<ManifestResponse>;
}

export function createDeploymentsApi(request: RequestFn): DeploymentsApi {
  return {
    list: (namespace?: string, options?: DeploymentListOptions) => {
      const params = new URLSearchParams();
      if (namespace) params.set('namespace', namespace);
      if (options?.limit) params.set('limit', options.limit.toString());
      if (options?.offset) params.set('offset', options.offset.toString());
      const query = params.toString();
      return request<DeploymentsListResponse>(
        `/deployments${query ? `?${query}` : ''}`
      );
    },

    get: (name: string, namespace?: string) =>
      request<DeploymentStatus>(
        `/deployments/${encodeURIComponent(name)}${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`
      ),

    create: (config: DeploymentConfig) =>
      request<CreateDeploymentResponse>('/deployments', {
        method: 'POST',
        body: JSON.stringify(config),
      }),

    delete: (name: string, namespace?: string) =>
      request<DeleteDeploymentResponse>(
        `/deployments/${encodeURIComponent(name)}${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`,
        { method: 'DELETE' }
      ),

    getPods: (name: string, namespace?: string) =>
      request<{ pods: PodStatus[] }>(
        `/deployments/${encodeURIComponent(name)}/pods${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`
      ),

    getMetrics: (name: string, namespace?: string) =>
      request<MetricsResponse>(
        `/deployments/${encodeURIComponent(name)}/metrics${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`
      ),

    getLogs: (
      name: string,
      namespace?: string,
      options?: DeploymentLogsOptions
    ) => {
      const params = new URLSearchParams();
      if (namespace) params.set('namespace', namespace);
      if (options?.podName) params.set('podName', options.podName);
      if (options?.container) params.set('container', options.container);
      if (options?.tailLines)
        params.set('tailLines', options.tailLines.toString());
      if (options?.timestamps) params.set('timestamps', 'true');
      const query = params.toString();
      return request<PodLogsResponse>(
        `/deployments/${encodeURIComponent(name)}/logs${query ? `?${query}` : ''}`
      );
    },

    preview: (config: DeploymentConfig) =>
      request<PreviewResponse>('/deployments/preview', {
        method: 'POST',
        body: JSON.stringify(config),
      }),

    getManifest: (name: string, namespace?: string) =>
      request<ManifestResponse>(
        `/deployments/${encodeURIComponent(name)}/manifest${namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''}`
      ),
  };
}
