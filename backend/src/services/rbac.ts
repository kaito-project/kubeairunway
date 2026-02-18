import { roleRepository, userRepository } from './database';
import type { HubRole } from '@kubefoundry/shared';
import logger from '../lib/logger';

const ROLE_HIERARCHY: Record<string, number> = {
  admin: 3,
  deployer: 2,
  viewer: 1,
};

class RBACService {
  async canAccessInstance(userId: string, instanceId: string): Promise<boolean> {
    const role = await roleRepository.getUserInstanceRole(userId, instanceId);
    return role !== null;
  }

  async canDeployToNamespace(userId: string, instanceId: string, namespace: string): Promise<boolean> {
    const role = await roleRepository.getUserInstanceRole(userId, instanceId);
    if (!role) return false;

    if (role.role !== 'admin' && role.role !== 'deployer') return false;

    // Admin always has access to all namespaces
    if (role.role === 'admin') return true;

    return role.namespaces.includes('*') || role.namespaces.includes(namespace);
  }

  async canManage(userId: string): Promise<boolean> {
    const roles = await roleRepository.getUserRoles(userId);
    if (roles.some((r) => r.role === 'admin')) return true;

    // Bootstrap: first user is auto-admin when no roles exist yet
    const totalUsers = await userRepository.countAll();
    if (totalUsers <= 1) {
      logger.info({ userId }, 'Bootstrap: granting admin access to first user');
      return true;
    }

    return false;
  }

  async getUserAllowedNamespaces(userId: string, instanceId: string): Promise<string[]> {
    const role = await roleRepository.getUserInstanceRole(userId, instanceId);
    if (!role) return [];

    if (role.role === 'admin') return ['*'];

    return role.namespaces;
  }

  async requireRole(userId: string, instanceId: string, minRole: HubRole): Promise<boolean> {
    const role = await roleRepository.getUserInstanceRole(userId, instanceId);
    if (!role) return false;

    const userLevel = ROLE_HIERARCHY[role.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0;
    return userLevel >= requiredLevel;
  }
}

export const rbacService = new RBACService();
