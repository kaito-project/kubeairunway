/**
 * Route path constants for the KubeAIRunway Headlamp plugin
 */

export const ROUTES = {
  /** Base path for all KubeAIRunway routes */
  BASE: '/kubeairunway',

  /** Deployments list page */
  DEPLOYMENTS: '/kubeairunway/deployments',

  /** Deployment details page (with name and namespace params) */
  DEPLOYMENT_DETAILS: '/kubeairunway/deployments/:namespace/:name',

  /** Models catalog page */
  MODELS: '/kubeairunway/models',

  /** Runtimes status page */
  RUNTIMES: '/kubeairunway/runtimes',

  /** Settings page */
  SETTINGS: '/kubeairunway/settings',

  /** Integrations page */
  INTEGRATIONS: '/kubeairunway/integrations',

  /** Create deployment wizard */
  CREATE_DEPLOYMENT: '/kubeairunway/deployments/create',

  /** HuggingFace OAuth callback */
  HUGGINGFACE_CALLBACK: '/kubeairunway/oauth/callback/huggingface',
} as const;

/**
 * Generate a deployment details URL
 */
export function getDeploymentDetailsUrl(name: string, namespace: string): string {
  return `/kubeairunway/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
}

/**
 * Generate a create deployment URL with model pre-selected
 */
export function getCreateDeploymentUrl(modelId: string, source?: 'huggingface' | 'curated'): string {
  const params = new URLSearchParams({ modelId });
  if (source) {
    params.append('source', source);
  }
  return `${ROUTES.CREATE_DEPLOYMENT}?${params.toString()}`;
}

/**
 * Get the full OAuth callback URL for HuggingFace
 * Uses the current window origin to support different environments
 */
export function getHuggingFaceCallbackUrl(): string {
  return `${window.location.origin}${ROUTES.HUGGINGFACE_CALLBACK}`;
}
