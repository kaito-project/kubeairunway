// Set env before any module initialization
process.env.DATABASE_URL = ':memory:';

import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { initializeDb, getDb } from '../../db';
import { userRepository, instanceRepository, roleRepository } from '../database';
import { rbacService } from '../rbac';

beforeAll(async () => {
  await initializeDb();
});

afterEach(async () => {
  const d = getDb() as any;
  d.run(sql`DELETE FROM entra_group_mappings`);
  d.run(sql`DELETE FROM user_instance_roles`);
  d.run(sql`DELETE FROM sessions`);
  d.run(sql`DELETE FROM oauth_providers`);
  d.run(sql`DELETE FROM instances`);
  d.run(sql`DELETE FROM users`);
});

async function createTestUser(overrides: Record<string, string> = {}) {
  return userRepository.upsertFromOAuth({
    email: overrides.email || 'test@example.com',
    displayName: overrides.displayName || 'Test User',
    provider: overrides.provider || 'github',
    providerId: overrides.providerId || 'gh-123',
    avatarUrl: overrides.avatarUrl,
  });
}

async function createTestInstance(overrides: Record<string, string> = {}) {
  return instanceRepository.create({
    name: overrides.name || 'test-instance',
    displayName: overrides.displayName || 'Test Instance',
    endpointUrl: overrides.endpointUrl || 'https://test.example.com',
    credentialRef: overrides.credentialRef || 'secret/test',
  });
}

async function assignRole(userId: string, instanceId: string, roleName: string, namespaces: string[]) {
  const role = await roleRepository.findByName(roleName);
  if (!role) throw new Error(`Role '${roleName}' not found`);
  await roleRepository.assignUserRole(userId, instanceId, role.id, namespaces);
}

describe('RBACService', () => {
  describe('canAccessInstance', () => {
    test('returns true when user has a role', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'viewer', ['default']);

      const result = await rbacService.canAccessInstance(user.id, instance.id);
      expect(result).toBe(true);
    });

    test('returns false when user has no role', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();

      const result = await rbacService.canAccessInstance(user.id, instance.id);
      expect(result).toBe(false);
    });
  });

  describe('canDeployToNamespace', () => {
    test('returns true for deployer with correct namespace', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'deployer', ['default', 'staging']);

      const result = await rbacService.canDeployToNamespace(user.id, instance.id, 'default');
      expect(result).toBe(true);
    });

    test('returns false for viewer', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'viewer', ['default']);

      const result = await rbacService.canDeployToNamespace(user.id, instance.id, 'default');
      expect(result).toBe(false);
    });

    test('returns true for admin regardless of namespace', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'admin', ['default']);

      const result = await rbacService.canDeployToNamespace(user.id, instance.id, 'any-namespace');
      expect(result).toBe(true);
    });

    test('returns false for deployer with wrong namespace', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'deployer', ['staging']);

      const result = await rbacService.canDeployToNamespace(user.id, instance.id, 'production');
      expect(result).toBe(false);
    });

    test('returns true for deployer with wildcard namespace', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'deployer', ['*']);

      const result = await rbacService.canDeployToNamespace(user.id, instance.id, 'any-namespace');
      expect(result).toBe(true);
    });
  });

  describe('canManage', () => {
    test('returns true for admin', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'admin', ['*']);

      const result = await rbacService.canManage(user.id);
      expect(result).toBe(true);
    });

    test('returns false for non-admin', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'deployer', ['default']);

      const result = await rbacService.canManage(user.id);
      expect(result).toBe(false);
    });

    test('returns false for user with no roles', async () => {
      const user = await createTestUser();

      const result = await rbacService.canManage(user.id);
      expect(result).toBe(false);
    });
  });

  describe('getUserAllowedNamespaces', () => {
    test('returns correct namespace list for deployer', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'deployer', ['default', 'staging']);

      const namespaces = await rbacService.getUserAllowedNamespaces(user.id, instance.id);
      expect(namespaces).toEqual(['default', 'staging']);
    });

    test('returns ["*"] for admin', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'admin', ['default']);

      const namespaces = await rbacService.getUserAllowedNamespaces(user.id, instance.id);
      expect(namespaces).toEqual(['*']);
    });

    test('returns empty array for user with no role', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();

      const namespaces = await rbacService.getUserAllowedNamespaces(user.id, instance.id);
      expect(namespaces).toEqual([]);
    });
  });

  describe('requireRole', () => {
    test('admin meets viewer requirement', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'admin', ['*']);

      const result = await rbacService.requireRole(user.id, instance.id, 'viewer');
      expect(result).toBe(true);
    });

    test('admin meets deployer requirement', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'admin', ['*']);

      const result = await rbacService.requireRole(user.id, instance.id, 'deployer');
      expect(result).toBe(true);
    });

    test('deployer meets viewer requirement', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'deployer', ['default']);

      const result = await rbacService.requireRole(user.id, instance.id, 'viewer');
      expect(result).toBe(true);
    });

    test('viewer does not meet deployer requirement', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'viewer', ['default']);

      const result = await rbacService.requireRole(user.id, instance.id, 'deployer');
      expect(result).toBe(false);
    });

    test('viewer does not meet admin requirement', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();
      await assignRole(user.id, instance.id, 'viewer', ['default']);

      const result = await rbacService.requireRole(user.id, instance.id, 'admin');
      expect(result).toBe(false);
    });

    test('returns false for user with no role', async () => {
      const user = await createTestUser();
      const instance = await createTestInstance();

      const result = await rbacService.requireRole(user.id, instance.id, 'viewer');
      expect(result).toBe(false);
    });
  });
});
