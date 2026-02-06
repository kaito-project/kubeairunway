/**
 * Cloud Provider Pricing Service
 *
 * Fetches real-time pricing from cloud provider APIs.
 * Currently supports:
 * - Azure Retail Prices API (no auth required)
 * - AWS Pricing API (requires credentials - TODO)
 * - GCP Cloud Billing Catalog API (requires credentials - TODO)
 */

import { logger } from '../lib/logger';
import { withRetry } from '../lib/retry';

/** Timeout for external API calls in milliseconds */
const API_TIMEOUT_MS = 10000;

/** Maximum cache entries to prevent memory leaks */
const MAX_CACHE_ENTRIES = 1000;

// Cache pricing data to avoid excessive API calls
interface PricingCache {
  data: Map<string, CachedPrice>;
  ttlMs: number;
}

interface CachedPrice {
  price: InstancePrice;
  fetchedAt: number;
}

export interface InstancePrice {
  instanceType: string;
  provider: 'azure' | 'aws' | 'gcp';
  region: string;
  hourlyPrice: number;
  currency: string;
  priceType: 'ondemand' | 'spot' | 'reserved';
  gpuCount?: number;
  gpuModel?: string;
  vcpus?: number;
  memoryGb?: number;
  lastUpdated: Date;
}

export interface PricingLookupResult {
  success: boolean;
  price?: InstancePrice;
  error?: string;
  cached?: boolean;
}

// Azure Retail Prices API response types
interface AzurePriceItem {
  currencyCode: string;
  tierMinimumUnits: number;
  retailPrice: number;
  unitPrice: number;
  armRegionName: string;
  location: string;
  effectiveStartDate: string;
  meterId: string;
  meterName: string;
  productId: string;
  skuId: string;
  productName: string;
  skuName: string;
  serviceName: string;
  serviceId: string;
  serviceFamily: string;
  unitOfMeasure: string;
  type: string;
  isPrimaryMeterRegion: boolean;
  armSkuName: string;
}

interface AzurePriceResponse {
  BillingCurrency: string;
  CustomerEntityId: string;
  CustomerEntityType: string;
  Items: AzurePriceItem[];
  NextPageLink: string | null;
  Count: number;
}

// GPU info extracted from instance types
const AZURE_GPU_INFO: Record<string, { gpuCount: number; gpuModel: string }> = {
  // NV A10 series
  Standard_NV6ads_A10_v5: { gpuCount: 0.167, gpuModel: 'A10' }, // 1/6 GPU
  Standard_NV12ads_A10_v5: { gpuCount: 0.333, gpuModel: 'A10' }, // 1/3 GPU
  Standard_NV18ads_A10_v5: { gpuCount: 0.5, gpuModel: 'A10' }, // 1/2 GPU
  Standard_NV36ads_A10_v5: { gpuCount: 1, gpuModel: 'A10' },
  Standard_NV72ads_A10_v5: { gpuCount: 2, gpuModel: 'A10' },
  // NC A100 series
  Standard_NC24ads_A100_v4: { gpuCount: 1, gpuModel: 'A100-80GB' },
  Standard_NC48ads_A100_v4: { gpuCount: 2, gpuModel: 'A100-80GB' },
  Standard_NC96ads_A100_v4: { gpuCount: 4, gpuModel: 'A100-80GB' },
  // NC H100 series
  Standard_NC40ads_H100_v5: { gpuCount: 1, gpuModel: 'H100' },
  Standard_NC80adis_H100_v5: { gpuCount: 2, gpuModel: 'H100' },
  // ND A100 series
  Standard_ND96asr_A100_v4: { gpuCount: 8, gpuModel: 'A100-40GB' },
  Standard_ND96amsr_A100_v4: { gpuCount: 8, gpuModel: 'A100-80GB' },
  // ND H100 series
  Standard_ND96isr_H100_v5: { gpuCount: 8, gpuModel: 'H100' },
  // NC T4 series
  Standard_NC4as_T4_v3: { gpuCount: 1, gpuModel: 'T4' },
  Standard_NC8as_T4_v3: { gpuCount: 1, gpuModel: 'T4' },
  Standard_NC16as_T4_v3: { gpuCount: 1, gpuModel: 'T4' },
  Standard_NC64as_T4_v3: { gpuCount: 4, gpuModel: 'T4' },
  // NC V100 series
  Standard_NC6s_v3: { gpuCount: 1, gpuModel: 'V100' },
  Standard_NC12s_v3: { gpuCount: 2, gpuModel: 'V100' },
  Standard_NC24s_v3: { gpuCount: 4, gpuModel: 'V100' },
  Standard_NC24rs_v3: { gpuCount: 4, gpuModel: 'V100' },
};

class CloudPricingService {
  private cache: PricingCache = {
    data: new Map(),
    ttlMs: 60 * 60 * 1000, // 1 hour cache
  };

