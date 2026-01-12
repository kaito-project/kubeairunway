import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { costEstimationService } from '../services/costEstimation';
import { kubernetesService } from '../services/kubernetes';
import type { CostEstimateResponse, NodePoolCostEstimate } from '@kubefoundry/shared';

const costEstimateRequestSchema = z.object({
  gpuType: z.string().min(1, 'GPU type is required'),
  gpuCount: z.number().int().min(1, 'GPU count must be at least 1'),
  replicas: z.number().int().min(1, 'Replicas must be at least 1'),
  hoursPerMonth: z.number().int().min(1).max(744).optional(),
});

export const costsRoutes = new Hono()
  /**
   * Estimate deployment cost based on GPU configuration
   */
  .post('/estimate', zValidator('json', costEstimateRequestSchema), async (c) => {
    const request = c.req.valid('json');

    const breakdown = costEstimationService.estimateCost(request);

    const response: CostEstimateResponse = {
      success: true,
      breakdown,
    };

    return c.json(response);
  })

  /**
   * Get cost estimates for all node pools in the cluster
   */
  .get('/node-pools', async (c) => {
    const gpuCountParam = c.req.query('gpuCount');
    const replicasParam = c.req.query('replicas');

    const gpuCount = gpuCountParam ? parseInt(gpuCountParam, 10) : 1;
    const replicas = replicasParam ? parseInt(replicasParam, 10) : 1;

    // Get detailed cluster capacity with node pool info
    const capacity = await kubernetesService.getDetailedClusterGpuCapacity();

    // Estimate costs for each node pool
    const nodePoolCosts: NodePoolCostEstimate[] = costEstimationService.estimateNodePoolCosts(
      capacity.nodePools,
      gpuCount,
      replicas
    );

    return c.json({
      success: true,
      nodePoolCosts,
      pricingLastUpdated: costEstimationService.getPricingLastUpdated(),
    });
  })

  /**
   * Get list of supported GPU models with pricing
   */
  .get('/gpu-models', (c) => {
    const models = costEstimationService.getSupportedGpuModels();

    return c.json({
      success: true,
      models,
      pricingLastUpdated: costEstimationService.getPricingLastUpdated(),
    });
  })

  /**
   * Normalize a GPU model name to our pricing key
   */
  .get('/normalize-gpu', (c) => {
    const gpuLabel = c.req.query('label');

    if (!gpuLabel) {
      return c.json({ success: false, error: 'GPU label is required' }, 400);
    }

    const normalizedModel = costEstimationService.normalizeGpuModel(gpuLabel);
    const pricing = costEstimationService.getGpuPricing(normalizedModel);

    return c.json({
      success: true,
      originalLabel: gpuLabel,
      normalizedModel,
      pricing: pricing
        ? {
            memoryGb: pricing.memoryGb,
            generation: pricing.generation,
            hourlyRate: pricing.hourlyRate,
          }
        : null,
    });
  });
