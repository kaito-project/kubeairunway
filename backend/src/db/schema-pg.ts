import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  unique,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  provider: text('provider', { enum: ['entra', 'github'] }).notNull(),
  providerId: text('provider_id').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastLogin: timestamp('last_login').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  refreshTokenHash: text('refresh_token_hash').unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const instances = pgTable('instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  displayName: text('display_name').notNull(),
  endpointUrl: text('endpoint_url').notNull(),
  credentialRef: text('credential_ref').notNull(),
  status: text('status', {
    enum: ['connected', 'disconnected', 'error'],
  }).notNull(),
  statusMessage: text('status_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
});

export const userInstanceRoles = pgTable(
  'user_instance_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    namespaces: text('namespaces').notNull().default('[]'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.instanceId, table.roleId)]
);

export const entraGroupMappings = pgTable('entra_group_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  entraGroupId: text('entra_group_id').notNull(),
  entraGroupName: text('entra_group_name').notNull(),
  instanceId: uuid('instance_id')
    .notNull()
    .references(() => instances.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id')
    .notNull()
    .references(() => roles.id, { onDelete: 'cascade' }),
  namespaces: text('namespaces').notNull().default('[]'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const oauthProviders = pgTable('oauth_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: text('type', { enum: ['entra', 'github'] }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  clientId: text('client_id').notNull(),
  tenantId: text('tenant_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  instanceId: uuid('instance_id').references(() => instances.id, { onDelete: 'set null' }),
  details: text('details'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
