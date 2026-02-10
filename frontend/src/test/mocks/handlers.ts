import { http, HttpResponse } from 'msw'

// Use wildcard prefix to match both relative URLs (/api/...) and absolute URLs (http://localhost:3001/api/...)
const API_BASE = '*/api'

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
    gated: false,
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
    gated: true,
  },
]

export const mockDeployments = [
  {
    name: 'qwen3-0-6b-vllm-abc123',
    namespace: 'kubeairunway-system',
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
    defaultNamespace: 'kubeairunway-system',
  },
  providers: [
    {
      id: 'dynamo',
      name: 'NVIDIA Dynamo',
      description: 'GPU-accelerated inference with disaggregated serving',
      defaultNamespace: 'kubeairunway-system',
    },
    {
      id: 'kuberay',
      name: 'KubeRay',
      description: 'Ray-based distributed inference',
      defaultNamespace: 'kuberay',
    },
  ],
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
      namespace: 'kubeairunway-system',
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
        apiGroup: 'nvidia.com',
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

  // HuggingFace OAuth API
  http.get(`${API_BASE}/oauth/huggingface/config`, () => {
    return HttpResponse.json({
      clientId: 'test-client-id',
      authorizeUrl: 'https://huggingface.co/oauth/authorize',
      scopes: ['openid', 'profile', 'read-repos'],
    })
  }),

  http.post(`${API_BASE}/oauth/huggingface/token`, async ({ request }) => {
    const body = await request.json() as { code: string; codeVerifier: string; redirectUri: string }
    if (!body.code || !body.codeVerifier || !body.redirectUri) {
      return HttpResponse.json({ error: { message: 'Missing required fields' } }, { status: 400 })
    }
    return HttpResponse.json({
      accessToken: 'hf_mock_token_123',
      tokenType: 'Bearer',
      expiresIn: 3600,
      scope: 'openid profile read-repos',
      user: {
        id: 'user123',
        name: 'testuser',
        fullname: 'Test User',
        email: 'test@example.com',
        avatarUrl: 'https://huggingface.co/avatars/test.png',
      },
    })
  }),

  // HuggingFace Secrets API
  http.get(`${API_BASE}/secrets/huggingface/status`, () => {
    return HttpResponse.json({
      configured: true,
      namespaces: [
        { name: 'dynamo-system', exists: true },
        { name: 'kuberay-system', exists: true },
        { name: 'default', exists: true },
      ],
      user: {
        id: 'user123',
        name: 'testuser',
        fullname: 'Test User',
      },
    })
  }),

  http.post(`${API_BASE}/secrets/huggingface`, async ({ request }) => {
    const body = await request.json() as { accessToken: string }
    if (!body.accessToken) {
      return HttpResponse.json({ error: { message: 'Access token is required' } }, { status: 400 })
    }
    return HttpResponse.json({
      success: true,
      message: 'HuggingFace token saved successfully',
      user: {
        id: 'user123',
        name: 'testuser',
        fullname: 'Test User',
      },
      results: [
        { namespace: 'dynamo-system', success: true },
        { namespace: 'kuberay-system', success: true },
        { namespace: 'default', success: true },
      ],
    })
  }),

  http.delete(`${API_BASE}/secrets/huggingface`, () => {
    return HttpResponse.json({
      success: true,
      message: 'HuggingFace secrets deleted successfully',
      results: [
        { namespace: 'dynamo-system', success: true },
        { namespace: 'kuberay-system', success: true },
        { namespace: 'default', success: true },
      ],
    })
  }),
]
