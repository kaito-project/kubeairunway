import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { kubernetesService } from '../services/kubernetes';
import { helmService } from '../services/helm';
import { getProvider, getAllProviders } from '../providers/registry';
import logger from '../lib/logger';

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
    const provider = getProvider(providerId);

    if (!provider) {
      throw new HTTPException(404, { message: `Unknown provider: ${providerId}` });
    }

    // Check CRD
    const crdFound = await kubernetesService.checkCRDExists(
      `${provider.crdConfig.plural}.${provider.crdConfig.apiGroup}`
    );

    // Check operator pods
    let operatorRunning = false;
    if (crdFound) {
      try {
        const runtimes = await kubernetesService.getRuntimesStatus();
        const runtime = runtimes.find(r => r.id === providerId);
        operatorRunning = runtime?.healthy ?? false;
      } catch {
        operatorRunning = false;
      }
    }

    const installed = crdFound && operatorRunning;

    return c.json({
      providerId: provider.id,
      providerName: provider.name,
      installed,
      crdFound,
      operatorRunning,
      message: installed
        ? `${provider.name} is installed and running`
        : crdFound
          ? `${provider.name} CRD found but operator is not running`
          : `${provider.name} is not installed`,
      installationSteps: provider.installationSteps,
      helmCommands: helmService.getInstallCommands(provider.helmRepos, provider.helmCharts),
    });
  })
  .get('/providers/:providerId/commands', async (c) => {
    const providerId = c.req.param('providerId');
    const provider = getProvider(providerId);

    if (!provider) {
      throw new HTTPException(404, { message: `Unknown provider: ${providerId}` });
    }

    return c.json({
      providerId: provider.id,
      providerName: provider.name,
      commands: helmService.getInstallCommands(provider.helmRepos, provider.helmCharts),
      steps: provider.installationSteps,
    });
  })
  .post('/providers/:providerId/install', async (c) => {
    const providerId = c.req.param('providerId');
    const provider = getProvider(providerId);

    if (!provider) {
      throw new HTTPException(404, { message: `Unknown provider: ${providerId}` });
    }

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
    const provider = getProvider(providerId);

    if (!provider) {
      throw new HTTPException(404, { message: `Unknown provider: ${providerId}` });
    }

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
    const provider = getProvider(providerId);

    if (!provider) {
      throw new HTTPException(404, { message: `Unknown provider: ${providerId}` });
    }

    logger.info({ providerId }, `Removing CRDs for ${provider.name}`);
    try {
      await kubernetesService.deleteCRD(
        `${provider.crdConfig.plural}.${provider.crdConfig.apiGroup}`
      );
      return c.json({
        success: true,
        message: `${provider.name} CRDs removed successfully`,
      });
    } catch (error) {
      throw new HTTPException(500, {
        message: `Failed to remove CRDs: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  });

export default installation;
