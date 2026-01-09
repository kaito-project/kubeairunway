/**
 * AIKit API (KAITO/GGUF Models)
 */

import type { RequestFn } from './client';

/**
 * Premade AIKit model from the curated catalog
 */
export interface PremadeModel {
  id: string; // Unique identifier (e.g., 'llama3.2:1b')
  name: string; // Display name (e.g., 'Llama 3.2')
  size: string; // Model size (e.g., '1B', '8B')
  image: string; // Full container image reference
  modelName: string; // Model name for API
  license: string; // License type
  description?: string; // Optional description
  computeType: 'cpu' | 'gpu'; // Compute type supported by this model
}

/**
 * AIKit build request for building custom GGUF images
 */
export interface AikitBuildRequest {
  modelSource: 'premade' | 'huggingface';
  premadeModel?: string;
  modelId?: string;
  ggufFile?: string;
  imageName?: string;
  imageTag?: string;
}

/**
 * AIKit build result
 */
export interface AikitBuildResult {
  success: boolean;
  imageRef: string;
  buildTime: number;
  wasPremade: boolean;
  message: string;
  error?: string;
}

/**
 * AIKit build preview result
 */
export interface AikitPreviewResult {
  imageRef: string;
  wasPremade: boolean;
  requiresBuild: boolean;
  registryUrl: string;
}

/**
 * AIKit infrastructure status
 */
export interface AikitInfrastructureStatus {
  ready: boolean;
  registry: {
    ready: boolean;
    url?: string;
    message?: string;
  };
  builder: {
    exists: boolean;
    running: boolean;
    name?: string;
    message?: string;
  };
  error?: string;
}

export interface AikitSetupResponse {
  success: boolean;
  message: string;
  registry: { url: string; ready: boolean };
  builder: { name: string; ready: boolean };
}

export interface AikitApi {
  /** List available premade KAITO models */
  listModels: () => Promise<{ models: PremadeModel[]; total: number }>;

  /** Get a specific premade model by ID */
  getModel: (id: string) => Promise<PremadeModel>;

  /** Build an AIKit image (premade returns immediately, HuggingFace triggers build) */
  build: (req: AikitBuildRequest) => Promise<AikitBuildResult>;

  /** Preview what image would be built without actually building */
  preview: (req: AikitBuildRequest) => Promise<AikitPreviewResult>;

  /** Get build infrastructure status (registry + BuildKit) */
  getInfrastructureStatus: () => Promise<AikitInfrastructureStatus>;

  /** Set up build infrastructure (registry + BuildKit) */
  setupInfrastructure: () => Promise<AikitSetupResponse>;
}

export function createAikitApi(request: RequestFn): AikitApi {
  return {
    listModels: () =>
      request<{ models: PremadeModel[]; total: number }>('/aikit/models'),

    getModel: (id: string) =>
      request<PremadeModel>(`/aikit/models/${encodeURIComponent(id)}`),

    build: (req: AikitBuildRequest) =>
      request<AikitBuildResult>('/aikit/build', {
        method: 'POST',
        body: JSON.stringify(req),
      }),

    preview: (req: AikitBuildRequest) =>
      request<AikitPreviewResult>('/aikit/build/preview', {
        method: 'POST',
        body: JSON.stringify(req),
      }),

    getInfrastructureStatus: () =>
      request<AikitInfrastructureStatus>('/aikit/infrastructure/status'),

    setupInfrastructure: () =>
      request<AikitSetupResponse>('/aikit/infrastructure/setup', {
        method: 'POST',
      }),
  };
}