  /**
   * Look up real-time pricing for an instance type
   */
  async getInstancePrice(
    instanceType: string,
    provider: 'azure' | 'aws' | 'gcp',
    region?: string
  ): Promise<PricingLookupResult> {
    const cacheKey = `${provider}:${instanceType}:${region || 'default'}`;

    // Check cache first and clean expired entries
    this.cleanExpiredCache();
    const cached = this.cache.data.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.cache.ttlMs) {
      return { success: true, price: cached.price, cached: true };
    }

    try {
      let price: InstancePrice | undefined;

      switch (provider) {
        case 'azure':
          price = await this.fetchAzurePrice(instanceType, region);
          break;
        case 'aws':
          // TODO: Implement AWS pricing lookup
          return {
            success: false,
            error: 'AWS pricing API not yet implemented',
          };
        case 'gcp':
          // TODO: Implement GCP pricing lookup
          return {
            success: false,
            error: 'GCP pricing API not yet implemented',
          };
      }

      if (price) {
        // Cache the result
        this.cache.data.set(cacheKey, {
          price,
          fetchedAt: Date.now(),
        });
        return { success: true, price, cached: false };
      }

      return { success: false, error: 'Price not found' };
    } catch (error) {
      logger.error({ error, instanceType, provider }, 'Failed to fetch pricing');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Validate and sanitize instance type for OData filter
   * Prevents OData injection attacks
   */
  private validateInstanceType(instanceType: string): string {
    // Azure instance types follow pattern: Standard_* or Basic_*
    // Allow alphanumeric, underscores, and hyphens only
    const sanitized = instanceType.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(sanitized)) {
      throw new Error(`Invalid instance type format: ${instanceType}`);
    }
    if (sanitized.length > 100) {
      throw new Error('Instance type too long');
    }
    return sanitized;
  }

  /**
   * Validate and sanitize region for OData filter
   * Prevents OData injection attacks
   */
  private validateRegion(region: string): string {
    // Azure regions are lowercase alphanumeric with optional numbers
    const sanitized = region.trim().toLowerCase();
    if (!/^[a-z][a-z0-9]*$/.test(sanitized)) {
      throw new Error(`Invalid region format: ${region}`);
    }
    if (sanitized.length > 50) {
      throw new Error('Region too long');
    }
    return sanitized;
  }

