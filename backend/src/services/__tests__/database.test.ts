// Set env before any module initialization
process.env.DATABASE_URL = ':memory:';

import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { initializeDb, getDb } from '../../db';
import {
  userRepository,
  sessionRepository,
  instanceRepository,
  roleRepository,
  groupMappingRepository,
  oauthProviderRepository,
} from '../database';

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

// Helper to create a test user
async function createTestUser(overrides: Record<string, string> = {}) {
  return userRepository.upsertFromOAuth({
    email: overrides.email || 'test@example.com',
    displayName: overrides.displayName || 'Test User',
    provider: overrides.provider || 'github',
    providerId: overrides.providerId || 'gh-123',
    avatarUrl: overrides.avatarUrl,
  });
}

// Helper to create a test instance
async function createTestInstance(overrides: Record<string, string> = {}) {
  return instanceRepository.create({
    name: overrides.name || 'test-instance',
    displayName: overrides.displayName || 'Test Instance',
    endpointUrl: overrides.endpointUrl || 'https://test.example.com',
    credentialRef: overrides.credentialRef || 'secret/test',
  });
}

describe('UserRepository', () => {
  test('upsertFromOAuth creates a new user', async () => {
    const user = await createTestUser();
    expect(user.id).toBeDefined();
    expect(user.email).toBe('test@example.com');
    expect(user.displayName).toBe('Test User');
    expect(user.provider).toBe('github');
  });

  test('upsertFromOAuth updates existing user', async () => {
    const user1 = await createTestUser();
    const user2 = await userRepository.upsertFromOAuth({
      email: 'updated@example.com',
      displayName: 'Updated User',
      provider: 'github',
      providerId: 'gh-123',
      avatarUrl: 'https://avatar.test/pic.png',
    });
    expect(user2.id).toBe(user1.id);
    expect(user2.email).toBe('updated@example.com');
    expect(user2.displayName).toBe('Updated User');
    expect(user2.avatarUrl).toBe('https://avatar.test/pic.png');
  });

  test('findByEmail returns user', async () => {
    await createTestUser();
    const found = await userRepository.findByEmail('test@example.com');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('test@example.com');
  });

  test('findByEmail returns null for missing', async () => {
    const found = await userRepository.findByEmail('nobody@example.com');
    expect(found).toBeNull();
  });

  test('findByProviderId returns user', async () => {
    await createTestUser();
    const found = await userRepository.findByProviderId('github', 'gh-123');
    expect(found).not.toBeNull();
    expect(found!.provider).toBe('github');
  });

  test('findById returns user', async () => {
    const user = await createTestUser();
    const found = await userRepository.findById(user.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(user.id);
  });

  test('updateLastLogin does not throw', async () => {
    const user = await createTestUser();
    await userRepository.updateLastLogin(user.id);
  });

  test('listAll returns all users', async () => {
    await createTestUser({ email: 'a@test.com', providerId: 'p1' });
    await createTestUser({ email: 'b@test.com', providerId: 'p2' });
    const all = await userRepository.listAll();
    expect(all.length).toBe(2);
  });
});

describe('SessionRepository', () => {
  test('create and findByTokenHash', async () => {
    const user = await createTestUser();
    const expiresAt = new Date(Date.now() + 3600_000);
    const { id } = await sessionRepository.create(user.id, 'hash-abc', 'refresh-abc', expiresAt);
    expect(id).toBeDefined();

    const session = await sessionRepository.findByTokenHash('hash-abc');
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(user.id);
  });

  test('findByRefreshTokenHash', async () => {
    const user = await createTestUser();
    await sessionRepository.create(user.id, 'hash-xyz', 'refresh-xyz', new Date(Date.now() + 3600_000));
    const session = await sessionRepository.findByRefreshTokenHash('refresh-xyz');
    expect(session).not.toBeNull();
    expect(session!.userId).toBe(user.id);
  });

  test('delete removes session', async () => {
    const user = await createTestUser();
    const { id } = await sessionRepository.create(user.id, 'hash-del', null, new Date(Date.now() + 3600_000));
    await sessionRepository.delete(id);
    const session = await sessionRepository.findByTokenHash('hash-del');
    expect(session).toBeNull();
  });

  test('deleteByUserId removes all user sessions', async () => {
    const user = await createTestUser();
    await sessionRepository.create(user.id, 'h1', null, new Date(Date.now() + 3600_000));
    await sessionRepository.create(user.id, 'h2', null, new Date(Date.now() + 3600_000));
    await sessionRepository.deleteByUserId(user.id);
    expect(await sessionRepository.findByTokenHash('h1')).toBeNull();
    expect(await sessionRepository.findByTokenHash('h2')).toBeNull();
  });

  test('deleteExpired cleans up expired sessions', async () => {
    const user = await createTestUser();
    // Create an expired session (past date)
    await sessionRepository.create(user.id, 'expired-hash', null, new Date(Date.now() - 1000));
    // Create a valid session
    await sessionRepository.create(user.id, 'valid-hash', null, new Date(Date.now() + 3600_000));

    const count = await sessionRepository.deleteExpired();
    expect(count).toBe(1);
    expect(await sessionRepository.findByTokenHash('expired-hash')).toBeNull();
    expect(await sessionRepository.findByTokenHash('valid-hash')).not.toBeNull();
  });

  test('cascade delete: deleting user removes sessions', async () => {
    const user = await createTestUser();
    await sessionRepository.create(user.id, 'cascade-hash', null, new Date(Date.now() + 3600_000));

    // Delete the user directly via SQL
    const d = getDb() as any;
    const s = await import('../../db/schema-sqlite');
    d.delete(s.users).where(sql`id = ${user.id}`).run();

    const session = await sessionRepository.findByTokenHash('cascade-hash');
    expect(session).toBeNull();
  });
});

describe('InstanceRepository', () => {
  test('create returns instance with defaults', async () => {
    const inst = await createTestInstance();
    expect(inst.id).toBeDefined();
    expect(inst.name).toBe('test-instance');
    expect(inst.status).toBe('disconnected');
    expect(inst.createdAt).toBeDefined();
  });

  test('findById returns instance', async () => {
    const inst = await createTestInstance();
    const found = await instanceRepository.findById(inst.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('test-instance');
  });

  test('findByName returns instance', async () => {
    await createTestInstance();
    const found = await instanceRepository.findByName('test-instance');
    expect(found).not.toBeNull();
  });

  test('listAll returns all instances', async () => {
    await createTestInstance({ name: 'inst-a' });
    await createTestInstance({ name: 'inst-b' });
    const all = await instanceRepository.listAll();
    expect(all.length).toBe(2);
  });

  test('update modifies fields', async () => {
    const inst = await createTestInstance();
    const updated = await instanceRepository.update(inst.id, {
      displayName: 'Updated Name',
      status: 'connected',
    });
    expect(updated).not.toBeNull();
    expect(updated!.displayName).toBe('Updated Name');
    expect(updated!.status).toBe('connected');
  });

  test('delete removes instance', async () => {
    const inst = await createTestInstance();
    const result = await instanceRepository.delete(inst.id);
    expect(result).toBe(true);
    expect(await instanceRepository.findById(inst.id)).toBeNull();
  });

  test('delete returns false for missing', async () => {
    const result = await instanceRepository.delete('non-existent-id');
    expect(result).toBe(false);
  });

  test('updateStatus changes status', async () => {
    const inst = await createTestInstance();
    await instanceRepository.updateStatus(inst.id, 'error', 'Connection refused');
    const found = await instanceRepository.findById(inst.id);
    expect(found!.status).toBe('error');
    expect(found!.statusMessage).toBe('Connection refused');
  });

  test('unique name constraint', async () => {
    await createTestInstance({ name: 'unique-name' });
    await expect(createTestInstance({ name: 'unique-name' })).rejects.toThrow();
  });
});

describe('RoleRepository', () => {
  test('listAll returns seeded roles', async () => {
    const roles = await roleRepository.listAll();
    expect(roles.length).toBe(3);
    const names = roles.map((r: any) => r.name).sort();
    expect(names).toEqual(['admin', 'deployer', 'viewer']);
  });

  test('findByName returns role', async () => {
    const role = await roleRepository.findByName('admin');
    expect(role).not.toBeNull();
    expect(role!.name).toBe('admin');
    expect(role!.description).toBeDefined();
  });

  test('findByName returns null for missing', async () => {
    const role = await roleRepository.findByName('superadmin');
    expect(role).toBeNull();
  });

  test('assignUserRole and getUserRoles', async () => {
    const user = await createTestUser();
    const inst = await createTestInstance();
    const role = await roleRepository.findByName('viewer');

    await roleRepository.assignUserRole(user.id, inst.id, role!.id, ['default', 'kube-system']);
    const roles = await roleRepository.getUserRoles(user.id);
    expect(roles.length).toBe(1);
    expect(roles[0].role).toBe('viewer');
    expect(roles[0].namespaces).toEqual(['default', 'kube-system']);
    expect(roles[0].instanceId).toBe(inst.id);
  });

  test('assignUserRole upserts namespaces', async () => {
    const user = await createTestUser();
    const inst = await createTestInstance();
    const role = await roleRepository.findByName('viewer');

    await roleRepository.assignUserRole(user.id, inst.id, role!.id, ['default']);
    await roleRepository.assignUserRole(user.id, inst.id, role!.id, ['default', 'prod']);

    const roles = await roleRepository.getUserRoles(user.id);
    expect(roles.length).toBe(1);
    expect(roles[0].namespaces).toEqual(['default', 'prod']);
  });

  test('removeUserRole', async () => {
    const user = await createTestUser();
    const inst = await createTestInstance();
    const role = await roleRepository.findByName('viewer');

    await roleRepository.assignUserRole(user.id, inst.id, role!.id, ['default']);
    await roleRepository.removeUserRole(user.id, inst.id, role!.id);

    const roles = await roleRepository.getUserRoles(user.id);
    expect(roles.length).toBe(0);
  });

  test('getUserInstanceRole returns highest priority role', async () => {
    const user = await createTestUser();
    const inst = await createTestInstance();
    const viewerRole = await roleRepository.findByName('viewer');
    const adminRole = await roleRepository.findByName('admin');

    await roleRepository.assignUserRole(user.id, inst.id, viewerRole!.id, ['default']);
    await roleRepository.assignUserRole(user.id, inst.id, adminRole!.id, ['*']);

    const best = await roleRepository.getUserInstanceRole(user.id, inst.id);
    expect(best).not.toBeNull();
    expect(best!.role).toBe('admin');
  });

  test('getUserInstanceRole returns null for no assignment', async () => {
    const user = await createTestUser();
    const inst = await createTestInstance();
    const result = await roleRepository.getUserInstanceRole(user.id, inst.id);
    expect(result).toBeNull();
  });

  test('getInstanceUsers returns users with roles', async () => {
    const user = await createTestUser();
    const inst = await createTestInstance();
    const role = await roleRepository.findByName('deployer');

    await roleRepository.assignUserRole(user.id, inst.id, role!.id, ['default']);
    const users = await roleRepository.getInstanceUsers(inst.id);
    expect(users.length).toBe(1);
    expect(users[0].email).toBe('test@example.com');
    expect(users[0].role).toBe('deployer');
    expect(users[0].namespaces).toEqual(['default']);
  });
});

describe('GroupMappingRepository', () => {
  test('create and findByGroupId', async () => {
    const inst = await createTestInstance();
    const role = await roleRepository.findByName('viewer');

    const mapping = await groupMappingRepository.create({
      entraGroupId: 'group-abc',
      entraGroupName: 'Test Group',
      instanceId: inst.id,
      roleId: role!.id,
      namespaces: ['default'],
    });

    expect(mapping.id).toBeDefined();
    expect(mapping.role).toBe('viewer');
    expect(mapping.namespaces).toEqual(['default']);

    const found = await groupMappingRepository.findByGroupId('group-abc');
    expect(found.length).toBe(1);
    expect(found[0].entraGroupName).toBe('Test Group');
  });

  test('listAll returns all mappings', async () => {
    const inst = await createTestInstance();
    const role = await roleRepository.findByName('admin');

    await groupMappingRepository.create({
      entraGroupId: 'g1',
      entraGroupName: 'Group 1',
      instanceId: inst.id,
      roleId: role!.id,
      namespaces: [],
    });
    await groupMappingRepository.create({
      entraGroupId: 'g2',
      entraGroupName: 'Group 2',
      instanceId: inst.id,
      roleId: role!.id,
      namespaces: ['ns1'],
    });

    const all = await groupMappingRepository.listAll();
    expect(all.length).toBe(2);
  });

  test('delete removes mapping', async () => {
    const inst = await createTestInstance();
    const role = await roleRepository.findByName('viewer');

    const mapping = await groupMappingRepository.create({
      entraGroupId: 'g-del',
      entraGroupName: 'Delete Me',
      instanceId: inst.id,
      roleId: role!.id,
      namespaces: [],
    });

    const result = await groupMappingRepository.delete(mapping.id);
    expect(result).toBe(true);
    const found = await groupMappingRepository.findByGroupId('g-del');
    expect(found.length).toBe(0);
  });
});

describe('OAuthProviderRepository', () => {
  test('upsert creates and findByType retrieves', async () => {
    await oauthProviderRepository.upsert({
      type: 'github',
      enabled: true,
      clientId: 'gh-client-id',
    });

    const provider = await oauthProviderRepository.findByType('github');
    expect(provider).not.toBeNull();
    expect(provider!.type).toBe('github');
    expect(provider!.enabled).toBe(true);
    expect(provider!.clientId).toBe('gh-client-id');
  });

  test('upsert updates existing provider', async () => {
    await oauthProviderRepository.upsert({
      type: 'entra',
      enabled: false,
      clientId: 'old-client',
      tenantId: 'tenant-1',
    });
    await oauthProviderRepository.upsert({
      type: 'entra',
      enabled: true,
      clientId: 'new-client',
      tenantId: 'tenant-2',
    });

    const provider = await oauthProviderRepository.findByType('entra');
    expect(provider!.enabled).toBe(true);
    expect(provider!.clientId).toBe('new-client');
  });

  test('listEnabled returns only enabled providers', async () => {
    await oauthProviderRepository.upsert({
      type: 'github',
      enabled: true,
      clientId: 'gh-id',
    });
    await oauthProviderRepository.upsert({
      type: 'entra',
      enabled: false,
      clientId: 'entra-id',
    });

    const enabled = await oauthProviderRepository.listEnabled();
    expect(enabled.length).toBe(1);
    expect(enabled[0].type).toBe('github');
  });

  test('findByType returns null for missing', async () => {
    const provider = await oauthProviderRepository.findByType('github');
    expect(provider).toBeNull();
  });
});
