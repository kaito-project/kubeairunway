import { Engine } from './model';

// ==================== ModelDeployment CRD Types ====================
// These types mirror the Go CRD types in controller/api/v1alpha1/

export type ModelSource = 'huggingface' | 'custom';
export type EngineType = 'vllm' | 'sglang' | 'trtllm' | 'llamacpp';
export type ServingMode = 'aggregated' | 'disaggregated';
export type DeploymentPhase = 'Pending' | 'Deploying' | 'Running' | 'Failed' | 'Terminating';
export type PodPhase = 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown';

// Storage types (mirrors controller StorageSpec / StorageVolume)
export type VolumePurpose = 'modelCache' | 'compilationCache' | 'custom';
export type PersistentVolumeAccessMode = 'ReadWriteOnce' | 'ReadWriteMany' | 'ReadOnlyMany' | 'ReadWriteOncePod';

export interface StorageVolume {
  name: string;
  claimName?: string;
  mountPath?: string;
  purpose?: VolumePurpose;
  readOnly?: boolean;
  size?: string;
  storageClassName?: string;
  accessMode?: PersistentVolumeAccessMode;
}

export interface StorageSpec {
  volumes?: StorageVolume[];
}

// Legacy types for backward compatibility
export type DeploymentMode = ServingMode;
export type GgufRunMode = 'build' | 'direct';
export type RouterMode = 'none' | 'kv' | 'round-robin';
export type KaitoResourceType = 'workspace' | 'inferenceset';

export interface DeploymentConfig {
  name: string;
  namespace: string;
  modelId: string;
  engine: Engine;
  mode: DeploymentMode;
  provider?: 'dynamo' | 'kuberay' | 'kaito'| 'llmd';
  servedModelName?: string;
  routerMode: RouterMode;
  replicas: number;
  hfTokenSecret?: string;
  contextLength?: number;
  enforceEager: boolean;
  enablePrefixCaching: boolean;
  trustRemoteCode: boolean;
  resources?: {
    gpu: number;
    memory?: string;
  };
  engineArgs?: Record<string, unknown>;
  prefillReplicas?: number;
  decodeReplicas?: number;
  prefillGpus?: number;
  decodeGpus?: number;
  modelSource?: 'premade' | 'huggingface' | 'vllm';
  premadeModel?: string;
  ggufFile?: string;
  ggufRunMode?: GgufRunMode;
  imageRef?: string;
  computeType?: 'cpu' | 'gpu';
  maxModelLen?: number;
  kaitoResourceType?: KaitoResourceType;
  providerOverrides?: Record<string, unknown>;
  storage?: StorageSpec;
}

export interface ModelSpec {
  id: string;
  servedName?: string;
  source?: ModelSource;
  storage?: StorageSpec;
}

export interface ProviderSpec {
  name?: string;
  overrides?: Record<string, unknown>;
}

export interface EngineSpec {
  type: EngineType;
  contextLength?: number;
  trustRemoteCode?: boolean;
  args?: Record<string, unknown>;
}

export interface ServingSpec {
  mode?: ServingMode;
}

export interface GPUSpec {
  count: number;
  type?: string;
}

export interface ResourceSpec {
  gpu?: GPUSpec;
  memory?: string;
  cpu?: string;
}

export interface ComponentScalingSpec {
  replicas: number;
  gpu?: GPUSpec;
}

export interface ScalingSpec {
  replicas?: number;
  minReplicas?: number;
  maxReplicas?: number;
  prefill?: ComponentScalingSpec;
  decode?: ComponentScalingSpec;
}

export interface PodTemplateSpec {
  nodeSelector?: Record<string, string>;
  tolerations?: Array<{
    key?: string;
    operator?: string;
    value?: string;
    effect?: string;
    tolerationSeconds?: number;
  }>;
  annotations?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface SecretSpec {
  huggingFaceToken?: string;
  custom?: string[];
}

export interface ModelDeploymentSpec {
  model: ModelSpec;
  provider?: ProviderSpec;
  engine: EngineSpec;
  serving?: ServingSpec;
  scaling?: ScalingSpec;
  resources?: ResourceSpec;
  image?: string;
  env?: Record<string, string>;
  podTemplate?: PodTemplateSpec;
  secrets?: SecretSpec;
}

export interface ReplicaStatus {
  desired: number;
  ready: number;
  available: number;
}

export interface ProviderStatus {
  name?: string;
  selectedReason?: string;
  resourceRef?: {
    apiVersion?: string;
    kind?: string;
    name?: string;
    namespace?: string;
  };
}

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown';
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
}

export interface GatewayStatus {
  endpoint?: string;
  modelName?: string;
}

export interface GatewayInfo {
  available: boolean;
  endpoint?: string;
  models?: GatewayModelInfo[];
}

export interface GatewayModelInfo {
  name: string;
  deploymentName: string;
  provider?: string;
  ready: boolean;
}

export interface ModelDeploymentStatus {
  phase?: DeploymentPhase;
  message?: string;
  provider?: ProviderStatus;
  replicas?: ReplicaStatus;
  prefillReplicas?: {
    desired: number;
    ready: number;
  };
  decodeReplicas?: {
    desired: number;
    ready: number;
  };
  endpoint?: string;
  gateway?: GatewayStatus;
  conditions?: Condition[];
  observedGeneration?: number;
}

