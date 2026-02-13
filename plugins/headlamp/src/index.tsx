/**
 * KubeAIRunway Headlamp Plugin
 *
 * This plugin provides ML deployment management capabilities within Headlamp,
 * supporting KAITO, KubeRay, and Dynamo runtimes.
 */

import {
  registerRoute,
  registerSidebarEntry,
  registerPluginSettings,
} from '@kinvolk/headlamp-plugin/lib';

import { ROUTES } from './routes';
import { PluginSettings } from './settings';
import { DeploymentsList } from './pages/DeploymentsList';
import { DeploymentDetails } from './pages/DeploymentDetails';
import { ModelsCatalog } from './pages/ModelsCatalog';
import { RuntimesStatus } from './pages/RuntimesStatus';
import { CreateDeployment } from './pages/CreateDeployment';
import { Integrations } from './pages/Integrations';
import { HuggingFaceCallback } from './pages/HuggingFaceCallback';

// ============================================================================
// Sidebar Registration
// ============================================================================

// Parent sidebar entry
registerSidebarEntry({
  parent: null,
  name: 'kubeairunway',
  label: 'KubeAIRunway',
  icon: 'mdi:anvil',
  url: ROUTES.DEPLOYMENTS,
});

// Deployments
registerSidebarEntry({
  parent: 'kubeairunway',
  name: 'kf-deployments',
  label: 'Deployments',
  url: ROUTES.DEPLOYMENTS,
});

// Models
registerSidebarEntry({
  parent: 'kubeairunway',
  name: 'kf-models',
  label: 'Models',
  url: ROUTES.MODELS,
});

// Runtimes
registerSidebarEntry({
  parent: 'kubeairunway',
  name: 'kf-runtimes',
  label: 'Runtimes',
  url: ROUTES.RUNTIMES,
});

// Integrations
registerSidebarEntry({
  parent: 'kubeairunway',
  name: 'kf-integrations',
  label: 'Integrations',
  url: ROUTES.INTEGRATIONS,
});

// Settings (visible from sidebar)
registerSidebarEntry({
  parent: 'kubeairunway',
  name: 'kf-settings',
  label: 'Settings',
  url: ROUTES.SETTINGS,
});

// ============================================================================
// Route Registration
// ============================================================================

// Create deployment - MUST be registered before DEPLOYMENT_DETAILS to avoid
// /kubeairunway/deployments/create being matched as /:namespace/:name
registerRoute({
  path: ROUTES.CREATE_DEPLOYMENT,
  sidebar: 'kf-deployments',
  name: 'Create Deployment',
  exact: true,
  component: () => <CreateDeployment />,
});

// Deployments list
registerRoute({
  path: ROUTES.DEPLOYMENTS,
  sidebar: 'kf-deployments',
  name: 'KubeAIRunway Deployments',
  exact: true,
  component: () => <DeploymentsList />,
});

// Deployment details
registerRoute({
  path: ROUTES.DEPLOYMENT_DETAILS,
  sidebar: 'kf-deployments',
  name: 'Deployment Details',
  exact: true,
  component: () => <DeploymentDetails />,
});

// Models catalog
registerRoute({
  path: ROUTES.MODELS,
  sidebar: 'kf-models',
  name: 'KubeAIRunway Models',
  exact: true,
  component: () => <ModelsCatalog />,
});

// Runtimes status
registerRoute({
  path: ROUTES.RUNTIMES,
  sidebar: 'kf-runtimes',
  name: 'KubeAIRunway Runtimes',
  exact: true,
  component: () => <RuntimesStatus />,
});

// Integrations
registerRoute({
  path: ROUTES.INTEGRATIONS,
  sidebar: 'kf-integrations',
  name: 'KubeAIRunway Integrations',
  exact: true,
  component: () => <Integrations />,
});

// HuggingFace OAuth Callback
registerRoute({
  path: ROUTES.HUGGINGFACE_CALLBACK,
  sidebar: 'kf-integrations',
  name: 'HuggingFace Callback',
  exact: true,
  component: () => <HuggingFaceCallback />,
});

// Settings page
registerRoute({
  path: ROUTES.SETTINGS,
  sidebar: 'kf-settings',
  name: 'KubeAIRunway Settings',
  exact: true,
  component: () => <PluginSettings />,
});

// ============================================================================
// Plugin Settings Registration
// ============================================================================

registerPluginSettings(
  'kubeairunway-headlamp-plugin',
  PluginSettings,
  true // showInMenu
);
