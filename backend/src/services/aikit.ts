import { buildKitService, type StreamCallback } from './buildkit';
import { registryService } from './registry';
import logger from '../lib/logger';

/**
 * Direct runner image for HuggingFace GGUF models
 * Downloads and runs models at runtime without pre-building
 */
export const GGUF_RUNNER_IMAGE = 'ghcr.io/kaito-project/aikit/runners/llama-cpp-cuda:latest';

/**
 * Pre-made AIKit models from the KAITO project
 * These are pre-built GGUF models that can be deployed directly
 */
export interface PremadeModel {
  id: string;                 // Unique identifier (e.g., 'llama3.2:1b')
  name: string;               // Display name
  size: string;               // Model size (e.g., '1B', '8B', '70B')
  image: string;              // Full image reference
  modelName: string;          // Model name for API
  license: string;            // License type
  description?: string;       // Optional description
  computeType: 'cpu' | 'gpu'; // Compute type supported by this model
}

/**
 * Curated list of pre-made AIKit models
 */
export const PREMADE_MODELS: PremadeModel[] = [
  {
    id: 'llama3.2:1b',
    name: 'Llama 3.2',
    size: '1B',
    image: 'ghcr.io/kaito-project/aikit/llama3.2:1b',
    modelName: 'llama-3.2-1b-instruct',
    license: 'Llama',
    description: 'Compact model for edge deployments',
    computeType: 'cpu',
  },
  {
    id: 'llama3.2:3b',
    name: 'Llama 3.2',
    size: '3B',
    image: 'ghcr.io/kaito-project/aikit/llama3.2:3b',
    modelName: 'llama-3.2-3b-instruct',
    license: 'Llama',
    description: 'Efficient model for general tasks',
    computeType: 'cpu',
  },
  {
    id: 'llama3.1:8b',
    name: 'Llama 3.1',
    size: '8B',
    image: 'ghcr.io/kaito-project/aikit/llama3.1:8b',
    modelName: 'llama-3.1-8b-instruct',
    license: 'Llama',
    description: 'Balanced performance and efficiency',
    computeType: 'cpu',
  },
  {
    id: 'llama3.3:70b',
    name: 'Llama 3.3',
    size: '70B',
    image: 'ghcr.io/kaito-project/aikit/llama3.3:70b',
    modelName: 'llama-3.3-70b-instruct',
    license: 'Llama',
    description: 'High-performance large model',
    computeType: 'cpu',
  },
  {
    id: 'mixtral:8x7b',
    name: 'Mixtral',
    size: '8x7B',
    image: 'ghcr.io/kaito-project/aikit/mixtral:8x7b',
    modelName: 'mixtral-8x7b-instruct',
    license: 'Apache',
    description: 'Mixture of experts architecture',
    computeType: 'cpu',
  },
  {
    id: 'phi4:14b',
    name: 'Phi 4',
    size: '14B',
    image: 'ghcr.io/kaito-project/aikit/phi4:14b',
    modelName: 'phi-4-14b-instruct',
    license: 'MIT',
    description: 'Microsoft research model',
    computeType: 'cpu',
  },
  {
    id: 'gemma2:2b',
    name: 'Gemma 2',
    size: '2B',
    image: 'ghcr.io/kaito-project/aikit/gemma2:2b',
    modelName: 'gemma-2-2b-instruct',
    license: 'Gemma',
    description: 'Google lightweight model',
    computeType: 'cpu',
  },
  {
    id: 'qwq:32b',
    name: 'QwQ',
    size: '32B',
    image: 'ghcr.io/kaito-project/aikit/qwq:32b',
    modelName: 'qwq-32b',
    license: 'Apache 2.0',
    description: 'Reasoning-focused model',
    computeType: 'cpu',
  },
  {
    id: 'codestral:22b',
    name: 'Codestral',
    size: '22B',
    image: 'ghcr.io/kaito-project/aikit/codestral:22b',
    modelName: 'codestral-22b',
    license: 'MNLP',
    description: 'Code generation specialist',
    computeType: 'cpu',
  },
  {
    id: 'gpt-oss:20b',
    name: 'GPT-OSS',
    size: '20B',
    image: 'ghcr.io/kaito-project/aikit/gpt-oss:20b',
    modelName: 'gpt-oss-20b',
    license: 'Apache 2.0',
    description: 'Open source GPT-style model',
    computeType: 'cpu',
  },
];

/**
 * AIKit build request configuration
 */
export interface AikitBuildRequest {
  /** Source of the model */
  modelSource: 'premade' | 'huggingface';

