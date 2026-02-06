import { z } from 'zod';

/**
 * KAITO resource type - determines which CRD to use
 * - 'workspace': Uses Workspace CRD (v1beta1) - stable, original KAITO API
 * - 'inferenceset': Uses InferenceSet CRD (v1alpha1) - newer, more flexible API
 */
export const kaitoResourceTypeSchema = z.enum(['workspace', 'inferenceset']).default('workspace');

/**
 * KAITO-specific deployment configuration schema
 * KAITO uses GGUF quantized models via AIKit, supporting both CPU and GPU inference
 */
export const kaitoDeploymentConfigSchema = z.object({
  // Basic deployment info
  name: z.string().min(1).max(63).regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, {
    message: 'Name must be a valid Kubernetes resource name (lowercase alphanumeric and hyphens)',
  }),
  namespace: z.string().min(1),
  provider: z.literal('kaito'),

  // KAITO resource type - Workspace (default, stable) or InferenceSet (newer)
  kaitoResourceType: kaitoResourceTypeSchema,

  // Model source
  modelSource: z.enum(['premade', 'huggingface', 'vllm']),

  // For premade models (from AIKit curated list)
  premadeModel: z.string().optional(),

  // For HuggingFace GGUF models
  modelId: z.string().optional(),    // HF repo: 'TheBloke/Llama-2-7B-Chat-GGUF'
  ggufFile: z.string().optional(),   // File: 'llama-2-7b-chat.Q4_K_M.gguf'

  // GGUF run mode for HuggingFace models
  // 'direct' - Use runner image, download model at runtime (no Docker required)
  // 'build' - Build custom image with model embedded (requires Docker)
  ggufRunMode: z.enum(['build', 'direct']).default('direct'),

  // Compute type - KAITO's key differentiator is CPU inference
  computeType: z.enum(['cpu', 'gpu']).default('cpu'),

  // Replicas
  replicas: z.number().int().min(1).max(10).default(1),

  // Node targeting - labelSelector for pod selection
  labelSelector: z.record(z.string()).optional(),

  // Instance type for non-BYO node scenarios (e.g., 'Standard_NC24ads_A100_v4')
  // For BYO nodes, leave this empty and use labelSelector instead
  instanceType: z.string().optional(),

  // Resources
  resources: z.object({
    memory: z.string().optional(),      // e.g., '8Gi'
    cpu: z.string().optional(),         // e.g., '4' or '4000m'
    gpu: z.number().int().optional(),   // e.g., 1
  }).optional(),

  // Image reference (set by build service, optional for premade)
  imageRef: z.string().optional(),

  // vLLM-specific options
  maxModelLen: z.number().int().min(1).optional(),  // --max-model-len for vLLM

  // HuggingFace token secret for gated models
  hfTokenSecret: z.string().optional(),

}).refine(
  data => {
    if (data.modelSource === 'premade') {
      return !!data.premadeModel;
    }
    if (data.modelSource === 'huggingface') {
      // Both direct and build modes require modelId and ggufFile
      return !!data.modelId && !!data.ggufFile;
    }
    if (data.modelSource === 'vllm') {
      // vLLM mode just needs modelId (HuggingFace model ID)
      return !!data.modelId;
    }
    return false;
  },
  { message: 'Invalid model configuration: premade requires premadeModel, huggingface requires modelId and ggufFile, vllm requires modelId' }
);

export type KaitoDeploymentConfig = z.infer<typeof kaitoDeploymentConfigSchema>;

/**
 * KAITO Workspace manifest schema for validation
 * Workspace is v1beta1 API - the stable, original KAITO API
 * Note: Workspace API has resource/inference/tuning at top level, NOT inside a spec field
 */
