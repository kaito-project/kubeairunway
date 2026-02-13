import { sqliteTable, text, integer, unique } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  provider: text('provider', { enum: ['entra', 'github'] }).notNull(),
  providerId: text('provider_id').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  lastLogin: integer('last_login', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const sessions = sqliteTable('sessions', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  refreshTokenHash: text('refresh_token_hash').unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const instances = sqliteTable('instances', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  endpointUrl: text('endpoint_url').notNull(),
  credentialRef: text('credential_ref').notNull(),
  status: text('status', {
    enum: ['connected', 'disconnected', 'error'],
  }).notNull(),
  statusMessage: text('status_message'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const roles = sqliteTable('roles', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull().unique(),
  description: text('description'),
});

export const userInstanceRoles = sqliteTable(
  'user_instance_roles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instanceId: text('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    namespaces: text('namespaces').notNull().default('[]'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [unique().on(table.userId, table.instanceId, table.roleId)]
);

export const entraGroupMappings = sqliteTable('entra_group_mappings', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  entraGroupId: text('entra_group_id').notNull(),
  entraGroupName: text('entra_group_name').notNull(),
  instanceId: text('instance_id')
    .notNull()
    .references(() => instances.id, { onDelete: 'cascade' }),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  namespaces: text('namespaces').notNull().default('[]'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const oauthProviders = sqliteTable('oauth_providers', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: text('type', { enum: ['entra', 'github'] }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  clientId: text('client_id').notNull(),
  tenantId: text('tenant_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const auditLog = sqliteTable('audit_log', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  instanceId: text('instance_id').references(() => instances.id, { onDelete: 'set null' }),
  details: text('details'),
  ipAddress: text('ip_address'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});
