import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { kubernetesService } from '../services/kubernetes';
import { helmService } from '../services/helm';
import { getProviderHealth } from '../services/providerHealth';
import logger from '../lib/logger';

export type InstallConflict = {
  kind: 'preexisting-resource';
  source: 'eno' | 'helm' | 'unknown';
  resource: { apiVersion: string; kind: string; name: string; namespace?: string };
  message: string;
};

const ENO_STORAGECLASS_CONFLICT_MESSAGE =
  'A `kaito-local-nvme-disk` StorageClass already exists and is managed by the ' +
  'AKS AI toolchain operator (Eno). AI Runway cannot install KAITO on top of ' +
  'this partial install. Options: (1) disable the AKS extension with ' +
  '`az aks update --disable-ai-toolchain-operator ...` and retry, or ' +
  '(2) install the `kaito-workspace` controller manually.';

export async function checkInstallConflicts(providerId: string): Promise<InstallConflict | null> {
  if (providerId !== 'kaito') return null;

  const sc = await kubernetesService.getStorageClass('kaito-local-nvme-disk');
  if (!sc) return null;

  const managedBy = sc.metadata?.labels?.['app.kubernetes.io/managed-by'];
  if (managedBy !== 'Eno') return null;

  return {
    kind: 'preexisting-resource',
    source: 'eno',
    resource: {
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      name: 'kaito-local-nvme-disk',
    },
    message: ENO_STORAGECLASS_CONFLICT_MESSAGE,
  };
}

/**
 * Extract provider details from an InferenceProviderConfig CRD object.
 */
function extractProviderDetails(config: any) {
  const name = config.metadata?.name || 'unknown';
  const spec = config.spec || {};
  const installation = spec.installation || {};
  const capabilities = spec.capabilities || {};

  return {
    id: name,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    description: installation.description || '',
    defaultNamespace: installation.defaultNamespace || 'default',
    crdConfig: {
      apiGroup: capabilities.engines?.length ? '' : '',
    },
    helmRepos: (installation.helmRepos || []).map((r: any) => ({
      name: r.name,
      url: r.url,
    })),
    helmCharts: (installation.helmCharts || []).map((c: any) => ({
      name: c.name,
      chart: c.chart,
      version: c.version,
      namespace: c.namespace,
      createNamespace: c.createNamespace,
      values: c.values,
    })),
    installationSteps: (installation.steps || []).map((s: any) => ({
      title: s.title,
      command: s.command,
      description: s.description,
    })),
  };
}

