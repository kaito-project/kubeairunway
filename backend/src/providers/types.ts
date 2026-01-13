import { z } from 'zod';
import type { DeploymentConfig, DeploymentStatus, MetricDefinition, MetricsEndpointConfig } from '@kubefoundry/shared';

/**
 * CRD configuration for a provider's custom resources
 */
export interface CRDConfig {
  apiGroup: string;
  apiVersion: string;
  plural: string;
  kind: string;
}

/**
 * Helm repository configuration
 */
export interface HelmRepo {
  name: string;
  url: string;
}

/**
 * Helm chart configuration for installation
 */
export interface HelmChart {
  name: string;
  chart: string;
  version?: string;
  namespace: string;
  values?: Record<string, unknown>;
  createNamespace?: boolean;
  /** Optional: Direct URL to fetch the chart tarball (for charts not in repos) */
  fetchUrl?: string;
  /** Optional: Skip installing CRDs bundled with the chart (use when CRDs conflict with existing ones) */
  skipCrds?: boolean;
  /** Optional: URLs to CRD manifests to apply before installing the chart (used with skipCrds) */
  preCrdUrls?: string[];
}

/**
 * Installation status for a provider
 */
export interface InstallationStatus {
  installed: boolean;
  version?: string;
  message?: string;
  crdFound?: boolean;
  operatorRunning?: boolean;
}

/**
 * Installation step for documentation/display
 */
export interface InstallationStep {
  title: string;
  command?: string;
  description: string;
}

/**
 * Resources to clean up during uninstallation
 */
export interface UninstallResources {
  /** CRD names to delete (e.g., 'workspaces.kaito.sh') */
  crds: string[];
  /** Namespaces to delete */
  namespaces: string[];
}

/**
 * Provider interface - all inference providers must implement this
 */
export interface Provider {
  /** Unique identifier for the provider (e.g., 'dynamo', 'kuberay') */
  id: string;
  
  /** Display name (e.g., 'NVIDIA Dynamo', 'KubeRay') */
  name: string;
  
  /** Description of the provider */
  description: string;
  
  /** Default Kubernetes namespace for deployments */
  defaultNamespace: string;

  /**
   * Get CRD configuration for this provider
   */
  getCRDConfig(): CRDConfig;

  /**
   * Generate Kubernetes manifest from deployment config
   */
  generateManifest(config: DeploymentConfig): Record<string, unknown>;

  /**
   * Parse raw Kubernetes object into DeploymentStatus
   */
  parseStatus(raw: unknown): DeploymentStatus;

  /**
   * Validate deployment configuration
   * Returns validation result with any errors
   */
  validateConfig(config: unknown): { valid: boolean; errors: string[]; data?: DeploymentConfig };

  /**
   * Get Zod schema for provider-specific configuration validation
   */
  getConfigSchema(): z.ZodSchema;

  /**
   * Get installation steps for documentation
   */
  getInstallationSteps(): InstallationStep[];

  /**
   * Get required Helm repositories
   */
  getHelmRepos(): HelmRepo[];

  /**
   * Get Helm charts needed for installation
   */
  getHelmCharts(): HelmChart[];

  /**
   * Check if provider is installed in the cluster
   */
  checkInstallation(k8sApi: {
    customObjectsApi: unknown;
    coreV1Api: unknown;
    apiExtensionsApi?: unknown;
  }): Promise<InstallationStatus>;

  /**
   * Get metrics endpoint configuration for this provider's deployments.
   * Returns null if the provider does not support metrics.
   */
  getMetricsConfig(): MetricsEndpointConfig | null;

  /**
   * Get the list of key metrics to display for this provider.
   * These define which Prometheus metrics to extract and how to display them.
   */
  getKeyMetrics(): MetricDefinition[];

  /**
   * Optional: Refresh version information from external source (e.g., GitHub releases)
   * Should be called before installation to ensure latest version is used
   */
  refreshVersion?(): Promise<string>;

  /**
   * Get resources to clean up during uninstallation (CRDs, namespaces)
   * This enables complete cleanup when uninstalling a provider
   */
  getUninstallResources(): UninstallResources;
}

/**
 * Provider metadata for listing without full implementation
 */
export interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  defaultNamespace: string;
}

/**
 * Base Zod schema for deployment config (shared across providers)
 */
export const baseDeploymentConfigSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message: 'Name must be a valid Kubernetes resource name (lowercase alphanumeric and hyphens)',
  }),
  namespace: z.string().min(1),
  modelId: z.string().min(1),
  engine: z.enum(['vllm', 'sglang', 'trtllm']),
  mode: z.enum(['aggregated', 'disaggregated']).default('aggregated'),
  provider: z.enum(['dynamo', 'kuberay', 'kaito']).optional(),
  servedModelName: z.string().optional(),
  routerMode: z.enum(['none', 'kv', 'round-robin']).default('none'),
  replicas: z.number().int().min(1).max(10).default(1),
  hfTokenSecret: z.string().min(1),
  contextLength: z.number().int().positive().optional(),
  enforceEager: z.boolean().default(true),
  enablePrefixCaching: z.boolean().default(false),
  trustRemoteCode: z.boolean().default(false),
  resources: z.object({
    gpu: z.number().int().min(1).default(1),
    memory: z.string().optional(),
  }).optional(),
  engineArgs: z.record(z.unknown()).optional(),

  // Disaggregated mode configuration (P/D separation)
  prefillReplicas: z.number().int().min(1).max(10).default(1).describe('Number of prefill worker replicas'),
  decodeReplicas: z.number().int().min(1).max(10).default(1).describe('Number of decode worker replicas'),
  prefillGpus: z.number().int().min(1).default(1).describe('GPUs per prefill worker'),
  decodeGpus: z.number().int().min(1).default(1).describe('GPUs per decode worker'),
});
