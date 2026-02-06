import { Engine } from './model';

export type DeploymentMode = 'aggregated' | 'disaggregated';
export type GgufRunMode = 'build' | 'direct';
export type RouterMode = 'none' | 'kv' | 'round-robin';
export type DeploymentPhase = 'Pending' | 'Deploying' | 'Running' | 'Failed' | 'Terminating';
export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';

// KAITO resource type - Workspace (v1beta1, stable) or InferenceSet (v1alpha1, newer)
export type KaitoResourceType = 'workspace' | 'inferenceset';

export interface DeploymentConfig {
  name: string;                  // Kubernetes resource name
  namespace: string;             // Target namespace
  modelId: string;               // HuggingFace model ID
  engine: Engine;                // Inference engine
  mode: DeploymentMode;
  provider?: 'dynamo' | 'kuberay' | 'kaito';  // Runtime provider (optional during transition)
  servedModelName?: string;      // Custom model name for API
  routerMode: RouterMode;
  replicas: number;              // Number of worker replicas (aggregated mode)
  hfTokenSecret?: string;        // K8s secret name for HF_TOKEN (optional for non-gated models)
  contextLength?: number;        // Optional context length override
  enforceEager: boolean;         // Enforce eager mode for quick deployment
  enablePrefixCaching: boolean;  // Enable prefix caching
  trustRemoteCode: boolean;      // Trust remote code from HuggingFace
  resources?: {
    gpu: number;                 // Number of GPUs per replica
    memory?: string;             // Memory limit
  };
  engineArgs?: Record<string, unknown>;  // Engine-specific arguments

  // Disaggregated mode configuration (P/D separation)
  prefillReplicas?: number;      // Number of prefill worker replicas
  decodeReplicas?: number;       // Number of decode worker replicas
  prefillGpus?: number;          // GPUs per prefill worker
  decodeGpus?: number;           // GPUs per decode worker

  // KAITO-specific fields
  modelSource?: 'premade' | 'huggingface' | 'vllm';  // Model source for KAITO
  premadeModel?: string;         // Premade model ID (e.g., 'llama3.2:1b')
  ggufFile?: string;             // GGUF filename for build mode
  ggufRunMode?: GgufRunMode;     // 'direct' uses runner image, 'build' builds custom image
  imageRef?: string;             // Built/resolved image reference
  computeType?: 'cpu' | 'gpu';   // Compute type for KAITO
  maxModelLen?: number;          // Max model length for vLLM mode
  kaitoResourceType?: KaitoResourceType;  // KAITO resource type: 'workspace' (stable) or 'inferenceset' (newer)
}

export interface PodStatus {
  name: string;
  phase: PodPhase;
  ready: boolean;
  restarts: number;
  node?: string;
}

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface DeploymentStatus {
  name: string;
  namespace: string;
  modelId: string;
  servedModelName?: string;      // Model name exposed via API (for clients)
  engine: Engine;
  mode: DeploymentMode;
  phase: DeploymentPhase;
  provider: string;              // Provider ID (dynamo, kuberay)
  replicas: {
    desired: number;
    ready: number;
    available: number;
  };
  conditions?: Condition[];
  pods: PodStatus[];
  createdAt: string;
  frontendService?: string;      // Service name for port-forwarding

  // Disaggregated mode status (P/D separation)
  prefillReplicas?: {
    desired: number;
    ready: number;
  };
  decodeReplicas?: {
    desired: number;
    ready: number;
  };
}

export interface CreateDeploymentRequest {
  config: DeploymentConfig;
}

export interface DeploymentListResponse {
  deployments: DeploymentStatus[];
}

/**
 * Basic cluster connectivity status
 */
export interface ClusterStatus {
  connected: boolean;
  namespace: string;
  clusterName?: string;
  error?: string;
}

/**
 * Options for fetching pod logs
 */
export interface PodLogsOptions {
  podName?: string;        // Specific pod to get logs from (defaults to first pod)
  container?: string;      // Specific container name
  tailLines?: number;      // Number of lines to return (default: 100)
  timestamps?: boolean;    // Include timestamps in log lines
}

/**
 * Response from pod logs endpoint
 */
export interface PodLogsResponse {
  logs: string;            // Log content
  podName: string;         // Pod the logs came from
  container?: string;      // Container name (if specified)
}
