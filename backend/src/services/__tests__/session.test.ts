// Set env before any module initialization
process.env.DATABASE_URL = ':memory:';
process.env.SESSION_SECRET = 'test-secret-for-unit-tests';

import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { sql } from 'drizzle-orm';
import { initializeDb, getDb } from '../../db';
import { userRepository } from '../database';
import { sessionService } from '../session';
import type { SessionTokens } from '../session';

beforeAll(async () => {
  await initializeDb();
});

afterEach(async () => {
  const d = getDb() as any;
  d.run(sql`DELETE FROM sessions`);
  d.run(sql`DELETE FROM users`);
});

async function createTestUser() {
  return userRepository.upsertFromOAuth({
    email: 'session-test@example.com',
    displayName: 'Session Test User',
    provider: 'github',
    providerId: 'gh-session-123',
  });
}

describe('SessionService', () => {
  test('createSession returns tokens', async () => {
    const user = await createTestUser();
    const tokens = await sessionService.createSession(user.id);

    expect(tokens.accessToken).toBeDefined();
    expect(tokens.refreshToken).toBeDefined();
    expect(tokens.expiresIn).toBe(15 * 60);
    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
  });

  test('createSession throws for unknown user', async () => {
    await expect(sessionService.createSession('nonexistent-id')).rejects.toThrow('User not found');
  });

  test('validateAccessToken returns payload for valid token', async () => {
    const user = await createTestUser();
    const tokens = await sessionService.createSession(user.id);
    const payload = await sessionService.validateAccessToken(tokens.accessToken);

    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(user.id);
    expect(payload!.email).toBe('session-test@example.com');
    expect(payload!.displayName).toBe('Session Test User');
    expect(payload!.provider).toBe('github');
    expect(payload!.type).toBe('access');
  });

  test('validateAccessToken returns null for invalid token', async () => {
    const payload = await sessionService.validateAccessToken('invalid-token');
    expect(payload).toBeNull();
  });

  test('validateAccessToken rejects refresh token used as access token', async () => {
    const user = await createTestUser();
    const tokens = await sessionService.createSession(user.id);
    const payload = await sessionService.validateAccessToken(tokens.refreshToken);
    expect(payload).toBeNull();
  });

  test('refreshSession returns new tokens (token rotation)', async () => {
    const user = await createTestUser();
    const originalTokens = await sessionService.createSession(user.id);
    const newTokens = await sessionService.refreshSession(originalTokens.refreshToken);

    expect(newTokens).not.toBeNull();
    expect(newTokens!.accessToken).toBeDefined();
    expect(newTokens!.refreshToken).toBeDefined();
    // New tokens should be different from original
    expect(newTokens!.accessToken).not.toBe(originalTokens.accessToken);
    expect(newTokens!.refreshToken).not.toBe(originalTokens.refreshToken);
  });

  test('refreshSession invalidates old session', async () => {
    const user = await createTestUser();
    const originalTokens = await sessionService.createSession(user.id);
    await sessionService.refreshSession(originalTokens.refreshToken);

    // Old access token should no longer be valid
    const payload = await sessionService.validateAccessToken(originalTokens.accessToken);
    expect(payload).toBeNull();
  });

  test('refreshSession returns null for invalid token', async () => {
    const result = await sessionService.refreshSession('invalid-token');
    expect(result).toBeNull();
  });

  test('refreshSession rejects access token used as refresh token', async () => {
    const user = await createTestUser();
    const tokens = await sessionService.createSession(user.id);
    const result = await sessionService.refreshSession(tokens.accessToken);
    expect(result).toBeNull();
  });

  test('invalidateSession removes session', async () => {
    const user = await createTestUser();
    const tokens = await sessionService.createSession(user.id);

    await sessionService.invalidateSession(tokens.accessToken);

    const payload = await sessionService.validateAccessToken(tokens.accessToken);
    expect(payload).toBeNull();
  });

  test('invalidateAllUserSessions removes all sessions', async () => {
    const user = await createTestUser();
    const tokens1 = await sessionService.createSession(user.id);
    const tokens2 = await sessionService.createSession(user.id);

    await sessionService.invalidateAllUserSessions(user.id);

    expect(await sessionService.validateAccessToken(tokens1.accessToken)).toBeNull();
    expect(await sessionService.validateAccessToken(tokens2.accessToken)).toBeNull();
  });

  test('cleanupExpiredSessions runs without error', async () => {
    // Should not throw even with no expired sessions
    await sessionService.cleanupExpiredSessions();
  });
});
