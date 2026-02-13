/**
 * Plugin routes tests
 *
 * Basic tests to ensure the plugin routes are configured correctly.
 */

import { describe, it, expect } from 'vitest';
import { ROUTES, getDeploymentDetailsUrl } from './routes';

describe('KubeAIRunway Plugin Routes', () => {
  it('exports ROUTES configuration', () => {
    expect(ROUTES).toBeDefined();
    expect(ROUTES.BASE).toBe('/kubeairunway');
    expect(ROUTES.DEPLOYMENTS).toBe('/kubeairunway/deployments');
    expect(ROUTES.MODELS).toBe('/kubeairunway/models');
    expect(ROUTES.RUNTIMES).toBe('/kubeairunway/runtimes');
    expect(ROUTES.SETTINGS).toBe('/kubeairunway/settings');
    expect(ROUTES.CREATE_DEPLOYMENT).toBe('/kubeairunway/deployments/create');
  });

  it('generates correct deployment details URL', () => {
    const url = getDeploymentDetailsUrl('my-deployment', 'default');
    expect(url).toBe('/kubeairunway/deployments/default/my-deployment');
  });

  it('encodes special characters in deployment details URL', () => {
    const url = getDeploymentDetailsUrl('my deployment', 'my namespace');
    expect(url).toBe('/kubeairunway/deployments/my%20namespace/my%20deployment');
  });
});
