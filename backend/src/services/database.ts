import { getDb, getDbType } from '../db';
import * as pgSchema from '../db/schema-pg';
import * as sqliteSchema from '../db/schema-sqlite';
import { eq, and, lt } from 'drizzle-orm';
import type {
  HubUser,
  HubInstance,
  HubRole,
  HubUserInstanceRole,
  HubAuthProvider,
  HubEntraGroupMapping,
} from '@kubefoundry/shared';

function getSchema() {
  return getDbType() === 'pg' ? pgSchema : sqliteSchema;
}

// Cast to any for dual-dialect compatibility
function db(): any {
  return getDb();
}

const ROLE_PRIORITY: Record<string, number> = {
  admin: 3,
  deployer: 2,
  viewer: 1,
};

class UserRepository {
  private toHubUser(row: any): HubUser {
    return {
      id: row.id,
      email: row.email,
      displayName: row.displayName,
      provider: row.provider,
      avatarUrl: row.avatarUrl || undefined,
    };
  }

  async findByEmail(email: string): Promise<HubUser | null> {
    const s = getSchema();
    const rows = await db().select().from(s.users).where(eq(s.users.email, email));
    return rows.length > 0 ? this.toHubUser(rows[0]) : null;
  }

  async findByProviderId(provider: string, providerId: string): Promise<HubUser | null> {
    const s = getSchema();
    const rows = await db()
      .select()
      .from(s.users)
      .where(and(eq(s.users.provider, provider as any), eq(s.users.providerId, providerId)));
    return rows.length > 0 ? this.toHubUser(rows[0]) : null;
  }

  async findById(id: string): Promise<HubUser | null> {
    const s = getSchema();
    const rows = await db().select().from(s.users).where(eq(s.users.id, id));
    return rows.length > 0 ? this.toHubUser(rows[0]) : null;
  }

  async upsertFromOAuth(data: {
    email: string;
    displayName: string;
    provider: string;
    providerId: string;
    avatarUrl?: string;
  }): Promise<HubUser> {
    const s = getSchema();
    const existing = await this.findByProviderId(data.provider, data.providerId);

    if (existing) {
      await db()
        .update(s.users)
        .set({
          email: data.email,
          displayName: data.displayName,
          avatarUrl: data.avatarUrl || null,
          lastLogin: new Date(),
        })
        .where(eq(s.users.id, existing.id));
      return {
        ...existing,
        email: data.email,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl,
      };
    }

    const rows = await db()
      .insert(s.users)
      .values({
        email: data.email,
        displayName: data.displayName,
        provider: data.provider as any,
        providerId: data.providerId,
        avatarUrl: data.avatarUrl || null,
      })
      .returning();
    return this.toHubUser(rows[0]);
  }

  async updateLastLogin(id: string): Promise<void> {
    const s = getSchema();
    await db().update(s.users).set({ lastLogin: new Date() }).where(eq(s.users.id, id));
  }

  async listAll(): Promise<HubUser[]> {
    const s = getSchema();
    const rows = await db().select().from(s.users);
    return rows.map((r: any) => this.toHubUser(r));
  }
}

class SessionRepository {
  async create(
    userId: string,
    tokenHash: string,
    refreshTokenHash: string | null,
    expiresAt: Date
  ): Promise<{ id: string }> {
    const s = getSchema();
    const rows = await db()
      .insert(s.sessions)
      .values({ userId, tokenHash, refreshTokenHash, expiresAt })
      .returning();
    return { id: rows[0].id };
  }

  async findByTokenHash(
    tokenHash: string
  ): Promise<{ id: string; userId: string; expiresAt: Date } | null> {
    const s = getSchema();
    const rows = await db()
      .select()
      .from(s.sessions)
      .where(eq(s.sessions.tokenHash, tokenHash));
    if (rows.length === 0) return null;
    return { id: rows[0].id, userId: rows[0].userId, expiresAt: rows[0].expiresAt };
  }

  async findByRefreshTokenHash(
    refreshTokenHash: string
  ): Promise<{ id: string; userId: string; expiresAt: Date } | null> {
    const s = getSchema();
    const rows = await db()
      .select()
      .from(s.sessions)
      .where(eq(s.sessions.refreshTokenHash, refreshTokenHash));
    if (rows.length === 0) return null;
    return { id: rows[0].id, userId: rows[0].userId, expiresAt: rows[0].expiresAt };
  }

