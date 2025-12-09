import { http, HttpResponse } from 'msw'

const API_BASE = 'http://localhost:3001/api'

// Mock data
export const mockModels = [
  {
    id: 'Qwen/Qwen3-0.6B',
    name: 'Qwen3-0.6B',
    description: 'Small but capable Qwen model',
    size: '0.6B',
    task: 'chat' as const,
    parameters: 600000000,
    contextLength: 8192,
    license: 'Apache 2.0',
    supportedEngines: ['vllm', 'sglang', 'trtllm'] as const,
    minGpuMemory: '4GB',
  },
  {
    id: 'meta-llama/Llama-3.2-1B-Instruct',
    name: 'Llama-3.2-1B-Instruct',
    description: 'Instruction-tuned Llama model',
    size: '1B',
    task: 'chat' as const,
    parameters: 1000000000,
    contextLength: 4096,
    license: 'Meta Llama License',
    supportedEngines: ['vllm', 'sglang', 'trtllm'] as const,
    minGpuMemory: '8GB',
  },
]

export const mockDeployments = [
  {
    name: 'qwen3-0-6b-vllm-abc123',
    namespace: 'kubefoundry',
    modelId: 'Qwen/Qwen3-0.6B',
    engine: 'vllm' as const,
    mode: 'aggregated' as const,
    phase: 'Running' as const,
    replicas: {
      desired: 1,
      ready: 1,
      available: 1,
    },
    pods: [
      {
        name: 'qwen3-0-6b-vllm-abc123-worker-0',
        phase: 'Running' as const,
        ready: true,
        restarts: 0,
        node: 'gpu-node-1',
      },
    ],
    createdAt: new Date().toISOString(),
    frontendService: 'qwen3-0-6b-vllm-abc123-frontend',
  },
]

export const mockSettings = {
  config: {
    activeProviderId: 'dynamo',
    defaultNamespace: 'kubefoundry',
  },
  providers: [
    {
      id: 'dynamo',
      name: 'NVIDIA Dynamo',
      description: 'GPU-accelerated inference with disaggregated serving',
      defaultNamespace: 'kubefoundry',
    },
    {
      id: 'kuberay',
      name: 'KubeRay',
      description: 'Ray-based distributed inference',
      defaultNamespace: 'kuberay',
    },
  ],
  activeProvider: {
    id: 'dynamo',
    name: 'NVIDIA Dynamo',
    description: 'GPU-accelerated inference with disaggregated serving',
    defaultNamespace: 'kubefoundry',
  },
}

