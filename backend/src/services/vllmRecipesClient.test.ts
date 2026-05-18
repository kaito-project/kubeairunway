import { describe, expect, test } from 'bun:test';
import { VllmRecipesClient } from './vllmRecipesClient';

describe('VllmRecipesClient', () => {
  test('resolves relative recipe references under the configured recipe base URL', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai/catalog');

    expect(client.resolveReference('microsoft/Phi-4-mini-instruct.json')).toBe(
      'https://recipes.vllm.ai/catalog/microsoft/Phi-4-mini-instruct.json'
    );
  });

  test('allows absolute references inside the configured recipe base URL', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai/catalog');

    expect(client.resolveReference('https://recipes.vllm.ai/catalog/microsoft/Phi-4-mini-instruct.json')).toBe(
      'https://recipes.vllm.ai/catalog/microsoft/Phi-4-mini-instruct.json'
    );
  });

  test('rejects recipe references outside the configured recipe origin', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai');

    expect(() => client.resolveReference('https://example.com/recipe.json')).toThrow(
      'vLLM recipe references must stay under https://recipes.vllm.ai'
    );
  });

  test('rejects recipe references outside the configured recipe path prefix', () => {
    const client = new VllmRecipesClient('https://recipes.vllm.ai/catalog');

    expect(() => client.resolveReference('/other/recipe.json')).toThrow(
      'vLLM recipe references must stay under https://recipes.vllm.ai/catalog'
    );
  });
});
