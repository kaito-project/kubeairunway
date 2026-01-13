import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { kubernetesService } from '../services/kubernetes';
import { helmService } from '../services/helm';
import { providerRegistry } from '../providers';
import logger from '../lib/logger';
import { handleK8sError } from '../lib/k8s-errors';

const providerIdParamsSchema = z.object({
  id: z.string().min(1),
});

const installQuerySchema = z.object({
  force: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
});

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
  .get(
    '/providers/:id/status',
    zValidator('param', providerIdParamsSchema),
    async (c) => {
      const { id } = c.req.valid('param');

      if (!providerRegistry.hasProvider(id)) {
        throw new HTTPException(404, { message: `Provider not found: ${id}` });
      }

      let installationStatus;
      try {
        installationStatus = await kubernetesService.checkProviderInstallation(id);
      } catch (error) {
        const { message, statusCode } = handleK8sError(error, { providerId: id, operation: 'checkInstallation' });
        throw new HTTPException(statusCode as 400 | 401 | 403 | 404 | 500, {
          message: `Failed to check installation status: ${message}`,
        });
      }

      const provider = providerRegistry.getProvider(id);

      // Refresh version from GitHub if provider supports it
      try {
        if (provider.refreshVersion) {
          await provider.refreshVersion();
        }
      } catch (error) {
        logger.warn({ error, providerId: id }, 'Failed to refresh provider version');
        // Continue with cached version
      }

      return c.json({
        providerId: id,
        providerName: provider.name,
        ...installationStatus,
        installationSteps: provider.getInstallationSteps(),
        helmCommands: helmService.getInstallCommands(
          provider.getHelmRepos(),
          provider.getHelmCharts()
        ),
      });
    }
  )
  .get(
    '/providers/:id/commands',
    zValidator('param', providerIdParamsSchema),
    async (c) => {
      const { id } = c.req.valid('param');

      if (!providerRegistry.hasProvider(id)) {
        throw new HTTPException(404, { message: `Provider not found: ${id}` });
      }

      const provider = providerRegistry.getProvider(id);

      // Refresh version from GitHub if provider supports it
      if (provider.refreshVersion) {
        await provider.refreshVersion();
      }

      const commands = helmService.getInstallCommands(
        provider.getHelmRepos(),
        provider.getHelmCharts()
      );

      return c.json({
        providerId: id,
        providerName: provider.name,
        commands,
        steps: provider.getInstallationSteps(),
      });
    }
  )
  .post(
    '/providers/:id/install',
    zValidator('param', providerIdParamsSchema),
    zValidator('query', installQuerySchema),
    async (c) => {
      const { id } = c.req.valid('param');
      const { force } = c.req.valid('query');

      if (!providerRegistry.hasProvider(id)) {
        throw new HTTPException(404, { message: `Provider not found: ${id}` });
      }

      const helmStatus = await helmService.checkHelmAvailable();
      if (!helmStatus.available) {
        throw new HTTPException(400, {
          message: `Helm CLI not available: ${helmStatus.error}. Please install Helm or use the manual installation commands.`,
        });
      }

      const provider = providerRegistry.getProvider(id);

      // Check current installation status with error handling
      let currentStatus;
      try {
        currentStatus = await kubernetesService.checkProviderInstallation(id);
      } catch (error) {
        const { message, statusCode } = handleK8sError(error, { providerId: id, operation: 'checkInstallation' });
        throw new HTTPException(statusCode as 400 | 401 | 403 | 404 | 500, {
          message: `Failed to check installation status: ${message}`,
        });
      }

      if (currentStatus.installed) {
        return c.json({
          success: true,
          message: `${provider.name} is already installed`,
          alreadyInstalled: true,
        });
      }

      // Refresh version from GitHub if provider supports it
      try {
        if (provider.refreshVersion) {
          await provider.refreshVersion();
        }
      } catch (error) {
        logger.warn({ error, providerId: id }, 'Failed to refresh provider version, using cached version');
        // Continue with cached version
      }

      // Check for stuck/failed releases before attempting installation
      const charts = provider.getHelmCharts();
      const releaseProblems = await helmService.checkReleaseProblems(charts);
      if (releaseProblems.hasProblems) {
        if (force) {
          // Force mode: uninstall problematic releases first
          logger.info({ providerId: id, problems: releaseProblems.problems }, 'Force mode: cleaning up problematic releases');
          for (const problem of releaseProblems.problems) {
            logger.info({ chart: problem.chart, namespace: problem.namespace, status: problem.status }, `Uninstalling stuck release: ${problem.chart}`);
            const uninstallResult = await helmService.uninstall(problem.chart, problem.namespace, (data, stream) => {
              logger.debug({ stream }, data.trim());
            });
            if (!uninstallResult.success) {
              logger.warn({ chart: problem.chart, stderr: uninstallResult.stderr }, 'Failed to uninstall stuck release, continuing anyway');
            }
          }
        } else {
          const problemMessages = releaseProblems.problems.map(p => p.message).join('\n');
          throw new HTTPException(409, {
            message: `Cannot install: existing Helm release(s) in problematic state.\n\n${problemMessages}\n\nTip: You can add ?force=true to automatically clean up stuck releases.`,
          });
        }
      }

      // Check if installation is already in progress
      const inProgressCheck = await helmService.checkInstallInProgress(charts);
      if (inProgressCheck.inProgress) {
        const pendingNames = inProgressCheck.pendingCharts.map(c => `${c.chart} (${c.status})`).join(', ');
        logger.info({ providerId: id, pendingCharts: inProgressCheck.pendingCharts }, 'Installation already in progress');
        return c.json({
          success: true,
          message: `${provider.name} installation is already in progress. Please wait for it to complete.`,
          installing: true,
          pendingCharts: pendingNames,
        });
      }

      logger.info(
        { providerId: id, providerName: provider.name, charts: provider.getHelmCharts().map(c => ({ name: c.name, version: c.version, namespace: c.namespace })) },
        `Starting installation of ${provider.name}`
      );
      
      let result;
      try {
        result = await helmService.installProvider(
          provider.getHelmRepos(),
          provider.getHelmCharts(),
          (data, stream) => {
            // Log all helm output for debugging
            if (stream === 'stderr') {
              logger.warn({ stream, data: data.trim() }, 'Helm stderr output');
            } else {
              logger.info({ stream, data: data.trim() }, 'Helm stdout output');
            }
          }
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error during Helm installation';
        const errorStack = error instanceof Error ? error.stack : undefined;
        logger.error({ error: errorMessage, stack: errorStack, providerId: id }, 'Helm installation threw an exception');
        throw new HTTPException(500, {
          message: `Helm installation failed: ${errorMessage}`,
        });
      }

      if (result.success) {
        // Installation command was accepted - check current status
        // Note: Without --wait, Helm returns immediately while installation progresses
        let verifyStatus;
        try {
          verifyStatus = await kubernetesService.checkProviderInstallation(id);
        } catch (error) {
          logger.warn({ error, providerId: id }, 'Failed to verify installation status');
          verifyStatus = { 
            installed: false, 
            crdFound: false,
            operatorRunning: false,
            message: 'Installation started, awaiting completion. Check status to monitor progress.' 
          };
        }

        // If not fully installed yet, indicate it's in progress
        const isFullyInstalled = verifyStatus.installed;
        
        return c.json({
          success: true,
          message: isFullyInstalled 
            ? `${provider.name} installed successfully` 
            : `${provider.name} installation started. The operator is being deployed - check status for progress.`,
          installing: !isFullyInstalled,
          installationStatus: verifyStatus,
          results: result.results.map((r) => ({
            step: r.step,
            success: r.result.success,
            output: r.result.stdout,
            error: r.result.stderr,
          })),
        });
      } else {
        const failedStep = result.results.find((r) => !r.result.success);
        // Sanitize stderr to prevent JSON serialization issues
        const stderr = (failedStep?.result.stderr || 'Unknown error')
          .replace(/[\x00-\x1F\x7F]/g, ' ')  // Replace control characters
          .trim()
          .slice(0, 1000);  // Increased limit for more context
        
        const stdout = (failedStep?.result.stdout || '')
          .replace(/[\x00-\x1F\x7F]/g, ' ')
          .trim()
          .slice(0, 500);
        
        logger.error({ 
          providerId: id, 
          failedStep: failedStep?.step, 
          stderr, 
          stdout,
          exitCode: failedStep?.result.exitCode 
        }, `Installation failed at step: ${failedStep?.step}`);
        
        // Check if this is a timeout issue (could indicate pending-install)
        const isTimeout = stderr.includes('timed out') || stderr.includes('timeout');
        const isCRDConflict = stderr.includes('conflict') && stderr.includes('CRD');
        
        let suggestion = '';
        if (isTimeout) {
          suggestion = ' The installation may still be in progress. Check with "helm list -A" and wait for the release to complete, or run "helm uninstall <release-name> -n <namespace>" to clean up.';
        } else if (isCRDConflict) {
          suggestion = ' A CRD conflict occurred. This typically happens when CRDs already exist from another installation. Check if NVIDIA GPU Operator or another operator already installed these CRDs.';
        }
        
        throw new HTTPException(500, {
          message: `Installation failed at step "${failedStep?.step}": ${stderr}${suggestion}`,
        });
      }
    }
  )
  .post(
    '/providers/:id/upgrade',
    zValidator('param', providerIdParamsSchema),
    async (c) => {
      const { id } = c.req.valid('param');

      if (!providerRegistry.hasProvider(id)) {
        throw new HTTPException(404, { message: `Provider not found: ${id}` });
      }

      const helmStatus = await helmService.checkHelmAvailable();
      if (!helmStatus.available) {
        throw new HTTPException(400, {
          message: `Helm CLI not available: ${helmStatus.error}. Please install Helm or use the manual upgrade commands.`,
        });
      }

      const provider = providerRegistry.getProvider(id);
      const charts = provider.getHelmCharts();
      const repos = provider.getHelmRepos();

      logger.info(
        { providerId: id, providerName: provider.name },
        `Starting upgrade of ${provider.name}`
      );

      for (const repo of repos) {
        await helmService.repoAdd(repo);
      }
      await helmService.repoUpdate();

      const results: Array<{ chart: string; success: boolean; output: string; error?: string }> =
        [];

      for (const chart of charts) {
        const result = await helmService.upgrade(chart, (data, stream) => {
          logger.debug({ stream }, data.trim());
        });

        results.push({
          chart: chart.name,
          success: result.success,
          output: result.stdout,
          error: result.stderr || undefined,
        });

        if (!result.success) {
          throw new HTTPException(500, {
            message: `Upgrade failed for chart "${chart.name}": ${result.stderr}`,
          });
        }
      }

      const verifyStatus = await kubernetesService.checkProviderInstallation(id);

      return c.json({
        success: true,
        message: `${provider.name} upgraded successfully`,
        installationStatus: verifyStatus,
        results,
      });
    }
  )
  .post(
    '/providers/:id/uninstall',
    zValidator('param', providerIdParamsSchema),
    async (c) => {
      const { id } = c.req.valid('param');

      if (!providerRegistry.hasProvider(id)) {
        throw new HTTPException(404, { message: `Provider not found: ${id}` });
      }

      const helmStatus = await helmService.checkHelmAvailable();
      if (!helmStatus.available) {
        throw new HTTPException(400, { message: `Helm CLI not available: ${helmStatus.error}` });
      }

      const provider = providerRegistry.getProvider(id);
      const charts = provider.getHelmCharts();
      const uninstallResources = provider.getUninstallResources();

      logger.info(
        { providerId: id, providerName: provider.name },
        `Starting uninstall of ${provider.name} (preserving CRDs)`
      );

      const results: Array<{ step: string; success: boolean; output: string; error?: string }> =
        [];

      // Step 1: Uninstall Helm charts (in reverse order)
      for (const chart of [...charts].reverse()) {
        const result = await helmService.uninstall(chart.name, chart.namespace, (data, stream) => {
          logger.debug({ stream }, data.trim());
        });

        results.push({
          step: `Uninstall Helm chart: ${chart.name}`,
          success: result.success,
          output: result.stdout,
          error: result.stderr || undefined,
        });

        // If uninstall fails, throw an error with the details
        if (!result.success) {
          const stderr = (result.stderr || 'Unknown error')
            .replace(/[\x00-\x1F\x7F]/g, ' ')  // Replace control characters
            .trim()
            .slice(0, 500);  // Limit length
          throw new HTTPException(500, {
            message: `Failed to uninstall Helm chart "${chart.name}": ${stderr}`,
          });
        }
      }

      // Step 2: Delete namespaces (but NOT CRDs - those require separate uninstall-crds call)
      for (const namespace of uninstallResources.namespaces) {
        const result = await kubernetesService.deleteNamespace(namespace);
        results.push({
          step: `Delete namespace: ${namespace}`,
          success: result.success,
          output: result.message,
          error: result.success ? undefined : result.message,
        });
      }

      const verifyStatus = await kubernetesService.checkProviderInstallation(id);

      return c.json({
        success: true,
        message: `${provider.name} uninstalled (CRDs preserved - use "Uninstall CRDs" for complete removal)`,
        installationStatus: verifyStatus,
        results,
      });
    }
  )
  .post(
    '/providers/:id/uninstall-crds',
    zValidator('param', providerIdParamsSchema),
    async (c) => {
      const { id } = c.req.valid('param');

      if (!providerRegistry.hasProvider(id)) {
        throw new HTTPException(404, { message: `Provider not found: ${id}` });
      }

      const provider = providerRegistry.getProvider(id);
      const uninstallResources = provider.getUninstallResources();

      logger.info(
        { providerId: id, providerName: provider.name, crds: uninstallResources.crds },
        `Starting CRD uninstall for ${provider.name}`
      );

      const results: Array<{ step: string; success: boolean; output: string; error?: string }> =
        [];

      // Delete CRDs
      for (const crdName of uninstallResources.crds) {
        const result = await kubernetesService.deleteCRD(crdName);
        results.push({
          step: `Delete CRD: ${crdName}`,
          success: result.success,
          output: result.message,
          error: result.success ? undefined : result.message,
        });
      }

      const verifyStatus = await kubernetesService.checkProviderInstallation(id);

      return c.json({
        success: true,
        message: `${provider.name} CRDs uninstalled`,
        installationStatus: verifyStatus,
        results,
      });
    }
  );

export default installation;