  /** For premade models: the model ID (e.g., 'llama3.2:3b') */
  premadeModel?: string;

  /** For HuggingFace models: the repository ID (e.g., 'TheBloke/Llama-2-7B-Chat-GGUF') */
  modelId?: string;

  /** For HuggingFace models: the GGUF filename (e.g., 'llama-2-7b-chat.Q4_K_M.gguf') */
  ggufFile?: string;

  /** Output image name (without registry prefix) */
  imageName?: string;

  /** Output image tag (e.g., 'Q4_K_M', 'latest') */
  imageTag?: string;
}

/**
 * AIKit build result
 */
export interface AikitBuildResult {
  /** Whether the build/resolution was successful */
  success: boolean;

  /** Full image reference (registry/name:tag) */
  imageRef: string;

  /** Build time in seconds (0 for premade models) */
  buildTime: number;

  /** Error message if build failed */
  error?: string;

  /** Whether this was a premade model (no build required) */
  wasPremade: boolean;
}

/**
 * AIKit Dockerfile context URL
 * This is the remote Dockerfile used to build AIKit images
 */
const AIKIT_DOCKERFILE_URL = 'https://raw.githubusercontent.com/kaito-project/aikit/main/models/aikitfile.yaml';

/**
 * AIKit Service
 * Handles building AIKit images from GGUF models using BuildKit
 */
class AikitService {
  /**
   * Get the list of available pre-made models
   */
  getPremadeModels(): PremadeModel[] {
    return [...PREMADE_MODELS];
  }

  /**
   * Get a pre-made model by ID
   */
  getPremadeModel(modelId: string): PremadeModel | undefined {
    return PREMADE_MODELS.find(m => m.id === modelId);
  }

