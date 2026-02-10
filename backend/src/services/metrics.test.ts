import { describe, test, expect } from 'bun:test';
import type { RawMetricValue, MetricsResponse } from '@kubeairunway/shared';

describe('MetricsService - buildMetricsUrl', () => {
  // Test the URL building logic (unit test the pattern)
  function buildMetricsUrl(
    deploymentName: string,
    namespace: string,
    servicePattern: string,
    port: number,
    endpointPath: string
  ): string {
    const serviceName = servicePattern.replace('{name}', deploymentName);
    return `http://${serviceName}.${namespace}.svc.cluster.local:${port}${endpointPath}`;
  }

  test('builds correct URL with service pattern', () => {
    const url = buildMetricsUrl(
      'my-model',
      'default',
      '{name}-router',
      8000,
      '/metrics'
    );
    expect(url).toBe('http://my-model-router.default.svc.cluster.local:8000/metrics');
  });

  test('handles namespace with hyphens', () => {
    const url = buildMetricsUrl(
      'llama-model',
      'ml-workloads',
      '{name}-svc',
      9090,
      '/v1/metrics'
    );
    expect(url).toBe('http://llama-model-svc.ml-workloads.svc.cluster.local:9090/v1/metrics');
  });

  test('handles pattern without placeholder', () => {
    const url = buildMetricsUrl(
      'ignored',
      'monitoring',
      'prometheus',
      9090,
      '/metrics'
    );
    expect(url).toBe('http://prometheus.monitoring.svc.cluster.local:9090/metrics');
  });
});

describe('MetricsService - Error Message Handling', () => {
  // Test error message mapping logic
  function mapErrorMessage(errorMessage: string): string {
    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
      return 'Cannot resolve service DNS. KubeAIRunway must be running in-cluster to fetch metrics.';
    } else if (errorMessage.includes('ECONNREFUSED')) {
      return 'Connection refused. The deployment may not be ready yet.';
    } else if (errorMessage.includes('abort')) {
      return 'Request timed out. The deployment may be under heavy load or not responding.';
    } else if (errorMessage.includes('HTTP 404')) {
      return 'Metrics endpoint not found. The deployment may not expose metrics.';
    } else if (errorMessage.includes('HTTP 503')) {
      return 'Service unavailable. The deployment is starting up.';
    } else if (errorMessage.includes('fetch failed') || errorMessage.includes('TypeError')) {
      return 'Cannot connect to metrics endpoint. KubeAIRunway must be running in-cluster.';
    }
    return errorMessage;
  }

  test('maps DNS resolution errors', () => {
    expect(mapErrorMessage('getaddrinfo ENOTFOUND service.namespace.svc')).toContain('Cannot resolve service DNS');
    expect(mapErrorMessage('Error: ENOTFOUND')).toContain('in-cluster');
  });

  test('maps connection refused errors', () => {
    expect(mapErrorMessage('connect ECONNREFUSED 10.0.0.1:8000')).toContain('Connection refused');
    expect(mapErrorMessage('ECONNREFUSED')).toContain('not be ready');
  });

  test('maps timeout errors', () => {
    expect(mapErrorMessage('The operation was aborted')).toContain('timed out');
    expect(mapErrorMessage('signal was aborted')).toContain('heavy load');
  });

  test('maps HTTP 404 errors', () => {
    expect(mapErrorMessage('HTTP 404: Not Found')).toContain('endpoint not found');
    expect(mapErrorMessage('HTTP 404')).toContain('not expose metrics');
  });

  test('maps HTTP 503 errors', () => {
    expect(mapErrorMessage('HTTP 503: Service Unavailable')).toContain('Service unavailable');
    expect(mapErrorMessage('HTTP 503')).toContain('starting up');
  });

  test('maps fetch errors', () => {
    expect(mapErrorMessage('fetch failed')).toContain('in-cluster');
    expect(mapErrorMessage('TypeError: Failed to fetch')).toContain('in-cluster');
  });

  test('returns original message for unknown errors', () => {
    expect(mapErrorMessage('Some unknown error')).toBe('Some unknown error');
    expect(mapErrorMessage('Unexpected condition')).toBe('Unexpected condition');
  });
});

