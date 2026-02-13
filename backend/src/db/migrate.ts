import { getDb, getDbType, initializeDb } from './index';

/**
 * Runs database migrations/initialization on startup.
 * For initial setup, we use CREATE TABLE IF NOT EXISTS via initializeDb().
 * For future schema changes, Drizzle Kit migrations can be applied here.
 */
export async function runMigrations(): Promise<void> {
  const type = getDbType();

  // Ensure tables exist and seed default data
  await initializeDb();

  if (type === 'pg') {
    await runPgMigrations();
  } else {
    await runSqliteMigrations();
  }
}

async function runPgMigrations(): Promise<void> {
  // Future: apply Drizzle Kit migrations from backend/drizzle/ directory
  // import { migrate } from 'drizzle-orm/postgres-js/migrator';
  // const db = getDb();
  // await migrate(db, { migrationsFolder: './drizzle' });
}

async function runSqliteMigrations(): Promise<void> {
  // Future: apply Drizzle Kit migrations from backend/drizzle/ directory
  // import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
  // const db = getDb();
  // migrate(db, { migrationsFolder: './drizzle' });
}
