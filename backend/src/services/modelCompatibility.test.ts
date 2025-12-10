import { describe, test, expect } from 'bun:test';
import {
  inferArchitectureFromModelId,
  getSupportedEngines,
  processHfModel,
  filterCompatibleModels,
  parseParameterCountFromName,
} from './modelCompatibility';
import type { HfApiModelResult } from '@kubefoundry/shared';

describe('inferArchitectureFromModelId', () => {
  test('infers LlamaForCausalLM for llama models', () => {
    expect(inferArchitectureFromModelId('meta-llama/Llama-3.1-8B-Instruct')).toEqual(['LlamaForCausalLM']);
    expect(inferArchitectureFromModelId('meta-llama/Llama-2-7b-chat-hf')).toEqual(['LlamaForCausalLM']);
    expect(inferArchitectureFromModelId('TinyLlama/TinyLlama-1.1B-Chat-v1.0')).toEqual(['LlamaForCausalLM']);
    expect(inferArchitectureFromModelId('NousResearch/Llama-2-7b-chat-hf')).toEqual(['LlamaForCausalLM']);
  });

  test('infers MistralForCausalLM for mistral models', () => {
    expect(inferArchitectureFromModelId('mistralai/Mistral-7B-v0.1')).toEqual(['MistralForCausalLM']);
    expect(inferArchitectureFromModelId('mistralai/Mistral-7B-Instruct-v0.2')).toEqual(['MistralForCausalLM']);
  });

  test('infers MixtralForCausalLM for mixtral models', () => {
    expect(inferArchitectureFromModelId('mistralai/Mixtral-8x7B-v0.1')).toEqual(['MixtralForCausalLM']);
  });

  test('infers Qwen architectures', () => {
    expect(inferArchitectureFromModelId('Qwen/Qwen2-7B-Instruct')).toEqual(['Qwen2ForCausalLM']);
    expect(inferArchitectureFromModelId('Qwen/Qwen2.5-7B-Instruct')).toEqual(['Qwen2ForCausalLM']);
    expect(inferArchitectureFromModelId('Qwen/Qwen3-8B')).toEqual(['Qwen3ForCausalLM']);
  });

  test('infers GemmaForCausalLM for gemma models', () => {
    expect(inferArchitectureFromModelId('google/gemma-7b')).toEqual(['GemmaForCausalLM']);
    expect(inferArchitectureFromModelId('google/gemma-2-9b')).toEqual(['Gemma2ForCausalLM']);
    expect(inferArchitectureFromModelId('google/gemma2-9b')).toEqual(['Gemma2ForCausalLM']);
  });

  test('infers PhiForCausalLM for phi models', () => {
    expect(inferArchitectureFromModelId('microsoft/phi-2')).toEqual(['PhiForCausalLM']);
    expect(inferArchitectureFromModelId('microsoft/Phi-3-mini-4k-instruct')).toEqual(['Phi3ForCausalLM']);
  });

  test('returns empty array for unknown models', () => {
    expect(inferArchitectureFromModelId('unknown/model-name')).toEqual([]);
    expect(inferArchitectureFromModelId('some-random-model')).toEqual([]);
  });
});

describe('getSupportedEngines', () => {
  test('returns all engines for LlamaForCausalLM', () => {
    const engines = getSupportedEngines(['LlamaForCausalLM']);
    expect(engines).toContain('vllm');
    expect(engines).toContain('sglang');
    expect(engines).toContain('trtllm');
  });

  test('returns empty array for unknown architecture', () => {
    expect(getSupportedEngines(['UnknownArchitecture'])).toEqual([]);
  });

  test('returns engines if any architecture is supported', () => {
    const engines = getSupportedEngines(['UnknownArchitecture', 'LlamaForCausalLM']);
    expect(engines.length).toBeGreaterThan(0);
  });
});

