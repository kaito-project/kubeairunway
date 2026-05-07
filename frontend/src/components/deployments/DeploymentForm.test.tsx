import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DetailedClusterCapacity, Model, RuntimeStatus } from '@/lib/api'
import { DeploymentForm } from './DeploymentForm'

const mutateAsync = vi.fn()
const toast = vi.fn()

vi.mock('@/hooks/useDeployments', () => ({
  useCreateDeployment: () => ({
    mutateAsync,
    isProcessing: false,
    isValidating: false,
    isSubmitting: false,
    status: 'idle',
    reset: vi.fn(),
  }),
  usePVCs: () => ({ data: undefined }),
}))

vi.mock('@/hooks/useHuggingFace', () => ({
  useHuggingFaceStatus: () => ({ data: { configured: true } }),
  useGgufFiles: () => ({ data: [], isLoading: false }),
}))

vi.mock('@/hooks/useAikit', () => ({
  usePremadeModels: () => ({ data: [] }),
}))

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast }),
}))

vi.mock('@/components/ui/confetti', () => ({
  useConfetti: () => ({
    trigger: vi.fn(),
    ConfettiComponent: () => null,
  }),
}))

vi.mock('./CapacityWarning', () => ({
  CapacityWarning: () => null,
}))

vi.mock('./AIConfiguratorPanel', () => ({
  AIConfiguratorPanel: () => null,
}))

vi.mock('./ManifestViewer', () => ({
  ManifestViewer: () => null,
}))

vi.mock('./CostEstimate', () => ({
  CostEstimate: () => null,
}))

vi.mock('./StorageVolumesSection', () => ({
  StorageVolumesSection: () => null,
}))

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'deepseek-ai/DeepSeek-R1',
    name: 'DeepSeek R1',
    description: 'Large language model',
    size: '671B',
    task: 'text-generation',
    supportedEngines: ['vllm'],
    parameterCount: 671_000_000_000,
    estimatedGpuMemoryGb: 900,
    contextLength: 4096,
    ...overrides,
  }
}

function createCapacity(overrides: Partial<DetailedClusterCapacity> = {}): DetailedClusterCapacity {
  return {
    totalGpus: 16,
    allocatedGpus: 0,
    availableGpus: 16,
    maxContiguousAvailable: 16,
    maxNodeGpuCapacity: 8,
    gpuNodeCount: 2,
    totalMemoryGb: 80,
    nodePools: [],
    ...overrides,
  }
}

function createRuntime(overrides: Partial<RuntimeStatus> = {}): RuntimeStatus {
  return {
    id: 'installed-runtime',
    name: 'Installed Runtime',
    installed: true,
    ...overrides,
  } as RuntimeStatus
}

describe('DeploymentForm', () => {
  beforeEach(() => {
    mutateAsync.mockReset()
    toast.mockReset()
  })

  it('keeps manual topology edits instead of snapping back to the recommendation', async () => {
    render(
      <MemoryRouter>
        <DeploymentForm
          model={createModel()}
          detailedCapacity={createCapacity()}
          runtimes={[createRuntime()]}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(
        screen.getByText(/Multi-Node \(2 nodes × 8 GPUs = 16 total\)/i)
      ).toBeInTheDocument()
    })

    const gpuInput = screen.getByRole('spinbutton', { name: /GPUs per Replica/i })
    fireEvent.change(gpuInput, { target: { value: '4' } })

    await waitFor(() => {
      expect(gpuInput).toHaveValue(4)
      expect(
        screen.getByText(/Multi-Node \(3 nodes × 4 GPUs = 12 total\)/i)
      ).toBeInTheDocument()
    })

    expect(
      screen.queryByText(/Multi-Node \(2 nodes × 8 GPUs = 16 total\)/i)
    ).not.toBeInTheDocument()
  })
})
