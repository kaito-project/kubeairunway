import type { OAuthProvider, OAuthTokens, OAuthUserInfo } from './types';
import logger from '../../lib/logger';

export class GitHubOAuthProvider implements OAuthProvider {
  readonly type = 'github' as const;

  constructor(
    private clientId: string,
    private clientSecret: string,
  ) {}

  getAuthUrl(redirectUri: string, state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email read:org',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string, _codeVerifier: string): Promise<OAuthTokens> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'GitHub token exchange failed');
      throw new Error(`GitHub token exchange failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.error) {
      logger.error({ error: data.error, description: data.error_description }, 'GitHub OAuth error');
      throw new Error(`GitHub OAuth error: ${data.error_description || data.error}`);
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  async getUserInfo(tokens: OAuthTokens): Promise<OAuthUserInfo> {
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: 'application/vnd.github+json',
    };

    // Fetch user profile
    const userResponse = await fetch('https://api.github.com/user', { headers });
    if (!userResponse.ok) {
      throw new Error(`GitHub user info fetch failed: ${userResponse.status}`);
    }
    const user = await userResponse.json();

    // If email is not public, fetch from /user/emails
    let email: string = user.email || '';
    if (!email) {
      email = await this.fetchPrimaryEmail(headers);
    }

    // Fetch org memberships for groups
    const groups = await this.fetchOrgMemberships(headers);

    return {
      email,
      displayName: user.name || user.login || '',
      providerId: String(user.id),
      avatarUrl: user.avatar_url,
      groups,
    };
  }

  private async fetchPrimaryEmail(headers: Record<string, string>): Promise<string> {
    try {
      const response = await fetch('https://api.github.com/user/emails', { headers });
      if (!response.ok) return '';

      const emails: Array<{ email: string; primary: boolean; verified: boolean }> = await response.json();
      const primary = emails.find((e) => e.primary && e.verified);
      return primary?.email || emails.find((e) => e.verified)?.email || '';
    } catch {
      logger.warn('Failed to fetch GitHub user emails');
      return '';
    }
  }

  private async fetchOrgMemberships(headers: Record<string, string>): Promise<string[] | undefined> {
    try {
      const response = await fetch('https://api.github.com/user/orgs', { headers });
      if (!response.ok) return undefined;

      const orgs: Array<{ login: string }> = await response.json();
      return orgs.map((o) => o.login);
    } catch {
      logger.warn('Failed to fetch GitHub org memberships');
      return undefined;
    }
  }
}
