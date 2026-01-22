import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useConfetti } from '@/components/ui/confetti'
import { useCreateDeployment, type DeploymentConfig } from '@/hooks/useDeployments'
import { useHuggingFaceStatus, useGgufFiles } from '@/hooks/useHuggingFace'
import { usePremadeModels } from '@/hooks/useAikit'
import { useToast } from '@/hooks/useToast'
import { generateDeploymentName, cn } from '@/lib/utils'
import { type Model, type DetailedClusterCapacity, type AutoscalerDetectionResult, type RuntimeStatus, type PremadeModel, type AIConfiguratorResult, aikitApi, type Engine } from '@/lib/api'
import { ChevronDown, AlertCircle, Rocket, CheckCircle2, Sparkles, AlertTriangle, Server, Cpu, Box, Loader2 } from 'lucide-react'
import { CapacityWarning } from './CapacityWarning'
import { AIConfiguratorPanel } from './AIConfiguratorPanel'
import { ManifestViewer } from './ManifestViewer'
import { CostEstimate } from './CostEstimate'
import { calculateGpuRecommendation, type GpuRecommendation } from '@/lib/gpu-recommendations'

// Reusable GPU per Replica field component
interface GpuPerReplicaFieldProps {
  id: string
  value: number
  onChange: (value: number) => void
  maxGpus?: number
  recommendation: GpuRecommendation
  aiConfigRecommended?: number | null
}

function GpuPerReplicaField({ id, value, onChange, maxGpus = 8, recommendation, aiConfigRecommended }: GpuPerReplicaFieldProps) {
  const isAiOptimized = aiConfigRecommended != null && value === aiConfigRecommended
  const isRecommended = value === recommendation.recommendedGpus

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center gap-2">
        GPUs per Replica
        {isAiOptimized ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Sparkles className="h-3 w-3" />
            Optimized
          </span>
        ) : isRecommended && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Sparkles className="h-3 w-3" />
            Recommended
          </span>
        )}
      </Label>
      <Input
        id={id}
        type="number"
        min={1}
        max={maxGpus}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 1)}
      />
      <p className="text-xs text-muted-foreground">
        {recommendation.reason}
        {recommendation.alternatives && recommendation.alternatives.length > 0 && (
          <span className="block mt-1">
            Consider: {recommendation.alternatives.join(', ')} GPUs
          </span>
        )}
      </p>
    </div>
  )
}

interface DeploymentFormProps {
  model: Model
  detailedCapacity?: DetailedClusterCapacity
  autoscaler?: AutoscalerDetectionResult
  runtimes?: RuntimeStatus[]
}

// Subset of Engine type for traditional GPU inference engines (excludes llamacpp which is KAITO-only)
type TraditionalEngine = 'vllm' | 'sglang' | 'trtllm'
type RouterMode = 'none' | 'kv' | 'round-robin'
type DeploymentMode = 'aggregated' | 'disaggregated'
type RuntimeId = 'dynamo' | 'kuberay' | 'kaito'
type KaitoComputeType = 'cpu' | 'gpu'
type GgufRunMode = 'build' | 'direct'

// Runtime metadata for display
const RUNTIME_INFO: Record<RuntimeId, { name: string; description: string; defaultNamespace: string }> = {
  dynamo: {
    name: 'NVIDIA Dynamo',
    description: 'High-performance inference with KV-cache routing and disaggregated serving',
    defaultNamespace: 'dynamo-system',
  },
  kuberay: {
    name: 'KubeRay',
    description: 'Ray-based serving with autoscaling and distributed inference',
    defaultNamespace: 'kuberay-system',
  },
  kaito: {
    name: 'KAITO',
    description: 'Flexible inference with GGUF (llama.cpp) and vLLM support',
    defaultNamespace: 'kaito-workspace',
  },
}

// Engine support by runtime (only traditional GPU engines, not llamacpp)
const RUNTIME_ENGINES: Record<RuntimeId, TraditionalEngine[]> = {
  dynamo: ['vllm', 'sglang', 'trtllm'],
  kuberay: ['vllm'], // KubeRay only supports vLLM currently
  kaito: [], // KAITO uses llama.cpp, not traditional engines
}

// Check if a runtime is compatible with a model based on engine support
function isRuntimeCompatible(runtimeId: RuntimeId, modelEngines: Engine[]): boolean {
  // KAITO supports llamacpp (GGUF) AND vllm models
  if (runtimeId === 'kaito') {
    return modelEngines.includes('llamacpp') || modelEngines.includes('vllm');
  }
  // Other models need at least one matching engine with the runtime
  const runtimeEngines = RUNTIME_ENGINES[runtimeId];
  return modelEngines.some(e => runtimeEngines.includes(e as TraditionalEngine));
}

