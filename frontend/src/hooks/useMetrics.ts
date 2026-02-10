import { useQuery } from '@tanstack/react-query'
import { metricsApi } from '@/lib/api'
import type { MetricsResponse, ComputedMetrics, ComputedMetric, MetricDefinition, RawMetricValue } from '@kubeairunway/shared'

/**
 * Format a numeric value for display with appropriate units and precision
 */
function formatMetricValue(value: number, unit: string): string {
  // Handle special cases
  if (!Number.isFinite(value)) {
    return 'N/A'
  }

  // Format based on unit type
  if (unit === '%') {
    return `${(value * 100).toFixed(1)}%`
  }

  if (unit === 'ms') {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(2)}s`
    }
    return `${value.toFixed(1)}ms`
  }

  if (unit === 's' || unit === 'seconds') {
    if (value < 0.001) {
      return `${(value * 1000000).toFixed(0)}µs`
    }
    if (value < 1) {
      return `${(value * 1000).toFixed(1)}ms`
    }
    return `${value.toFixed(2)}s`
  }

  if (unit === 'tokens/s' || unit === 'req/s') {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M ${unit}`
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k ${unit}`
    }
    return `${value.toFixed(1)} ${unit}`
  }

  // Generic number formatting
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}k`
  }
  if (Number.isInteger(value)) {
    return value.toString()
  }
  return value.toFixed(2)
}

/**
 * vLLM metric definitions (Dynamo provider)
 */
const vllmMetricDefinitions: MetricDefinition[] = [
  { name: 'vllm:num_requests_running', displayName: 'Running Requests', description: 'Number of requests currently being processed', unit: 'requests', type: 'gauge', category: 'queue' },
  { name: 'vllm:num_requests_waiting', displayName: 'Waiting Requests', description: 'Number of requests waiting in queue', unit: 'requests', type: 'gauge', category: 'queue' },
  { name: 'vllm:gpu_cache_usage_perc', displayName: 'GPU Cache Usage', description: 'Percentage of GPU KV cache in use', unit: '%', type: 'gauge', category: 'cache' },
  { name: 'vllm:gpu_prefix_cache_hit_rate', displayName: 'Prefix Cache Hit Rate', description: 'Hit rate for prefix caching', unit: '%', type: 'gauge', category: 'cache' },
  { name: 'vllm:e2e_request_latency_seconds', displayName: 'E2E Latency', description: 'End-to-end request latency', unit: 's', type: 'histogram', category: 'latency' },
  { name: 'vllm:time_to_first_token_seconds', displayName: 'Time to First Token', description: 'Time from request to first token', unit: 's', type: 'histogram', category: 'latency' },
  { name: 'vllm:time_per_output_token_seconds', displayName: 'Time per Token', description: 'Average time per output token', unit: 's', type: 'histogram', category: 'latency' },
  { name: 'vllm:prompt_tokens_total', displayName: 'Prompt Tokens', description: 'Total prompt tokens processed', unit: 'tokens', type: 'counter', category: 'throughput' },
  { name: 'vllm:generation_tokens_total', displayName: 'Generated Tokens', description: 'Total tokens generated', unit: 'tokens', type: 'counter', category: 'throughput' },
  { name: 'vllm:request_success_total', displayName: 'Successful Requests', description: 'Total successful requests', unit: 'requests', type: 'counter', category: 'throughput' },
]

/**
 * Ray Serve metric definitions (KubeRay provider)
 */
