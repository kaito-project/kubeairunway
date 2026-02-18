import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleSqlite } from 'drizzle-orm/bun-sqlite';
import postgres from 'postgres';
import { Database } from 'bun:sqlite';
import { sql } from 'drizzle-orm';
import * as pgSchema from './schema-pg';
import * as sqliteSchema from './schema-sqlite';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

type DbInstance =
  | ReturnType<typeof drizzlePg<typeof pgSchema>>
  | ReturnType<typeof drizzleSqlite<typeof sqliteSchema>>;

let dbInstance: DbInstance | null = null;
let dbType: 'pg' | 'sqlite' | null = null;
let initialized = false;

function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

/**
 * Returns the database type ('pg' or 'sqlite') based on DATABASE_URL.
 */
export function getDbType(): 'pg' | 'sqlite' {
  if (dbType) return dbType;
  const url = process.env.DATABASE_URL;
  dbType = url && isPostgresUrl(url) ? 'pg' : 'sqlite';
  return dbType;
}

/**
 * Returns the Drizzle database instance (lazy singleton).
 */
export function getDb(): DbInstance {
  if (dbInstance) return dbInstance;

  const url = process.env.DATABASE_URL;

  if (url && isPostgresUrl(url)) {
    const client = postgres(url);
    dbInstance = drizzlePg(client, { schema: pgSchema });
    dbType = 'pg';
  } else {
    const dbPath = url || './data/kubefoundry.db';
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const sqlite = new Database(dbPath);
    sqlite.exec('PRAGMA journal_mode = WAL');
    sqlite.exec('PRAGMA foreign_keys = ON');
    dbInstance = drizzleSqlite(sqlite, { schema: sqliteSchema });
    dbType = 'sqlite';
  }

  return dbInstance;
}

const DEFAULT_ROLES = [
  { name: 'admin', description: 'Full access to all resources' },
  { name: 'deployer', description: 'Can deploy and manage models' },
  { name: 'viewer', description: 'Read-only access to resources' },
];

/**
 * Creates tables (if not existing) and seeds default roles.
 * Safe to call multiple times — uses a singleton flag.
 */
export async function initializeDb(): Promise<void> {
  if (initialized) return;

  const db = getDb();
  const type = getDbType();

  if (type === 'sqlite') {
    await initializeSqlite(
      db as ReturnType<typeof drizzleSqlite<typeof sqliteSchema>>
    );
  } else {
    await initializePg(
      db as ReturnType<typeof drizzlePg<typeof pgSchema>>
    );
  }

  initialized = true;
}

async function initializeSqlite(
  db: ReturnType<typeof drizzleSqlite<typeof sqliteSchema>>
): Promise<void> {
  // Create tables using raw SQL for SQLite
  db.run(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('entra', 'github')),
      provider_id TEXT NOT NULL,
      avatar_url TEXT,
      created_at INTEGER NOT NULL,
      last_login INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      refresh_token_hash TEXT UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      credential_ref TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('connected', 'disconnected', 'error')),
      status_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS user_instance_roles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      namespaces TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, instance_id, role_id)
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS entra_group_mappings (
      id TEXT PRIMARY KEY,
      entra_group_id TEXT NOT NULL,
      entra_group_name TEXT NOT NULL,
      instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      namespaces TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS oauth_providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('entra', 'github')),
      enabled INTEGER NOT NULL DEFAULT 0,
      client_id TEXT NOT NULL,
      tenant_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      instance_id TEXT REFERENCES instances(id) ON DELETE SET NULL,
      details TEXT,
      ip_address TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  // Seed default roles
  for (const role of DEFAULT_ROLES) {
    db.insert(sqliteSchema.roles)
      .values({
        id: crypto.randomUUID(),
        name: role.name,
        description: role.description,
      })
      .onConflictDoNothing()
      .run();
  }
}

async function initializePg(
  db: ReturnType<typeof drizzlePg<typeof pgSchema>>
): Promise<void> {
  // Create tables using raw SQL for PostgreSQL
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('entra', 'github')),
      provider_id TEXT NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_login TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      refresh_token_hash TEXT UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS instances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      endpoint_url TEXT NOT NULL,
      credential_ref TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('connected', 'disconnected', 'error')),
      status_message TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL UNIQUE,
      description TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS user_instance_roles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      namespaces TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, instance_id, role_id)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS entra_group_mappings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entra_group_id TEXT NOT NULL,
      entra_group_name TEXT NOT NULL,
      instance_id UUID NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      namespaces TEXT NOT NULL DEFAULT '[]',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS oauth_providers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type TEXT NOT NULL CHECK(type IN ('entra', 'github')),
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      client_id TEXT NOT NULL,
      tenant_id TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      instance_id UUID REFERENCES instances(id) ON DELETE SET NULL,
      details TEXT,
      ip_address TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // Seed default roles
  for (const role of DEFAULT_ROLES) {
    await db
      .insert(pgSchema.roles)
      .values({
        name: role.name,
        description: role.description,
      })
      .onConflictDoNothing();
  }
}