export interface ModelDeployment {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec: ModelDeploymentSpec;
  status?: ModelDeploymentStatus;
}

// ==================== API Types ====================

export interface PodStatus {
  name: string;
  phase: PodPhase;
  ready: boolean;
  restarts: number;
  node?: string;
}

export interface DeploymentStatus {
  name: string;
  namespace: string;
  modelId: string;
  servedModelName?: string;
  engine?: Engine;
  mode: ServingMode;
  phase: DeploymentPhase;
  provider: string;
  replicas: {
    desired: number;
    ready: number;
    available: number;
  };
  conditions?: Condition[];
  pods: PodStatus[];
  createdAt: string;
  frontendService?: string;
  storage?: StorageSpec;
  prefillReplicas?: {
    desired: number;
    ready: number;
  };
  decodeReplicas?: {
    desired: number;
    ready: number;
  };
  gateway?: GatewayStatus;
}

// ==================== Conversion Functions ====================

export function toModelDeploymentSpec(config: DeploymentConfig): ModelDeploymentSpec {
  const spec: ModelDeploymentSpec = {
    model: {
      id: config.modelId,
      servedName: config.servedModelName,
      source: 'huggingface',
    },
    engine: {
      type: config.engine as EngineType,
      contextLength: config.contextLength || config.maxModelLen,
      trustRemoteCode: config.trustRemoteCode,
      args: config.engineArgs,
    },
    serving: {
      mode: config.mode,
    },
  };

  if (config.provider || config.providerOverrides) {
    spec.provider = {
      ...(config.provider && { name: config.provider }),
      ...(config.providerOverrides && { overrides: config.providerOverrides }),
    };
  }

  if (config.mode === 'aggregated') {
    spec.scaling = {
      replicas: config.replicas,
    };
    if (config.resources?.gpu) {
      spec.resources = {
        gpu: {
          count: config.resources.gpu,
          type: 'nvidia.com/gpu',
        },
        memory: config.resources.memory,
      };
    }
  } else if (config.mode === 'disaggregated') {
    spec.scaling = {
      prefill: {
        replicas: config.prefillReplicas || 1,
        gpu: config.prefillGpus ? { count: config.prefillGpus, type: 'nvidia.com/gpu' } : undefined,
      },
      decode: {
        replicas: config.decodeReplicas || 1,
        gpu: config.decodeGpus ? { count: config.decodeGpus, type: 'nvidia.com/gpu' } : undefined,
      },
    };
  }

  if (config.hfTokenSecret) {
    spec.secrets = {
      huggingFaceToken: config.hfTokenSecret,
    };
  }

  // Add storage volumes if configured
  if (config.storage?.volumes && config.storage.volumes.length > 0) {
    spec.model.storage = {
      volumes: config.storage.volumes,
    };
  }

  return spec;
}

export function toDeploymentStatus(md: ModelDeployment, pods: PodStatus[] = []): DeploymentStatus {
  const status = md.status || {};
  const spec = md.spec;

  return {
    name: md.metadata.name,
    namespace: md.metadata.namespace,
    modelId: spec.model.id,
    servedModelName: spec.model.servedName,
    engine: (spec.engine?.type as Engine) || undefined,
    mode: spec.serving?.mode || 'aggregated',
    phase: status.phase || 'Pending',
    provider: status.provider?.name || spec.provider?.name || 'unknown',
    replicas: {
      desired: status.replicas?.desired ?? 0,
      ready: status.replicas?.ready ?? 0,
      available: status.replicas?.available ?? 0,
    },
    conditions: status.conditions,
    pods,
    createdAt: md.metadata.creationTimestamp || new Date().toISOString(),
    frontendService: md.metadata.name,
    prefillReplicas: status.prefillReplicas,
    decodeReplicas: status.decodeReplicas,
    gateway: status.gateway,
    storage: spec.model.storage,
  };
}

export function toModelDeploymentManifest(config: DeploymentConfig): ModelDeployment {
  return {
    apiVersion: 'airunway.ai/v1alpha1',
    kind: 'ModelDeployment',
    metadata: {
      name: config.name,
      namespace: config.namespace,
      labels: {
        'app.kubernetes.io/name': 'airunway',
        'app.kubernetes.io/instance': config.name,
        'app.kubernetes.io/managed-by': 'airunway',
      },
    },
    spec: toModelDeploymentSpec(config),
  };
}

// ==================== Request/Response Types ====================

export interface CreateDeploymentRequest {
  config: DeploymentConfig;
}

export interface DeploymentListResponse {
  deployments: DeploymentStatus[];
}

export interface ClusterStatus {
  connected: boolean;
  namespace: string;
  clusterName?: string;
  error?: string;
}

export interface PodLogsOptions {
  podName?: string;
  container?: string;
  tailLines?: number;
  timestamps?: boolean;
}

export interface PodLogsResponse {
  logs: string;
  podName: string;
  container?: string;
}
