/**
 * Plugin routes tests
 *
 * Basic tests to ensure the plugin routes are configured correctly.
 */

import { describe, it, expect } from 'vitest';
import { ROUTES, getDeploymentDetailsUrl } from './routes';

describe('KubeFoundry Plugin Routes', () => {
  it('exports ROUTES configuration', () => {
    expect(ROUTES).toBeDefined();
    expect(ROUTES.BASE).toBe('/kubefoundry');
    expect(ROUTES.DEPLOYMENTS).toBe('/kubefoundry/deployments');
    expect(ROUTES.MODELS).toBe('/kubefoundry/models');
    expect(ROUTES.RUNTIMES).toBe('/kubefoundry/runtimes');
    expect(ROUTES.SETTINGS).toBe('/kubefoundry/settings');
    expect(ROUTES.CREATE_DEPLOYMENT).toBe('/kubefoundry/deployments/create');
  });

  it('generates correct deployment details URL', () => {
    const url = getDeploymentDetailsUrl('my-deployment', 'default');
    expect(url).toBe('/kubefoundry/deployments/default/my-deployment');
  });

  it('encodes special characters in deployment details URL', () => {
    const url = getDeploymentDetailsUrl('my deployment', 'my namespace');
    expect(url).toBe('/kubefoundry/deployments/my%20namespace/my%20deployment');
  });
});