  /**
   * Fetch pricing from Azure Retail Prices API
   * https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices
   */
  private async fetchAzurePrice(
    instanceType: string,
    region?: string
  ): Promise<InstancePrice | undefined> {
    // Validate inputs to prevent OData injection
    const validatedInstanceType = this.validateInstanceType(instanceType);
    const validatedRegion = region ? this.validateRegion(region) : undefined;

    // Build filter query
    // We want Linux VM consumption (pay-as-you-go) pricing
    let filter = `armSkuName eq '${validatedInstanceType}' and priceType eq 'Consumption' and contains(meterName, 'Spot') eq false`;

    if (validatedRegion) {
      filter += ` and armRegionName eq '${validatedRegion}'`;
    }

    const url = `https://prices.azure.com/api/retail/prices?$filter=${encodeURIComponent(filter)}`;

    logger.debug({ url, instanceType, region }, 'Fetching Azure pricing');

    // Use retry logic with timeout for external API calls
    const response = await withRetry(
      async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

        try {
          const res = await fetch(url, {
            headers: {
              Accept: 'application/json',
            },
            signal: controller.signal,
          });
          return res;
        } finally {
          clearTimeout(timeoutId);
        }
      },
      {
        operationName: 'fetchAzurePrice',
        maxRetries: 2,
        initialDelayMs: 500,
        maxDelayMs: 3000,
        isRetryable: (error) => {
          // Retry on network errors or 5xx/429 responses
          if (error instanceof Error) {
            if (error.name === 'AbortError') return true; // Timeout
            if (error.message.includes('fetch failed')) return true;
            if (error.message.includes('network')) return true;
          }
          const statusCode = (error as { statusCode?: number })?.statusCode;
          return statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Azure pricing API returned ${response.status}: ${response.statusText}`);
    }

    const data: AzurePriceResponse = await response.json();

    if (data.Items.length === 0) {
      logger.warn({ instanceType, region }, 'No pricing found for instance type');
      return undefined;
    }

    // Find the Linux VM price (not Windows, not Low Priority/Spot)
    const linuxPrice = data.Items.find(
      (item) =>
        item.productName.includes('Virtual Machines') &&
        !item.productName.includes('Windows') &&
        !item.meterName.includes('Low Priority') &&
        !item.meterName.includes('Spot') &&
        item.unitOfMeasure === '1 Hour'
    );

    if (!linuxPrice) {
      // Fall back to first item if no Linux-specific price found
      const fallback = data.Items.find((item) => item.unitOfMeasure === '1 Hour');
      if (!fallback) {
        logger.warn({ instanceType, items: data.Items.length }, 'No hourly price found');
        return undefined;
      }
      return this.mapAzurePriceToInstancePrice(fallback, instanceType);
    }

    return this.mapAzurePriceToInstancePrice(linuxPrice, instanceType);
  }

  private mapAzurePriceToInstancePrice(
    item: AzurePriceItem,
    instanceType: string
  ): InstancePrice {
    const gpuInfo = AZURE_GPU_INFO[instanceType];

    return {
      instanceType,
      provider: 'azure',
      region: item.armRegionName,
      hourlyPrice: item.retailPrice,
      currency: item.currencyCode,
      priceType: 'ondemand',
      gpuCount: gpuInfo?.gpuCount,
      gpuModel: gpuInfo?.gpuModel,
      lastUpdated: new Date(item.effectiveStartDate),
    };
  }

  /**
   * Get pricing for all GPU node pools in the cluster
   * Fetches pricing in parallel for better performance
   */
  async getNodePoolPricing(
    nodePools: Array<{ name: string; instanceType?: string; region?: string }>
  ): Promise<Map<string, PricingLookupResult>> {
    const results = new Map<string, PricingLookupResult>();

    // Build list of pools that need pricing lookups
    const lookupTasks: Array<{
      poolName: string;
      instanceType: string;
      provider: 'azure' | 'aws' | 'gcp';
      region?: string;
    }> = [];

    for (const pool of nodePools) {
      if (!pool.instanceType) {
        results.set(pool.name, {
          success: false,
          error: 'Instance type not available',
        });
        continue;
      }

      // Detect provider from instance type naming
      const provider = this.detectProvider(pool.instanceType);
      if (!provider) {
        results.set(pool.name, {
          success: false,
          error: `Unknown provider for instance type: ${pool.instanceType}`,
        });
        continue;
      }

      lookupTasks.push({
        poolName: pool.name,
        instanceType: pool.instanceType,
        provider,
        region: pool.region,
      });
    }

    // Fetch all prices in parallel
    const pricingResults = await Promise.all(
      lookupTasks.map(async (task) => {
        const result = await this.getInstancePrice(task.instanceType, task.provider, task.region);
        return { poolName: task.poolName, result };
      })
    );

    // Populate results map
    for (const { poolName, result } of pricingResults) {
      results.set(poolName, result);
    }

    return results;
  }

  /**
   * Detect cloud provider from instance type naming convention
   */
  detectProvider(instanceType: string): 'azure' | 'aws' | 'gcp' | undefined {
    if (!instanceType) {
      return undefined;
    }

    // Azure: Standard_*, Basic_*
    if (instanceType.startsWith('Standard_') || instanceType.startsWith('Basic_')) {
      return 'azure';
    }

    // GCP: Check for GCP-specific patterns first (before AWS, since both can start with letter+number)
    // GCP patterns: n1-standard-*, n2-*, e2-*, a2-*, c2-*, m1-*, custom-*
    const gcpPatterns = /^(n1|n2|n2d|c2|c2d|c3|c3d|e2|m1|m2|m3|a2|a3|g2|custom)-/i;
    if (gcpPatterns.test(instanceType)) {
      return 'gcp';
    }

    // AWS: starts with letter+number followed by letter or dot (p4d.24xlarge, g5.xlarge, etc.)
    // Pattern: letter + digit + (letter or dot) - more specific than before
    if (/^[a-z][0-9]+[a-z.]/i.test(instanceType) && instanceType.includes('.')) {
      return 'aws';
    }

    // GCP fallback: contains dashes (covers custom machine types like custom-2-4096)
    if (instanceType.includes('-') && !instanceType.startsWith('Standard_')) {
      return 'gcp';
    }

    return undefined;
  }

  /**
   * Clear the pricing cache
   */
  clearCache(): void {
    this.cache.data.clear();
  }

  /**
   * Clean expired cache entries to prevent memory leaks
   * Also enforces a maximum cache size
   */
  private cleanExpiredCache(): void {
    const now = Date.now();
    let expiredCount = 0;

    // Remove expired entries
    for (const [key, cached] of this.cache.data) {
      if (now - cached.fetchedAt >= this.cache.ttlMs) {
        this.cache.data.delete(key);
        expiredCount++;
      }
    }

    // If cache is still too large, remove oldest entries (LRU-like behavior)
    if (this.cache.data.size > MAX_CACHE_ENTRIES) {
      const entries = Array.from(this.cache.data.entries());
      entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);

      const toRemove = entries.slice(0, this.cache.data.size - MAX_CACHE_ENTRIES);
      for (const [key] of toRemove) {
        this.cache.data.delete(key);
      }

      logger.debug(
        { removed: toRemove.length, remaining: this.cache.data.size },
        'Evicted old cache entries due to size limit'
      );
    }

    if (expiredCount > 0) {
      logger.debug({ expiredCount }, 'Cleaned expired cache entries');
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; ttlMs: number; maxEntries: number } {
    return {
      size: this.cache.data.size,
      ttlMs: this.cache.ttlMs,
      maxEntries: MAX_CACHE_ENTRIES,
    };
  }
}

export const cloudPricingService = new CloudPricingService();
