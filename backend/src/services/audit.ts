import { getDb, getDbType } from '../db';
import * as pgSchema from '../db/schema-pg';
import * as sqliteSchema from '../db/schema-sqlite';
import logger from '../lib/logger';

interface AuditEntry {
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  instanceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

function getSchema() {
  return getDbType() === 'pg' ? pgSchema : sqliteSchema;
}

function db(): any {
  return getDb();
}

export async function logAuditEvent(entry: AuditEntry): Promise<void> {
  try {
    const s = getSchema();
    await db().insert(s.auditLog).values({
      userId: entry.userId || null,
      action: entry.action,
      resourceType: entry.resourceType || null,
      resourceId: entry.resourceId || null,
      instanceId: entry.instanceId || null,
      details: entry.details ? JSON.stringify(entry.details) : null,
      ipAddress: entry.ipAddress || null,
    });
  } catch (error) {
    // Audit logging should never break the main flow
    logger.error({ error, entry }, 'Failed to write audit log');
  }
}
