/**
 * Metrics types for observability features
 */

/**
 * Definition of a metric that a provider exposes
 */
export interface MetricDefinition {
  /** Prometheus metric name (e.g., "vllm:num_requests_running") */
  name: string;
  /** Human-readable display name (e.g., "Running Requests") */
  displayName: string;
  /** Description of what this metric measures */
  description: string;
  /** Unit of measurement (e.g., "requests", "ms", "%", "tokens/s") */
  unit: string;
  /** Prometheus metric type */
  type: 'gauge' | 'counter' | 'histogram';
  /** Category for grouping in the UI */
  category: 'throughput' | 'latency' | 'queue' | 'cache' | 'errors';
}

/**
 * Raw metric value parsed from Prometheus text format
 */
export interface RawMetricValue {
  /** Prometheus metric name */
  name: string;
  /** Numeric value */
  value: number;
  /** Labels associated with this metric */
  labels: Record<string, string>;
}

/**
 * Response from the metrics API endpoint
 */
export interface MetricsResponse {
  /** Whether metrics are available for this deployment */
  available: boolean;
  /** Error message if metrics are not available */
  error?: string;
  /** ISO timestamp of when metrics were fetched */
  timestamp: string;
  /** Raw metric values from the inference service */
  metrics: RawMetricValue[];
  /** True if KubeAIRunway is running outside the cluster (metrics require in-cluster deployment) */
  runningOffCluster?: boolean;
}

/**
 * Configuration for accessing a provider's metrics endpoint
 */
export interface MetricsEndpointConfig {
  /** Path to the metrics endpoint (e.g., "/metrics") */
  endpointPath: string;
  /** Port the metrics are exposed on */
  port: number;
  /** Pattern for constructing the service name. Use {name} as placeholder for deployment name */
  serviceNamePattern: string;
}

/**
 * Computed metric value for display in the UI
 * Includes rate calculations for counters and averages for histograms
 */
export interface ComputedMetric {
  /** Prometheus metric name */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Computed numeric value (rate for counters, average for histograms, raw for gauges) */
  value: number;
  /** Formatted string value for display (e.g., "1.2k", "45.3 ms") */
  formattedValue: string;
  /** Unit of measurement */
  unit: string;
  /** Category for grouping */
  category: 'throughput' | 'latency' | 'queue' | 'cache' | 'errors';
  /** Optional trend indicator comparing to previous value */
  trend?: 'up' | 'down' | 'stable';
}

/**
 * Computed metrics ready for display in the UI
 */
export interface ComputedMetrics {
  /** Whether metrics are available */
  available: boolean;
  /** Error message if not available */
  error?: string;
  /** When the metrics were last updated */
  lastUpdated: Date;
  /** Computed metric values */
  metrics: ComputedMetric[];
  /** True if KubeAIRunway is running outside the cluster (metrics require in-cluster deployment) */
  runningOffCluster?: boolean;
}
