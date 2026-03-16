/**
 * Shared test fixtures for backend e2e tests.
 * Provides mock data for K8s resources used across route tests.
 */

import type { AutoscalerDetectionResult, AutoscalerStatusInfo } from '@airunway/shared';
import type { AIConfiguratorStatus, AIConfiguratorResult, AIConfiguratorConfig } from '@airunway/shared';
import type { DeploymentStatus, PodStatus } from '@airunway/shared';

// ============================================================================
// Autoscaler Fixtures
// ============================================================================

export const autoscalerDetectionAKS: AutoscalerDetectionResult = {
  type: 'aks-managed',
  detected: true,
  healthy: true,
  message: 'AKS managed autoscaler detected',
  nodeGroupCount: 2,
};

export const autoscalerDetectionCA: AutoscalerDetectionResult = {
  type: 'cluster-autoscaler',
  detected: true,
  healthy: true,
  message: 'Cluster Autoscaler detected',
  nodeGroupCount: 3,
  lastActivity: new Date().toISOString(),
};

export const autoscalerDetectionNone: AutoscalerDetectionResult = {
  type: 'none',
  detected: false,
  healthy: false,
  message: 'No autoscaler detected',
};

export const autoscalerStatus: AutoscalerStatusInfo = {
  health: 'Healthy',
  lastUpdateTime: new Date().toISOString(),
  nodeGroups: [
    { name: 'gpu-pool', minSize: 0, maxSize: 5, currentSize: 2 },
    { name: 'cpu-pool', minSize: 1, maxSize: 10, currentSize: 3 },
  ],
};

// ============================================================================
// AI Configurator Fixtures
// ============================================================================

export const aiConfiguratorStatusAvailable: AIConfiguratorStatus = {
  available: true,
  version: '0.4.0',
};

export const aiConfiguratorStatusUnavailable: AIConfiguratorStatus = {
  available: false,
  error: 'AI Configurator CLI not found',
};

export const aiConfiguratorDefaultConfig: AIConfiguratorConfig = {
  tensorParallelDegree: 2,
  maxBatchSize: 256,
  gpuMemoryUtilization: 0.9,
  maxModelLen: 4096,
};

export const aiConfiguratorSuccessResult: AIConfiguratorResult = {
  success: true,
  config: aiConfiguratorDefaultConfig,
  mode: 'aggregated',
  replicas: 1,
  backend: 'vllm',
  supportedBackends: ['vllm', 'sglang', 'trtllm'],
};

// ============================================================================
// Deployment Fixtures
// ============================================================================

export const mockPod: PodStatus = {
  name: 'test-deploy-abc123',
  phase: 'Running' as const,
  ready: true,
  restarts: 0,
  age: '2h',
  node: 'gpu-node-1',
};

export const mockPendingPod: PodStatus = {
  name: 'test-deploy-pending-xyz',
  phase: 'Pending' as const,
  ready: false,
  restarts: 0,
  age: '5m',
};

export const mockDeployment: DeploymentStatus = {
  name: 'test-deploy',
  namespace: 'default',
  modelId: 'meta-llama/Llama-3.1-8B-Instruct',
  engine: 'vllm',
  status: 'Running',
  replicas: 1,
  readyReplicas: 1,
  pods: [mockPod],
  createdAt: new Date().toISOString(),
  mode: 'aggregated',
};

export const mockDeploymentWithPendingPod: DeploymentStatus = {
  ...mockDeployment,
  name: 'pending-deploy',
  status: 'Pending',
  readyReplicas: 0,
  pods: [mockPendingPod],
};

export const mockDeploymentManifest = {
  apiVersion: 'airunway.ai/v1alpha1',
  kind: 'ModelDeployment',
  metadata: {
    name: 'test-deploy',
    namespace: 'default',
  },
  spec: {
    model: { id: 'meta-llama/Llama-3.1-8B-Instruct', source: 'huggingface' },
    engine: { type: 'vllm' },
    resources: { gpu: { count: 1 } },
  },
};

// ============================================================================
// InferenceProviderConfig Fixtures
// ============================================================================

export const mockInferenceProviderConfig = {
  apiVersion: 'airunway.ai/v1alpha1',
  kind: 'InferenceProviderConfig',
  metadata: { name: 'kaito' },
  spec: {
    capabilities: {
      engines: ['vllm', 'llamacpp'],
      servingModes: ['aggregated'],
    },
    installation: {
      description: 'KAITO - Kubernetes AI Toolchain Operator',
      defaultNamespace: 'kaito-workspace',
      helmRepos: [{ name: 'kaito', url: 'https://kaito-project.github.io/kaito/charts/kaito' }],
      helmCharts: [{ name: 'workspace', chart: 'kaito/workspace', version: '0.9.0', namespace: 'kaito-workspace', createNamespace: true }],
      steps: [{ title: 'Install KAITO', command: 'helm install kaito-workspace kaito/workspace', description: 'Install KAITO operator' }],
    },
  },
  status: {
    ready: true,
    version: '0.9.0',
  },
};

// ============================================================================
// Pod Failure Reasons Fixtures
// ============================================================================

export const mockPodFailureReasons = [
  {
    reason: 'Insufficient nvidia.com/gpu',
    message: 'No GPU resources available',
    isResourceConstraint: true,
    resourceType: 'gpu' as const,
    canAutoscalerHelp: true,
  },
];
