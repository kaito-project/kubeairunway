/**
 * Metrics Service
 * Fetches and processes Prometheus metrics from inference deployments
 */

import type { MetricsResponse, RawMetricValue } from '@airunway/shared';
import { parsePrometheusText } from '../lib/prometheus-parser';
import logger from '../lib/logger';
import { kubernetesService } from './kubernetes';
import * as fs from 'fs';

// Timeout for metrics fetch (5 seconds)
const METRICS_FETCH_TIMEOUT = 5000;

// Kubernetes service account token path (exists only when running in-cluster)
const K8S_SERVICE_ACCOUNT_TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';

// Default metrics configuration for inference deployments
const DEFAULT_METRICS_CONFIG = {
  serviceNamePattern: '{name}',
  port: 8000,
  endpointPath: '/metrics',
};

/**
 * Check if AIRunway is running inside a Kubernetes cluster
 * This is determined by the presence of the service account token
 */
function isRunningInCluster(): boolean {
  try {
    return fs.existsSync(K8S_SERVICE_ACCOUNT_TOKEN_PATH);
  } catch {
    return false;
  }
}

// Cache the in-cluster check result
let _isInCluster: boolean | null = null;
function checkInCluster(): boolean {
  if (_isInCluster === null) {
    _isInCluster = isRunningInCluster();
    logger.info({ inCluster: _isInCluster }, 'Detected cluster environment');
  }
  return _isInCluster;
}

/**
 * Build the metrics URL for a deployment
 */
function buildMetricsUrl(
  deploymentName: string,
  namespace: string,
  servicePattern: string,
  port: number,
  endpointPath: string
): string {
  // Replace {name} placeholder with actual deployment name
  const serviceName = servicePattern.replace('{name}', deploymentName);

  // Build the in-cluster service URL
  // Format: http://<service>.<namespace>.svc.cluster.local:<port><path>
  return `http://${serviceName}.${namespace}.svc.cluster.local:${port}${endpointPath}`;
}

/**
 * Fetch raw metrics from a deployment's metrics endpoint
 */
async function fetchRawMetrics(url: string): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), METRICS_FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'text/plain',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * MetricsService class for fetching deployment metrics
 */
class MetricsService {
  /**
   * Check if metrics fetching is available (requires cluster connection)
   */
  isMetricsAvailable(): boolean {
    return true;
  }

  /**
   * Get metrics for a deployment
   *
   * @param deploymentName - Name of the deployment
   * @param namespace - Kubernetes namespace
   * @param providerId - Optional provider ID (for future use)
   * @returns MetricsResponse with available metrics or error
   */
  async getDeploymentMetrics(deploymentName: string, namespace: string, _providerId?: string): Promise<MetricsResponse> {
    const timestamp = new Date().toISOString();
    const inCluster = checkInCluster();

    try {
      // Use default metrics configuration
      const metricsConfig = DEFAULT_METRICS_CONFIG;
      const serviceName = metricsConfig.serviceNamePattern.replace('{name}', deploymentName);

      let rawText: string;

      if (inCluster) {
        // In-cluster: fetch directly via cluster DNS (fast path)
        const url = buildMetricsUrl(
          deploymentName,
          namespace,
          metricsConfig.serviceNamePattern,
          metricsConfig.port,
          metricsConfig.endpointPath
        );

        logger.debug({ url, deploymentName, namespace }, 'Fetching metrics from deployment (in-cluster)');
        rawText = await fetchRawMetrics(url);
      } else {
        // Off-cluster: proxy through the K8s API server via kubeconfig
        const path = metricsConfig.endpointPath.replace(/^\//, ''); // strip leading slash
        logger.debug({ deploymentName, namespace, port: metricsConfig.port, path }, 'Fetching metrics via K8s API proxy (off-cluster)');
        rawText = await kubernetesService.proxyServiceGet(serviceName, namespace, metricsConfig.port, path);
      }

      // Parse Prometheus format
      const metrics = parsePrometheusText(rawText);

      logger.debug(
        { deploymentName, namespace, metricCount: metrics.length },
        'Successfully fetched and parsed metrics'
      );

      return {
        available: true,
        timestamp,
        metrics,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Provide helpful error messages based on error type
      let userMessage = errorMessage;

      if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
        userMessage = 'Cannot resolve service DNS. The deployment service may not exist yet.';
      } else if (errorMessage.includes('no cluster') || errorMessage.includes('connect ECONNREFUSED')) {
        userMessage = 'Cannot connect to the Kubernetes cluster. Check your kubeconfig.';
      } else if (errorMessage.includes('ECONNREFUSED')) {
        userMessage = 'Connection refused. The deployment may not be ready yet.';
      } else if (errorMessage.includes('abort')) {
        userMessage = 'Request timed out. The deployment may be under heavy load or not responding.';
      } else if (errorMessage.includes('HTTP 404') || errorMessage.includes('404')) {
        userMessage = 'Metrics endpoint not found. The deployment may not expose metrics.';
      } else if (errorMessage.includes('HTTP 503') || errorMessage.includes('503')) {
        userMessage = 'Service unavailable. The deployment is starting up.';
      } else if (errorMessage.includes('fetch failed') || errorMessage.includes('TypeError')) {
        userMessage = 'Cannot connect to metrics endpoint. Verify the deployment is running.';
      }

      logger.warn(
        { deploymentName, namespace, error: errorMessage },
        'Failed to fetch deployment metrics'
      );

      return {
        available: false,
        error: userMessage,
        timestamp,
        metrics: [],
      };
    }
  }

  /**
   * Get the key metrics definitions (common vLLM/inference metrics)
   */
  getKeyMetricsDefinitions() {
    return [
      { name: 'vllm:num_requests_running', type: 'gauge', description: 'Number of requests currently running' },
      { name: 'vllm:num_requests_waiting', type: 'gauge', description: 'Number of requests waiting in queue' },
      { name: 'vllm:gpu_cache_usage_perc', type: 'gauge', description: 'GPU KV cache usage percentage' },
      { name: 'vllm:cpu_cache_usage_perc', type: 'gauge', description: 'CPU KV cache usage percentage' },
      { name: 'vllm:e2e_request_latency_seconds', type: 'histogram', description: 'End-to-end request latency' },
      { name: 'vllm:time_to_first_token_seconds', type: 'histogram', description: 'Time to first token' },
      { name: 'vllm:time_per_output_token_seconds', type: 'histogram', description: 'Time per output token' },
    ];
  }

  /**
   * Extract key metrics from raw metrics based on definitions
   * This filters raw metrics to only include the ones defined as "key metrics"
   */
  extractKeyMetrics(rawMetrics: RawMetricValue[]): RawMetricValue[] {
    const definitions = this.getKeyMetricsDefinitions();
    const keyMetricNames = new Set(definitions.map(d => d.name));

    // For histograms, also include _sum and _count variants
    for (const def of definitions) {
      if (def.type === 'histogram') {
        keyMetricNames.add(`${def.name}_sum`);
        keyMetricNames.add(`${def.name}_count`);
        keyMetricNames.add(`${def.name}_bucket`);
      }
      // For counters, include _total variant if not already present
      if (def.type === 'counter' && !def.name.endsWith('_total')) {
        keyMetricNames.add(`${def.name}_total`);
      }
    }

    return rawMetrics.filter(m => keyMetricNames.has(m.name));
  }
}

// Export singleton instance
export const metricsService = new MetricsService();
