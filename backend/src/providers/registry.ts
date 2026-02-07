/**
 * Provider registry - defines helm charts, installation steps,
 * and CRD metadata for each inference provider.
 */
import type { ProviderDetails } from '@kubefoundry/shared';

const KAITO_VERSION = '0.8.0';
const DYNAMO_VERSION = '0.7.1';
const KUBERAY_VERSION = '1.3.0';

const providers: Record<string, ProviderDetails> = {
  kaito: {
    id: 'kaito',
    name: 'KAITO',
    description: 'Kubernetes AI Toolchain Operator for simplified model deployment',
    defaultNamespace: 'kaito-workspace',
    crdConfig: {
      apiGroup: 'kaito.sh',
      apiVersion: 'v1beta1',
      plural: 'workspaces',
      kind: 'Workspace',
    },
    helmRepos: [
      { name: 'kaito', url: 'https://kaito-project.github.io/kaito/charts/kaito' },
    ],
    helmCharts: [
      {
        name: 'kaito-workspace',
        chart: 'kaito/workspace',
        version: KAITO_VERSION,
        namespace: 'kaito-workspace',
        createNamespace: true,
      },
    ],
    installationSteps: [
      {
        title: 'Add KAITO Helm Repository',
        command: 'helm repo add kaito https://kaito-project.github.io/kaito/charts/kaito',
        description: 'Add the KAITO Helm repository.',
      },
      {
        title: 'Update Helm Repositories',
        command: 'helm repo update',
        description: 'Update local Helm repository cache.',
      },
      {
        title: 'Install KAITO Workspace Operator',
        command: `helm upgrade --install kaito-workspace kaito/workspace --version ${KAITO_VERSION} -n kaito-workspace --create-namespace --set featureGates.disableNodeAutoProvisioning=true --wait`,
        description: `Install the KAITO workspace operator v${KAITO_VERSION} with Node Auto-Provisioning disabled (BYO nodes mode).`,
      },
    ],
  },
  dynamo: {
    id: 'dynamo',
    name: 'Dynamo',
    description: 'NVIDIA Dynamo for high-performance GPU inference',
    defaultNamespace: 'dynamo-system',
    crdConfig: {
      apiGroup: 'nvidia.com',
      apiVersion: 'v1alpha1',
      plural: 'dynamographdeployments',
      kind: 'DynamoGraphDeployment',
    },
    helmRepos: [
      { name: 'nvidia-ai-dynamo', url: 'https://helm.ngc.nvidia.com/nvidia/ai-dynamo' },
    ],
    helmCharts: [
      {
        name: 'dynamo-crds',
        chart: `https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-${DYNAMO_VERSION}.tgz`,
        namespace: 'default',
      },
      {
        name: 'dynamo-platform',
        chart: `https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-${DYNAMO_VERSION}.tgz`,
        namespace: 'dynamo-system',
        createNamespace: true,
      },
    ],
    installationSteps: [
      {
        title: 'Install Dynamo CRDs',
        command: `helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-crds-${DYNAMO_VERSION}.tgz && helm install dynamo-crds dynamo-crds-${DYNAMO_VERSION}.tgz --namespace default`,
        description: `Install the Dynamo Custom Resource Definitions v${DYNAMO_VERSION}.`,
      },
      {
        title: 'Install Dynamo Platform',
        command: `helm fetch https://helm.ngc.nvidia.com/nvidia/ai-dynamo/charts/dynamo-platform-${DYNAMO_VERSION}.tgz && helm install dynamo-platform dynamo-platform-${DYNAMO_VERSION}.tgz --namespace dynamo-system --create-namespace`,
        description: `Install the Dynamo platform operator v${DYNAMO_VERSION}.`,
      },
    ],
  },
  kuberay: {
    id: 'kuberay',
    name: 'KubeRay',
    description: 'Ray Serve via KubeRay for distributed Ray-based model serving with vLLM',
    defaultNamespace: 'ray-system',
    crdConfig: {
      apiGroup: 'ray.io',
      apiVersion: 'v1',
      plural: 'rayservices',
      kind: 'RayService',
    },
    helmRepos: [
      { name: 'kuberay', url: 'https://ray-project.github.io/kuberay-helm/' },
    ],
    helmCharts: [
      {
        name: 'kuberay-operator',
        chart: 'kuberay/kuberay-operator',
        version: KUBERAY_VERSION,
        namespace: 'ray-system',
        createNamespace: true,
      },
    ],
    installationSteps: [
      {
        title: 'Add KubeRay Helm Repository',
        command: 'helm repo add kuberay https://ray-project.github.io/kuberay-helm/',
        description: 'Add the KubeRay Helm repository.',
      },
      {
        title: 'Update Helm Repositories',
        command: 'helm repo update',
        description: 'Update local Helm repository cache.',
      },
      {
        title: 'Install KubeRay Operator',
        command: `helm upgrade --install kuberay-operator kuberay/kuberay-operator --version ${KUBERAY_VERSION} -n ray-system --create-namespace --wait`,
        description: `Install the KubeRay operator v${KUBERAY_VERSION}.`,
      },
    ],
  },
};

export function getProvider(id: string): ProviderDetails | undefined {
  return providers[id];
}

export function getAllProviders(): ProviderDetails[] {
  return Object.values(providers);
}

export function getProviderIds(): string[] {
  return Object.keys(providers);
}
