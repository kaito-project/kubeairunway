import { describe, test, expect } from 'bun:test';
import type { ClusterGpuCapacity, NodeGpuInfo, GPUAvailability, GPUOperatorStatus } from './kubernetes';
import type { ClusterStatus, PodStatus, DeploymentStatus, PodPhase } from '@kubeairunway/shared';

describe('KubernetesService - Type Definitions', () => {
  describe('ClusterGpuCapacity', () => {
    test('creates valid capacity with GPU nodes', () => {
      const nodes: NodeGpuInfo[] = [
        { nodeName: 'node-1', totalGpus: 8, allocatedGpus: 4, availableGpus: 4 },
        { nodeName: 'node-2', totalGpus: 8, allocatedGpus: 2, availableGpus: 6 },
      ];

      const capacity: ClusterGpuCapacity = {
        totalGpus: 16,
        allocatedGpus: 6,
        availableGpus: 10,
        maxContiguousAvailable: 6,
        maxNodeGpuCapacity: 8,
        gpuNodeCount: 2,
        totalMemoryGb: 80,
        nodes,
      };

      expect(capacity.totalGpus).toBe(16);
      expect(capacity.availableGpus).toBe(10);
      expect(capacity.maxContiguousAvailable).toBe(6);
      expect(capacity.nodes).toHaveLength(2);
    });

    test('handles cluster with no GPUs', () => {
      const capacity: ClusterGpuCapacity = {
        totalGpus: 0,
        allocatedGpus: 0,
        availableGpus: 0,
        maxContiguousAvailable: 0,
        maxNodeGpuCapacity: 0,
        gpuNodeCount: 0,
        nodes: [],
      };

      expect(capacity.totalGpus).toBe(0);
      expect(capacity.gpuNodeCount).toBe(0);
      expect(capacity.nodes).toHaveLength(0);
    });

    test('totalMemoryGb is optional', () => {
      const capacity: ClusterGpuCapacity = {
        totalGpus: 4,
        allocatedGpus: 0,
        availableGpus: 4,
        maxContiguousAvailable: 4,
        maxNodeGpuCapacity: 4,
        gpuNodeCount: 1,
        nodes: [{ nodeName: 'node-1', totalGpus: 4, allocatedGpus: 0, availableGpus: 4 }],
      };

      expect(capacity.totalMemoryGb).toBeUndefined();
    });
  });

  describe('GPUAvailability', () => {
    test('creates available GPU status', () => {
      const availability: GPUAvailability = {
        available: true,
        totalGPUs: 8,
        gpuNodes: ['node-1', 'node-2'],
      };

      expect(availability.available).toBe(true);
      expect(availability.totalGPUs).toBe(8);
      expect(availability.gpuNodes).toHaveLength(2);
    });

    test('creates unavailable GPU status', () => {
      const availability: GPUAvailability = {
        available: false,
        totalGPUs: 0,
        gpuNodes: [],
      };

      expect(availability.available).toBe(false);
      expect(availability.totalGPUs).toBe(0);
    });
  });

  describe('GPUOperatorStatus', () => {
    test('creates fully installed status', () => {
      const status: GPUOperatorStatus = {
        installed: true,
        crdFound: true,
        operatorRunning: true,
        gpusAvailable: true,
        totalGPUs: 4,
        gpuNodes: ['gpu-node-1'],
        message: 'GPUs enabled: 4 GPU(s) on 1 node(s)',
      };

      expect(status.installed).toBe(true);
      expect(status.operatorRunning).toBe(true);
      expect(status.gpusAvailable).toBe(true);
    });

    test('creates not installed status', () => {
      const status: GPUOperatorStatus = {
        installed: false,
        crdFound: false,
        operatorRunning: false,
        gpusAvailable: false,
        totalGPUs: 0,
        gpuNodes: [],
        message: 'GPU Operator not installed',
      };

      expect(status.installed).toBe(false);
      expect(status.message).toContain('not installed');
    });

    test('creates partial status (CRD found but not running)', () => {
      const status: GPUOperatorStatus = {
        installed: false,
        crdFound: true,
        operatorRunning: false,
        gpusAvailable: false,
        totalGPUs: 0,
        gpuNodes: [],
        message: 'GPU Operator CRD found but operator is not running',
      };

      expect(status.installed).toBe(false);
      expect(status.crdFound).toBe(true);
      expect(status.operatorRunning).toBe(false);
    });
  });

  describe('ClusterStatus', () => {
    test('creates connected status', () => {
      const status: ClusterStatus = {
        connected: true,
        namespace: 'default',
        clusterName: 'my-cluster',
      };

      expect(status.connected).toBe(true);
      expect(status.error).toBeUndefined();
    });

    test('creates disconnected status with error', () => {
      const status: ClusterStatus = {
        connected: false,
        namespace: 'default',
        error: 'Unable to connect to cluster',
      };

      expect(status.connected).toBe(false);
      expect(status.error).toBeDefined();
    });
  });

  describe('PodStatus', () => {
    test('creates running pod status', () => {
      const pod: PodStatus = {
        name: 'my-pod-abc123',
        phase: 'Running',
        ready: true,
        restarts: 0,
        node: 'worker-node-1',
      };

      expect(pod.phase).toBe('Running');
      expect(pod.ready).toBe(true);
    });

    test('creates pending pod status', () => {
      const pod: PodStatus = {
        name: 'my-pod-pending',
        phase: 'Pending',
        ready: false,
        restarts: 0,
      };

      expect(pod.phase).toBe('Pending');
      expect(pod.ready).toBe(false);
      expect(pod.node).toBeUndefined();
    });

    test('creates failed pod with restarts', () => {
      const pod: PodStatus = {
        name: 'crashloop-pod',
        phase: 'Running',
        ready: false,
        restarts: 5,
        node: 'worker-node-2',
      };

      expect(pod.restarts).toBe(5);
      expect(pod.ready).toBe(false);
    });
  });
});

