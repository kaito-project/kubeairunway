import type {
  VllmRecipeIndexEntry,
  VllmRecipeListResponse,
  VllmRecipeRawResponse,
} from '@airunway/shared';
import logger from '../lib/logger';

const DEFAULT_RECIPES_BASE_URL = 'https://recipes.vllm.ai';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitModelId(modelId: string): { org: string; model: string } {
  const slashIndex = modelId.indexOf('/');
  if (slashIndex <= 0 || slashIndex === modelId.length - 1) {
    throw new Error(`Invalid Hugging Face model ID: ${modelId}`);
  }

  return {
    org: modelId.slice(0, slashIndex),
    model: modelId.slice(slashIndex + 1),
  };
}

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export class VllmRecipesClient {
  constructor(private readonly baseUrl = process.env.VLLM_RECIPES_BASE_URL || DEFAULT_RECIPES_BASE_URL) {}

  get sourceBaseUrl(): string {
    return this.baseUrl.replace(/\/+$/, '');
  }

  async list(): Promise<VllmRecipeListResponse> {
    const source = `${this.sourceBaseUrl}/models.json`;
    const payload = await this.fetchJson<unknown>(source);

    let entries: unknown;
    if (Array.isArray(payload)) {
      entries = payload;
    } else if (isRecord(payload)) {
      entries = payload.models ?? payload.recipes;
    }

    if (!Array.isArray(entries)) {
      throw new Error('vLLM recipe index did not contain a models array');
    }

    const recipes = entries.filter(isRecord).map((entry) => ({ ...entry }) as VllmRecipeIndexEntry);

    return {
      recipes,
      total: recipes.length,
      source,
    };
  }

  async get(org: string, model: string): Promise<VllmRecipeRawResponse> {
    return this.getByModelId(`${org}/${model}`);
  }

  async getByModelId(modelId: string): Promise<VllmRecipeRawResponse> {
    const { org, model } = splitModelId(modelId);
    const source = `${this.sourceBaseUrl}/${encodePathSegments(org)}/${encodePathSegments(model)}.json`;
    const payload = await this.fetchJson<unknown>(source);

    if (!isRecord(payload)) {
      throw new Error(`vLLM recipe payload for ${modelId} was not a JSON object`);
    }

    return {
      modelId,
      source,
      recipe: payload,
    };
  }

  async fetchReference(reference: string): Promise<JsonRecord> {
    const source = this.resolveReference(reference);
    const payload = await this.fetchJson<unknown>(source);

    if (!isRecord(payload)) {
      throw new Error(`vLLM recipe reference ${source} was not a JSON object`);
    }

    return payload;
  }

  resolveReference(reference: string): string {
    try {
      return new URL(reference).toString();
    } catch {
      const normalizedReference = reference.startsWith('/') ? reference : `/${reference}`;
      return `${this.sourceBaseUrl}${normalizedReference}`;
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    logger.debug({ url }, 'Fetching vLLM recipe JSON');

    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}

export const vllmRecipesClient = new VllmRecipesClient();