export const handlers = [
  // Models API
  http.get(`${API_BASE}/models`, () => {
    return HttpResponse.json({ models: mockModels })
  }),

  http.get(`${API_BASE}/models/:id`, ({ params }) => {
    const id = decodeURIComponent(params.id as string)
    const model = mockModels.find(m => m.id === id)
    if (!model) {
      return HttpResponse.json({ error: { message: 'Model not found' } }, { status: 404 })
    }
    return HttpResponse.json(model)
  }),

  // Deployments API
  http.get(`${API_BASE}/deployments`, ({ request }) => {
    const url = new URL(request.url)
    const namespace = url.searchParams.get('namespace')
    const filtered = namespace
      ? mockDeployments.filter(d => d.namespace === namespace)
      : mockDeployments
    return HttpResponse.json({ deployments: filtered })
  }),

  http.get(`${API_BASE}/deployments/:name`, ({ params, request }) => {
    const name = params.name as string
    const url = new URL(request.url)
    const namespace = url.searchParams.get('namespace')
    const deployment = mockDeployments.find(
      d => d.name === name && (!namespace || d.namespace === namespace)
    )
    if (!deployment) {
      return HttpResponse.json({ error: { message: 'Deployment not found' } }, { status: 404 })
    }
    return HttpResponse.json(deployment)
  }),

  http.post(`${API_BASE}/deployments`, async ({ request }) => {
    const config = await request.json() as { name: string; namespace: string }
    return HttpResponse.json({
      message: 'Deployment created',
      name: config.name,
      namespace: config.namespace,
    })
  }),

  http.delete(`${API_BASE}/deployments/:name`, () => {
    return HttpResponse.json({ message: 'Deployment deleted' })
  }),

  http.get(`${API_BASE}/deployments/:name/pods`, ({ params }) => {
    const name = params.name as string
    const deployment = mockDeployments.find(d => d.name === name)
    return HttpResponse.json({ pods: deployment?.pods || [] })
  }),

  // Health API
  http.get(`${API_BASE}/health`, () => {
    return HttpResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
    })
  }),

  http.get(`${API_BASE}/cluster/status`, () => {
    return HttpResponse.json({
      connected: true,
      namespace: 'kubefoundry',
      clusterName: 'test-cluster',
      provider: {
        id: 'dynamo',
        name: 'NVIDIA Dynamo',
      },
      providerInstallation: {
        installed: true,
        version: '1.0.0',
        crdFound: true,
        operatorRunning: true,
      },
    })
  }),

  // Settings API
  http.get(`${API_BASE}/settings`, () => {
    return HttpResponse.json(mockSettings)
  }),

  http.put(`${API_BASE}/settings`, async ({ request }) => {
    const updates = await request.json() as Partial<typeof mockSettings.config>
    return HttpResponse.json({
      message: 'Settings updated',
      config: { ...mockSettings.config, ...updates },
    })
  }),

  http.get(`${API_BASE}/settings/providers`, () => {
    return HttpResponse.json({ providers: mockSettings.providers })
  }),

  http.get(`${API_BASE}/settings/providers/:id`, ({ params }) => {
    const provider = mockSettings.providers.find(p => p.id === params.id)
    if (!provider) {
      return HttpResponse.json({ error: { message: 'Provider not found' } }, { status: 404 })
    }
    return HttpResponse.json({
      ...provider,
      crdConfig: {
        apiGroup: 'dynamo.nvidia.com',
        apiVersion: 'v1alpha1',
        plural: 'dynamographdeployments',
        kind: 'DynamoGraphDeployment',
      },
      installationSteps: [],
      helmRepos: [],
      helmCharts: [],
    })
  }),

  // Installation API
  http.get(`${API_BASE}/installation/helm/status`, () => {
    return HttpResponse.json({
      available: true,
      version: '3.14.0',
    })
  }),

  http.get(`${API_BASE}/installation/providers/:id/status`, ({ params }) => {
    return HttpResponse.json({
      providerId: params.id,
      providerName: params.id === 'dynamo' ? 'NVIDIA Dynamo' : 'KubeRay',
      installed: true,
      version: '1.0.0',
      crdFound: true,
      operatorRunning: true,
      installationSteps: [],
      helmCommands: [],
    })
  }),

  http.post(`${API_BASE}/installation/providers/:id/install`, () => {
    return HttpResponse.json({
      success: true,
      message: 'Provider installed successfully',
    })
  }),

  http.post(`${API_BASE}/installation/providers/:id/upgrade`, () => {
    return HttpResponse.json({
      success: true,
      message: 'Provider upgraded successfully',
    })
  }),

  http.post(`${API_BASE}/installation/providers/:id/uninstall`, () => {
    return HttpResponse.json({
      success: true,
      message: 'Provider uninstalled successfully',
    })
  }),

  // GPU Operator API
  http.get(`${API_BASE}/installation/gpu-operator/status`, () => {
    return HttpResponse.json({
      installed: true,
      crdFound: true,
      operatorRunning: true,
      gpusAvailable: true,
      totalGPUs: 4,
      gpuNodes: ['gpu-node-1', 'gpu-node-2'],
      message: 'GPU Operator is running',
      helmCommands: [],
    })
  }),

  http.post(`${API_BASE}/installation/gpu-operator/install`, () => {
    return HttpResponse.json({
      success: true,
      message: 'GPU Operator installed successfully',
    })
  }),
]