  async delete(id: string): Promise<void> {
    const s = getSchema();
    await db().delete(s.sessions).where(eq(s.sessions.id, id));
  }

  async deleteByUserId(userId: string): Promise<void> {
    const s = getSchema();
    await db().delete(s.sessions).where(eq(s.sessions.userId, userId));
  }

  async deleteExpired(): Promise<number> {
    const s = getSchema();
    const rows = await db()
      .delete(s.sessions)
      .where(lt(s.sessions.expiresAt, new Date()))
      .returning();
    return rows.length;
  }
}

class InstanceRepository {
  private toHubInstance(row: any): HubInstance {
    return {
      id: row.id,
      name: row.name,
      displayName: row.displayName,
      endpointUrl: row.endpointUrl,
      status: row.status,
      statusMessage: row.statusMessage || undefined,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    };
  }

  async create(data: {
    name: string;
    displayName: string;
    endpointUrl: string;
    credentialRef: string;
  }): Promise<HubInstance> {
    const s = getSchema();
    const rows = await db()
      .insert(s.instances)
      .values({
        name: data.name,
        displayName: data.displayName,
        endpointUrl: data.endpointUrl,
        credentialRef: data.credentialRef,
        status: 'disconnected' as const,
      })
      .returning();
    return this.toHubInstance(rows[0]);
  }

  async findById(id: string): Promise<HubInstance | null> {
    const s = getSchema();
    const rows = await db().select().from(s.instances).where(eq(s.instances.id, id));
    return rows.length > 0 ? this.toHubInstance(rows[0]) : null;
  }

  async findByName(name: string): Promise<HubInstance | null> {
    const s = getSchema();
    const rows = await db().select().from(s.instances).where(eq(s.instances.name, name));
    return rows.length > 0 ? this.toHubInstance(rows[0]) : null;
  }

  async listAll(): Promise<HubInstance[]> {
    const s = getSchema();
    const rows = await db().select().from(s.instances);
    return rows.map((r: any) => this.toHubInstance(r));
  }

  async update(
    id: string,
    data: Partial<{
      displayName: string;
      endpointUrl: string;
      credentialRef: string;
      status: string;
      statusMessage: string;
    }>
  ): Promise<HubInstance | null> {
    const s = getSchema();
    const updateData: Record<string, any> = { updatedAt: new Date() };
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) updateData[key] = value;
    }
    await db().update(s.instances).set(updateData).where(eq(s.instances.id, id));
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const s = getSchema();
    const rows = await db()
      .delete(s.instances)
      .where(eq(s.instances.id, id))
      .returning();
    return rows.length > 0;
  }

  async updateStatus(id: string, status: string, statusMessage?: string): Promise<void> {
    const s = getSchema();
    const updateData: Record<string, any> = { status, updatedAt: new Date() };
    if (statusMessage !== undefined) updateData.statusMessage = statusMessage;
    await db().update(s.instances).set(updateData).where(eq(s.instances.id, id));
  }
}

class RoleRepository {
  async findByName(name: string): Promise<{ id: string; name: string; description: string | null } | null> {
    const s = getSchema();
    const rows = await db().select().from(s.roles).where(eq(s.roles.name, name));
    return rows.length > 0 ? rows[0] : null;
  }

  async listAll(): Promise<{ id: string; name: string; description: string | null }[]> {
    const s = getSchema();
    return await db().select().from(s.roles);
  }

  async assignUserRole(
    userId: string,
    instanceId: string,
    roleId: string,
    namespaces: string[]
  ): Promise<void> {
    const s = getSchema();
    await db()
      .insert(s.userInstanceRoles)
      .values({
        userId,
        instanceId,
        roleId,
        namespaces: JSON.stringify(namespaces),
      })
      .onConflictDoUpdate({
        target: [s.userInstanceRoles.userId, s.userInstanceRoles.instanceId, s.userInstanceRoles.roleId],
        set: { namespaces: JSON.stringify(namespaces) },
      });
  }

