import { describe, test, expect } from 'bun:test';
import app from '../hono-app';
import { getProvider } from '../providers';
import { aikitService } from '../services/aikit';
import type { KaitoDeploymentConfig } from '../providers/kaito/schema';

/**
 * End-to-end tests for the KAITO premade model deployment flow.
 *
 * These tests verify the complete flow from:
 * 1. Fetching available premade models
 * 2. Building (resolving) the model image
 * 3. Generating a valid KAITO InferenceSet manifest
 */
describe('KAITO Premade Model Deployment Flow', () => {
  describe('Complete deployment flow', () => {
    test('can fetch premade models from API', async () => {
      const res = await app.request('/api/aikit/models');
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.models.length).toBeGreaterThan(0);
      expect(data.total).toBe(data.models.length);
    });

    test('can get a specific premade model details', async () => {
      // Get available models
      const listRes = await app.request('/api/aikit/models');
      const listData = await listRes.json();
      const firstModel = listData.models[0];

      // Get specific model
      const modelRes = await app.request(`/api/aikit/models/${firstModel.id}`);
      expect(modelRes.status).toBe(200);

      const modelData = await modelRes.json();
      expect(modelData.id).toBe(firstModel.id);
      expect(modelData.image).toBe(firstModel.image);
    });

    test('can build (resolve) a premade model image via API', async () => {
      // Get a known premade model
      const listRes = await app.request('/api/aikit/models');
      const listData = await listRes.json();
      const model = listData.models.find((m: { computeType: string }) => m.computeType === 'cpu');
      expect(model).toBeDefined();

      // Build (resolve) the premade model
      const buildRes = await app.request('/api/aikit/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelSource: 'premade',
          premadeModel: model.id,
        }),
      });
      expect(buildRes.status).toBe(200);

      const buildData = await buildRes.json();
      expect(buildData.success).toBe(true);
      expect(buildData.wasPremade).toBe(true);
      expect(buildData.imageRef).toBe(model.image);
    });

    test('KAITO provider generates valid manifest with premade model image', () => {
      // Get a premade model
      const premadeModel = aikitService.getPremadeModel('llama3.2:3b');
      expect(premadeModel).toBeDefined();

      // Create KAITO config
      const config: KaitoDeploymentConfig = {
        name: 'test-llama',
        namespace: 'default',
        provider: 'kaito',
        kaitoResourceType: 'workspace',
        modelSource: 'premade',
        premadeModel: 'llama3.2:3b',
        ggufRunMode: 'direct',
        computeType: 'cpu',
        replicas: 1,
      };

      // Get KAITO provider
      const provider = getProvider('kaito');
      expect(provider).toBeDefined();

      // Generate manifest - default is now Workspace
      const manifest = provider!.generateManifest(config);
      expect(manifest).toBeDefined();

      // Manifest is already an object, access directly
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;
      expect(parsed.kind).toBe('Workspace');  // Default is now Workspace
      expect(parsed.apiVersion).toBe('kaito.sh/v1beta1');
      expect(parsed.metadata.name).toBe('test-llama');
      expect(parsed.metadata.namespace).toBe('default');

      // Workspace has inference at top level (not in spec.template)
      const container = parsed.inference.template.spec.containers[0];
      expect(container.image).toBe(premadeModel!.image);
    });

    test('KAITO provider validates premade model exists', () => {
      const config: KaitoDeploymentConfig = {
        name: 'test-invalid',
        namespace: 'default',
        provider: 'kaito',
        kaitoResourceType: 'workspace',
        modelSource: 'premade',
        premadeModel: 'non-existent-model',
        ggufRunMode: 'direct',
        computeType: 'cpu',
        replicas: 1,
      };

      const provider = getProvider('kaito');
      const result = provider!.validateConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Unknown premade model');
    });

    test('complete flow: list models -> select -> build -> generate manifest', async () => {
      // Step 1: List available models
      const listRes = await app.request('/api/aikit/models');
      expect(listRes.status).toBe(200);
      const models = (await listRes.json()).models;

      // Step 2: Select a model with CPU support
      const cpuModel = models.find((m: { computeType: string }) => m.computeType === 'cpu');
      expect(cpuModel).toBeDefined();

      // Step 3: Build (resolve) the model
      const buildRes = await app.request('/api/aikit/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelSource: 'premade',
          premadeModel: cpuModel.id,
        }),
      });
      expect(buildRes.status).toBe(200);
      const buildResult = await buildRes.json();
      expect(buildResult.success).toBe(true);
      expect(buildResult.imageRef).toBe(cpuModel.image);

      // Step 4: Generate KAITO manifest
      const config: KaitoDeploymentConfig = {
        name: 'e2e-test-deployment',
        namespace: 'kaito-workspace',
        provider: 'kaito',
        kaitoResourceType: 'workspace',
        modelSource: 'premade',
        premadeModel: cpuModel.id,
        ggufRunMode: 'direct',
        computeType: 'cpu',
        replicas: 1,
      };

      const provider = getProvider('kaito');
      expect(provider).toBeDefined();

      // Validate config
      const validation = provider!.validateConfig(config);
      expect(validation.valid).toBe(true);

      // Generate manifest - default is Workspace
      const manifest = provider!.generateManifest(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;

      // Verify complete manifest (Workspace format)
      expect(parsed.kind).toBe('Workspace');
      expect(parsed.apiVersion).toBe('kaito.sh/v1beta1');
      expect(parsed.metadata.name).toBe('e2e-test-deployment');
      expect(parsed.resource.count).toBe(1);  // Workspace uses resource.count
      expect(parsed.inference.template.spec.containers[0].image).toBe(cpuModel.image);

      // Verify kubefoundry labels
      expect(parsed.metadata.labels['app.kubernetes.io/managed-by']).toBe('kubefoundry');
    });
  });

  describe('HuggingFace GGUF deployment flow', () => {
    test('preview build returns correct image reference', async () => {
      const previewRes = await app.request('/api/aikit/build/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelSource: 'huggingface',
          modelId: 'TheBloke/Llama-2-7B-Chat-GGUF',
          ggufFile: 'llama-2-7b-chat.Q4_K_M.gguf',
        }),
      });
      expect(previewRes.status).toBe(200);

      const previewData = await previewRes.json();
      expect(previewData.wasPremade).toBe(false);
      expect(previewData.requiresBuild).toBe(true);
      expect(previewData.imageRef).toBeDefined();
      expect(previewData.registryUrl).toBeDefined();
    });

    test('KAITO provider generates manifest with custom image for HuggingFace model', () => {
      const config: KaitoDeploymentConfig = {
        name: 'custom-llama',
        namespace: 'default',
        provider: 'kaito',
        kaitoResourceType: 'workspace',
        modelSource: 'huggingface',
        modelId: 'TheBloke/Llama-2-7B-Chat-GGUF',
        ggufFile: 'llama-2-7b-chat.Q4_K_M.gguf',
        ggufRunMode: 'build',
        imageRef: 'kubefoundry-registry.kubefoundry-system.svc:5000/aikit-thebloke-llama-2-7b-chat-gguf:Q4_K_M',
        computeType: 'cpu',
        replicas: 2,
      };

      const provider = getProvider('kaito');
      expect(provider).toBeDefined();

      const validation = provider!.validateConfig(config);
      expect(validation.valid).toBe(true);

      const manifest = provider!.generateManifest(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;

      // Default is Workspace
      expect(parsed.kind).toBe('Workspace');
      expect(parsed.resource.count).toBe(2);  // Workspace uses resource.count
      expect(parsed.inference.template.spec.containers[0].image).toBe(config.imageRef);
    });
  });

  describe('GPU deployment configuration', () => {
    test('KAITO provider includes GPU resources when computeType is gpu', () => {
      const config: KaitoDeploymentConfig = {
        name: 'gpu-llama',
        namespace: 'default',
        provider: 'kaito',
        kaitoResourceType: 'workspace',
        modelSource: 'premade',
        premadeModel: 'llama3.1:8b',
        ggufRunMode: 'direct',
        computeType: 'gpu',
        replicas: 1,
        resources: {
          gpu: 2,
        },
      };

      const provider = getProvider('kaito');
      const manifest = provider!.generateManifest(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;

      // Workspace has inference at top level (not in spec.template)
      const resources = parsed.inference.template.spec.containers[0].resources;
      expect(resources).toBeDefined();
      expect(resources.limits['nvidia.com/gpu']).toBe(2);
    });
  });

  describe('Provider availability', () => {
    test('KAITO provider is registered in providers', async () => {
      const settingsRes = await app.request('/api/settings/providers');
      expect(settingsRes.status).toBe(200);

      const data = await settingsRes.json();
      expect(data.providers).toBeDefined();

      const kaito = data.providers.find((p: { id: string }) => p.id === 'kaito');
      expect(kaito).toBeDefined();
      expect(kaito.name).toBe('KAITO');
    });
  });

  describe('InferenceSet resource type', () => {
    test('KAITO provider generates valid InferenceSet manifest with premade model', () => {
      // Get a premade model
      const premadeModel = aikitService.getPremadeModel('llama3.2:3b');
      expect(premadeModel).toBeDefined();

      // Create KAITO config with InferenceSet
      const config: KaitoDeploymentConfig = {
        name: 'test-llama-inferenceset',
        namespace: 'default',
        provider: 'kaito',
        kaitoResourceType: 'inferenceset',
        modelSource: 'premade',
        premadeModel: 'llama3.2:3b',
        ggufRunMode: 'direct',
        computeType: 'cpu',
        replicas: 1,
      };

      // Get KAITO provider
      const provider = getProvider('kaito');
      expect(provider).toBeDefined();

      // Generate manifest - should be InferenceSet
      const manifest = provider!.generateManifest(config);
      expect(manifest).toBeDefined();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;
      expect(parsed.kind).toBe('InferenceSet');
      expect(parsed.apiVersion).toBe('kaito.sh/v1alpha1');
      expect(parsed.metadata.name).toBe('test-llama-inferenceset');
      expect(parsed.metadata.namespace).toBe('default');

      // InferenceSet has spec.template.inference.template structure
      const container = parsed.spec.template.inference.template.spec.containers[0];
      expect(container.image).toBe(premadeModel!.image);
    });

    test('InferenceSet uses spec.replicas instead of resource.count', () => {
      const config: KaitoDeploymentConfig = {
        name: 'inferenceset-replicas-test',
        namespace: 'kaito-workspace',
        provider: 'kaito',
        kaitoResourceType: 'inferenceset',
        modelSource: 'premade',
        premadeModel: 'llama3.2:3b',
        ggufRunMode: 'direct',
        computeType: 'cpu',
        replicas: 3,
      };

      const provider = getProvider('kaito');
      const manifest = provider!.generateManifest(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;

      expect(parsed.kind).toBe('InferenceSet');
      expect(parsed.spec.replicas).toBe(3);
      // InferenceSet should NOT have resource.count
      expect(parsed.resource).toBeUndefined();
    });

    test('InferenceSet includes GPU resources when computeType is gpu', () => {
      const config: KaitoDeploymentConfig = {
        name: 'gpu-inferenceset',
        namespace: 'default',
        provider: 'kaito',
        kaitoResourceType: 'inferenceset',
        modelSource: 'premade',
        premadeModel: 'llama3.1:8b',
        ggufRunMode: 'direct',
        computeType: 'gpu',
        replicas: 1,
        resources: {
          gpu: 2,
        },
      };

      const provider = getProvider('kaito');
      const manifest = provider!.generateManifest(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;

      expect(parsed.kind).toBe('InferenceSet');
      // InferenceSet has spec.template.inference.template structure
      const resources = parsed.spec.template.inference.template.spec.containers[0].resources;
      expect(resources).toBeDefined();
      expect(resources.limits['nvidia.com/gpu']).toBe(2);
    });

    test('InferenceSet generates manifest with custom image for HuggingFace model', () => {
      const config: KaitoDeploymentConfig = {
        name: 'custom-llama-inferenceset',
        namespace: 'default',
        provider: 'kaito',
        kaitoResourceType: 'inferenceset',
        modelSource: 'huggingface',
        modelId: 'TheBloke/Llama-2-7B-Chat-GGUF',
        ggufFile: 'llama-2-7b-chat.Q4_K_M.gguf',
        ggufRunMode: 'build',
        imageRef: 'kubefoundry-registry.kubefoundry-system.svc:5000/aikit-thebloke-llama-2-7b-chat-gguf:Q4_K_M',
        computeType: 'cpu',
        replicas: 2,
      };

      const provider = getProvider('kaito');
      expect(provider).toBeDefined();

      const validation = provider!.validateConfig(config);
      expect(validation.valid).toBe(true);

      const manifest = provider!.generateManifest(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;

      expect(parsed.kind).toBe('InferenceSet');
      expect(parsed.apiVersion).toBe('kaito.sh/v1alpha1');
      expect(parsed.spec.replicas).toBe(2);
      expect(parsed.spec.template.inference.template.spec.containers[0].image).toBe(config.imageRef);
    });

    test('complete InferenceSet flow: select model -> generate manifest', () => {
      // Get a premade model with CPU support
      const cpuModel = aikitService.getPremadeModel('llama3.2:3b');
      expect(cpuModel).toBeDefined();

      // Create InferenceSet config
      const config: KaitoDeploymentConfig = {
        name: 'e2e-inferenceset-deployment',
        namespace: 'kaito-workspace',
        provider: 'kaito',
        kaitoResourceType: 'inferenceset',
        modelSource: 'premade',
        premadeModel: 'llama3.2:3b',
        ggufRunMode: 'direct',
        computeType: 'cpu',
        replicas: 1,
      };

      const provider = getProvider('kaito');
      expect(provider).toBeDefined();

      // Validate config
      const validation = provider!.validateConfig(config);
      expect(validation.valid).toBe(true);

      // Generate manifest
      const manifest = provider!.generateManifest(config);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed = manifest as any;

      // Verify InferenceSet manifest structure
      expect(parsed.kind).toBe('InferenceSet');
      expect(parsed.apiVersion).toBe('kaito.sh/v1alpha1');
      expect(parsed.metadata.name).toBe('e2e-inferenceset-deployment');
      expect(parsed.spec.replicas).toBe(1);
      expect(parsed.spec.template.inference.template.spec.containers[0].image).toBe(cpuModel!.image);

      // Verify kubefoundry labels
      expect(parsed.metadata.labels['app.kubernetes.io/managed-by']).toBe('kubefoundry');
    });
  });
});
