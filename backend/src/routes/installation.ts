import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { kubernetesService } from '../services/kubernetes';
import { helmService } from '../services/helm';
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
  .get('/kubefoundry/status', async (c) => {
    // Check KubeFoundry controller installation status
    const runtimesStatus = await kubernetesService.getRuntimesStatus();
    const kubefoundryStatus = runtimesStatus.find(r => r.id === 'kubefoundry') || {
      id: 'kubefoundry',
      name: 'KubeFoundry',
      installed: false,
      healthy: false,
      message: 'Controller not installed',
    };

    return c.json(kubefoundryStatus);
  })
  .get('/runtimes/status', async (c) => {
    // Get status of all runtimes (currently just KubeFoundry)
    const runtimesStatus = await kubernetesService.getRuntimesStatus();
    return c.json({ runtimes: runtimesStatus });
  });

export default installation;