const installation = new Hono()
  .get('/helm/status', async (c) => {
    const helmStatus = await helmService.checkHelmAvailable();
    return c.json(helmStatus);
  })
  .get('/gpu-operator/status', async (c) => {
    const status = await kubernetesService.checkGPUOperatorStatus();
    const helmCommands = helmService.getGpuOperatorCommands();

    return c.json({
      ...status,
      helmCommands,
    });
  })
  .get('/gpu-capacity', async (c) => {
    const capacity = await kubernetesService.getClusterGpuCapacity();
    return c.json(capacity);
  })
  .get('/gpu-capacity/detailed', async (c) => {
    const capacity = await kubernetesService.getDetailedClusterGpuCapacity();
    return c.json(capacity);
  })
  .post('/gpu-operator/install', async (c) => {
    const helmStatus = await helmService.checkHelmAvailable();
    if (!helmStatus.available) {
      throw new HTTPException(400, {
        message: `Helm CLI not available: ${helmStatus.error}. Please install Helm or use the manual installation commands.`,
      });
    }

    const currentStatus = await kubernetesService.checkGPUOperatorStatus();
    if (currentStatus.installed) {
      return c.json({
        success: true,
        message: 'NVIDIA GPU Operator is already installed',
        alreadyInstalled: true,
        status: currentStatus,
      });
    }

    logger.info('Starting installation of NVIDIA GPU Operator');
    const result = await helmService.installGpuOperator((data, stream) => {
      logger.debug({ stream }, data.trim());
    });

    if (result.success) {
      const verifyStatus = await kubernetesService.checkGPUOperatorStatus();

      return c.json({
        success: true,
        message: 'NVIDIA GPU Operator installed successfully',
        status: verifyStatus,
        results: result.results.map((r) => ({
          step: r.step,
          success: r.result.success,
          output: r.result.stdout,
          error: r.result.stderr,
        })),
      });
    } else {
      const failedStep = result.results.find((r) => !r.result.success);
      throw new HTTPException(500, {
        message: `Installation failed at step "${failedStep?.step}": ${failedStep?.result.stderr}`,
      });
    }
  })
  .get('/runtimes/status', async (c) => {
    const runtimesStatus = await kubernetesService.getRuntimesStatus();
    return c.json({ runtimes: runtimesStatus });
  })
  .get('/providers/:providerId/status', async (c) => {
    const providerId = c.req.param('providerId');
    const config = await kubernetesService.getInferenceProviderConfig(providerId);

    if (!config) {
      throw new HTTPException(404, { message: `Provider not found: ${providerId}` });
    }

    const provider = extractProviderDetails(config);
    const status = config.status || {};
    const health = await getProviderHealth(providerId);

    return c.json({
      providerId: provider.id,
      providerName: provider.name,
      installed: health.healthy,
      crdFound: health.reason !== 'CRDMissing',
      operatorRunning: health.healthy,
      version: status.version,
      message: health.message,
      managedBy: health.managedBy,
      installationSteps: provider.installationSteps,
      helmCommands: helmService.getInstallCommands(provider.helmRepos, provider.helmCharts),
    });
  })
  .get('/providers/:providerId/commands', async (c) => {
    const providerId = c.req.param('providerId');
    const config = await kubernetesService.getInferenceProviderConfig(providerId);

    if (!config) {
      throw new HTTPException(404, { message: `Provider not found: ${providerId}` });
    }

    const provider = extractProviderDetails(config);

    return c.json({
      providerId: provider.id,
      providerName: provider.name,
      commands: helmService.getInstallCommands(provider.helmRepos, provider.helmCharts),
      steps: provider.installationSteps,
    });
  })
  .post('/providers/:providerId/install', async (c) => {
    const providerId = c.req.param('providerId');
    const config = await kubernetesService.getInferenceProviderConfig(providerId);

    if (!config) {
      throw new HTTPException(404, { message: `Provider not found: ${providerId}` });
    }

    const provider = extractProviderDetails(config);

    const helmStatus = await helmService.checkHelmAvailable();
    if (!helmStatus.available) {
      throw new HTTPException(400, {
        message: `Helm CLI not available: ${helmStatus.error}. Please install Helm or use the manual installation commands.`,
      });
    }

    const conflict = await checkInstallConflicts(providerId);
    if (conflict) {
      return c.json(
        {
          error: 'InstallConflict',
          conflict,
          message: conflict.message,
        },
        409,
      );
    }

    logger.info({ providerId }, `Starting installation of ${provider.name}`);
    const result = await helmService.installProvider(
      provider.helmRepos,
      provider.helmCharts,
      (data, stream) => { logger.debug({ stream, providerId }, data.trim()); }
    );

    if (result.success) {
      return c.json({
        success: true,
        message: `${provider.name} installed successfully`,
        results: result.results.map((r) => ({
          step: r.step,
          success: r.result.success,
          output: r.result.stdout,
          error: r.result.stderr,
        })),
      });
    } else {
      const failedStep = result.results.find((r) => !r.result.success);
      throw new HTTPException(500, {
        message: `Installation failed at step "${failedStep?.step}": ${failedStep?.result.stderr}`,
      });
    }
  })
  .post('/providers/:providerId/uninstall', async (c) => {
    const providerId = c.req.param('providerId');
    const config = await kubernetesService.getInferenceProviderConfig(providerId);

    if (!config) {
      throw new HTTPException(404, { message: `Provider not found: ${providerId}` });
    }

    const provider = extractProviderDetails(config);

    const helmStatus = await helmService.checkHelmAvailable();
    if (!helmStatus.available) {
      throw new HTTPException(400, {
        message: `Helm CLI not available: ${helmStatus.error}.`,
      });
    }

    logger.info({ providerId }, `Uninstalling ${provider.name}`);
    const results: Array<{ step: string; success: boolean; output: string; error?: string }> = [];

    for (const chart of [...provider.helmCharts].reverse()) {
      const result = await helmService.uninstall(chart.name, chart.namespace);
      results.push({
        step: `uninstall-${chart.name}`,
        success: result.success,
        output: result.stdout,
        error: result.stderr,
      });
    }

    const allSuccess = results.every(r => r.success);
    return c.json({
      success: allSuccess,
      message: allSuccess
        ? `${provider.name} uninstalled successfully`
        : `${provider.name} uninstall completed with errors`,
      results,
    });
  })
  .post('/providers/:providerId/uninstall-crds', async (c) => {
    const providerId = c.req.param('providerId');
    const config = await kubernetesService.getInferenceProviderConfig(providerId);

    if (!config) {
      throw new HTTPException(404, { message: `Provider not found: ${providerId}` });
    }

    const crdConfig = config.spec?.capabilities || {};
    logger.info({ providerId }, `Removing CRDs for ${providerId}`);

    // The CRD name is typically plural.apiGroup — but since we don't store that in
    // the CRD itself, we delete the InferenceProviderConfig instance for this provider
    try {
      await kubernetesService.deleteInferenceProviderConfig(providerId);
      return c.json({
        success: true,
        message: `${providerId} provider config removed successfully`,
      });
    } catch (error) {
      throw new HTTPException(500, {
        message: `Failed to remove CRDs: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  })
  .get('/gateway/status', async (c) => {
    const status = await kubernetesService.checkGatewayCRDStatus();
    return c.json(status);
  })
  .post('/gateway/install-crds', async (c) => {
    const { GATEWAY_API_CRD_URL, GAIE_CRD_URL, PINNED_GAIE_VERSION } = await import('@airunway/shared');

    const results: Array<{ step: string; success: boolean; output: string; error?: string }> = [];

    // Install Gateway API CRDs
    logger.info('Installing Gateway API CRDs');
    const gwResult = await helmService.applyManifestUrl(GATEWAY_API_CRD_URL, (data, stream) => {
      logger.debug({ stream }, data.trim());
    });
    results.push({
      step: 'gateway-api-crds',
      success: gwResult.success,
      output: gwResult.stdout,
      error: gwResult.stderr || undefined,
    });

    if (!gwResult.success) {
      throw new HTTPException(500, {
        message: `Failed to install Gateway API CRDs: ${gwResult.stderr}`,
      });
    }

    // Install GAIE CRDs
    logger.info(`Installing Inference Extension CRDs (${PINNED_GAIE_VERSION})`);
    const gaieResult = await helmService.applyManifestUrl(GAIE_CRD_URL, (data, stream) => {
      logger.debug({ stream }, data.trim());
    });
    results.push({
      step: 'inference-extension-crds',
      success: gaieResult.success,
      output: gaieResult.stdout,
      error: gaieResult.stderr || undefined,
    });

    if (!gaieResult.success) {
      throw new HTTPException(500, {
        message: `Failed to install Inference Extension CRDs: ${gaieResult.stderr}`,
      });
    }

    return c.json({
      success: true,
      message: 'Gateway API and Inference Extension CRDs installed successfully',
      results,
    });
  });

export default installation;
