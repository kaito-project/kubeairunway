import { test as base, type Page, type Route } from '@playwright/test'

/**
 * Mock data matching the shapes used by the frontend MSW handlers.
 * This data is served via Playwright page.route() interception so no
 * backend is required.
 */

export const mockModels = [
  {
    id: 'Qwen/Qwen3-0.6B',
    name: 'Qwen3-0.6B',
    description: 'Small but capable Qwen model',
    size: '0.6B',
    task: 'chat',
    parameters: 600_000_000,
    contextLength: 8192,
    license: 'Apache 2.0',
    supportedEngines: ['vllm', 'sglang', 'trtllm'],
    minGpuMemory: '4GB',
    gated: false,
  },
  {
    id: 'meta-llama/Llama-3.2-1B-Instruct',
    name: 'Llama-3.2-1B-Instruct',
    description: 'Instruction-tuned Llama model',
    size: '1B',
    task: 'chat',
    parameters: 1_000_000_000,
    contextLength: 4096,
    license: 'Meta Llama License',
    supportedEngines: ['vllm', 'sglang', 'trtllm'],
    minGpuMemory: '8GB',
    gated: true,
  },
]

export const mockDeployments = [
  {
    name: 'qwen3-0-6b-vllm-abc123',
    namespace: 'airunway-system',
    modelId: 'Qwen/Qwen3-0.6B',
    engine: 'vllm',
    mode: 'aggregated',
    phase: 'Running',
    replicas: { desired: 1, ready: 1, available: 1 },
    pods: [
      {
        name: 'qwen3-0-6b-vllm-abc123-worker-0',
        phase: 'Running',
        ready: true,
        restarts: 0,
        node: 'gpu-node-1',
      },
    ],
    createdAt: new Date().toISOString(),
    frontendService: 'qwen3-0-6b-vllm-abc123-frontend:8000',
  },
  {
    name: 'llama-1b-pending-def456',
    namespace: 'airunway-system',
    modelId: 'meta-llama/Llama-3.2-1B-Instruct',
    engine: 'sglang',
    mode: 'aggregated',
    phase: 'Pending',
    replicas: { desired: 1, ready: 0, available: 0 },
    pods: [],
    createdAt: new Date().toISOString(),
  },
]

export const mockSettings = {
  config: { defaultNamespace: 'airunway-system' },
  auth: { enabled: false },
  providers: [
    {
      id: 'runtime-a',
      name: 'Primary Runtime',
      description: 'General-purpose runtime for standard workloads',
      defaultNamespace: 'runtime-a-system',
    },
    {
      id: 'runtime-b',
      name: 'Distributed Runtime',
      description: 'Runtime for larger distributed workloads',
      defaultNamespace: 'runtime-b-system',
    },
  ],
}

export const mockClusterStatus = {
  connected: true,
  namespace: 'airunway-system',
  clusterName: 'test-cluster',
  provider: { id: 'runtime-a', name: 'Primary Runtime' },
  providerInstallation: {
    installed: true,
    version: '1.0.0',
    crdFound: true,
    operatorRunning: true,
  },
}

export const mockRuntimesStatus = {
  runtimes: [
    {
      id: 'runtime-a',
      name: 'Primary Runtime',
      installed: true,
      version: '1.0.0',
      crdFound: true,
      operatorRunning: true,
    },
  ],
}

