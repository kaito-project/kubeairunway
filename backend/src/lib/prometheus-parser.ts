/**
 * Prometheus text format parser
 * Parses the Prometheus exposition format into structured metric values
 */

import type { RawMetricValue } from '@kubeairunway/shared';

/**
 * Parse Prometheus text exposition format into structured metric values
 * 
 * Example input:
 * ```
 * # HELP vllm:num_requests_running Number of requests running
 * # TYPE vllm:num_requests_running gauge
 * vllm:num_requests_running 5
 * vllm:gpu_cache_usage_perc{model="llama"} 0.73
 * counter_total{label="value",other="test"} 1234
 * histogram_sum{le="0.5"} 567.8
 * histogram_count 100
 * ```
 * 
 * @param text - Raw Prometheus text format
 * @returns Array of parsed metric values
 */
export function parsePrometheusText(text: string): RawMetricValue[] {
  const metrics: RawMetricValue[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments (HELP, TYPE)
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const parsed = parseMetricLine(trimmed);
    if (parsed) {
      metrics.push(parsed);
    }
  }

  return metrics;
}

/**
 * Parse a single metric line
 * 
 * Format: metric_name{label1="value1",label2="value2"} value [timestamp]
 * Or:     metric_name value [timestamp]
 */
function parseMetricLine(line: string): RawMetricValue | null {
  // Match metric name, optional labels, and value
  // Metric names can contain colons (e.g., vllm:num_requests_running)
  const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?[\d.eE+-]+(?:NaN|Inf)?)\s*(\d+)?$/);

  if (!match) {
    return null;
  }

  const [, name, labelsStr, valueStr] = match;
  const value = parseFloat(valueStr);

  // Skip NaN and Inf values
  if (!Number.isFinite(value)) {
    return null;
  }

  const labels: Record<string, string> = {};

  // Parse labels if present
  if (labelsStr) {
    // Remove braces and parse key="value" pairs
    const labelsContent = labelsStr.slice(1, -1);
    const labelPairs = labelsContent.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/g);

    if (labelPairs) {
      for (const pair of labelPairs) {
        const labelMatch = pair.match(/([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"/);
        if (labelMatch) {
          labels[labelMatch[1]] = labelMatch[2];
        }
      }
    }
  }

  return {
    name,
    value,
    labels,
  };
}

/**
 * Find a metric by name from parsed metrics
 * Returns the first match (ignoring labels)
 */
export function findMetric(metrics: RawMetricValue[], name: string): RawMetricValue | undefined {
  return metrics.find(m => m.name === name);
}

/**
 * Find all metrics matching a name (may have different label combinations)
 */
export function findAllMetrics(metrics: RawMetricValue[], name: string): RawMetricValue[] {
  return metrics.filter(m => m.name === name);
}

/**
 * Get the sum value for a histogram metric
 * Histograms expose _sum and _count suffixes
 */
export function getHistogramSum(metrics: RawMetricValue[], baseName: string): number | undefined {
  const sumMetric = findMetric(metrics, `${baseName}_sum`);
  return sumMetric?.value;
}

/**
 * Get the count value for a histogram metric
 */
export function getHistogramCount(metrics: RawMetricValue[], baseName: string): number | undefined {
  const countMetric = findMetric(metrics, `${baseName}_count`);
  return countMetric?.value;
}

/**
 * Calculate average from histogram sum and count
 */
export function calculateHistogramAverage(metrics: RawMetricValue[], baseName: string): number | undefined {
  const sum = getHistogramSum(metrics, baseName);
  const count = getHistogramCount(metrics, baseName);

  if (sum !== undefined && count !== undefined && count > 0) {
    return sum / count;
  }

  return undefined;
}

/**
 * Sum all values for a metric across different label combinations
 */
export function sumMetricValues(metrics: RawMetricValue[], name: string): number {
  const matching = findAllMetrics(metrics, name);
  return matching.reduce((sum, m) => sum + m.value, 0);
}
