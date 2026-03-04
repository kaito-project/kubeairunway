/**
 * Installation and Helm types
 */

import { InstallationStep } from './settings';

export interface HelmStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export interface InstallationStatus {
  providerId: string;
  providerName: string;
  installed: boolean;
  version?: string;
  message?: string;
  crdFound?: boolean;
  operatorRunning?: boolean;
  installationSteps: InstallationStep[];
  helmCommands: string[];
}

export interface InstallResult {
  success: boolean;
  message: string;
  alreadyInstalled?: boolean;
  installationStatus?: {
    installed: boolean;
    message?: string;
  };
  results?: Array<{
    step: string;
    success: boolean;
    output: string;
    error?: string;
  }>;
}

export interface GPUOperatorStatus {
  installed: boolean;
  crdFound: boolean;
  operatorRunning: boolean;
  gpusAvailable: boolean;
  totalGPUs: number;
  gpuNodes: string[];
  message: string;
  helmCommands: string[];
}

export interface GPUOperatorInstallResult {
  success: boolean;
  message: string;
  alreadyInstalled?: boolean;
  status?: GPUOperatorStatus;
  results?: Array<{
    step: string;
    success: boolean;
    output: string;
    error?: string;
  }>;
}

export interface NodeGpuInfo {
  nodeName: string;
  totalGpus: number;
  allocatedGpus: number;
  availableGpus: number;
}

export interface ClusterGpuCapacity {
  totalGpus: number;
  allocatedGpus: number;
  availableGpus: number;
  maxContiguousAvailable: number;
  totalMemoryGb?: number;         // Total GPU memory per GPU (e.g., 80 for A100 80GB)
  nodes: NodeGpuInfo[];
}

/**
 * Gateway CRD installation status
 */
export interface GatewayCRDStatus {
  gatewayApiInstalled: boolean;
  inferenceExtInstalled: boolean;
  gatewayApiVersion?: string;
  inferenceExtVersion?: string;
  pinnedVersion: string;
  gatewayAvailable: boolean;
  gatewayEndpoint?: string;
  message: string;
  installCommands: string[];
}

/**
 * Result of installing Gateway API / GAIE CRDs
 */
export interface GatewayCRDInstallResult {
  success: boolean;
  message: string;
  results?: Array<{
    step: string;
    success: boolean;
    output: string;
    error?: string;
  }>;
}