  async removeUserRole(userId: string, instanceId: string, roleId: string): Promise<void> {
    const s = getSchema();
    await db()
      .delete(s.userInstanceRoles)
      .where(
        and(
          eq(s.userInstanceRoles.userId, userId),
          eq(s.userInstanceRoles.instanceId, instanceId),
          eq(s.userInstanceRoles.roleId, roleId)
        )
      );
  }

  async getUserRoles(userId: string): Promise<HubUserInstanceRole[]> {
    const s = getSchema();
    const rows = await db()
      .select({
        instanceId: s.userInstanceRoles.instanceId,
        roleName: s.roles.name,
        namespaces: s.userInstanceRoles.namespaces,
      })
      .from(s.userInstanceRoles)
      .innerJoin(s.roles, eq(s.userInstanceRoles.roleId, s.roles.id))
      .where(eq(s.userInstanceRoles.userId, userId));

    return rows.map((r: any) => ({
      instanceId: r.instanceId,
      role: r.roleName as HubRole,
      namespaces: JSON.parse(r.namespaces),
    }));
  }

  async getUserInstanceRole(
    userId: string,
    instanceId: string
  ): Promise<HubUserInstanceRole | null> {
    const s = getSchema();
    const rows = await db()
      .select({
        instanceId: s.userInstanceRoles.instanceId,
        roleName: s.roles.name,
        namespaces: s.userInstanceRoles.namespaces,
      })
      .from(s.userInstanceRoles)
      .innerJoin(s.roles, eq(s.userInstanceRoles.roleId, s.roles.id))
      .where(
        and(
          eq(s.userInstanceRoles.userId, userId),
          eq(s.userInstanceRoles.instanceId, instanceId)
        )
      );

    if (rows.length === 0) return null;

    // Return the highest-priority role
    const best = rows.reduce((acc: any, r: any) => {
      return (ROLE_PRIORITY[r.roleName] || 0) > (ROLE_PRIORITY[acc.roleName] || 0) ? r : acc;
    });

    return {
      instanceId: best.instanceId,
      role: best.roleName as HubRole,
      namespaces: JSON.parse(best.namespaces),
    };
  }

  async getInstanceUsers(
    instanceId: string
  ): Promise<Array<HubUser & { role: HubRole; namespaces: string[] }>> {
    const s = getSchema();
    const rows = await db()
      .select({
        id: s.users.id,
        email: s.users.email,
        displayName: s.users.displayName,
        provider: s.users.provider,
        avatarUrl: s.users.avatarUrl,
        roleName: s.roles.name,
        namespaces: s.userInstanceRoles.namespaces,
      })
      .from(s.userInstanceRoles)
      .innerJoin(s.users, eq(s.userInstanceRoles.userId, s.users.id))
      .innerJoin(s.roles, eq(s.userInstanceRoles.roleId, s.roles.id))
      .where(eq(s.userInstanceRoles.instanceId, instanceId));

    return rows.map((r: any) => ({
      id: r.id,
      email: r.email,
      displayName: r.displayName,
      provider: r.provider,
      avatarUrl: r.avatarUrl || undefined,
      role: r.roleName as HubRole,
      namespaces: JSON.parse(r.namespaces),
    }));
  }
}

class GroupMappingRepository {
  async create(data: {
    entraGroupId: string;
    entraGroupName: string;
    instanceId: string;
    roleId: string;
    namespaces: string[];
  }): Promise<HubEntraGroupMapping> {
    const s = getSchema();
    const rows = await db()
      .insert(s.entraGroupMappings)
      .values({
        entraGroupId: data.entraGroupId,
        entraGroupName: data.entraGroupName,
        instanceId: data.instanceId,
        roleId: data.roleId,
        namespaces: JSON.stringify(data.namespaces),
      })
      .returning();

    const roleRows = await db().select().from(s.roles).where(eq(s.roles.id, data.roleId));
    return {
      id: rows[0].id,
      entraGroupId: rows[0].entraGroupId,
      entraGroupName: rows[0].entraGroupName,
      instanceId: rows[0].instanceId,
      role: roleRows[0].name as HubRole,
      namespaces: data.namespaces,
    };
  }

