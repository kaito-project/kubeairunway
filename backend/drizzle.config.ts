import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
const isPostgres =
  databaseUrl?.startsWith('postgres://') ||
  databaseUrl?.startsWith('postgresql://');

export default defineConfig(
  isPostgres
    ? {
        schema: './src/db/schema-pg.ts',
        out: './drizzle',
        dialect: 'postgresql',
        dbCredentials: {
          url: databaseUrl!,
        },
      }
    : {
        schema: './src/db/schema-sqlite.ts',
        out: './drizzle',
        dialect: 'sqlite',
        dbCredentials: {
          url: databaseUrl || './data/kubefoundry.db',
        },
      }
);
