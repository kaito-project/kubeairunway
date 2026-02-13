export interface HubInstance {
  id: string;
  name: string;
  displayName: string;
  endpointUrl: string;
  status: 'connected' | 'disconnected' | 'error';
  statusMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HubUser {
  id: string;
  email: string;
  displayName: string;
  provider: 'entra' | 'github';
  avatarUrl?: string;
}

export type HubRole = 'admin' | 'deployer' | 'viewer';

export interface HubUserInstanceRole {
  instanceId: string;
  role: HubRole;
  namespaces: string[];
}

export interface HubAuthProvider {
  type: 'entra' | 'github';
  enabled: boolean;
  clientId?: string;
}

export interface HubEntraGroupMapping {
  id: string;
  entraGroupId: string;
  entraGroupName: string;
  instanceId: string;
  role: HubRole;
  namespaces: string[];
}
