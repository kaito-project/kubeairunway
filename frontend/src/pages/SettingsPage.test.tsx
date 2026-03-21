import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPage } from './SettingsPage'

const mutateAsync = vi.fn()
const refetch = vi.fn()
const startOAuth = vi.fn()
const toast = vi.fn()
let mockGpuStatus = {
  installed: false,
  gpusAvailable: false,
  operatorRunning: false,
  totalGPUs: 0,
  message: '',
  gpuNodes: [] as string[],
  helmCommands: [] as string[],
}
let mockHfStatus: {
  configured: boolean
  user?: {
    name: string
    fullname?: string
    avatarUrl?: string
  }
} = {
  configured: false,
}

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ isLoading: false }),
}))

vi.mock('@/hooks/useRuntimes', () => ({
  useRuntimesStatus: () => ({
    data: {
      runtimes: [
        {
          id: 'installed-runtime',
          name: 'Installed Runtime',
          installed: true,
          healthy: true,
          version: '1.0.0',
        },
        {
          id: 'available-runtime',
          name: 'Available Runtime',
          installed: false,
          healthy: false,
        },
      ],
    },
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useClusterStatus', () => ({
  useClusterStatus: () => ({
    data: {
      connected: true,
      clusterName: 'test-cluster',
    },
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useInstallation', () => ({
  useHelmStatus: () => ({
    data: {
      available: true,
      version: '3.15.0',
    },
    isLoading: false,
  }),
  useProviderInstallationStatus: (providerId: string) => ({
    data: providerId === 'available-runtime'
      ? {
          installed: false,
          providerName: 'Available Runtime',
          message: 'Available Runtime is not installed yet.',
          crdFound: false,
          operatorRunning: false,
          installationSteps: [],
        }
      : {
          installed: true,
          providerName: 'Installed Runtime',
          message: 'Installed Runtime is ready.',
          crdFound: true,
          operatorRunning: true,
          installationSteps: [],
        },
    isLoading: false,
    refetch,
  }),
  useInstallProvider: () => ({
    mutateAsync,
  }),
  useUninstallProvider: () => ({
    mutateAsync,
  }),
}))

vi.mock('@/hooks/useAutoscaler', () => ({
  useAutoscalerDetection: () => ({
    data: null,
    isLoading: false,
  }),
}))

vi.mock('@/hooks/useGpuOperator', () => ({
  useGpuOperatorStatus: () => ({
    data: mockGpuStatus,
    isLoading: false,
    refetch,
  }),
  useInstallGpuOperator: () => ({
    mutateAsync,
  }),
}))

vi.mock('@/hooks/useGateway', () => ({
  useGatewayCRDStatus: () => ({
    data: {
      gatewayApiInstalled: false,
      inferenceExtInstalled: false,
      gatewayAvailable: false,
      installCommands: [],
      message: '',
    },
    isLoading: false,
    refetch,
  }),
  useInstallGatewayCRDs: () => ({
    mutateAsync,
  }),
}))

vi.mock('@/hooks/useHuggingFace', () => ({
  useHuggingFaceStatus: () => ({
    data: mockHfStatus,
    isLoading: false,
    refetch,
  }),
  useHuggingFaceOAuth: () => ({
    startOAuth,
  }),
  useDeleteHuggingFaceSecret: () => ({
    mutateAsync,
    isPending: false,
  }),
}))

vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({
    toast,
  }),
}))

vi.mock('@/components/autoscaler/AutoscalerGuidance', () => ({
  AutoscalerGuidance: () => null,
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    mutateAsync.mockReset()
    refetch.mockReset()
    startOAuth.mockReset()
    toast.mockReset()
    mockGpuStatus = {
      installed: false,
      gpusAvailable: false,
      operatorRunning: false,
      totalGPUs: 0,
      message: '',
      gpuNodes: [],
      helmCommands: [],
    }
    mockHfStatus = {
      configured: false,
    }
  })

  it('keeps uninstalled runtime surfaces neutral while showing red X icons', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/settings?tab=runtimes']}>
        <SettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByText('Available Runtimes')).toBeInTheDocument()
    expect(screen.getByText('Installed Runtime')).toBeInTheDocument()
    expect(screen.getByText('Available Runtime')).toBeInTheDocument()
    expect(container.querySelector('[style*="border-top-color"]')).toBeNull()
    expect(container.querySelector('[style*="border-top-width"]')).toBeNull()

    const availableCard = screen.getByText('Available Runtime').closest('.rounded-2xl')
    expect(availableCard).not.toHaveClass('bg-destructive/10', 'border-destructive/20')
    const availableStatus = within(availableCard as HTMLElement).getByText('Not Installed').closest('span')
    expect(availableStatus).toHaveClass('text-muted-foreground')
    expect(availableStatus?.querySelector('svg')).toHaveClass('text-red-500')

    fireEvent.click(screen.getByText('Available Runtime'))

    const installationPanel = screen.getByText('Available Runtime Installation').closest('.rounded-2xl')
    expect(installationPanel).not.toHaveClass('bg-destructive/10', 'border-destructive/20')
    const installationStatus = within(installationPanel as HTMLElement).getByText('Not Installed').closest('span')
    expect(installationStatus).toHaveClass('text-muted-foreground')
    expect(installationStatus?.querySelector('svg')).toHaveClass('text-red-500')
  })

  it('uses success badge styling for readable integration connection states', () => {
    mockGpuStatus = {
      installed: true,
      gpusAvailable: true,
      operatorRunning: true,
      totalGPUs: 4,
      message: 'GPU support is ready',
      gpuNodes: ['worker-a'],
      helmCommands: [],
    }
    mockHfStatus = {
      configured: true,
      user: {
        name: 'test-user',
        fullname: 'Test User',
      },
    }

    render(
      <MemoryRouter initialEntries={['/settings?tab=integrations']}>
        <SettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByText('GPUs Enabled')).toHaveClass('bg-green-500/15', 'text-green-600', 'dark:text-green-400')
    expect(screen.getByText('Connected')).toHaveClass('bg-green-500/15', 'text-green-600', 'dark:text-green-400')
  })

  it('uses the Hugging Face emoji on the connect button', () => {
    render(
      <MemoryRouter initialEntries={['/settings?tab=integrations']}>
        <SettingsPage />
      </MemoryRouter>
    )

    expect(screen.getByRole('button', { name: /sign in with hugging face/i })).toHaveTextContent('🤗')
  })
})