  async findByGroupId(entraGroupId: string): Promise<HubEntraGroupMapping[]> {
    const s = getSchema();
    const rows = await db()
      .select({
        id: s.entraGroupMappings.id,
        entraGroupId: s.entraGroupMappings.entraGroupId,
        entraGroupName: s.entraGroupMappings.entraGroupName,
        instanceId: s.entraGroupMappings.instanceId,
        roleName: s.roles.name,
        namespaces: s.entraGroupMappings.namespaces,
      })
      .from(s.entraGroupMappings)
      .innerJoin(s.roles, eq(s.entraGroupMappings.roleId, s.roles.id))
      .where(eq(s.entraGroupMappings.entraGroupId, entraGroupId));

    return rows.map((r: any) => ({
      id: r.id,
      entraGroupId: r.entraGroupId,
      entraGroupName: r.entraGroupName,
      instanceId: r.instanceId,
      role: r.roleName as HubRole,
      namespaces: JSON.parse(r.namespaces),
    }));
  }

  async listAll(): Promise<HubEntraGroupMapping[]> {
    const s = getSchema();
    const rows = await db()
      .select({
        id: s.entraGroupMappings.id,
        entraGroupId: s.entraGroupMappings.entraGroupId,
        entraGroupName: s.entraGroupMappings.entraGroupName,
        instanceId: s.entraGroupMappings.instanceId,
        roleName: s.roles.name,
        namespaces: s.entraGroupMappings.namespaces,
      })
      .from(s.entraGroupMappings)
      .innerJoin(s.roles, eq(s.entraGroupMappings.roleId, s.roles.id));

    return rows.map((r: any) => ({
      id: r.id,
      entraGroupId: r.entraGroupId,
      entraGroupName: r.entraGroupName,
      instanceId: r.instanceId,
      role: r.roleName as HubRole,
      namespaces: JSON.parse(r.namespaces),
    }));
  }

  async delete(id: string): Promise<boolean> {
    const s = getSchema();
    const rows = await db()
      .delete(s.entraGroupMappings)
      .where(eq(s.entraGroupMappings.id, id))
      .returning();
    return rows.length > 0;
  }
}

class OAuthProviderRepository {
  private toHubAuthProvider(row: any): HubAuthProvider {
    return {
      type: row.type,
      enabled: Boolean(row.enabled),
      clientId: row.clientId || undefined,
    };
  }

  async findByType(type: 'entra' | 'github'): Promise<HubAuthProvider | null> {
    const s = getSchema();
    const rows = await db()
      .select()
      .from(s.oauthProviders)
      .where(eq(s.oauthProviders.type, type));
    return rows.length > 0 ? this.toHubAuthProvider(rows[0]) : null;
  }

  async listEnabled(): Promise<HubAuthProvider[]> {
    const s = getSchema();
    const rows = await db()
      .select()
      .from(s.oauthProviders)
      .where(eq(s.oauthProviders.enabled, true as any));
    return rows.map((r: any) => this.toHubAuthProvider(r));
  }

  async upsert(data: {
    type: 'entra' | 'github';
    enabled: boolean;
    clientId: string;
    tenantId?: string;
  }): Promise<void> {
    const s = getSchema();
    const existing = await db()
      .select()
      .from(s.oauthProviders)
      .where(eq(s.oauthProviders.type, data.type));

    if (existing.length > 0) {
      await db()
        .update(s.oauthProviders)
        .set({
          enabled: data.enabled as any,
          clientId: data.clientId,
          tenantId: data.tenantId || null,
          updatedAt: new Date(),
        })
        .where(eq(s.oauthProviders.type, data.type));
    } else {
      await db()
        .insert(s.oauthProviders)
        .values({
          type: data.type as any,
          enabled: data.enabled as any,
          clientId: data.clientId,
          tenantId: data.tenantId || null,
        });
    }
  }
}

export const userRepository = new UserRepository();
export const sessionRepository = new SessionRepository();
export const instanceRepository = new InstanceRepository();
export const roleRepository = new RoleRepository();
export const groupMappingRepository = new GroupMappingRepository();
export const oauthProviderRepository = new OAuthProviderRepository();