export const kaitoWorkspaceSchema = z.object({
  apiVersion: z.literal('kaito.sh/v1beta1'),
  kind: z.literal('Workspace'),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string()).optional(),
  }),
  resource: z.object({
    labelSelector: z.object({
      matchLabels: z.record(z.string()).optional(),
    }).optional(),
    count: z.number().optional(),
    instanceType: z.string().optional(),
  }).optional(),
  inference: z.object({
    template: z.object({
      spec: z.object({
        containers: z.array(z.object({
          name: z.string(),
          image: z.string(),
          command: z.array(z.string()).optional(),
          args: z.array(z.string()).optional(),
          env: z.array(z.object({
            name: z.string(),
            value: z.string().optional(),
            valueFrom: z.object({
              secretKeyRef: z.object({
                name: z.string(),
                key: z.string(),
              }).optional(),
            }).optional(),
          })).optional(),
          ports: z.array(z.object({
            containerPort: z.number(),
            protocol: z.string().optional(),
          })).optional(),
          resources: z.object({
            requests: z.record(z.union([z.string(), z.number()])).optional(),
            limits: z.record(z.union([z.string(), z.number()])).optional(),
          }).optional(),
          volumeMounts: z.array(z.object({
            name: z.string(),
            mountPath: z.string(),
          })).optional(),
          livenessProbe: z.object({
            httpGet: z.object({
              path: z.string(),
              port: z.number(),
              scheme: z.string().optional(),
            }).optional(),
            initialDelaySeconds: z.number().optional(),
            periodSeconds: z.number().optional(),
            failureThreshold: z.number().optional(),
          }).optional(),
          readinessProbe: z.object({
            httpGet: z.object({
              path: z.string(),
              port: z.number(),
              scheme: z.string().optional(),
            }).optional(),
            initialDelaySeconds: z.number().optional(),
            periodSeconds: z.number().optional(),
            failureThreshold: z.number().optional(),
          }).optional(),
        })),
        volumes: z.array(z.object({
          name: z.string(),
          emptyDir: z.object({
            medium: z.string().optional(),
          }).optional(),
        })).optional(),
      }),
    }),
  }),
});

export type KaitoWorkspace = z.infer<typeof kaitoWorkspaceSchema>;

/**
 * KAITO InferenceSet manifest schema for validation
 * InferenceSet is v1alpha1 API - newer, more flexible API with spec.template.inference structure
 */
export const kaitoInferenceSetSchema = z.object({
  apiVersion: z.literal('kaito.sh/v1alpha1'),
  kind: z.literal('InferenceSet'),
  metadata: z.object({
    name: z.string(),
    namespace: z.string(),
    labels: z.record(z.string()).optional(),
  }),
  spec: z.object({
    replicas: z.number().optional(),
    labelSelector: z.object({
      matchLabels: z.record(z.string()).optional(),
    }),
    nodeCountLimit: z.number().optional(),
    template: z.object({
      // resource.instanceType is only for non-BYO scenarios
      resource: z.object({
        instanceType: z.string(),
      }).optional(),
      inference: z.object({
        // Can use preset or template (PodTemplateSpec)
        preset: z.object({
          accessMode: z.string().optional(),
          name: z.string(),
        }).optional(),
        template: z.object({
          spec: z.object({
            containers: z.array(z.object({
              name: z.string(),
              image: z.string(),
              command: z.array(z.string()).optional(),
              args: z.array(z.string()).optional(),
              env: z.array(z.object({
                name: z.string(),
                value: z.string().optional(),
                valueFrom: z.object({
                  secretKeyRef: z.object({
                    name: z.string(),
                    key: z.string(),
                  }).optional(),
                }).optional(),
              })).optional(),
              ports: z.array(z.object({
                containerPort: z.number(),
                protocol: z.string().optional(),
              })).optional(),
              resources: z.object({
                requests: z.record(z.union([z.string(), z.number()])).optional(),
                limits: z.record(z.union([z.string(), z.number()])).optional(),
              }).optional(),
              volumeMounts: z.array(z.object({
                name: z.string(),
                mountPath: z.string(),
              })).optional(),
              livenessProbe: z.object({
                httpGet: z.object({
                  path: z.string(),
                  port: z.number(),
                  scheme: z.string().optional(),
                }).optional(),
                initialDelaySeconds: z.number().optional(),
                periodSeconds: z.number().optional(),
                failureThreshold: z.number().optional(),
              }).optional(),
              readinessProbe: z.object({
                httpGet: z.object({
                  path: z.string(),
                  port: z.number(),
                  scheme: z.string().optional(),
                }).optional(),
                initialDelaySeconds: z.number().optional(),
                periodSeconds: z.number().optional(),
                failureThreshold: z.number().optional(),
              }).optional(),
            })),
            volumes: z.array(z.object({
              name: z.string(),
              emptyDir: z.object({
                medium: z.string().optional(),
              }).optional(),
            })).optional(),
          }),
        }).optional(),
      }),
    }),
  }),
});

export type KaitoInferenceSet = z.infer<typeof kaitoInferenceSetSchema>;