export function DeploymentForm({ model, detailedCapacity, autoscaler, runtimes }: DeploymentFormProps) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const createDeployment = useCreateDeployment()
  const { data: hfStatus } = useHuggingFaceStatus()
  const { data: premadeModels } = usePremadeModels()
  const formRef = useRef<HTMLFormElement>(null)
  const { trigger: triggerConfetti, ConfettiComponent } = useConfetti(2500)

  // Check if this is a gated model and HF is not configured
  const isGatedModel = model.gated === true
  const needsHfAuth = isGatedModel && !hfStatus?.configured

  // Determine default runtime: prefer compatible and installed runtime
  const getDefaultRuntime = (): RuntimeId => {
    if (!runtimes || runtimes.length === 0) {
      // Fallback based on model engines
      return model.supportedEngines.includes('llamacpp') ? 'kaito' : 'dynamo';
    }

    // Find first compatible and installed runtime
    const compatibleRuntimes: RuntimeId[] = ['dynamo', 'kuberay', 'kaito'];
    for (const rtId of compatibleRuntimes) {
      const rt = runtimes.find(r => r.id === rtId);
      if (rt?.installed && isRuntimeCompatible(rtId, model.supportedEngines)) {
        return rtId;
      }
    }

    // If no compatible installed runtime, return first compatible one
    for (const rtId of compatibleRuntimes) {
      if (isRuntimeCompatible(rtId, model.supportedEngines)) {
        return rtId;
      }
    }

    return 'dynamo';
  }

  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId>(getDefaultRuntime)
  const selectedRuntimeStatus = runtimes?.find(r => r.id === selectedRuntime)
  const isRuntimeInstalled = selectedRuntimeStatus?.installed ?? false

  // AI Configurator state - tracks supported backends and recommended mode
  const [aiConfigSupportedBackends, setAiConfigSupportedBackends] = useState<string[] | null>(null)
  const [aiConfigRecommendedBackend, setAiConfigRecommendedBackend] = useState<string | null>(null)
  const [aiConfigRecommendedMode, setAiConfigRecommendedMode] = useState<DeploymentMode | null>(null)
  // Track AI Configurator recommended values for disaggregated mode
  const [aiConfigRecommendedValues, setAiConfigRecommendedValues] = useState<{
    prefillReplicas?: number
    decodeReplicas?: number
    prefillGpus?: number
    decodeGpus?: number
    gpuPerReplica?: number
  } | null>(null)

  // KAITO-specific state
  const [kaitoComputeType, setKaitoComputeType] = useState<KaitoComputeType>('cpu')
  const [selectedPremadeModel, setSelectedPremadeModel] = useState<PremadeModel | null>(null)
  const [ggufFile, setGgufFile] = useState<string>('')
  const [ggufRunMode, setGgufRunMode] = useState<GgufRunMode>('direct')
  const [maxModelLen, setMaxModelLen] = useState<number | undefined>(undefined)

  // Check if this is a HuggingFace GGUF model (not a premade model)
  // GGUF models have only llamacpp as supported engine and come from HuggingFace
  const isHuggingFaceGgufModel = model.supportedEngines.length === 1 &&
                                  model.supportedEngines[0] === 'llamacpp' &&
                                  !model.id.startsWith('kaito/');

  // Check if this is a vLLM-compatible model for KAITO
  // vLLM models have 'vllm' in supported engines but NOT 'llamacpp'
  const isVllmModel = model.supportedEngines.includes('vllm') &&
                      !model.supportedEngines.includes('llamacpp');

  // Fetch GGUF files from HuggingFace repo when it's a GGUF model and KAITO is selected
  const { data: ggufFilesData, isLoading: ggufFilesLoading } = useGgufFiles(
    model.id,
    isHuggingFaceGgufModel && selectedRuntime === 'kaito'
  );
  const ggufFiles = ggufFilesData?.files || [];

  // Auto-select Q4_K_M file if available, otherwise first file
  useEffect(() => {
    if (ggufFiles.length > 0 && !ggufFile) {
      // Look for Q4_K_M variant (case-insensitive)
      const q4kmFile = ggufFiles.find(f => /q4_k_m/i.test(f));
      if (q4kmFile) {
        setGgufFile(q4kmFile);
      } else {
        // Fallback to first file
        setGgufFile(ggufFiles[0]);
      }
    }
  }, [ggufFiles, ggufFile]);

  // Get supported engines for the selected runtime, filtered by model support
  const getAvailableEngines = (): TraditionalEngine[] => {
    const runtimeEngines = RUNTIME_ENGINES[selectedRuntime]
    // Filter model engines to only those supported by the runtime (excluding llamacpp)
    return model.supportedEngines.filter(
      (e): e is TraditionalEngine => runtimeEngines.includes(e as TraditionalEngine)
    )
  }
  const availableEngines = getAvailableEngines()

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [config, setConfig] = useState<DeploymentConfig>({
    name: generateDeploymentName(model.id),
    namespace: RUNTIME_INFO[getDefaultRuntime()].defaultNamespace,
    modelId: model.id,
    servedModelName: model.id,  // Use HuggingFace model ID as served model name
    engine: availableEngines[0] || 'vllm',
    mode: 'aggregated',
    provider: getDefaultRuntime(),
    routerMode: 'none',
    replicas: 1,
    hfTokenSecret: import.meta.env.VITE_DEFAULT_HF_SECRET || 'hf-token-secret',
    enforceEager: true,
    enablePrefixCaching: false,
    trustRemoteCode: false,
    // Disaggregated mode defaults
    prefillReplicas: 1,
    decodeReplicas: 1,
    prefillGpus: 1,
    decodeGpus: 1,
    // GPU resources for aggregated mode
    resources: {
      gpu: 0, // Will be set from recommendation
    },
  })

  // Calculate GPU recommendation based on model characteristics
  const gpuRecommendation = calculateGpuRecommendation(model, detailedCapacity)

  // Set initial GPU value from recommendation when component mounts
  useEffect(() => {
    if (config.resources?.gpu === 0 && gpuRecommendation.recommendedGpus > 0) {
      setConfig(prev => ({
        ...prev,
        resources: {
          ...prev.resources,
          gpu: gpuRecommendation.recommendedGpus
        }
      }))
    }
  }, [gpuRecommendation.recommendedGpus])

  // Auto-select matching premade model when navigating with a KAITO model from Models page
  useEffect(() => {
    if (premadeModels && premadeModels.length > 0 && !selectedPremadeModel) {
      // Try to match model.id (e.g., 'kaito/llama3.2-1b') to premade model id (e.g., 'llama3.2:1b')
      const modelIdWithoutPrefix = model.id.replace('kaito/', '').replace('-', ':');
      const matchingPremade = premadeModels.find(pm => pm.id === modelIdWithoutPrefix);
      if (matchingPremade) {
        setSelectedPremadeModel(matchingPremade);
        setConfig(prev => ({
          ...prev,
          name: generateDeploymentName(matchingPremade.id),
          modelId: matchingPremade.id,
          servedModelName: matchingPremade.modelName,
        }));
      }
    }
  }, [premadeModels, model.id, selectedPremadeModel])

  // Handle runtime change - update namespace and engine
  const handleRuntimeChange = (runtime: RuntimeId) => {
    setSelectedRuntime(runtime)
    const newAvailableEngines = model.supportedEngines.filter(
      (e): e is TraditionalEngine => RUNTIME_ENGINES[runtime].includes(e as TraditionalEngine)
    )
    const currentEngineSupported = newAvailableEngines.includes(config.engine as TraditionalEngine)

    setConfig(prev => ({
      ...prev,
      provider: runtime,
      namespace: RUNTIME_INFO[runtime].defaultNamespace,
      // Reset engine if current one isn't supported by new runtime
      engine: currentEngineSupported ? prev.engine : (newAvailableEngines[0] || 'vllm'),
      // Reset router mode if switching away from Dynamo
      routerMode: runtime === 'dynamo' ? prev.routerMode : 'none',
      // Reset to aggregated mode if switching to KAITO (disaggregated not supported)
      mode: runtime === 'kaito' ? 'aggregated' : prev.mode,
    }))

    // Reset KAITO-specific state when switching away from KAITO
    if (runtime !== 'kaito') {
      setSelectedPremadeModel(null)
      setKaitoComputeType('cpu')
    }

    // Reset AI Configurator state when switching away from Dynamo
    // This ensures optimization badges are cleared when changing providers
    if (runtime !== 'dynamo') {
      setAiConfigSupportedBackends(null)
      setAiConfigRecommendedBackend(null)
      setAiConfigRecommendedMode(null)
      setAiConfigRecommendedValues(null)
    }
  }

  // Handle premade model selection for KAITO (also used in auto-selection useEffect above)
  const handlePremadeModelSelect = useCallback((premadeModel: PremadeModel) => {
    setSelectedPremadeModel(premadeModel)
    setConfig(prev => ({
      ...prev,
      name: generateDeploymentName(premadeModel.id),
      modelId: premadeModel.id,
      servedModelName: premadeModel.modelName,
    }))
  }, [])

  // Use the handler to ensure it's not considered unused
  void handlePremadeModelSelect;

  // Keyboard shortcut: Cmd/Ctrl+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!createDeployment.isProcessing && !needsHfAuth) {
          formRef.current?.requestSubmit()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [createDeployment.isProcessing, needsHfAuth])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Build the deployment config, adding KAITO-specific fields if needed
      let deployConfig = { ...config }

      if (selectedRuntime === 'kaito') {
        if (isHuggingFaceGgufModel) {
          if (ggufRunMode === 'direct') {
            // Direct run mode - no Docker/build required
            // The runner image will download the model at runtime using huggingface:// URI
            deployConfig = {
              ...deployConfig,
              modelSource: 'huggingface',
              modelId: model.id,
              ggufFile: ggufFile,
              ggufRunMode: 'direct',
              computeType: kaitoComputeType,
            }
          } else {
            // Build mode - requires Docker and building an image

            // Check if build infrastructure (Docker) is available
            toast({
              title: 'Checking Build Infrastructure',
              description: 'Verifying Docker and build tools are available...',
            })

            const infraStatus = await aikitApi.getInfrastructureStatus()
            if (!infraStatus.ready) {
              const errorMsg = infraStatus.error ||
                (!infraStatus.builder.running ? 'Docker is not running. Please start Docker and try again.' :
                  !infraStatus.registry.ready ? 'Container registry is not available.' :
                 'Build infrastructure is not ready.')
              throw new Error(errorMsg)
            }

            // Build the image first
            toast({
              title: 'Building Image',
              description: `Building GGUF model image for ${model.id}. This may take a few minutes...`,
            })

            const buildResult = await aikitApi.build({
              modelSource: 'huggingface',
              modelId: model.id,
              ggufFile: ggufFile,
            })

            if (!buildResult.success || !buildResult.imageRef) {
              throw new Error(buildResult.error || 'Failed to build model image')
            }

            toast({
              title: 'Image Built Successfully',
              description: `Image: ${buildResult.imageRef}`,
              variant: 'success',
            })

            // Use the built image in the deployment config
            deployConfig = {
              ...deployConfig,
              modelSource: 'huggingface',
              modelId: model.id,
              ggufFile: ggufFile,
              ggufRunMode: 'build',
              imageRef: buildResult.imageRef,
              computeType: kaitoComputeType,
            }
          }
        } else if (isVllmModel) {
          // vLLM model via KAITO - GPU always required
          const gpuCount = config.resources?.gpu || 1;
          deployConfig = {
            ...deployConfig,
            modelSource: 'vllm',
            modelId: model.id,
            computeType: 'gpu',  // vLLM always requires GPU
            resources: { gpu: gpuCount },
            ...(maxModelLen && { maxModelLen }),
            ...(model.gated && config.hfTokenSecret && { hfTokenSecret: config.hfTokenSecret }),
          }
        } else {
          // Premade model
          deployConfig = {
            ...deployConfig,
            modelSource: 'premade',
            computeType: kaitoComputeType,
            premadeModel: selectedPremadeModel?.id,
          }
        }
      }

      await createDeployment.mutateAsync(deployConfig)

      // Trigger confetti celebration!
      triggerConfetti()

      toast({
        title: 'Deployment Created',
        description: `${config.name} is being deployed to ${config.namespace}`,
        variant: 'success',
      })

      // Delay navigation slightly to let user see confetti
      setTimeout(() => {
        navigate('/deployments')
      }, 1500)
    } catch (error) {
      toast({
        title: 'Deployment Failed',
        description: error instanceof Error ? error.message : 'Failed to create deployment',
        variant: 'destructive',
      })
    }
  }, [config, createDeployment, navigate, toast, triggerConfetti, selectedRuntime, kaitoComputeType, selectedPremadeModel, isHuggingFaceGgufModel, isVllmModel, model.id, model.gated, ggufFile, ggufRunMode, maxModelLen])

  const updateConfig = <K extends keyof DeploymentConfig>(
    key: K,
    value: DeploymentConfig[K]
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  // Handler for applying AI Configurator recommendations
  const handleApplyAIConfig = useCallback((result: AIConfiguratorResult) => {
    const cfg = result.config

    // Map AI Configurator backend to our engine type
    const backendToEngine: Record<string, Engine> = {
      'vllm': 'vllm',
      'sglang': 'sglang',
      'trtllm': 'trtllm',
    }
    const recommendedEngine = result.backend ? backendToEngine[result.backend] : undefined

    // Store supported backends info for engine selection UI
    if (result.supportedBackends) {
      setAiConfigSupportedBackends(result.supportedBackends)
    }
    if (result.backend) {
      setAiConfigRecommendedBackend(result.backend)
    }

    // Store recommended mode
    setAiConfigRecommendedMode(result.mode)

    // Store recommended values for badges
    setAiConfigRecommendedValues({
      prefillReplicas: cfg.prefillReplicas,
      decodeReplicas: cfg.decodeReplicas,
      prefillGpus: cfg.prefillTensorParallel || cfg.tensorParallelDegree,
      decodeGpus: cfg.decodeTensorParallel || cfg.tensorParallelDegree,
      gpuPerReplica: cfg.tensorParallelDegree,
    })

    setConfig(prev => ({
      ...prev,
      mode: result.mode,
      replicas: result.replicas,
      contextLength: cfg.maxModelLen,
      // Set engine if AI Configurator recommended one
      ...(recommendedEngine && { engine: recommendedEngine }),
      resources: {
        ...prev.resources,
        gpu: cfg.tensorParallelDegree,
      },
      // Disaggregated mode settings
      ...(result.mode === 'disaggregated' && {
        prefillReplicas: cfg.prefillReplicas || 1,
        decodeReplicas: cfg.decodeReplicas || 1,
        prefillGpus: cfg.prefillTensorParallel || cfg.tensorParallelDegree,
        decodeGpus: cfg.decodeTensorParallel || cfg.tensorParallelDegree,
      }),
      // Engine args for advanced settings
      engineArgs: {
        ...prev.engineArgs,
        'max-num-batched-tokens': cfg.maxBatchSize,
        'gpu-memory-utilization': cfg.gpuMemoryUtilization,
        ...(cfg.maxNumSeqs && { 'max-num-seqs': cfg.maxNumSeqs }),
      },
    }))

    const engineInfo = recommendedEngine ? `, Engine=${recommendedEngine.toUpperCase()}` : ''
    toast({
      title: 'Configuration Applied',
      description: `AI Configurator recommendations applied. TP=${cfg.tensorParallelDegree}, Context=${cfg.maxModelLen}${engineInfo}`,
      variant: 'success',
    })
  }, [toast])

  // Calculate total GPUs needed for the deployment
  const calculateSelectedGpus = (): number => {
    if (config.mode === 'disaggregated') {
      // For disaggregated, calculate total GPUs across all workers
      const prefillTotal = (config.prefillReplicas || 1) * (config.prefillGpus || 1);
      const decodeTotal = (config.decodeReplicas || 1) * (config.decodeGpus || 1);
      return prefillTotal + decodeTotal;
    }
    // For aggregated, multiply GPUs per replica by number of replicas
    const gpusPerReplica = config.resources?.gpu || gpuRecommendation.recommendedGpus || 1;
    const replicas = config.replicas || 1;
    return gpusPerReplica * replicas;
  }

  const selectedGpus = calculateSelectedGpus()

  // Calculate the maximum GPUs per single pod (for node placement constraints)
  const maxGpusPerPod = config.mode === 'disaggregated'
    ? Math.max(config.prefillGpus || 1, config.decodeGpus || 1)
    : (config.resources?.gpu || gpuRecommendation.recommendedGpus || 1);

  // Check if KAITO configuration is valid
  // For HuggingFace GGUF models, we need a ggufFile for both direct and build modes
  // For vLLM models, we need at least 1 GPU
  // For premade, we need a selected model
  const isKaitoConfigValid = selectedRuntime !== 'kaito' ||
    (isHuggingFaceGgufModel
      ? ggufFile.endsWith('.gguf')
      : isVllmModel
        ? (config.resources?.gpu || 0) >= 1
        : selectedPremadeModel !== null)

  // Status-aware button content
  const getButtonContent = () => {
    if (needsHfAuth && selectedRuntime !== 'kaito') {
      return 'HuggingFace Auth Required'
    }

    if (!isRuntimeInstalled) {
      return 'Runtime Not Installed'
    }

    if (selectedRuntime === 'kaito' && !isHuggingFaceGgufModel && !isVllmModel && !selectedPremadeModel) {
      return 'Select a Model'
    }

    if (selectedRuntime === 'kaito' && isHuggingFaceGgufModel && !ggufFile.endsWith('.gguf')) {
      return 'Select GGUF File'
    }

    if (selectedRuntime === 'kaito' && isVllmModel && (config.resources?.gpu || 0) < 1) {
      return 'Configure GPUs'
    }

    switch (createDeployment.status) {
      case 'validating':
        return 'Validating...'
      case 'submitting':
        return 'Deploying...'
      case 'success':
        return (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Deployed!
          </>
        )
      default:
        return (
          <>
            <Rocket className="h-4 w-4" />
            Deploy Model
            <kbd className="hidden sm:inline-flex ml-2 px-1.5 py-0.5 text-[10px] font-mono bg-primary-foreground/20 rounded">
              ⌘↵
            </kbd>
          </>
        )
    }
  }

  return (
    <>
      <ConfettiComponent count={60} />
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      {/* Gated Model Warning */}
      {needsHfAuth && (
        <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-yellow-800 dark:text-yellow-200">
                HuggingFace Authentication Required
              </h3>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                <strong>{model.name}</strong> is a gated model that requires HuggingFace authentication.
                Please{' '}
                  <a
                    href="/settings"
                  className="underline font-medium hover:text-yellow-900 dark:hover:text-yellow-100"
                >
                  sign in with HuggingFace
                </a>{' '}
                in Settings before deploying.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Runtime Selection */}
      {runtimes && runtimes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              Runtime
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {runtimes.map((runtime) => {
                const info = RUNTIME_INFO[runtime.id as RuntimeId]
                if (!info) return null

                const isCompatible = isRuntimeCompatible(runtime.id as RuntimeId, model.supportedEngines)
                const isSelected = selectedRuntime === runtime.id

                return (
                  <div
                    key={runtime.id}
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={isCompatible ? 0 : -1}
                    onClick={() => {
                      if (isCompatible) {
                        handleRuntimeChange(runtime.id as RuntimeId)
                      }
                    }}
                    onKeyDown={(e) => {
                      if (isCompatible && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault()
                        handleRuntimeChange(runtime.id as RuntimeId)
                      }
                    }}
                    className={cn(
                      "relative flex items-start space-x-3 rounded-lg border p-4 transition-colors",
                      !isCompatible && "opacity-50 cursor-not-allowed",
                      isCompatible && "cursor-pointer",
                      isCompatible && isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border",
                      isCompatible && !isSelected && "hover:border-muted-foreground/50",
                      isCompatible && !runtime.installed && "opacity-75"
                    )}
                  >
                    {/* Custom radio indicator */}
                    <div
                      className={cn(
                        "mt-1 h-4 w-4 rounded-full border flex items-center justify-center shrink-0",
                        isSelected ? "border-primary" : "border-muted-foreground/50",
                        !isCompatible && "opacity-50"
                      )}
                    >
                      {isSelected && (
                        <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "font-medium text-sm",
                            isCompatible ? "cursor-pointer" : "cursor-not-allowed"
                          )}
                        >
                          {info.name}
                        </span>
                        {!isCompatible ? (
                          <Badge variant="outline" className="text-muted-foreground border-muted text-xs">
                            Not Compatible
                          </Badge>
                        ) : runtime.installed ? (
                          <Badge variant="outline" className="text-green-600 border-green-500 text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Installed
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-500 text-xs">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Not Installed
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {info.description}
                      </p>
                      {!isCompatible && (
                        <p className="text-xs text-muted-foreground mt-1">
                          This model requires {model.supportedEngines.includes('llamacpp') ? 'llama.cpp' : model.supportedEngines.join('/')} which is not supported by this runtime.
                        </p>
                      )}
                      {isCompatible && !runtime.installed && isSelected && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-2">
                          <Link to="/installation" className="underline hover:no-underline">
                            Install {info.name}
                          </Link>{' '}
                          before deploying.
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Configurator Panel - only show for Dynamo runtime */}
      {selectedRuntime === 'dynamo' && (
        <AIConfiguratorPanel
          modelId={model.id}
          detailedCapacity={detailedCapacity}
          onApplyConfig={handleApplyAIConfig}
          onDiscard={() => {
            // Clear AI Configurator state when discarding
            setAiConfigSupportedBackends(null)
            setAiConfigRecommendedBackend(null)
            setAiConfigRecommendedMode(null)
            setAiConfigRecommendedValues(null)
          }}
        />
      )}

      {/* Basic Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Deployment Name</Label>
              <Input
                id="name"
                value={config.name}
                onChange={(e) => updateConfig('name', e.target.value)}
                placeholder="my-deployment"
                required
                pattern="^[a-z0-9]([-a-z0-9]*[a-z0-9])?$"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase letters, numbers, and hyphens only
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="namespace">Namespace</Label>
              <Input
                id="namespace"
                value={config.namespace}
                onChange={(e) => updateConfig('namespace', e.target.value)}
                placeholder={RUNTIME_INFO[selectedRuntime].defaultNamespace}
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Engine Selection - show for non-KAITO runtimes OR KAITO with vLLM models */}
      {(selectedRuntime !== 'kaito' || isVllmModel) && (
      <Card>
        <CardHeader>
          <CardTitle>Inference Engine</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedRuntime === 'kaito' && isVllmModel ? (
            // KAITO vLLM - only vLLM option
            <RadioGroup value="vllm" className="flex gap-4">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="vllm" id="engine-vllm" />
                <Label htmlFor="engine-vllm" className="cursor-pointer">
                  vLLM
                </Label>
              </div>
            </RadioGroup>
          ) : availableEngines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No compatible engines available for this model with {RUNTIME_INFO[selectedRuntime].name}.
            </p>
          ) : (
            <div className="space-y-3">
              <RadioGroup
                value={config.engine}
                onValueChange={(value) => {
                  // Only allow changing to supported backends if AI Configurator has set restrictions
                  if (!aiConfigSupportedBackends || aiConfigSupportedBackends.includes(value)) {
                    updateConfig('engine', value as Engine)
                  }
                }}
                className="grid gap-4 sm:grid-cols-3"
              >
                {availableEngines.map((engine) => {
                  const isUnavailable = aiConfigSupportedBackends !== null && !aiConfigSupportedBackends.includes(engine)
                  const isRecommended = aiConfigRecommendedBackend === engine

                  return (
                    <div
                      key={engine}
                      className={cn(
                        "flex items-center space-x-2",
                        isUnavailable && "opacity-50"
                      )}
                    >
                      <RadioGroupItem
                        value={engine}
                        id={engine}
                        disabled={isUnavailable}
                      />
                      <Label
                        htmlFor={engine}
                        className={cn(
                          isUnavailable ? "cursor-not-allowed" : "cursor-pointer",
                          "flex items-center gap-2"
                        )}
                      >
                        {engine === 'vllm' && 'vLLM'}
                        {engine === 'sglang' && 'SGLang'}
                        {engine === 'trtllm' && 'TensorRT-LLM'}
                        {isRecommended && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            <Sparkles className="h-3 w-3" />
                            Optimized
                          </span>
                        )}
                      </Label>
                    </div>
                  )
                })}
              </RadioGroup>
              {aiConfigSupportedBackends && aiConfigSupportedBackends.length < availableEngines.length && (
                <p className="text-xs text-muted-foreground">
                  Some engines are unavailable based on your GPU type. AI Configurator recommends {aiConfigRecommendedBackend?.toUpperCase()}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* KAITO Model Configuration - only show for KAITO runtime with non-vLLM models */}
      {selectedRuntime === 'kaito' && !isVllmModel && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="h-5 w-5" />
              KAITO Model Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Compute Type Selection - only for non-vLLM models (vLLM always requires GPU) */}
            <div className="space-y-3">
              <Label>Compute Type</Label>
              <RadioGroup
                value={kaitoComputeType}
                onValueChange={(value) => setKaitoComputeType(value as KaitoComputeType)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="cpu" id="compute-cpu" />
                  <Label htmlFor="compute-cpu" className="cursor-pointer flex items-center gap-1">
                    <Cpu className="h-4 w-4" />
                    CPU
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="gpu" id="compute-gpu" />
                  <Label htmlFor="compute-gpu" className="cursor-pointer flex items-center gap-1">
                    <Server className="h-4 w-4" />
                    GPU
                  </Label>
                </div>
              </RadioGroup>
              <p className="text-xs text-muted-foreground">
                  {kaitoComputeType === 'cpu'
                  ? 'Run inference on CPU nodes - slower but no GPU required'
                  : 'Run inference on GPU nodes - faster performance'}
              </p>
            </div>

            {/* Run Mode Selection - only for HuggingFace GGUF models */}
            {isHuggingFaceGgufModel && (
              <div className="space-y-3">
                <Label>Run Mode</Label>
                <RadioGroup
                  value={ggufRunMode}
                  onValueChange={(value) => setGgufRunMode(value as GgufRunMode)}
                  className="grid gap-3"
                >
                  <label
                    htmlFor="run-direct"
                    className={cn(
                      "flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors",
                      ggufRunMode === 'direct'
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    )}
                  >
                    <RadioGroupItem value="direct" id="run-direct" className="mt-1" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Direct Run</span>
                        <Badge variant="secondary" className="text-xs">Recommended</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Downloads model at runtime. No Docker required.
                      </p>
                    </div>
                  </label>
                  <label
                    htmlFor="run-build"
                    className={cn(
                      "flex items-start space-x-3 rounded-lg border p-3 cursor-pointer transition-colors",
                      ggufRunMode === 'build'
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-muted-foreground/50"
                    )}
                  >
                    <RadioGroupItem value="build" id="run-build" className="mt-1" />
                    <div className="flex-1">
                      <span className="font-medium">Build Image</span>
                      <p className="text-xs text-muted-foreground mt-1">
                        Pre-builds container image. Requires Docker running locally.
                      </p>
                    </div>
                  </label>
                </RadioGroup>
              </div>
            )}

            {/* GGUF File Selection - for HuggingFace GGUF models */}
            {isHuggingFaceGgufModel && (
              <div className="space-y-3">
                <Label htmlFor="ggufFile">GGUF File</Label>
                {ggufFilesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading GGUF files from repository...
                  </div>
                ) : ggufFiles.length > 0 ? (
                  <Select value={ggufFile} onValueChange={setGgufFile}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a GGUF file" />
                    </SelectTrigger>
                    <SelectContent>
                      {ggufFiles.map((file) => (
                        <SelectItem key={file} value={file}>
                          {file}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="text-sm text-muted-foreground py-2">
                    No GGUF files found in this repository.
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Select the quantization variant to use. Q4_K_M offers a good balance of quality and size.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Deployment Mode - show for non-KAITO runtimes OR KAITO with vLLM models */}
      {(selectedRuntime !== 'kaito' || isVllmModel) && (
      <Card>
        <CardHeader>
          <CardTitle>Deployment Mode</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={config.mode}
            onValueChange={(value) => {
              // Only allow changing mode for non-KAITO runtimes
              if (selectedRuntime !== 'kaito') {
                updateConfig('mode', value as DeploymentMode)
              }
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="flex items-start space-x-2">
              <RadioGroupItem value="aggregated" id="mode-aggregated" className="mt-1" />
              <div>
                <Label htmlFor="mode-aggregated" className="cursor-pointer font-medium flex items-center gap-2">
                  Aggregated (Standard)
                  {aiConfigRecommendedMode === 'aggregated' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      <Sparkles className="h-3 w-3" />
                      Optimized
                    </span>
                  )}
                </Label>
                <p className="text-xs text-muted-foreground">
                  Combined prefill and decode on same workers
                </p>
              </div>
            </div>
            <div className={cn("flex items-start space-x-2", selectedRuntime === 'kaito' && "opacity-50")}>
                  <RadioGroupItem
                    value="disaggregated"
                    id="mode-disaggregated"
                    className="mt-1"
                disabled={selectedRuntime === 'kaito'}
              />
              <div>
                    <Label
                      htmlFor="mode-disaggregated"
                  className={cn("font-medium flex items-center gap-2", selectedRuntime === 'kaito' ? "cursor-not-allowed" : "cursor-pointer")}
                >
                  Disaggregated (P/D)
                  {aiConfigRecommendedMode === 'disaggregated' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                      <Sparkles className="h-3 w-3" />
                      Optimized
                    </span>
                  )}
                </Label>
                <p className="text-xs text-muted-foreground">
                      {selectedRuntime === 'kaito'
                    ? 'Separate prefill and decode workers - not supported by KAITO'
                    : 'Separate prefill and decode workers for better resource utilization'}
                </p>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>
      )}

      {/* Deployment Options - show for all runtimes with vLLM/GPU */}
      {(selectedRuntime !== 'kaito' || isVllmModel || kaitoComputeType === 'gpu') && (
      <Card>
        <CardHeader>
          <CardTitle>Deployment Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.mode === 'aggregated' || selectedRuntime === 'kaito' ? (
            /* Aggregated mode: single replica count (KAITO always uses aggregated) */
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="replicas">Worker Replicas</Label>
                <Input
                  id="replicas"
                  type="number"
                  min={1}
                  max={10}
                  value={config.replicas}
                  onChange={(e) => updateConfig('replicas', parseInt(e.target.value) || 1)}
                />
              </div>

              {/* GPU per Replica with recommendation */}
              <GpuPerReplicaField
                id="gpusPerReplica"
                value={config.resources?.gpu || gpuRecommendation.recommendedGpus}
                onChange={(value) => {
                  setConfig(prev => ({
                    ...prev,
                    resources: {
                      ...prev.resources,
                      gpu: value
                    }
                  }))
                }}
                maxGpus={detailedCapacity?.maxNodeGpuCapacity || 8}
                recommendation={gpuRecommendation}
                aiConfigRecommended={aiConfigRecommendedValues?.gpuPerReplica}
              />

              {/* Router Mode is only applicable to Dynamo provider */}
              {selectedRuntime === 'dynamo' && (
                <div className="space-y-2">
                  <Label>Router Mode</Label>
                  <RadioGroup
                    value={config.routerMode}
                    onValueChange={(value) => updateConfig('routerMode', value as RouterMode)}
                    className="flex gap-4"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="none" id="router-none" />
                      <Label htmlFor="router-none" className="cursor-pointer">None</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="kv" id="router-kv" />
                      <Label htmlFor="router-kv" className="cursor-pointer">KV-Aware</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="round-robin" id="router-rr" />
                      <Label htmlFor="router-rr" className="cursor-pointer">Round Robin</Label>
                    </div>
                  </RadioGroup>
                </div>
              )}
            </div>
          ) : (
            /* Disaggregated mode: separate prefill/decode configuration */
            <div className="space-y-6">
              {/* Prefill Workers */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Prefill Workers</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="prefillReplicas" className="flex items-center gap-2">
                      Replicas
                      {aiConfigRecommendedValues?.prefillReplicas === config.prefillReplicas && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <Sparkles className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </Label>
                    <Input
                      id="prefillReplicas"
                      type="number"
                      min={1}
                      max={10}
                      value={config.prefillReplicas || 1}
                      onChange={(e) => updateConfig('prefillReplicas', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="prefillGpus" className="flex items-center gap-2">
                      GPUs per Worker
                      {aiConfigRecommendedValues?.prefillGpus === config.prefillGpus && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <Sparkles className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </Label>
                    <Input
                      id="prefillGpus"
                      type="number"
                      min={1}
                      max={8}
                      value={config.prefillGpus || 1}
                      onChange={(e) => updateConfig('prefillGpus', parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>
              </div>

              {/* Decode Workers */}
              <div className="space-y-3">
                <h4 className="font-medium text-sm">Decode Workers</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="decodeReplicas" className="flex items-center gap-2">
                      Replicas
                      {aiConfigRecommendedValues?.decodeReplicas === config.decodeReplicas && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <Sparkles className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </Label>
                    <Input
                      id="decodeReplicas"
                      type="number"
                      min={1}
                      max={10}
                      value={config.decodeReplicas || 1}
                      onChange={(e) => updateConfig('decodeReplicas', parseInt(e.target.value) || 1)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="decodeGpus" className="flex items-center gap-2">
                      GPUs per Worker
                      {aiConfigRecommendedValues?.decodeGpus === config.decodeGpus && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                          <Sparkles className="h-2.5 w-2.5" />
                        </span>
                      )}
                    </Label>
                    <Input
                      id="decodeGpus"
                      type="number"
                      min={1}
                      max={8}
                      value={config.decodeGpus || 1}
                      onChange={(e) => updateConfig('decodeGpus', parseInt(e.target.value) || 1)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Advanced Options - show for non-KAITO runtimes OR KAITO with vLLM models */}
      {(selectedRuntime !== 'kaito' || isVllmModel) && (
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          <div className="flex items-center justify-between">
            <CardTitle>Advanced Options</CardTitle>
              <ChevronDown
              className={cn(
                "h-5 w-5 text-muted-foreground transition-transform duration-200 ease-out",
                showAdvanced && "rotate-180"
                )}
            />
          </div>
        </CardHeader>

        {/* Smooth accordion animation */}
          <div
          className={cn(
            "grid transition-all duration-300 ease-out-expo",
            showAdvanced ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden">
            <CardContent className="space-y-4 pt-0">
            {/* These options only apply to non-KAITO runtimes */}
            {selectedRuntime !== 'kaito' && (
              <>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enforce Eager Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      Use eager mode for faster startup
                    </p>
                  </div>
                  <Switch
                    checked={config.enforceEager}
                    onCheckedChange={(checked) => updateConfig('enforceEager', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Prefix Caching</Label>
                    <p className="text-xs text-muted-foreground">
                      Cache common prefixes for faster inference
                    </p>
                  </div>
                  <Switch
                    checked={config.enablePrefixCaching}
                    onCheckedChange={(checked) => updateConfig('enablePrefixCaching', checked)}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Trust Remote Code</Label>
                    <p className="text-xs text-muted-foreground">
                      Required for some models with custom code
                    </p>
                  </div>
                  <Switch
                    checked={config.trustRemoteCode}
                    onCheckedChange={(checked) => updateConfig('trustRemoteCode', checked)}
                  />
                </div>
              </>
            )}

            {/* Context Length - shown for all runtimes, but uses different state for KAITO */}
            <div className="space-y-2">
              <Label htmlFor="contextLength">Context Length (optional)</Label>
              <Input
                id="contextLength"
                type="number"
                placeholder={model.contextLength?.toString() || 'Default'}
                value={selectedRuntime === 'kaito' ? (maxModelLen || '') : (config.contextLength || '')}
                onChange={(e) => {
                  const value = e.target.value ? parseInt(e.target.value) : undefined
                  if (selectedRuntime === 'kaito') {
                    setMaxModelLen(value)
                  } else {
                    updateConfig('contextLength', value)
                  }
                }}
              />
            </div>
            </CardContent>
          </div>
        </div>
      </Card>
      )}

        {/* Capacity Warning - only show for non-KAITO or KAITO with GPU/vLLM */}
        {detailedCapacity && (selectedRuntime !== 'kaito' || kaitoComputeType === 'gpu' || isVllmModel) && (
          <CapacityWarning
            selectedGpus={selectedGpus}
            capacity={detailedCapacity}
            autoscaler={autoscaler}
            maxGpusPerPod={maxGpusPerPod}
            deploymentMode={config.mode}
            replicas={config.replicas}
            gpusPerReplica={config.resources?.gpu || gpuRecommendation.recommendedGpus || 1}
          />
        )}

        {/* Manifest Preview - build config with KAITO-specific fields */}
        {(() => {
          // Build preview config with all necessary fields
          let previewConfig = { ...config };
          
          if (selectedRuntime === 'kaito') {
            if (isHuggingFaceGgufModel) {
              previewConfig = {
                ...previewConfig,
                modelSource: 'huggingface' as const,
                modelId: model.id,
                ggufFile: ggufFile,
                ggufRunMode: ggufRunMode,
                computeType: kaitoComputeType,
              };
            } else if (isVllmModel) {
              previewConfig = {
                ...previewConfig,
                modelSource: 'vllm' as const,
                modelId: model.id,
                computeType: 'gpu' as const,
                ...(maxModelLen && { maxModelLen }),
              };
            } else if (selectedPremadeModel) {
              previewConfig = {
                ...previewConfig,
                modelSource: 'premade' as const,
                computeType: kaitoComputeType,
                premadeModel: selectedPremadeModel.id,
              };
            }
          }
          
          return (
            <ManifestViewer 
              mode="preview"
              config={previewConfig}
              provider={selectedRuntime}
            />
          );
        })()}
        {/* Cost Estimate - show for GPU and CPU deployments */}
        {(selectedRuntime === 'kaito') && (
          <CostEstimate
            nodePools={detailedCapacity?.nodePools}
            gpuCount={config.mode === 'disaggregated' 
              ? Math.max(config.prefillGpus || 1, config.decodeGpus || 1)
              : (config.resources?.gpu || gpuRecommendation.recommendedGpus || 1)}
            replicas={config.mode === 'disaggregated'
              ? (config.prefillReplicas || 1) + (config.decodeReplicas || 1)
              : config.replicas}
            computeType={kaitoComputeType === 'cpu' && !isVllmModel ? 'cpu' : 'gpu'}
          />
        )}
        {/* Cost Estimate for non-KAITO runtimes (always GPU) */}
        {selectedRuntime !== 'kaito' && detailedCapacity && detailedCapacity.nodePools.length > 0 && (
          <CostEstimate
            nodePools={detailedCapacity.nodePools}
            gpuCount={config.mode === 'disaggregated' 
              ? Math.max(config.prefillGpus || 1, config.decodeGpus || 1)
              : (config.resources?.gpu || gpuRecommendation.recommendedGpus || 1)}
            replicas={config.mode === 'disaggregated'
              ? (config.prefillReplicas || 1) + (config.decodeReplicas || 1)
              : config.replicas}
            computeType="gpu"
          />
        )}

      {/* Submit Button */}
      <div className="flex gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/')}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={createDeployment.isProcessing || (needsHfAuth && selectedRuntime !== 'kaito') || !isRuntimeInstalled || !isKaitoConfigValid}
          loading={createDeployment.isProcessing}
          className={cn(
            "flex-1 gap-2",
            createDeployment.status === 'success' && "bg-green-600 hover:bg-green-600"
          )}
        >
          {getButtonContent()}
        </Button>
      </div>
    </form>
    </>
  )
}
