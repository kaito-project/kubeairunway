// Set env before any module initialization
process.env.DATABASE_URL = ':memory:';

import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { initializeDb, getDb } from '../../db';
import { userRepository, instanceRepository, roleRepository, groupMappingRepository } from '../database';
import { groupSyncService } from '../group-sync';

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
    provider: overrides.provider || 'entra',
    providerId: overrides.providerId || 'entra-123',
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

async function createGroupMapping(
  entraGroupId: string,
  instanceId: string,
  roleName: string,
  namespaces: string[],
  entraGroupName?: string
) {
  const role = await roleRepository.findByName(roleName);
  if (!role) throw new Error(`Role '${roleName}' not found`);
  return groupMappingRepository.create({
    entraGroupId,
    entraGroupName: entraGroupName || `Group ${entraGroupId}`,
    instanceId,
    roleId: role.id,
    namespaces,
  });
}

describe('GroupSyncService', () => {
  test('syncUserGroups assigns role when group mapping exists', async () => {
    const user = await createTestUser();
    const instance = await createTestInstance();
    await createGroupMapping('entra-group-1', instance.id, 'viewer', ['default']);

    await groupSyncService.syncUserGroups(user.id, ['entra-group-1']);

    const roles = await roleRepository.getUserRoles(user.id);
    expect(roles).toHaveLength(1);
    expect(roles[0].instanceId).toBe(instance.id);
    expect(roles[0].role).toBe('viewer');
    expect(roles[0].namespaces).toEqual(['default']);
  });

  test('syncUserGroups handles empty group list gracefully', async () => {
    const user = await createTestUser();

    await groupSyncService.syncUserGroups(user.id, []);

    const roles = await roleRepository.getUserRoles(user.id);
    expect(roles).toHaveLength(0);
  });

  test('syncUserGroups handles groups with no mappings', async () => {
    const user = await createTestUser();

    await groupSyncService.syncUserGroups(user.id, ['nonexistent-group']);

    const roles = await roleRepository.getUserRoles(user.id);
    expect(roles).toHaveLength(0);
  });

  test('syncUserGroups handles multiple mappings for same group', async () => {
    const user = await createTestUser();
    const instance1 = await createTestInstance({ name: 'instance-1', displayName: 'Instance 1' });
    const instance2 = await createTestInstance({ name: 'instance-2', displayName: 'Instance 2' });
    await createGroupMapping('entra-group-1', instance1.id, 'viewer', ['default']);
    await createGroupMapping('entra-group-1', instance2.id, 'deployer', ['staging']);

    await groupSyncService.syncUserGroups(user.id, ['entra-group-1']);

    const roles = await roleRepository.getUserRoles(user.id);
    expect(roles).toHaveLength(2);
    const sorted = roles.sort((a, b) => a.instanceId.localeCompare(b.instanceId));
    const i1Role = sorted.find((r) => r.instanceId === instance1.id);
    const i2Role = sorted.find((r) => r.instanceId === instance2.id);
    expect(i1Role?.role).toBe('viewer');
    expect(i1Role?.namespaces).toEqual(['default']);
    expect(i2Role?.role).toBe('deployer');
    expect(i2Role?.namespaces).toEqual(['staging']);
  });

  test('syncUserGroups handles multiple groups', async () => {
    const user = await createTestUser();
    const instance = await createTestInstance();
    await createGroupMapping('entra-group-1', instance.id, 'viewer', ['default']);
    const instance2 = await createTestInstance({ name: 'instance-2', displayName: 'Instance 2' });
    await createGroupMapping('entra-group-2', instance2.id, 'admin', ['*']);

    await groupSyncService.syncUserGroups(user.id, ['entra-group-1', 'entra-group-2']);

    const roles = await roleRepository.getUserRoles(user.id);
    expect(roles).toHaveLength(2);
    const viewerRole = roles.find((r) => r.instanceId === instance.id);
    const adminRole = roles.find((r) => r.instanceId === instance2.id);
    expect(viewerRole?.role).toBe('viewer');
    expect(adminRole?.role).toBe('admin');
    expect(adminRole?.namespaces).toEqual(['*']);
  });
});
