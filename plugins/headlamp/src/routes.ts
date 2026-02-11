/**
 * Route path constants for the KubeFoundry Headlamp plugin
 */

export const ROUTES = {
  /** Base path for all KubeFoundry routes */
  BASE: '/kubefoundry',

  /** Deployments list page */
  DEPLOYMENTS: '/kubefoundry/deployments',

  /** Deployment details page (with name and namespace params) */
  DEPLOYMENT_DETAILS: '/kubefoundry/deployments/:namespace/:name',

  /** Models catalog page */
  MODELS: '/kubefoundry/models',

  /** Runtimes status page */
  RUNTIMES: '/kubefoundry/runtimes',

  /** Settings page */
  SETTINGS: '/kubefoundry/settings',

  /** Integrations page */
  INTEGRATIONS: '/kubefoundry/integrations',

  /** Create deployment wizard */
  CREATE_DEPLOYMENT: '/kubefoundry/deployments/create',

  /** HuggingFace OAuth callback */
  HUGGINGFACE_CALLBACK: '/kubefoundry/oauth/callback/huggingface',
} as const;

/**
 * Generate a deployment details URL
 */
export function getDeploymentDetailsUrl(name: string, namespace: string): string {
  return `/kubefoundry/deployments/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}`;
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
