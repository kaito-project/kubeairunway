import { sign, verify } from 'hono/jwt';
import { sessionRepository, userRepository } from './database';
import logger from '../lib/logger';

const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-in-production';
const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

export interface SessionPayload {
  sub: string; // user ID
  email: string;
  displayName: string;
  provider: string;
  type: 'access' | 'refresh';
  iat: number;
  exp: number;
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

class SessionService {
  async createSession(userId: string): Promise<SessionTokens> {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const now = Math.floor(Date.now() / 1000);

    const accessPayload = {
      sub: userId,
      email: user.email,
      displayName: user.displayName,
      provider: user.provider,
      type: 'access' as const,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + ACCESS_TOKEN_TTL,
    };

    const refreshPayload = {
      sub: userId,
      type: 'refresh' as const,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + REFRESH_TOKEN_TTL,
    };

    const accessToken = await sign(accessPayload, SESSION_SECRET);
    const refreshToken = await sign(refreshPayload, SESSION_SECRET);

    const tokenHash = await hashToken(accessToken);
    const refreshTokenHash = await hashToken(refreshToken);
    const expiresAt = new Date((now + REFRESH_TOKEN_TTL) * 1000);

    await sessionRepository.create(userId, tokenHash, refreshTokenHash, expiresAt);

    logger.debug({ userId }, 'Session created');

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL,
    };
  }

  async validateAccessToken(token: string): Promise<SessionPayload | null> {
    try {
      const payload = (await verify(token, SESSION_SECRET)) as unknown as SessionPayload;

      if (payload.type !== 'access') {
        return null;
      }

      const tokenHash = await hashToken(token);
      const session = await sessionRepository.findByTokenHash(tokenHash);
      if (!session) {
        return null;
      }

      if (new Date() > session.expiresAt) {
        await sessionRepository.delete(session.id);
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  async refreshSession(refreshToken: string): Promise<SessionTokens | null> {
    try {
      const payload = (await verify(refreshToken, SESSION_SECRET)) as unknown as {
        sub: string;
        type: string;
        exp: number;
      };

      if (payload.type !== 'refresh') {
        return null;
      }

      const refreshTokenHash = await hashToken(refreshToken);
      const session = await sessionRepository.findByRefreshTokenHash(refreshTokenHash);
      if (!session) {
        return null;
      }

      if (new Date() > session.expiresAt) {
        await sessionRepository.delete(session.id);
        return null;
      }

      // Token rotation: delete old session, create new one
      await sessionRepository.delete(session.id);
      return this.createSession(session.userId);
    } catch {
      return null;
    }
  }

  async invalidateSession(accessToken: string): Promise<void> {
    const tokenHash = await hashToken(accessToken);
    const session = await sessionRepository.findByTokenHash(tokenHash);
    if (session) {
      await sessionRepository.delete(session.id);
      logger.debug({ userId: session.userId }, 'Session invalidated');
    }
  }

  async invalidateAllUserSessions(userId: string): Promise<void> {
    await sessionRepository.deleteByUserId(userId);
    logger.debug({ userId }, 'All user sessions invalidated');
  }

  async cleanupExpiredSessions(): Promise<void> {
    const count = await sessionRepository.deleteExpired();
    if (count > 0) {
      logger.info({ count }, 'Cleaned up expired sessions');
    }
  }
}

export const sessionService = new SessionService();