export const mockGpuCapacity = {
  totalGpus: 4,
  allocatedGpus: 2,
  availableGpus: 2,
  maxContiguousAvailable: 2,
  maxNodeGpuCapacity: 2,
  gpuNodeCount: 2,
  totalMemoryGb: 80,
  nodePools: [
    { name: 'gpu-pool', gpuType: 'NVIDIA A100', gpuCount: 2, nodeCount: 2, availableGpus: 2, totalMemoryGb: 80 },
  ],
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

/**
 * Single route handler that dispatches based on URL pathname.
 * Using one handler avoids Playwright glob-matching edge cases.
 */
export async function mockApiRoutes(page: Page) {
  await page.route(/\/api\//, (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname
    const method = route.request().method()

    // --- Settings ---
    if (path === '/api/settings' || path === '/api/settings/') {
      if (method === 'PUT') {
        return json(route, { message: 'Settings updated', config: mockSettings.config })
      }
      return json(route, mockSettings)
    }
    if (path === '/api/settings/providers' || path === '/api/settings/providers/') {
      return json(route, { providers: mockSettings.providers })
    }
    if (path.startsWith('/api/settings/providers/')) {
      return json(route, {
        ...mockSettings.providers[0],
        crdConfig: { apiGroup: 'example.ai', apiVersion: 'v1alpha1', plural: 'runtimedeployments', kind: 'RuntimeDeployment' },
        installationSteps: [], helmRepos: [], helmCharts: [],
      })
    }

    // --- Health ---
    if (path === '/api/health' || path === '/api/health/') {
      return json(route, { status: 'ok', timestamp: new Date().toISOString() })
    }

    // --- Cluster ---
    if (path === '/api/cluster/status') {
      return json(route, mockClusterStatus)
    }

    // --- Models ---
    if (path === '/api/models' || path === '/api/models/') {
      return json(route, { models: mockModels })
    }
    if (path.startsWith('/api/models/search')) {
      return json(route, { models: [], total: 0, hasMore: false, query: '' })
    }
    if (path.startsWith('/api/models/')) {
      const idPart = path.replace('/api/models/', '')
      const model = mockModels.find((m) => m.id === decodeURIComponent(idPart))
      if (!model) return json(route, { error: { message: 'Model not found' } }, 404)
      return json(route, model)
    }

    // --- Deployments (sub-paths first) ---
    if (path.match(/\/api\/deployments\/preview$/)) {
      return json(route, {
        resources: [{
          kind: 'ModelDeployment', apiVersion: 'airunway.ai/v1alpha1',
          name: 'test-deployment',
          manifest: {
            apiVersion: 'airunway.ai/v1alpha1', kind: 'ModelDeployment',
            metadata: { name: 'test-deployment', namespace: 'airunway-system' },
            spec: { model: { id: 'Qwen/Qwen3-0.6B', source: 'huggingface' }, resources: { gpu: { count: 1 } } },
          },
        }],
        primaryResource: { kind: 'ModelDeployment', apiVersion: 'airunway.ai/v1alpha1' },
      })
    }
    if (path.match(/\/api\/deployments\/[^/]+\/pods$/)) {
      const name = path.split('/')[3]
      const dep = mockDeployments.find((d) => d.name === name)
      return json(route, { pods: dep?.pods || [] })
    }
    if (path.match(/\/api\/deployments\/[^/]+\/metrics$/)) {
      return json(route, { available: false })
    }
    if (path.match(/\/api\/deployments\/[^/]+\/pending-reasons$/)) {
      return json(route, { reasons: [] })
    }
    if (path.match(/\/api\/deployments\/[^/]+\/manifest$/)) {
      const name = path.split('/')[3]
      return json(route, {
        resources: [{
          kind: 'ModelDeployment', apiVersion: 'airunway.ai/v1alpha1', name,
          manifest: {
            apiVersion: 'airunway.ai/v1alpha1', kind: 'ModelDeployment',
            metadata: { name, namespace: 'airunway-system' },
            spec: { model: { id: 'Qwen/Qwen3-0.6B', source: 'huggingface' }, resources: { gpu: { count: 1 } } },
          },
        }],
        primaryResource: { kind: 'ModelDeployment', apiVersion: 'airunway.ai/v1alpha1' },
      })
    }
    if (path.match(/\/api\/deployments\/[^/]+\/logs/)) {
      return json(route, {
        logs: 'INFO: Model loaded successfully\nINFO: Server started on port 8000',
        podName: 'qwen3-0-6b-vllm-abc123-worker-0', container: 'inference',
      })
    }
    if (path === '/api/deployments' || path === '/api/deployments/') {
      if (method === 'POST') {
        return json(route, { message: 'Deployment created successfully', name: 'test-deployment', namespace: 'airunway-system' }, 201)
      }
      return json(route, { deployments: mockDeployments })
    }
    // Individual deployment by name
    if (path.match(/^\/api\/deployments\/[^/]+$/)) {
      const name = path.split('/').pop()
      if (method === 'DELETE') return json(route, { message: 'Deployment deleted successfully' })
      const dep = mockDeployments.find((d) => d.name === name)
      if (!dep) return json(route, { error: { message: 'Deployment not found' } }, 404)
      return json(route, dep)
    }

    // --- Installation ---
    if (path === '/api/installation/helm/status') {
      return json(route, { available: true, version: '3.14.0' })
    }
    if (path.match(/\/api\/installation\/providers\/[^/]+\/status$/)) {
      return json(route, {
        providerId: 'runtime-a', providerName: 'Primary Runtime',
        installed: true, version: '1.0.0', crdFound: true, operatorRunning: true,
        installationSteps: [], helmCommands: [],
      })
    }
    if (path === '/api/installation/gpu-operator/status') {
      return json(route, {
        installed: true, crdFound: true, operatorRunning: true, gpusAvailable: true,
        totalGPUs: 4, gpuNodes: ['gpu-node-1', 'gpu-node-2'],
        message: 'GPU Operator is running', helmCommands: [],
      })
    }
    if (path.startsWith('/api/installation/gpu-capacity')) {
      return json(route, mockGpuCapacity)
    }
    if (path === '/api/installation/gateway/status') {
      return json(route, {
        gatewayApiInstalled: true, inferenceExtInstalled: true, pinnedVersion: 'v1.3.1',
        gatewayAvailable: false,
        message: 'Gateway API and Inference Extension CRDs are installed.',
        installCommands: [],
      })
    }
    if (path === '/api/installation/runtimes/status') {
      return json(route, mockRuntimesStatus)
    }

    // --- Runtimes ---
    if (path === '/api/runtimes/status') {
      return json(route, mockRuntimesStatus)
    }

    // --- OAuth / Secrets ---
    if (path === '/api/oauth/huggingface/config') {
      return json(route, {
        clientId: 'test-client-id',
        authorizeUrl: 'https://huggingface.co/oauth/authorize',
        scopes: ['openid', 'profile', 'read-repos'],
      })
    }
    if (path === '/api/secrets/huggingface/status') {
      return json(route, {
        configured: true,
        namespaces: [{ name: 'runtime-a-system', exists: true }, { name: 'default', exists: true }],
        user: { id: 'user123', name: 'testuser', fullname: 'Test User' },
      })
    }

    // --- Autoscaler ---
    if (path === '/api/autoscaler/detection') {
      return json(route, { type: 'none', detected: false })
    }
    if (path === '/api/autoscaler/status') {
      return json(route, { available: false })
    }

    // --- Gateway ---
    if (path === '/api/gateway/status') {
      return json(route, { enabled: false, available: false })
    }
    if (path === '/api/gateway/models') {
      return json(route, { models: [] })
    }

    // --- Costs ---
    if (path.startsWith('/api/costs/')) {
      return json(route, { success: true, breakdown: {} })
    }

    // --- AI Configurator ---
    if (path === '/api/aiconfigurator/status') {
      return json(route, { available: false })
    }

    // --- AIKit ---
    if (path === '/api/aikit/models' || path === '/api/aikit/models/') {
      return json(route, { models: [], total: 0 })
    }
    if (path.startsWith('/api/aikit/')) {
      return json(route, {})
    }

    // Fallback
    return json(route, {})
  })
}

/**
 * Extended test fixture that sets up API mocking before each test.
 */
export const test = base.extend<{ mockedPage: Page }>({
  mockedPage: async ({ page }, use) => {
    await mockApiRoutes(page)
    await use(page)
  },
})

export { expect } from '@playwright/test'