describe('processHfModel', () => {
  test('processes model with full metadata', () => {
    const model: HfApiModelResult = {
      _id: '123',
      id: 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
      modelId: 'TinyLlama-1.1B-Chat-v1.0',
      downloads: 1000,
      likes: 100,
      pipeline_tag: 'text-generation',
      library_name: 'transformers',
      config: {
        architectures: ['LlamaForCausalLM'],
        model_type: 'llama',
      },
      gated: false,
    };

    const result = processHfModel(model);
    expect(result.compatible).toBe(true);
    expect(result.architectures).toEqual(['LlamaForCausalLM']);
    expect(result.supportedEngines.length).toBeGreaterThan(0);
    expect(result.gated).toBe(false);
  });

  test('processes gated model without metadata by inferring architecture', () => {
    const model: HfApiModelResult = {
      _id: '123',
      id: 'meta-llama/Llama-3.1-8B-Instruct',
      modelId: 'Llama-3.1-8B-Instruct',
      downloads: 100000,
      likes: 5000,
      // Gated models return null for these fields without auth
      pipeline_tag: undefined,
      library_name: undefined,
      config: undefined,
      gated: true,
      safetensors: {
        total: 8030261248,
      },
    };

    const result = processHfModel(model);
    // Should be compatible because we infer LlamaForCausalLM from the model name
    expect(result.compatible).toBe(true);
    expect(result.architectures).toEqual(['LlamaForCausalLM']);
    expect(result.supportedEngines.length).toBeGreaterThan(0);
    expect(result.gated).toBe(true);
    expect(result.parameterCount).toBe(8030261248);
  });

  test('marks unknown model without metadata as incompatible', () => {
    const model: HfApiModelResult = {
      _id: '123',
      id: 'unknown/some-model',
      modelId: 'some-model',
      downloads: 10,
      likes: 1,
      pipeline_tag: undefined,
      library_name: undefined,
      config: undefined,
      gated: false,
    };

    const result = processHfModel(model);
    // Unknown model cannot have architecture inferred
    expect(result.compatible).toBe(false);
    expect(result.architectures).toEqual([]);
    expect(result.incompatibilityReason).toBeDefined();
  });
});

describe('filterCompatibleModels', () => {
  test('filters to only compatible models', () => {
    const models: HfApiModelResult[] = [
      {
        _id: '1',
        id: 'meta-llama/Llama-3.1-8B',
        modelId: 'Llama-3.1-8B',
        gated: true,
      },
      {
        _id: '2',
        id: 'unknown/unsupported-model',
        modelId: 'unsupported-model',
        gated: false,
      },
      {
        _id: '3',
        id: 'TinyLlama/TinyLlama-1.1B',
        modelId: 'TinyLlama-1.1B',
        pipeline_tag: 'text-generation',
        library_name: 'transformers',
        config: { architectures: ['LlamaForCausalLM'] },
        gated: false,
      },
    ];

    const compatible = filterCompatibleModels(models);
    expect(compatible.length).toBe(2);
    expect(compatible.map(m => m.id)).toContain('meta-llama/Llama-3.1-8B');
    expect(compatible.map(m => m.id)).toContain('TinyLlama/TinyLlama-1.1B');
    expect(compatible.map(m => m.id)).not.toContain('unknown/unsupported-model');
  });
});

describe('parseParameterCountFromName', () => {
  test('parses billion parameters', () => {
    expect(parseParameterCountFromName('Llama-3.1-8B-Instruct')).toBe(8_000_000_000);
    expect(parseParameterCountFromName('Llama-2-70b-chat')).toBe(70_000_000_000);
    expect(parseParameterCountFromName('Qwen2-1.5B')).toBe(1_500_000_000);
  });

  test('parses million parameters', () => {
    expect(parseParameterCountFromName('model-125M')).toBe(125_000_000);
    expect(parseParameterCountFromName('gpt2-350m')).toBe(350_000_000);
  });

  test('returns undefined for unparseable names', () => {
    expect(parseParameterCountFromName('some-model')).toBeUndefined();
  });
});
