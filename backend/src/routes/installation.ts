import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { kubernetesService } from '../services/kubernetes';
import { helmService } from '../services/helm';
import logger from '../lib/logger';

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

    return c.json({
      providerId: provider.id,
      providerName: provider.name,
      installed: status.ready === true,
      crdFound: true,
      operatorRunning: status.ready === true,
      version: status.version,
      message: status.ready
        ? `${provider.name} is installed and running`
        : `${provider.name} is registered but not ready`,
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
    // the CRD itself, we delete the InferenceProviderConfig for this provider
    try {
      await kubernetesService.deleteCRD(
        `inferenceproviderconfigs.kubeairunway.ai`
      );
      return c.json({
        success: true,
        message: `${providerId} CRDs removed successfully`,
      });
    } catch (error) {
      throw new HTTPException(500, {
        message: `Failed to remove CRDs: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });

export default installation;
