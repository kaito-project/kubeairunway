import { useState } from 'react'
import { useSettings, useUpdateSettings, useProviderDetails } from '@/hooks/useSettings'
import { useClusterStatus } from '@/hooks/useClusterStatus'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/useToast'
import { CheckCircle, XCircle, AlertCircle, Loader2, Server, Settings as SettingsIcon, Terminal } from 'lucide-react'

export function SettingsPage() {
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const { data: clusterStatus, isLoading: clusterLoading } = useClusterStatus()
  const updateSettings = useUpdateSettings()
  const { toast } = useToast()

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const activeProviderId = selectedProviderId || settings?.config.activeProviderId || 'dynamo'

  const { data: providerDetails } = useProviderDetails(activeProviderId)

  const handleProviderChange = async (newProviderId: string) => {
    setSelectedProviderId(newProviderId)
    try {
      await updateSettings.mutateAsync({ activeProviderId: newProviderId })
      toast({
        title: 'Settings updated',
        description: `Active provider changed to ${newProviderId}`,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update settings',
        variant: 'destructive',
      })
    }
  }

  if (settingsLoading || clusterLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const providerInstallation = clusterStatus?.providerInstallation
  const isInstalled = providerInstallation?.installed ?? false

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your inference provider and application settings.
        </p>
      </div>

      {/* Cluster Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Cluster Status
          </CardTitle>
          <CardDescription>
            Current Kubernetes cluster connection and provider status
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
              <span className="text-sm text-muted-foreground">{clusterStatus.clusterName}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Active Provider</span>
            <Badge variant={isInstalled ? 'default' : 'destructive'}>
              {clusterStatus?.provider?.name || 'Unknown'}
            </Badge>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Provider Status</span>
            <div className="flex items-center gap-2">
              {isInstalled ? (
                <>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-green-600">Installed</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm text-yellow-600">Not Installed</span>
                </>
              )}
            </div>
          </div>

          {providerInstallation?.message && (
            <div className="rounded-lg bg-muted p-3 text-sm">
              {providerInstallation.message}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Provider Selection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Provider Settings
          </CardTitle>
          <CardDescription>
            Select and configure your inference provider
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="provider">Active Provider</Label>
            <Select
              value={activeProviderId}
              onValueChange={handleProviderChange}
              disabled={updateSettings.isPending}
            >
              <SelectTrigger id="provider">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                {settings?.providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {providerDetails?.description && (
              <p className="text-sm text-muted-foreground">{providerDetails.description}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="namespace">Default Namespace</Label>
            <Input
              id="namespace"
              value={settings?.config.defaultNamespace || providerDetails?.defaultNamespace || ''}
              placeholder={providerDetails?.defaultNamespace || 'default'}
              disabled
            />
            <p className="text-xs text-muted-foreground">
              The default Kubernetes namespace for deployments
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Installation Instructions */}
      {!isInstalled && providerDetails && (
        <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-800 dark:text-yellow-200">
              <AlertCircle className="h-5 w-5" />
              Provider Not Installed
            </CardTitle>
            <CardDescription className="text-yellow-700 dark:text-yellow-300">
              The {providerDetails.name} provider is not installed in your cluster. Follow the steps below to install it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {providerDetails.installationSteps.map((step, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-yellow-200 text-xs font-semibold text-yellow-800 dark:bg-yellow-800 dark:text-yellow-200">
                    {index + 1}
                  </span>
                  <span className="font-medium text-yellow-800 dark:text-yellow-200">{step.title}</span>
                </div>
                <p className="ml-8 text-sm text-yellow-700 dark:text-yellow-300">{step.description}</p>
                {step.command && (
                  <div className="ml-8 flex items-center gap-2">
                    <code className="flex-1 rounded bg-yellow-100 px-3 py-2 text-sm font-mono text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100">
                      {step.command}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(step.command!)
                        toast({
                          title: 'Copied',
                          description: 'Command copied to clipboard',
                        })
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Provider Details */}
      {providerDetails && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              Provider Details
            </CardTitle>
            <CardDescription>
              Technical details about the {providerDetails.name} provider
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">API Group:</span>
                <span className="ml-2 text-muted-foreground">{providerDetails.crdConfig.apiGroup}</span>
              </div>
              <div>
                <span className="font-medium">API Version:</span>
                <span className="ml-2 text-muted-foreground">{providerDetails.crdConfig.apiVersion}</span>
              </div>
              <div>
                <span className="font-medium">CRD Kind:</span>
                <span className="ml-2 text-muted-foreground">{providerDetails.crdConfig.kind}</span>
              </div>
              <div>
                <span className="font-medium">Resource Plural:</span>
                <span className="ml-2 text-muted-foreground">{providerDetails.crdConfig.plural}</span>
              </div>
            </div>

            {providerDetails.helmRepos.length > 0 && (
              <div>
                <span className="font-medium text-sm">Helm Repositories:</span>
                <div className="mt-2 space-y-1">
                  {providerDetails.helmRepos.map((repo, index) => (
                    <div key={index} className="text-sm text-muted-foreground">
                      <span className="font-mono">{repo.name}</span>: {repo.url}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
