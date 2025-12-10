import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { huggingFaceApi } from '@/lib/api';
import type { HfSecretStatus, HfTokenExchangeResponse, HfModelSearchResponse } from '@kubefoundry/shared';

// HuggingFace token storage key (for model search)
const HF_ACCESS_TOKEN_KEY = 'hf_access_token';

/**
 * PKCE code verifier storage key
 */
const PKCE_VERIFIER_KEY = 'hf_oauth_code_verifier';
const PKCE_STATE_KEY = 'hf_oauth_state';

/**
 * Generate a cryptographically secure random string for PKCE
 */
function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate PKCE code verifier (43-128 characters)
 */
function generateCodeVerifier(): string {
  // Generate 32 bytes = 64 hex chars (within 43-128 range)
  return generateRandomString(32);
}

/**
 * Generate PKCE code challenge from verifier using SHA-256
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  
  // Base64url encode the digest
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Generate a random state parameter for CSRF protection
 */
function generateState(): string {
  return generateRandomString(16);
}

/**
 * Hook to get HuggingFace secret status
 */
export function useHuggingFaceStatus() {
  return useQuery<HfSecretStatus>({
    queryKey: ['huggingface', 'status'],
    queryFn: () => huggingFaceApi.getSecretStatus(),
    staleTime: 30000, // 30 seconds
    refetchOnMount: 'always', // Always refetch when component mounts
    retry: 1,
  });
}

/**
 * Hook to save HuggingFace token
 */
export function useSaveHuggingFaceToken() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (accessToken: string) => huggingFaceApi.saveSecret({ accessToken }),
    onSuccess: async () => {
      // Wait for the status query to be invalidated and refetched
      await queryClient.invalidateQueries({ queryKey: ['huggingface', 'status'] });
    },
  });
}

/**
 * Hook to delete HuggingFace secrets
 */
export function useDeleteHuggingFaceSecret() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => huggingFaceApi.deleteSecret(),
    onSuccess: async () => {
      // Clear localStorage token when disconnecting
      clearHfAccessToken();
      // Wait for the status query to be invalidated and refetched
      await queryClient.invalidateQueries({ queryKey: ['huggingface', 'status'] });
    },
  });
}

/**
 * Hook to exchange OAuth authorization code for token
 */
export function useExchangeHuggingFaceToken() {
  return useMutation({
    mutationFn: async ({
      code,
      redirectUri,
    }: {
      code: string;
      redirectUri: string;
    }): Promise<HfTokenExchangeResponse> => {
      // Retrieve the code verifier from session storage
      const codeVerifier = sessionStorage.getItem(PKCE_VERIFIER_KEY);
      if (!codeVerifier) {
        throw new Error('PKCE code verifier not found. Please restart the OAuth flow.');
      }

      // Clean up session storage
      sessionStorage.removeItem(PKCE_VERIFIER_KEY);
      sessionStorage.removeItem(PKCE_STATE_KEY);

      return huggingFaceApi.exchangeToken({
        code,
        codeVerifier,
        redirectUri,
      });
    },
  });
}

/**
 * Hook providing HuggingFace OAuth utilities
 */
export function useHuggingFaceOAuth() {
  /**
   * Initiate the OAuth flow by redirecting to HuggingFace
   */
  const startOAuth = async () => {
    // Get OAuth config from backend
    const config = await huggingFaceApi.getOAuthConfig();

    // Generate PKCE values
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();

    // Store verifier and state in session storage for callback
    sessionStorage.setItem(PKCE_VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(PKCE_STATE_KEY, state);

    // Build authorization URL
    const redirectUri = `${window.location.origin}/oauth/callback/huggingface`;
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    // Redirect to HuggingFace authorization
    window.location.href = `${config.authorizeUrl}?${params.toString()}`;
  };

  /**
   * Validate the state parameter from the OAuth callback
   */
  const validateState = (returnedState: string): boolean => {
    const storedState = sessionStorage.getItem(PKCE_STATE_KEY);
    return storedState === returnedState;
  };

  /**
   * Check if we have a pending OAuth flow
   */
  const hasPendingOAuth = (): boolean => {
    return !!sessionStorage.getItem(PKCE_VERIFIER_KEY);
  };

  /**
   * Clear OAuth session data (for error handling or cleanup)
   */
  const clearOAuthSession = () => {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY);
    sessionStorage.removeItem(PKCE_STATE_KEY);
  };

  return {
    startOAuth,
    validateState,
    hasPendingOAuth,
    clearOAuthSession,
  };
}

/**
 * Get stored HuggingFace access token (for model search)
 */
export function getHfAccessToken(): string | null {
  try {
    return localStorage.getItem(HF_ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Save HuggingFace access token (for model search)
 */
export function saveHfAccessToken(token: string): void {
  try {
    localStorage.setItem(HF_ACCESS_TOKEN_KEY, token);
  } catch {
    console.warn('Failed to save HF access token to localStorage');
  }
}

/**
 * Clear stored HuggingFace access token
 */
export function clearHfAccessToken(): void {
  try {
    localStorage.removeItem(HF_ACCESS_TOKEN_KEY);
  } catch {
    // Ignore errors
  }
}

/**
 * Hook to search HuggingFace models
 * 
 * @param query - Search query string (must be at least 2 characters)
 * @param options - Search options (limit, offset)
 * @returns Query result with compatible models
 */
export function useHfModelSearch(
  query: string,
  options?: { limit?: number; offset?: number }
) {
  const hfToken = getHfAccessToken();

  return useQuery<HfModelSearchResponse>({
    queryKey: ['huggingface', 'models', 'search', query, options?.limit, options?.offset],
    queryFn: () => huggingFaceApi.searchModels(query, {
      limit: options?.limit ?? 20,
      offset: options?.offset ?? 0,
      hfToken: hfToken ?? undefined,
    }),
    enabled: query.length >= 2,
    staleTime: 60000, // 60 seconds
    retry: 1,
    placeholderData: (previousData) => previousData,
  });
}