  /**
   * Validate a build request
   */
  validateBuildRequest(request: AikitBuildRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (request.modelSource === 'premade') {
      if (!request.premadeModel) {
        errors.push('premadeModel is required for premade model source');
      } else {
        const model = this.getPremadeModel(request.premadeModel);
        if (!model) {
          errors.push(`Unknown premade model: ${request.premadeModel}`);
        }
      }
    } else if (request.modelSource === 'huggingface') {
      if (!request.modelId) {
        errors.push('modelId is required for HuggingFace model source');
      }
      if (!request.ggufFile) {
        errors.push('ggufFile is required for HuggingFace model source');
      }
      if (request.ggufFile && !request.ggufFile.endsWith('.gguf')) {
        errors.push('ggufFile must be a .gguf file');
      }
    } else {
      errors.push('modelSource must be either "premade" or "huggingface"');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Build the direct Hugging Face resolve URL for a GGUF model
   */
  buildHuggingFaceUrl(modelId: string, ggufFile: string): string {
    const encodePath = (path: string) =>
      path.split('/').map((segment) => encodeURIComponent(segment)).join('/');

    return `https://huggingface.co/${encodePath(modelId)}/resolve/main/${encodePath(ggufFile)}`;
  }

  /**
   * Extract quantization level from GGUF filename
   * Examples: 'llama-2-7b-chat.Q4_K_M.gguf' -> 'Q4_K_M'
   */
  extractQuantization(ggufFile: string): string {
    // Common quantization patterns
    const patterns = [
      /\.(Q\d+_K_[SM])\.gguf$/i,      // Q4_K_M, Q5_K_S, etc.
      /\.(Q\d+_\d)\.gguf$/i,          // Q4_0, Q5_1, etc.
      /\.(Q\d+)\.gguf$/i,              // Q4, Q5, etc.
      /\.(IQ\d+_[A-Z]+)\.gguf$/i,     // IQ2_XXS, IQ3_XS, etc.
      /\.(F\d+)\.gguf$/i,              // F16, F32
    ];

    for (const pattern of patterns) {
      const match = ggufFile.match(pattern);
      if (match) {
        return match[1].toUpperCase();
      }
    }

    // Fallback: use 'custom' if no quantization found
    return 'custom';
  }

  /**
   * Generate a safe image name from model ID
   */
  sanitizeImageName(modelId: string): string {
    return modelId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')  // Replace non-alphanumeric with hyphens
      .replace(/-+/g, '-')           // Collapse multiple hyphens
      .replace(/^-|-$/g, '')         // Remove leading/trailing hyphens
      .slice(0, 63);                 // Limit to 63 chars (k8s limit)
  }

  /**
   * Build an AIKit image or return the premade image reference
   */
  async buildImage(
    request: AikitBuildRequest,
    onStream?: StreamCallback
  ): Promise<AikitBuildResult> {
    // Validate request
    const validation = this.validateBuildRequest(request);
    if (!validation.valid) {
      return {
        success: false,
        imageRef: '',
        buildTime: 0,
        error: `Invalid build request: ${validation.errors.join(', ')}`,
        wasPremade: false,
      };
    }

    // Handle premade models - no build required
    if (request.modelSource === 'premade') {
      const model = this.getPremadeModel(request.premadeModel!);
      if (!model) {
        return {
          success: false,
          imageRef: '',
          buildTime: 0,
          error: `Unknown premade model: ${request.premadeModel}`,
          wasPremade: true,
        };
      }

      logger.info({ modelId: model.id, image: model.image }, 'Using premade AIKit image');

      return {
        success: true,
        imageRef: model.image,
        buildTime: 0,
        wasPremade: true,
      };
    }

    // Handle HuggingFace GGUF models - build required
    const startTime = Date.now();

    try {
      // Ensure infrastructure is ready
      logger.info('Ensuring build infrastructure is ready');
      
      const registryStatus = await registryService.ensureRegistry();
      if (!registryStatus.ready) {
        return {
          success: false,
          imageRef: '',
          buildTime: 0,
          error: `Registry not ready: ${registryStatus.message}`,
          wasPremade: false,
        };
      }

      const builderStatus = await buildKitService.ensureBuilder(onStream);
      if (!builderStatus.ready) {
        return {
          success: false,
          imageRef: '',
          buildTime: 0,
          error: `Builder not ready: ${builderStatus.message}`,
          wasPremade: false,
        };
      }

      // Build the image
      const modelId = request.modelId!;
      const ggufFile = request.ggufFile!;
      const ggufUrl = this.buildHuggingFaceUrl(modelId, ggufFile);

      // Determine image name and tag
      const imageName = request.imageName || `aikit-${this.sanitizeImageName(modelId)}`;
      const imageTag = request.imageTag || this.extractQuantization(ggufFile);
      
      // Use cluster-internal URL for buildx push
      const buildImageRef = registryService.getImageRef(imageName, imageTag);
      // Use kubelet-accessible URL for the returned imageRef (goes into KAITO manifest)
      const kubeletImageRef = registryService.getKubeletImageRef(imageName, imageTag);

      logger.info(
        { modelId, ggufFile, buildImageRef, kubeletImageRef },
        'Building AIKit image from HuggingFace GGUF'
      );

      if (onStream) {
        onStream(`Building AIKit image for ${modelId}/${ggufFile}\n`, 'stdout');
        onStream(`Build target: ${buildImageRef}\n`, 'stdout');
        onStream(`Kubelet image: ${kubeletImageRef}\n`, 'stdout');
      }

      // Execute the build
      const buildResult = await buildKitService.build(
        {
          buildArg: `model=${ggufUrl}`,
          tags: [buildImageRef],
          context: AIKIT_DOCKERFILE_URL,
          push: true,
        },
        onStream
      );

      const buildTime = (Date.now() - startTime) / 1000;

      if (!buildResult.success) {
        logger.error({ modelId, error: buildResult.stderr }, 'AIKit image build failed');
        return {
          success: false,
          imageRef: '',
          buildTime,
          error: buildResult.stderr || 'Build failed',
          wasPremade: false,
        };
      }

      logger.info({ kubeletImageRef, buildTime }, 'AIKit image build completed successfully');

      // Return the kubelet-accessible URL for use in KAITO manifests
      return {
        success: true,
        imageRef: kubeletImageRef,
        buildTime,
        wasPremade: false,
      };
    } catch (error) {
      const buildTime = (Date.now() - startTime) / 1000;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error({ error: errorMessage }, 'AIKit image build failed with exception');

      return {
        success: false,
        imageRef: '',
        buildTime,
        error: errorMessage,
        wasPremade: false,
      };
    }
  }

  /**
   * Get the image reference for a request without building
   * Returns the kubelet-accessible URL for use in KAITO manifests
   */
  getImageRef(request: AikitBuildRequest): string | null {
    if (request.modelSource === 'premade') {
      const model = this.getPremadeModel(request.premadeModel || '');
      return model?.image || null;
    }

    if (request.modelSource === 'huggingface' && request.modelId && request.ggufFile) {
      const imageName = request.imageName || `aikit-${this.sanitizeImageName(request.modelId)}`;
      const imageTag = request.imageTag || this.extractQuantization(request.ggufFile);
      // Return kubelet-accessible URL for use in KAITO manifests
      return registryService.getKubeletImageRef(imageName, imageTag);
    }

    return null;
  }
}

// Export singleton instance
export const aikitService = new AikitService();