describe('KubernetesService - GPU Memory Detection Logic', () => {
  // Test the GPU memory detection from product names
  function detectGpuMemoryFromProduct(gpuProduct: string): number | undefined {
    const product = gpuProduct.toLowerCase();

    // NVIDIA Data Center GPUs
    if (product.includes('a100') && product.includes('80')) return 80;
    if (product.includes('a100') && product.includes('40')) return 40;
    if (product.includes('a100')) return 40;
    if (product.includes('h100') && product.includes('80')) return 80;
    if (product.includes('h100')) return 80;
    if (product.includes('h200')) return 141;
    if (product.includes('a10g')) return 24;
    if (product.includes('a10')) return 24;
    if (product.includes('l40s')) return 48;
    if (product.includes('l40')) return 48;
    if (product.includes('l4')) return 24;
    if (product.includes('t4')) return 16;
    if (product.includes('v100') && product.includes('32')) return 32;
    if (product.includes('v100')) return 16;

    // NVIDIA Consumer GPUs
    if (product.includes('4090')) return 24;
    if (product.includes('4080')) return 16;
    if (product.includes('3090')) return 24;
    if (product.includes('3080') && product.includes('12')) return 12;
    if (product.includes('3080')) return 10;

    return undefined;
  }

  test('detects A100 80GB', () => {
    expect(detectGpuMemoryFromProduct('NVIDIA-A100-SXM4-80GB')).toBe(80);
    expect(detectGpuMemoryFromProduct('Tesla-A100-80GB-PCIe')).toBe(80);
  });

  test('detects A100 40GB', () => {
    expect(detectGpuMemoryFromProduct('NVIDIA-A100-40GB')).toBe(40);
    expect(detectGpuMemoryFromProduct('Tesla-A100-PCIE-40GB')).toBe(40);
  });

  test('detects A100 default as 40GB', () => {
    expect(detectGpuMemoryFromProduct('NVIDIA-A100-SXM')).toBe(40);
    expect(detectGpuMemoryFromProduct('a100')).toBe(40);
  });

  test('detects H100', () => {
    expect(detectGpuMemoryFromProduct('NVIDIA-H100-80GB')).toBe(80);
    expect(detectGpuMemoryFromProduct('H100-SXM')).toBe(80);
  });

  test('detects H200', () => {
    expect(detectGpuMemoryFromProduct('NVIDIA-H200')).toBe(141);
  });

  test('detects A10G', () => {
    expect(detectGpuMemoryFromProduct('NVIDIA-A10G')).toBe(24);
  });

  test('detects L40S', () => {
    expect(detectGpuMemoryFromProduct('NVIDIA-L40S')).toBe(48);
  });

  test('detects L4', () => {
    expect(detectGpuMemoryFromProduct('NVIDIA-L4')).toBe(24);
  });

  test('detects T4', () => {
    expect(detectGpuMemoryFromProduct('Tesla-T4')).toBe(16);
    expect(detectGpuMemoryFromProduct('NVIDIA-T4')).toBe(16);
  });

  test('detects V100 32GB', () => {
    expect(detectGpuMemoryFromProduct('Tesla-V100-32GB')).toBe(32);
  });

  test('detects V100 default as 16GB', () => {
    expect(detectGpuMemoryFromProduct('Tesla-V100-SXM2')).toBe(16);
    expect(detectGpuMemoryFromProduct('V100')).toBe(16);
  });

  test('detects consumer GPUs', () => {
    expect(detectGpuMemoryFromProduct('GeForce-RTX-4090')).toBe(24);
    expect(detectGpuMemoryFromProduct('RTX-4080')).toBe(16);
    expect(detectGpuMemoryFromProduct('GeForce-RTX-3090')).toBe(24);
    expect(detectGpuMemoryFromProduct('RTX-3080-12GB')).toBe(12);
    expect(detectGpuMemoryFromProduct('RTX-3080')).toBe(10);
  });

  test('returns undefined for unknown GPU', () => {
    expect(detectGpuMemoryFromProduct('Unknown-GPU')).toBeUndefined();
    expect(detectGpuMemoryFromProduct('AMD-MI250X')).toBeUndefined();
    expect(detectGpuMemoryFromProduct('')).toBeUndefined();
  });
});

