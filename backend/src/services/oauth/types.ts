export interface OAuthUserInfo {
  email: string;
  displayName: string;
  providerId: string;
  avatarUrl?: string;
  groups?: string[];
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
}

export interface OAuthProvider {
  readonly type: 'entra' | 'github';

  /** Generate the authorization URL for OAuth redirect */
  getAuthUrl(redirectUri: string, state: string, codeChallenge: string): string;

  /** Exchange authorization code for tokens */
  exchangeCode(code: string, redirectUri: string, codeVerifier: string): Promise<OAuthTokens>;

  /** Get user info from the provider using access token */
  getUserInfo(tokens: OAuthTokens): Promise<OAuthUserInfo>;

  /** Refresh an access token (optional) */
  refreshToken?(refreshToken: string): Promise<OAuthTokens>;
}
