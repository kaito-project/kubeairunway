import { useState, useEffect } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { useRuntimesStatus } from '@/hooks/useRuntimes'
import { useClusterStatus } from '@/hooks/useClusterStatus'
import {
  useHelmStatus,
  useProviderInstallationStatus,
  useInstallProvider,
  useUninstallProvider,
} from '@/hooks/useInstallation'
import { useAutoscalerDetection } from '@/hooks/useAutoscaler'
import { useGpuOperatorStatus, useInstallGpuOperator } from '@/hooks/useGpuOperator'
import { useHuggingFaceStatus, useHuggingFaceOAuth, useDeleteHuggingFaceSecret } from '@/hooks/useHuggingFace'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AutoscalerGuidance } from '@/components/autoscaler/AutoscalerGuidance'
import { useToast } from '@/hooks/useToast'
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Server,
  Cpu,
  Key,
  Cog,
  Layers,
  Download,
  RefreshCw,
  Copy,
  Zap,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSearchParams } from 'react-router-dom'

type SettingsTab = 'general' | 'runtimes' | 'integrations'
type RuntimeId = 'dynamo' | 'kuberay' | 'kaito'

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoading: settingsLoading } = useSettings()
  const { data: runtimesStatus, isLoading: runtimesLoading } = useRuntimesStatus()
  const { data: clusterStatus, isLoading: clusterLoading } = useClusterStatus()
  const { data: helmStatus, isLoading: helmLoading } = useHelmStatus()
  const { data: autoscaler, isLoading: autoscalerLoading } = useAutoscalerDetection()
  const { data: gpuOperatorStatus, isLoading: gpuStatusLoading, refetch: refetchGpuStatus } = useGpuOperatorStatus()
  const { data: hfStatus, isLoading: hfStatusLoading, refetch: refetchHfStatus } = useHuggingFaceStatus()
  const { startOAuth } = useHuggingFaceOAuth()
  const deleteHfSecret = useDeleteHuggingFaceSecret()
  const installGpuOperator = useInstallGpuOperator()
  const { toast } = useToast()

  const [isInstallingGpu, setIsInstallingGpu] = useState(false)
  const [isConnectingHf, setIsConnectingHf] = useState(false)
  
  // Tab state from URL params or default
  const tabFromUrl = searchParams.get('tab') as SettingsTab | null
  const [activeTab, setActiveTab] = useState<SettingsTab>(tabFromUrl || 'general')
  
  // Runtime installation state
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId | null>(null)
  const [isInstalling, setIsInstalling] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [showUninstallDialog, setShowUninstallDialog] = useState(false)

  const runtimes = runtimesStatus?.runtimes || []
  const installedCount = runtimes.filter(r => r.installed).length
  const helmAvailable = helmStatus?.available ?? false

  // Set default runtime once data is loaded
  useEffect(() => {
    if (runtimesStatus?.runtimes && selectedRuntime === null) {
      const installedRuntime = runtimes.find(r => r.installed)
      if (installedRuntime) {
        setSelectedRuntime(installedRuntime.id as RuntimeId)
      } else {
        setSelectedRuntime('dynamo')
      }
    }
  }, [runtimesStatus, selectedRuntime, runtimes])

  // Update URL when tab changes
  useEffect(() => {
    if (activeTab !== 'general') {
      setSearchParams({ tab: activeTab })
    } else {
      setSearchParams({})
    }
  }, [activeTab, setSearchParams])

  const effectiveRuntime = selectedRuntime || 'dynamo'

  const {
    data: installationStatus,
    isLoading: installationLoading,
    refetch: refetchInstallation,
  } = useProviderInstallationStatus(effectiveRuntime)

  const installProvider = useInstallProvider()
  const uninstallProvider = useUninstallProvider()

  const handleInstall = async (providerId: RuntimeId) => {
    setIsInstalling(true)
    try {
      const result = await installProvider.mutateAsync(providerId)
      if (result.success) {
        toast({ title: 'Installation Complete', description: result.message })
        refetchInstallation()
      } else {
        toast({ title: 'Installation Failed', description: result.message, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Installation Error', description: error instanceof Error ? error.message : 'Unknown error occurred', variant: 'destructive' })
    } finally {
      setIsInstalling(false)
    }
  }

  const handleUninstall = async (providerId: RuntimeId) => {
    setIsUninstalling(true)
    setShowUninstallDialog(false)
    try {
      const result = await uninstallProvider.mutateAsync(providerId)
      if (result.success) {
        toast({ title: 'Uninstall Complete', description: result.message })
        refetchInstallation()
      } else {
        toast({ title: 'Uninstall Failed', description: result.message, variant: 'destructive' })
      }
    } catch (error) {
      toast({ title: 'Uninstall Error', description: error instanceof Error ? error.message : 'Unknown error occurred', variant: 'destructive' })
    } finally {
      setIsUninstalling(false)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: 'Copied', description: 'Command copied to clipboard' })
  }

  const isInstalled = installationStatus?.installed ?? false

  if (settingsLoading || clusterLoading || runtimesLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Cog className="h-7 w-7 text-muted-foreground" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure your inference runtimes and application settings.
          </p>
        </div>
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'general' as const, label: 'General', icon: Server },
    { id: 'runtimes' as const, label: 'Runtimes', icon: Layers },
    { id: 'integrations' as const, label: 'Integrations', icon: Key },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Cog className="h-7 w-7 text-muted-foreground" />
          Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure your inference runtimes and application settings.
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 border-b-2 -mb-px rounded-t-md',
              activeTab === tab.id
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <tab.icon className={cn(
              "h-4 w-4 transition-transform duration-200",
              activeTab === tab.id && "scale-110"
            )} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* General Tab */}
      {activeTab === 'general' && (
        <div className="space-y-6 animate-fade-in">
          {/* Cluster Status */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Cluster Status
              </CardTitle>
              <CardDescription>
                Current Kubernetes cluster connection status
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Connection</span>
                <div className="flex items-center gap-2">
                  {clusterStatus?.connected ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">Connected</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-sm text-red-600">Disconnected</span>
                    </>
                  )}
                </div>
              </div>

              {clusterStatus?.clusterName && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Cluster</span>
                  <span className="text-sm text-muted-foreground font-mono">{clusterStatus.clusterName}</span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Runtimes Installed</span>
                <Badge variant={installedCount > 0 ? 'default' : 'secondary'}>
                  {installedCount} of {runtimes.length}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Runtimes Tab */}
      {activeTab === 'runtimes' && (
        <div className="space-y-6 animate-fade-in">
          {/* Prerequisites */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5" />
                Prerequisites
              </CardTitle>
              <CardDescription>
                Required components for runtime installation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Kubernetes Cluster</span>
                <div className="flex items-center gap-2">
                  {clusterStatus?.connected ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">Connected</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-sm text-red-600">Not Connected</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Helm CLI</span>
                  {helmStatus?.version && (
                    <span className="text-xs text-muted-foreground">({helmStatus.version})</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {helmLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : helmAvailable ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-sm text-green-600">Available</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-sm text-red-600">Not Found</span>
                    </>
                  )}
                </div>
              </div>

              {!helmAvailable && helmStatus?.error && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
                  {helmStatus.error}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cluster Autoscaling Status */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Cluster Autoscaling
                </div>
                {autoscalerLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : autoscaler?.detected ? (
                  <Badge variant={autoscaler.healthy ? 'default' : 'destructive'}>
                    {autoscaler.healthy ? 'Healthy' : 'Unhealthy'}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not Detected</Badge>
                )}
              </CardTitle>
              <CardDescription>
                Automatically provision GPU nodes when deployments require more resources
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {autoscalerLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                      <span>Status</span>
                      <div className="flex items-center gap-2">
                        {autoscaler?.detected ? (
                          <>
                            {autoscaler.healthy ? (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-yellow-500" />
                            )}
                            <span className="font-medium">
                              {autoscaler.type === 'aks-managed' ? 'AKS Managed' : 'Cluster Autoscaler'}
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 text-gray-400" />
                            <span className="text-muted-foreground">Not Detected</span>
                          </>
                        )}
                      </div>
                    </div>

                    {autoscaler?.detected && autoscaler.nodeGroupCount !== undefined && (
                      <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                        <span>Node Pools</span>
                        <span className="font-medium">{autoscaler.nodeGroupCount}</span>
                      </div>
                    )}

                    {autoscaler?.message && (
                      <div className={cn(
                        'rounded-lg p-3 text-sm',
                        autoscaler.healthy
                          ? 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                          : autoscaler.detected
                            ? 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200'
                            : 'bg-muted text-muted-foreground'
                      )}>
                        {autoscaler.message}
                      </div>
                    )}
                  </div>

                  {autoscaler && !autoscaler.detected && (
                    <AutoscalerGuidance autoscaler={autoscaler} />
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Runtimes Overview */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Available Runtimes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {runtimes.map((runtime) => (
                <Card
                  key={runtime.id}
                  className={cn(
                    'transition-all cursor-pointer',
                    effectiveRuntime === runtime.id
                      ? 'ring-2 ring-primary'
                      : 'hover:border-primary/50'
                  )}
                  onClick={() => setSelectedRuntime(runtime.id as RuntimeId)}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center justify-between">
                      <span>{runtime.name}</span>
                      <Badge variant={runtime.installed ? (runtime.healthy ? 'default' : 'secondary') : 'destructive'}>
                        {runtime.installed ? (runtime.healthy ? 'Healthy' : 'Unhealthy') : 'Not Installed'}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {runtime.id === 'kaito'
                        ? 'Kubernetes AI Toolchain Operator for simplified model deployment'
                        : runtime.id === 'dynamo'
                          ? 'NVIDIA Dynamo for high-performance GPU inference'
                          : 'Ray Serve via KubeRay for distributed Ray-based model serving with vLLM'}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">CRD</span>
                        {runtime.installed ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Operator</span>
                        {runtime.healthy ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                      </div>
                      {runtime.version && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Version</span>
                          <span className="font-mono text-xs">{runtime.version}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Selected Runtime Installation Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download className="h-5 w-5" />
                  {installationStatus?.providerName || runtimes.find(r => r.id === effectiveRuntime)?.name || 'Runtime'} Installation
                </div>
                <Badge variant={isInstalled ? 'default' : 'destructive'}>
                  {isInstalled ? 'Installed' : 'Not Installed'}
                </Badge>
              </CardTitle>
              <CardDescription>
                {installationStatus?.message || 'Checking installation status...'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {installationLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                      <span>CRD Installed</span>
                      {installationStatus?.crdFound ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-muted p-3">
                      <span>Operator Running</span>
                      {installationStatus?.operatorRunning ? (
                        <CheckCircle className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    {!isInstalled && (
                      <Button
                        onClick={() => handleInstall(effectiveRuntime)}
                        disabled={isInstalling || !helmAvailable || !clusterStatus?.connected}
                        className="flex items-center gap-2"
                      >
                        {isInstalling ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Installing...
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4" />
                            Install {runtimes.find(r => r.id === effectiveRuntime)?.name || 'Runtime'}
                          </>
                        )}
                      </Button>
                    )}

                    {isInstalled && (
                      <Button
                        variant="destructive"
                        onClick={() => setShowUninstallDialog(true)}
                        disabled={isUninstalling || !helmAvailable || !clusterStatus?.connected}
                        className="flex items-center gap-2"
                      >
                        {isUninstalling ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Uninstalling...
                          </>
                        ) : (
                          <>
                            <Trash2 className="h-4 w-4" />
                            Uninstall
                          </>
                        )}
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      onClick={() => refetchInstallation()}
                      disabled={installationLoading}
                    >
                      <RefreshCw className={cn('h-4 w-4', installationLoading && 'animate-spin')} />
                    </Button>
                  </div>

                  {!helmAvailable && (
                    <div className="flex items-start gap-2 rounded-lg bg-yellow-50 p-4 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
                      <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium">Helm CLI not available</p>
                        <p className="mt-1">
                          Automatic installation requires Helm. You can install the runtime manually using the commands below.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Installation Steps */}
          {installationStatus?.installationSteps && installationStatus.installationSteps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Manual Installation Steps</CardTitle>
                <CardDescription>
                  Detailed steps for installing {installationStatus.providerName}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {installationStatus.installationSteps.map((step, index) => (
                  <div key={index} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                        {index + 1}
                      </span>
                      <span className="font-medium">{step.title}</span>
                    </div>
                    <p className="ml-8 text-sm text-muted-foreground">{step.description}</p>
                    {step.command && (
                      <div className="ml-8 flex items-center gap-2">
                        <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono">{step.command}</code>
                        <Button variant="ghost" size="sm" onClick={() => copyToClipboard(step.command!)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Integrations Tab */}
      {activeTab === 'integrations' && (
        <div className="space-y-6 animate-fade-in">
          {/* GPU Operator */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5" />
                NVIDIA GPU Operator
              </CardTitle>
              <CardDescription>
                Install the NVIDIA GPU Operator to enable GPU support in your cluster
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Prerequisites check */}
              {(!clusterStatus?.connected || !helmStatus?.available) && (
                <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">Prerequisites not met</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    {!clusterStatus?.connected && (
                      <li>Kubernetes cluster not connected</li>
                    )}
                    {!helmStatus?.available && (
                      <li>Helm CLI not available</li>
                    )}
                  </ul>
                </div>
              )}

              {/* GPU Status Display */}
              {gpuStatusLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Checking GPU status...</span>
                </div>
              ) : gpuOperatorStatus?.gpusAvailable ? (
                // GPUs are already available
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">GPU Status</span>
                    <Badge variant="default" className="bg-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      GPUs Enabled
                    </Badge>
                  </div>
                  <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3 text-sm text-green-800 dark:text-green-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      <span>{gpuOperatorStatus.message}</span>
                    </div>
                    {gpuOperatorStatus.gpuNodes.length > 0 && (
                      <div className="mt-2 text-xs">
                        Nodes: {gpuOperatorStatus.gpuNodes.join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              ) : gpuOperatorStatus?.installed ? (
                // Operator installed but no GPUs detected
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">GPU Status</span>
                    <Badge variant="secondary">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Operator Installed
                    </Badge>
                  </div>
                  <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      <span>{gpuOperatorStatus.message}</span>
                    </div>
                  </div>
                </div>
              ) : (
                // Not installed - show install option
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="gpu-operator-switch">Enable GPU Operator</Label>
                      <p className="text-xs text-muted-foreground">
                        Automatically installs the NVIDIA GPU Operator via Helm
                      </p>
                    </div>
                    <Switch
                      id="gpu-operator-switch"
                      checked={false}
                      disabled={!clusterStatus?.connected || !helmStatus?.available || isInstallingGpu}
                      onCheckedChange={async (checked) => {
                        if (checked) {
                          setIsInstallingGpu(true)
                          try {
                            const result = await installGpuOperator.mutateAsync()
                            if (result.success) {
                              toast({
                                title: 'GPU Operator Installed',
                                description: result.message,
                              })
                              refetchGpuStatus()
                            }
                          } catch (error) {
                            toast({
                              title: 'Installation Failed',
                              description: error instanceof Error ? error.message : 'Unknown error',
                              variant: 'destructive',
                            })
                          } finally {
                            setIsInstallingGpu(false)
                          }
                        }
                      }}
                    />
                  </div>

                  {isInstallingGpu && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Installing GPU Operator... This may take several minutes.</span>
                    </div>
                  )}

                  {/* Manual installation commands */}
                  {gpuOperatorStatus?.helmCommands && gpuOperatorStatus.helmCommands.length > 0 && (
                    <div className="space-y-2">
                      <span className="text-sm font-medium">Manual Installation</span>
                      <div className="space-y-1">
                        {gpuOperatorStatus.helmCommands.map((cmd, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <code className="flex-1 rounded bg-muted px-3 py-2 text-xs font-mono">
                              {cmd}
                            </code>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                navigator.clipboard.writeText(cmd)
                                toast({
                                  title: 'Copied',
                                  description: 'Command copied to clipboard',
                                })
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* HuggingFace Token */}
          <Card variant="elevated">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                HuggingFace Token
              </CardTitle>
              <CardDescription>
                Connect your HuggingFace account to access gated models like Llama
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {hfStatusLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Checking HuggingFace connection...</span>
                </div>
              ) : hfStatus?.configured ? (
                // Connected state - token exists in K8s secrets
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {hfStatus.user?.avatarUrl ? (
                        <img
                          src={hfStatus.user.avatarUrl}
                          alt={hfStatus.user.name}
                          className="h-10 w-10 rounded-full"
                        />
                      ) : (
                        <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                          <Key className="h-5 w-5 text-muted-foreground" />
                        </div>
                      )}
                      <div>
                        {hfStatus.user ? (
                          <>
                            <div className="font-medium">{hfStatus.user.fullname || hfStatus.user.name}</div>
                            <div className="text-sm text-muted-foreground">@{hfStatus.user.name}</div>
                          </>
                        ) : (
                          <>
                            <div className="font-medium">HuggingFace Token</div>
                            <div className="text-sm text-muted-foreground">Token configured</div>
                          </>
                        )}
                      </div>
                    </div>
                    <Badge variant="default" className="bg-green-500">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Connected
                    </Badge>
                  </div>

                  <div className="rounded-lg bg-green-50 dark:bg-green-950 p-3 text-sm text-green-800 dark:text-green-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      <span>Token saved in {hfStatus.namespaces.filter(n => n.exists).length} namespace(s)</span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      try {
                        await deleteHfSecret.mutateAsync()
                        toast({
                          title: 'Disconnected',
                          description: 'HuggingFace token has been removed',
                        })
                        refetchHfStatus()
                      } catch (error) {
                        toast({
                          title: 'Error',
                          description: error instanceof Error ? error.message : 'Failed to disconnect',
                          variant: 'destructive',
                        })
                      }
                    }}
                    disabled={deleteHfSecret.isPending}
                  >
                    {deleteHfSecret.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Disconnecting...
                      </>
                    ) : (
                      'Disconnect HuggingFace'
                    )}
                  </Button>
                </div>
              ) : (
                // Not connected state
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    Sign in with HuggingFace to automatically configure your token for accessing gated models.
                    The token will be securely stored as a Kubernetes secret.
                  </div>

                  <Button
                    onClick={async () => {
                      setIsConnectingHf(true)
                      try {
                        await startOAuth()
                      } catch (error) {
                        toast({
                          title: 'Error',
                          description: error instanceof Error ? error.message : 'Failed to start OAuth',
                          variant: 'destructive',
                        })
                        setIsConnectingHf(false)
                      }
                    }}
                    disabled={isConnectingHf}
                    className="bg-[#FFD21E] hover:bg-[#FFD21E]/90 text-black"
                  >
                    {isConnectingHf ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Redirecting...
                      </>
                    ) : (
                      <>
                        <svg className="h-5 w-5 mr-2" viewBox="0 0 95 88" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M47.2119 76.5C54.4518 76.5 60.7119 70.24 60.7119 63V50.5H47.2119C39.9719 50.5 33.7119 56.76 33.7119 64C33.7119 70.9 39.6319 76.5 47.2119 76.5Z" fill="currentColor"/>
                          <path d="M47.2119 88C61.5765 88 73.2119 76.3645 73.2119 62C73.2119 47.6355 61.5765 36 47.2119 36C32.8474 36 21.2119 47.6355 21.2119 62C21.2119 76.3645 32.8474 88 47.2119 88Z" fill="currentColor"/>
                          <ellipse cx="35.7119" cy="30" rx="12" ry="12" fill="currentColor"/>
                          <ellipse cx="59.7119" cy="30" rx="12" ry="12" fill="currentColor"/>
                          <ellipse cx="35.7119" cy="30" rx="5" ry="5" fill="white"/>
                          <ellipse cx="59.7119" cy="30" rx="5" ry="5" fill="white"/>
                        </svg>
                        Sign in with Hugging Face
                      </>
                    )}
                  </Button>

                  {hfStatus?.configured && !hfStatus.user && (
                    <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        <span>Token exists but could not be validated. Try reconnecting.</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Uninstall Confirmation Dialog */}
      <Dialog open={showUninstallDialog} onOpenChange={setShowUninstallDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall Runtime</DialogTitle>
            <DialogDescription>
              Are you sure you want to uninstall {runtimes.find(r => r.id === effectiveRuntime)?.name || 'this runtime'}?
              This will remove the operator and all associated resources from your cluster.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUninstallDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => handleUninstall(effectiveRuntime)}>
              Uninstall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