describe('MetricsService - MetricsResponse structure', () => {
  test('creates unavailable response for off-cluster', () => {
    const response: MetricsResponse = {
      available: false,
      error: 'Metrics are only available when KubeAIRunway is deployed inside the Kubernetes cluster.',
      timestamp: new Date().toISOString(),
      metrics: [],
      runningOffCluster: true,
    };

    expect(response.available).toBe(false);
    expect(response.runningOffCluster).toBe(true);
    expect(response.metrics).toHaveLength(0);
    expect(response.error).toContain('inside the Kubernetes cluster');
  });

  test('creates available response with metrics', () => {
    const metrics: RawMetricValue[] = [
      { name: 'vllm:num_requests_running', value: 5, labels: {} },
      { name: 'vllm:gpu_cache_usage_perc', value: 0.73, labels: { model: 'llama' } },
    ];

    const response: MetricsResponse = {
      available: true,
      timestamp: new Date().toISOString(),
      metrics,
    };

    expect(response.available).toBe(true);
    expect(response.error).toBeUndefined();
    expect(response.metrics).toHaveLength(2);
    expect(response.metrics[0].name).toBe('vllm:num_requests_running');
  });

  test('creates error response', () => {
    const response: MetricsResponse = {
      available: false,
      error: 'Connection refused. The deployment may not be ready yet.',
      timestamp: new Date().toISOString(),
      metrics: [],
    };

    expect(response.available).toBe(false);
    expect(response.error).toContain('Connection refused');
    expect(response.runningOffCluster).toBeUndefined();
  });
});

describe('MetricsService - Key Metrics Filtering', () => {
  // Test the logic for filtering key metrics from raw metrics
  function extractKeyMetrics(
    rawMetrics: RawMetricValue[],
    keyMetricNames: Set<string>
  ): RawMetricValue[] {
    // Expand key metric names to include histogram variants
    const expandedNames = new Set(keyMetricNames);
    for (const name of keyMetricNames) {
      expandedNames.add(`${name}_sum`);
      expandedNames.add(`${name}_count`);
      expandedNames.add(`${name}_bucket`);
      expandedNames.add(`${name}_total`);
    }

    return rawMetrics.filter(m => expandedNames.has(m.name));
  }

  test('filters to only key metrics', () => {
    const rawMetrics: RawMetricValue[] = [
      { name: 'vllm:num_requests_running', value: 5, labels: {} },
      { name: 'vllm:gpu_cache_usage_perc', value: 0.73, labels: {} },
      { name: 'unrelated_metric', value: 100, labels: {} },
      { name: 'another_random_metric', value: 42, labels: {} },
    ];

    const keyNames = new Set(['vllm:num_requests_running', 'vllm:gpu_cache_usage_perc']);
    const filtered = extractKeyMetrics(rawMetrics, keyNames);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(m => m.name)).toContain('vllm:num_requests_running');
    expect(filtered.map(m => m.name)).toContain('vllm:gpu_cache_usage_perc');
  });

  test('includes histogram variants (_sum, _count, _bucket)', () => {
    const rawMetrics: RawMetricValue[] = [
      { name: 'latency_seconds', value: 5, labels: {} },
      { name: 'latency_seconds_sum', value: 500, labels: {} },
      { name: 'latency_seconds_count', value: 100, labels: {} },
      { name: 'latency_seconds_bucket', value: 50, labels: { le: '0.5' } },
      { name: 'other_metric', value: 42, labels: {} },
    ];

    const keyNames = new Set(['latency_seconds']);
    const filtered = extractKeyMetrics(rawMetrics, keyNames);

    expect(filtered).toHaveLength(4);
    expect(filtered.map(m => m.name)).not.toContain('other_metric');
  });

  test('includes counter variants (_total)', () => {
    const rawMetrics: RawMetricValue[] = [
      { name: 'requests', value: 100, labels: {} },
      { name: 'requests_total', value: 100, labels: {} },
      { name: 'other_total', value: 50, labels: {} },
    ];

    const keyNames = new Set(['requests']);
    const filtered = extractKeyMetrics(rawMetrics, keyNames);

    expect(filtered).toHaveLength(2);
    expect(filtered.map(m => m.name)).toContain('requests');
    expect(filtered.map(m => m.name)).toContain('requests_total');
  });

  test('returns empty array when no matches', () => {
    const rawMetrics: RawMetricValue[] = [
      { name: 'metric_a', value: 1, labels: {} },
      { name: 'metric_b', value: 2, labels: {} },
    ];

    const keyNames = new Set(['metric_c', 'metric_d']);
    const filtered = extractKeyMetrics(rawMetrics, keyNames);

    expect(filtered).toHaveLength(0);
  });
});
