import type { OAuthProvider, OAuthTokens, OAuthUserInfo } from './types';
import logger from '../../lib/logger';

export class EntraOAuthProvider implements OAuthProvider {
  readonly type = 'entra' as const;
  private authority: string;

  constructor(
    private clientId: string,
    private tenantId: string,
    private clientSecret?: string,
  ) {
    this.authority = `https://login.microsoftonline.com/${tenantId}`;
  }

  getAuthUrl(redirectUri: string, state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email User.Read',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${this.authority}/oauth2/v2.0/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });

    if (this.clientSecret) {
      body.set('client_secret', this.clientSecret);
    }

    const response = await fetch(`${this.authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Entra token exchange failed');
      throw new Error(`Entra token exchange failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresIn: data.expires_in,
    };
  }

  async getUserInfo(tokens: OAuthTokens): Promise<OAuthUserInfo> {
    // Try to extract claims from ID token first
    const idClaims = tokens.idToken ? this.parseIdTokenClaims(tokens.idToken) : null;

    // Fall back to Graph API for user info
    const graphUser = await this.fetchGraphUser(tokens.accessToken);

    const email = graphUser.mail || graphUser.userPrincipalName || idClaims?.email || idClaims?.preferred_username || '';
    const displayName = graphUser.displayName || idClaims?.name || '';
    const providerId = graphUser.id || idClaims?.oid || idClaims?.sub || '';

    // Extract groups from ID token claims if available, otherwise fetch from Graph
    let groups: string[] | undefined;
    if (idClaims?._claim_names && typeof idClaims._claim_names === 'object' && 'groups' in (idClaims._claim_names as object)) {
      // Group overage: too many groups for ID token, fetch from Graph API
      logger.info('Entra group overage detected, fetching groups from Microsoft Graph API');
      groups = await this.fetchGroupMemberships(tokens.accessToken);
    } else if (idClaims?.groups && Array.isArray(idClaims.groups)) {
      groups = idClaims.groups;
    } else {
      groups = await this.fetchGroupMemberships(tokens.accessToken);
    }

    return { email, displayName, providerId, groups };
  }

  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: refreshToken,
    });

    if (this.clientSecret) {
      body.set('client_secret', this.clientSecret);
    }

    const response = await fetch(`${this.authority}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, 'Entra token refresh failed');
      throw new Error(`Entra token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      idToken: data.id_token,
      expiresIn: data.expires_in,
    };
  }

  /** Decode JWT payload without validation (claims are verified by the token endpoint) */
  private parseIdTokenClaims(idToken: string): Record<string, unknown> | null {
    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload;
    } catch {
      logger.warn('Failed to parse Entra ID token claims');
      return null;
    }
  }

  private async fetchGraphUser(accessToken: string): Promise<Record<string, string>> {
    const response = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Failed to fetch user from Microsoft Graph');
      return {};
    }

    return response.json();
  }

  private async fetchGroupMemberships(accessToken: string): Promise<string[] | undefined> {
    try {
      const response = await fetch('https://graph.microsoft.com/v1.0/me/memberOf', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) return undefined;

      const data = await response.json();
      return data.value
        ?.filter((m: { '@odata.type': string }) => m['@odata.type'] === '#microsoft.graph.group')
        .map((g: { id: string }) => g.id);
    } catch {
      logger.warn('Failed to fetch Entra group memberships');
      return undefined;
    }
  }
}
