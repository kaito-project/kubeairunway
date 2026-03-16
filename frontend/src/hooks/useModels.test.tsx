import { describe, it, expect } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useModels, useModel, hfModelToModel } from './useModels'
import { createWrapper } from '@/test/test-utils'
import type { HfModelSearchResult } from '@/lib/api'

describe('useModels', () => {
  it('fetches models list', async () => {
    const { result } = renderHook(() => useModels(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toBeDefined()
    expect(Array.isArray(result.current.data)).toBe(true)
    expect(result.current.data!.length).toBeGreaterThan(0)
  })

  it('returns model objects with required fields', async () => {
    const { result } = renderHook(() => useModels(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const model = result.current.data![0]
    expect(model.id).toBeDefined()
    expect(model.name).toBeDefined()
  })
})

describe('useModel', () => {
  it('fetches a single model by id', async () => {
    const { result } = renderHook(() => useModel('Qwen/Qwen3-0.6B'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toBeDefined()
    expect(result.current.data?.id).toBe('Qwen/Qwen3-0.6B')
  })

  it('does not fetch when id is undefined', async () => {
    const { result } = renderHook(() => useModel(undefined), {
      wrapper: createWrapper(),
    })

    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('hfModelToModel', () => {
  it('converts HF search result to Model type', () => {
    const hfModel: HfModelSearchResult = {
      id: 'meta-llama/Llama-3.2-1B',
      author: 'meta-llama',
      name: 'Llama-3.2-1B',
      downloads: 1000,
      likes: 50,
      pipelineTag: 'text-generation',
      libraryName: 'transformers',
      architectures: ['LlamaForCausalLM'],
      gated: false,
      parameterCount: 1_000_000_000,
      estimatedGpuMemory: '3GB',
      estimatedGpuMemoryGb: 3,
      supportedEngines: ['vllm', 'sglang', 'trtllm'],
      compatible: true,
    }

    const model = hfModelToModel(hfModel)

    expect(model.id).toBe('meta-llama/Llama-3.2-1B')
    expect(model.name).toBe('Llama-3.2-1B')
    expect(model.size).toBe('1.0B')
    expect(model.task).toBe('text-generation')
    expect(model.supportedEngines).toEqual(['vllm', 'sglang', 'trtllm'])
    expect(model.gated).toBe(false)
    expect(model.fromHfSearch).toBe(true)
  })

  it('formats parameter count in billions', () => {
    const hfModel: HfModelSearchResult = {
      id: 'test/70b-model',
      author: 'test',
      name: '70b-model',
      downloads: 0,
      likes: 0,
      pipelineTag: 'text-generation',
      architectures: [],
      gated: false,
      libraryName: 'transformers',
      parameterCount: 70_000_000_000,
      supportedEngines: ['vllm'],
      compatible: true,
    }

    const model = hfModelToModel(hfModel)
    expect(model.size).toBe('70.0B')
  })

  it('formats parameter count in millions for small models', () => {
    const hfModel: HfModelSearchResult = {
      id: 'test/125m-model',
      author: 'test',
      name: '125m-model',
      downloads: 0,
      likes: 0,
      pipelineTag: 'text-generation',
      architectures: [],
      gated: false,
      libraryName: 'transformers',
      parameterCount: 125_000_000,
      supportedEngines: ['vllm'],
      compatible: true,
    }

    const model = hfModelToModel(hfModel)
    expect(model.size).toBe('125M')
  })

  it('handles unknown parameter count', () => {
    const hfModel: HfModelSearchResult = {
      id: 'test/unknown-size',
      author: 'test',
      name: 'unknown-size',
      downloads: 0,
      likes: 0,
      pipelineTag: 'text-generation',
      architectures: [],
      gated: false,
      libraryName: 'transformers',
      supportedEngines: ['vllm'],
      compatible: true,
    }

    const model = hfModelToModel(hfModel)
    expect(model.size).toBe('Unknown')
  })

  it('maps conversational pipeline tag to text-generation task', () => {
    const hfModel: HfModelSearchResult = {
      id: 'test/chat-model',
      author: 'test',
      name: 'chat-model',
      downloads: 0,
      likes: 0,
      pipelineTag: 'conversational',
      architectures: [],
      gated: false,
      libraryName: 'transformers',
      supportedEngines: ['vllm'],
      compatible: true,
    }

    const model = hfModelToModel(hfModel)
    expect(model.task).toBe('text-generation')
    expect(model.conversational).toBe(true)
  })
})
