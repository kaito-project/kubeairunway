import { sessionService } from './session';
import logger from '../lib/logger';

let cleanupInterval: ReturnType<typeof setInterval> | null = null;

export function startSessionCleanup(intervalMs = 60 * 60 * 1000): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(async () => {
    try {
      await sessionService.cleanupExpiredSessions();
    } catch (error) {
      logger.error({ error }, 'Session cleanup failed');
    }
  }, intervalMs);
  logger.info('Session cleanup job started');
}

export function stopSessionCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
