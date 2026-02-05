import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { HTTPException } from 'hono/http-exception';
import { kubernetesService } from '../services/kubernetes';
import { configService } from '../services/config';
import { metricsService } from '../services/metrics';
import { validateGpuFit, formatGpuWarnings } from '../services/gpuValidation';
import { handleK8sError } from '../lib/k8s-errors';
import models from '../data/models.json';
import logger from '../lib/logger';
import type { DeploymentStatus, DeploymentConfig } from '@kubefoundry/shared';
import {
  namespaceSchema,
  resourceNameSchema,
} from '../lib/validation';

const listDeploymentsQuerySchema = z.object({
  namespace: namespaceSchema.optional(),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(1).max(100).optional()),
  offset: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : undefined))
    .pipe(z.number().int().min(0).optional()),
});

const deploymentQuerySchema = z.object({
  namespace: namespaceSchema.optional(),
});

const deploymentParamsSchema = z.object({
  name: resourceNameSchema,
});

const deployments = new Hono()
  .get('/', zValidator('query', listDeploymentsQuerySchema), async (c) => {
    try {
      const { namespace, limit, offset } = c.req.valid('query');

      // Get default namespace if not specified
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      // List deployments from the ModelDeployment CRD
      let deploymentsList: DeploymentStatus[] = await kubernetesService.listDeployments(resolvedNamespace);

      const total = deploymentsList.length;

      // Apply pagination
      if (offset !== undefined || limit !== undefined) {
        const start = offset || 0;
        const end = limit ? start + limit : undefined;
        deploymentsList = deploymentsList.slice(start, end);
      }

      return c.json({
        deployments: deploymentsList || [],
        pagination: {
          total,
          limit: limit || total,
          offset: offset || 0,
          hasMore: (offset || 0) + deploymentsList.length < total,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Error in GET /deployments');
      return c.json({
        deployments: [],
        pagination: { total: 0, limit: 0, offset: 0, hasMore: false },
      });
    }
  })
  .post('/', async (c) => {
    const body = await c.req.json();

    // Validate required fields
    if (!body.name || !body.modelId || !body.engine) {
      throw new HTTPException(400, {
        message: 'Required fields: name, modelId, engine',
      });
    }

    // Set defaults
    const config: DeploymentConfig = {
      name: body.name,
      namespace: body.namespace || (await configService.getDefaultNamespace()),
      modelId: body.modelId,
      engine: body.engine,
      mode: body.mode || 'aggregated',
      provider: body.provider,
      servedModelName: body.servedModelName,
      routerMode: body.routerMode || 'none',
      replicas: body.replicas || 1,
      hfTokenSecret: body.hfTokenSecret || '',
      contextLength: body.contextLength,
      enforceEager: body.enforceEager ?? false,
      enablePrefixCaching: body.enablePrefixCaching ?? false,
      trustRemoteCode: body.trustRemoteCode ?? false,
      resources: body.resources,
      engineArgs: body.engineArgs,
      prefillReplicas: body.prefillReplicas,
      decodeReplicas: body.decodeReplicas,
      prefillGpus: body.prefillGpus,
      decodeGpus: body.decodeGpus,
    };

    // GPU fit validation
    let gpuWarnings: string[] = [];
    try {
      const capacity = await kubernetesService.getClusterGpuCapacity();

      const model = models.models.find((m) => m.id === config.modelId);
      const modelMinGpus = (model as { minGpus?: number })?.minGpus ?? 1;

      const gpuFitResult = validateGpuFit(config, capacity, modelMinGpus);
      if (!gpuFitResult.fits) {
        gpuWarnings = formatGpuWarnings(gpuFitResult);
        logger.warn(
          {
            modelId: config.modelId,
            warnings: gpuWarnings,
            capacity: {
              available: capacity.availableGpus,
              maxContiguous: capacity.maxContiguousAvailable,
            },
          },
          'GPU fit warnings for deployment'
        );
      }
    } catch (gpuError) {
      logger.warn({ error: gpuError }, 'Could not perform GPU fit validation');
    }

    // Create deployment with detailed error handling
    try {
      await kubernetesService.createDeployment(config);
    } catch (error) {
      const { message, statusCode } = handleK8sError(error, {
        operation: 'createDeployment',
        deploymentName: config.name,
        namespace: config.namespace,
        modelId: config.modelId,
      });

      throw new HTTPException(statusCode as 400 | 403 | 404 | 409 | 422 | 500, {
        message: `Failed to create deployment: ${message}`,
      });
    }

    return c.json(
      {
        message: 'Deployment created successfully',
        name: config.name,
        namespace: config.namespace,
        ...(gpuWarnings.length > 0 && { warnings: gpuWarnings }),
      },
      201
    );
  })
  .get(
    '/:name',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      const deployment = await kubernetesService.getDeployment(name, resolvedNamespace);

      if (!deployment) {
        throw new HTTPException(404, { message: 'Deployment not found' });
      }

      return c.json(deployment);
    }
  )
  .get(
    '/:name/manifest',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      // Get the main CR manifest
      const manifest = await kubernetesService.getDeploymentManifest(name, resolvedNamespace);

      if (!manifest) {
        throw new HTTPException(404, { message: 'Deployment manifest not found' });
      }

      const kind = (manifest.kind as string) || 'ModelDeployment';
      const apiVersion = (manifest.apiVersion as string) || 'kubefoundry.kubefoundry.ai/v1alpha1';

      // Build array of resources
      const resources: Array<{
        kind: string;
        apiVersion: string;
        name: string;
        manifest: Record<string, unknown>;
      }> = [];

      // Add main CR
      resources.push({
        kind,
        apiVersion,
        name,
        manifest,
      });

      return c.json({
        resources,
        primaryResource: {
          kind,
          apiVersion,
        },
      });
    }
  )
  .delete(
    '/:name',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      try {
        await kubernetesService.deleteDeployment(name, resolvedNamespace);
      } catch (error) {
        // Check if it's a "not found" error from our own code
        if (error instanceof Error && error.message.includes('not found')) {
          throw new HTTPException(404, { message: error.message });
        }

        const { message, statusCode } = handleK8sError(error, {
          operation: 'deleteDeployment',
          deploymentName: name,
          namespace: resolvedNamespace,
        });

        throw new HTTPException(statusCode as 400 | 403 | 404 | 500, {
          message: `Failed to delete deployment: ${message}`,
        });
      }

      return c.json({ message: 'Deployment deleted successfully' });
    }
  )
  .get(
    '/:name/pods',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      const pods = await kubernetesService.getDeploymentPods(name, resolvedNamespace);
      return c.json({ pods });
    }
  )
  .get(
    '/:name/metrics',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      const metricsResponse = await metricsService.getDeploymentMetrics(name, resolvedNamespace);
      return c.json(metricsResponse);
    }
)
  .get(
    '/:name/pending-reasons',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', deploymentQuerySchema),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      try {
        // Get deployment to find pending pods
        const deployment = await kubernetesService.getDeployment(name, resolvedNamespace);

        if (!deployment) {
          throw new HTTPException(404, { message: 'Deployment not found' });
        }

        // Get all pending pods
        const pendingPods = deployment.pods.filter(pod => pod.phase === 'Pending');

        if (pendingPods.length === 0) {
          return c.json({ reasons: [] });
        }

        // Get failure reasons for the first pending pod (they're typically the same)
        const podName = pendingPods[0].name;
        const reasons = await kubernetesService.getPodFailureReasons(podName, resolvedNamespace);

        return c.json({ reasons });
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        logger.error({ error, name, namespace: resolvedNamespace }, 'Error getting pending reasons');
        return c.json(
          {
            error: {
              message: error instanceof Error ? error.message : 'Failed to get pending reasons',
              statusCode: 500,
            },
          },
          500
        );
      }
    }
  )
  .get(
    '/:name/logs',
    zValidator('param', deploymentParamsSchema),
    zValidator('query', z.object({
      namespace: namespaceSchema.optional(),
      podName: z.string().optional(),
      container: z.string().optional(),
      tailLines: z.string().optional()
        .transform((val) => (val ? parseInt(val, 10) : undefined))
        .pipe(z.number().int().min(1).max(10000).optional()),
      timestamps: z.string().optional()
        .transform((val) => val === 'true'),
    })),
    async (c) => {
      const { name } = c.req.valid('param');
      const { namespace, podName, container, tailLines, timestamps } = c.req.valid('query');
      const resolvedNamespace = namespace || (await configService.getDefaultNamespace());

      try {
        // Get pods for this deployment using label selectors
        const pods = await kubernetesService.getDeploymentPods(name, resolvedNamespace);

        if (pods.length === 0) {
          logger.debug({ name, namespace: resolvedNamespace }, 'No pods found for deployment');
          return c.json({ logs: '', podName: '', message: 'No pods found for this deployment' });
        }

        // Use specified pod or default to first pod
        const targetPodName = podName || pods[0].name;

        // Verify the pod belongs to this deployment
        const podExists = pods.some(pod => pod.name === targetPodName);
        if (!podExists) {
          throw new HTTPException(400, {
            message: `Pod '${targetPodName}' is not part of deployment '${name}'`
          });
        }

        logger.debug({ name, namespace: resolvedNamespace, targetPodName }, 'Fetching logs for pod');

        const logs = await kubernetesService.getPodLogs(targetPodName, resolvedNamespace, {
          container,
          tailLines: tailLines || 100,
          timestamps: timestamps || false,
        });

        return c.json({
          logs,
          podName: targetPodName,
          container: container || undefined,
        });
      } catch (error) {
        if (error instanceof HTTPException) {
          throw error;
        }
        logger.error({ error, name, namespace: resolvedNamespace }, 'Error getting deployment logs');
        return c.json(
          {
            error: {
              message: error instanceof Error ? error.message : 'Failed to get logs',
              statusCode: 500,
            },
          },
          500
        );
      }
    }
  );

export default deployments;