describe('KubernetesService - Label Selector Logic', () => {
  // Test the label selector patterns used for finding pods
  const labelSelectors = [
    'app.kubernetes.io/instance={name}',
    'kaito.sh/workspace={name}',
    'app={name}',
  ];

  test('generates correct standard K8s label selector', () => {
    const deploymentName = 'my-llm';
    const selector = labelSelectors[0].replace('{name}', deploymentName);
    expect(selector).toBe('app.kubernetes.io/instance=my-llm');
  });

  test('generates correct KAITO label selector', () => {
    const deploymentName = 'kaito-model';
    const selector = labelSelectors[1].replace('{name}', deploymentName);
    expect(selector).toBe('kaito.sh/workspace=kaito-model');
  });

  test('generates correct fallback label selector', () => {
    const deploymentName = 'legacy-app';
    const selector = labelSelectors[2].replace('{name}', deploymentName);
    expect(selector).toBe('app=legacy-app');
  });
});

describe('KubernetesService - Protected Namespaces', () => {
  const protectedNamespaces = ['default', 'kube-system', 'kube-public', 'kube-node-lease'];

  test('identifies protected namespaces', () => {
    expect(protectedNamespaces.includes('default')).toBe(true);
    expect(protectedNamespaces.includes('kube-system')).toBe(true);
    expect(protectedNamespaces.includes('kube-public')).toBe(true);
    expect(protectedNamespaces.includes('kube-node-lease')).toBe(true);
  });

  test('allows deletion of non-protected namespaces', () => {
    expect(protectedNamespaces.includes('my-namespace')).toBe(false);
    expect(protectedNamespaces.includes('kubeairunway-system')).toBe(false);
    expect(protectedNamespaces.includes('dynamo')).toBe(false);
  });
});

describe('KubernetesService - ANSI Color Code Stripping', () => {
  // Test the ANSI color code regex used in getPodLogs
  const ansiRegex = /\x1b\[[0-9;]*m/g;

  function stripAnsiCodes(text: string): string {
    return text.replace(ansiRegex, '');
  }

  test('strips ANSI color codes from logs', () => {
    const coloredLog = '\x1b[32mINFO\x1b[0m: Application started';
    expect(stripAnsiCodes(coloredLog)).toBe('INFO: Application started');
  });

  test('strips multiple ANSI codes', () => {
    const coloredLog = '\x1b[31mERROR\x1b[0m: \x1b[33mWarning\x1b[0m detected';
    expect(stripAnsiCodes(coloredLog)).toBe('ERROR: Warning detected');
  });

  test('handles text without ANSI codes', () => {
    const plainLog = 'Normal log message';
    expect(stripAnsiCodes(plainLog)).toBe('Normal log message');
  });

  test('handles empty string', () => {
    expect(stripAnsiCodes('')).toBe('');
  });

  test('strips bold and other formatting codes', () => {
    const formattedLog = '\x1b[1mBold\x1b[0m and \x1b[4munderline\x1b[0m';
    expect(stripAnsiCodes(formattedLog)).toBe('Bold and underline');
  });
});

describe('KubernetesService - Node Pool Label Detection', () => {
  // Test the logic for detecting node pool names from labels
  function getNodePoolName(labels: Record<string, string>): string {
    return (
      labels['agentpool'] ||
      labels['kubernetes.azure.com/agentpool'] ||
      labels['cloud.google.com/gke-nodepool'] ||
      labels['eks.amazonaws.com/nodegroup'] ||
      'default'
    );
  }

  test('detects AKS agentpool label', () => {
    const labels = { agentpool: 'gpupool' };
    expect(getNodePoolName(labels)).toBe('gpupool');
  });

  test('detects AKS kubernetes.azure.com/agentpool label', () => {
    const labels = { 'kubernetes.azure.com/agentpool': 'gpu-nodepool' };
    expect(getNodePoolName(labels)).toBe('gpu-nodepool');
  });

  test('detects GKE nodepool label', () => {
    const labels = { 'cloud.google.com/gke-nodepool': 'gpu-pool' };
    expect(getNodePoolName(labels)).toBe('gpu-pool');
  });

  test('detects EKS nodegroup label', () => {
    const labels = { 'eks.amazonaws.com/nodegroup': 'gpu-nodes' };
    expect(getNodePoolName(labels)).toBe('gpu-nodes');
  });

  test('prefers agentpool over other labels', () => {
    const labels = {
      agentpool: 'aks-pool',
      'cloud.google.com/gke-nodepool': 'gke-pool',
    };
    expect(getNodePoolName(labels)).toBe('aks-pool');
  });

  test('returns default for empty labels', () => {
    expect(getNodePoolName({})).toBe('default');
  });

  test('returns default for unrecognized labels', () => {
    const labels = { 'custom-label': 'value' };
    expect(getNodePoolName(labels)).toBe('default');
  });
});