const rayServeMetricDefinitions: MetricDefinition[] = [
  { name: 'ray_serve_replica_processing_queries', displayName: 'Processing Queries', description: 'Queries being processed by replicas', unit: 'queries', type: 'gauge', category: 'queue' },
  { name: 'ray_serve_deployment_queued_queries', displayName: 'Queued Queries', description: 'Queries waiting in deployment queue', unit: 'queries', type: 'gauge', category: 'queue' },
  { name: 'ray_serve_deployment_processing_latency_ms', displayName: 'Processing Latency', description: 'Deployment processing latency', unit: 'ms', type: 'histogram', category: 'latency' },
  { name: 'ray_serve_http_request_latency_ms', displayName: 'HTTP Latency', description: 'HTTP request latency', unit: 'ms', type: 'histogram', category: 'latency' },
  { name: 'ray_serve_deployment_request_counter_total', displayName: 'Total Requests', description: 'Total deployment requests', unit: 'requests', type: 'counter', category: 'throughput' },
  { name: 'ray_serve_num_http_requests_total', displayName: 'HTTP Requests', description: 'Total HTTP requests', unit: 'requests', type: 'counter', category: 'throughput' },
  { name: 'ray_serve_deployment_error_counter_total', displayName: 'Deployment Errors', description: 'Total deployment errors', unit: 'errors', type: 'counter', category: 'errors' },
  { name: 'ray_serve_num_http_error_requests_total', displayName: 'HTTP Errors', description: 'Total HTTP error responses', unit: 'errors', type: 'counter', category: 'errors' },
]

/**
 * Get metric definitions based on provider type
 */
function getMetricDefinitions(provider: string): MetricDefinition[] {
  switch (provider) {
    case 'dynamo':
      return vllmMetricDefinitions
    case 'kuberay':
      return rayServeMetricDefinitions
    default:
      // Try to detect from metrics - if metrics contain "vllm:" prefix, use vLLM definitions
      return vllmMetricDefinitions
  }
}

/**
 * Compute metrics from raw Prometheus values
 */
function computeMetrics(
  response: MetricsResponse,
  provider: string
): ComputedMetrics {
  if (!response.available) {
    return {
      available: false,
      error: response.error,
      lastUpdated: new Date(response.timestamp),
      metrics: [],
      runningOffCluster: response.runningOffCluster,
    }
  }

  const definitions = getMetricDefinitions(provider)
  const computed: ComputedMetric[] = []

  for (const def of definitions) {
    // Find matching metrics
    const matchingMetrics = response.metrics.filter((m: RawMetricValue) => m.name === def.name)

    if (matchingMetrics.length === 0) {
      // For histograms, try to find _sum/_count variants
      if (def.type === 'histogram') {
        const sumMetrics = response.metrics.filter((m: RawMetricValue) => m.name === `${def.name}_sum`)
        const countMetrics = response.metrics.filter((m: RawMetricValue) => m.name === `${def.name}_count`)

        if (sumMetrics.length > 0 && countMetrics.length > 0) {
          const totalSum = sumMetrics.reduce((acc: number, m: RawMetricValue) => acc + m.value, 0)
          const totalCount = countMetrics.reduce((acc: number, m: RawMetricValue) => acc + m.value, 0)
          const avgValue = totalCount > 0 ? totalSum / totalCount : 0

          computed.push({
            name: def.name,
            displayName: def.displayName,
            value: avgValue,
            formattedValue: formatMetricValue(avgValue, def.unit),
            unit: def.unit,
            category: def.category,
          })
        }
      }
      continue
    }

    // Sum all matching metric values (across labels)
    const totalValue = matchingMetrics.reduce((acc: number, m: RawMetricValue) => acc + m.value, 0)

    computed.push({
      name: def.name,
      displayName: def.displayName,
      value: totalValue,
      formattedValue: formatMetricValue(totalValue, def.unit),
      unit: def.unit,
      category: def.category,
    })
  }

  return {
    available: true,
    lastUpdated: new Date(response.timestamp),
    metrics: computed,
    runningOffCluster: response.runningOffCluster,
  }
}

/**
 * Hook for fetching deployment metrics
 */
export function useMetrics(
  deploymentName: string | undefined,
  namespace: string | undefined,
  provider: string = 'dynamo',
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  const query = useQuery({
    queryKey: ['metrics', deploymentName, namespace],
    queryFn: async () => {
      const response = await metricsApi.get(deploymentName!, namespace)
      return computeMetrics(response, provider)
    },
    enabled: options?.enabled !== false && !!deploymentName,
    refetchInterval: options?.refetchInterval ?? 10000, // Default 10 seconds
    staleTime: 5000, // Consider data stale after 5 seconds
    retry: false, // Don't retry on failure (metrics might not be available)
  })

  return {
    ...query,
    metrics: query.data,
  }
}

export type { ComputedMetrics, ComputedMetric }
