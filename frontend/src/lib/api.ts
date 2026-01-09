/**
 * KubeFoundry Frontend API Client
 *
 * This module provides a configured API client for the browser environment.
 * It wraps the shared API client with browser-specific configuration.
 */

// API Base URL - when not specified, use relative URL (same origin)
// This allows the frontend to work both in development (with VITE_API_URL=http://localhost:3001)
// and in production (served from the same container as the backend)
const API_BASE = import.meta.env.VITE_API_URL || '';

console.log('[API] API_BASE:', API_BASE || '(same origin)');

// Auth token storage key
const AUTH_TOKEN_KEY = 'kubefoundry_auth_token';

/**
 * Get the stored auth token
 */
function getAuthToken(): string | null {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Dispatch unauthorized event to trigger logout
 */
function dispatchUnauthorized(): void {
  window.dispatchEvent(new CustomEvent('auth:unauthorized'));
}

// ============================================================================
// Re-export types from @kubefoundry/shared
// ============================================================================

// Core types
export type {
  Engine,
  ModelTask,
  Model,
  DeploymentMode,
  RouterMode,
  DeploymentPhase,
  PodPhase,
  GgufRunMode,
  DeploymentConfig,
  PodStatus,
  DeploymentStatus,
  ClusterStatus,
} from '@kubefoundry/shared';

// Settings types
export type {
  ProviderInfo,
  ProviderDetails,
  Settings,
  RuntimeStatus,
  RuntimesStatusResponse,
} from '@kubefoundry/shared';

// Installation types
export type {
  HelmStatus,
  InstallationStatus,
  InstallResult,
  GPUOperatorStatus,
  GPUOperatorInstallResult,
  NodeGpuInfo,
  ClusterGpuCapacity,
} from '@kubefoundry/shared';

// HuggingFace types
export type {
  HfUserInfo,
  HfTokenExchangeRequest,
  HfTokenExchangeResponse,
  HfSaveSecretRequest,
  HfSecretStatus,
  HfModelSearchResult,
  HfModelSearchResponse,
  HfSearchParams,
} from '@kubefoundry/shared';

// API response types
export type {
  Pagination,
  DeploymentsListResponse,
  ClusterStatusResponse,
} from '@kubefoundry/shared';

// Metrics types
export type {
  MetricsResponse,
  RawMetricValue,
  ComputedMetric,
  ComputedMetrics,
  MetricDefinition,
} from '@kubefoundry/shared';

// Autoscaler types
export type {
  AutoscalerDetectionResult,
  AutoscalerStatusInfo,
  DetailedClusterCapacity,
  NodePoolInfo,
  PodFailureReason,
  PodLogsOptions,
  PodLogsResponse,
} from '@kubefoundry/shared';

// AI Configurator types
export type {
  AIConfiguratorInput,
  AIConfiguratorResult,
  AIConfiguratorStatus,
  AIConfiguratorConfig,
  AIConfiguratorPerformance,
} from '@kubefoundry/shared';

// ============================================================================
// Re-export API types from shared
// ============================================================================

export type { ClusterNode } from '@kubefoundry/shared/api';
export type {
  PremadeModel,
  AikitBuildRequest,
  AikitBuildResult,
  AikitPreviewResult,
  AikitInfrastructureStatus,
} from '@kubefoundry/shared/api';

// ============================================================================
// Create and export the configured API client
// ============================================================================

import { createApiClient, ApiError } from '@kubefoundry/shared/api';

// Re-export ApiError for backwards compatibility
export { ApiError };

// Create the browser-configured API client
const apiClient = createApiClient({
  baseUrl: API_BASE,
  getToken: getAuthToken,
  onUnauthorized: dispatchUnauthorized,
});

// ============================================================================
// Export API modules (backwards compatible)
// ============================================================================

export const modelsApi = apiClient.models;
export const deploymentsApi = apiClient.deployments;
export const metricsApi = apiClient.metrics;
export const healthApi = apiClient.health;
export const settingsApi = apiClient.settings;
export const runtimesApi = apiClient.runtimes;
export const installationApi = apiClient.installation;
export const gpuOperatorApi = apiClient.gpuOperator;
export const autoscalerApi = apiClient.autoscaler;
export const huggingFaceApi = apiClient.huggingFace;
export const aikitApi = apiClient.aikit;
export const aiConfiguratorApi = apiClient.aiConfigurator;
