import { useState, useEffect, useCallback } from 'react';
import { useSettings } from './useSettings';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { HubUser, HubUserInstanceRole } from '@kubefoundry/shared';

const AUTH_TOKEN_KEY = 'kubefoundry_auth_token';
const AUTH_USERNAME_KEY = 'kubefoundry_auth_username';

export interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  username: string | null;
  authEnabled: boolean;
  hubMode: boolean;
  error: string | null;
}

export interface HubUserInfo extends HubUser {
  instances: HubUserInstanceRole[];
}

export interface UseAuthReturn extends AuthState {
  login: (token: string, username?: string) => void;
  logout: () => void;
  getToken: () => string | null;
  checkTokenFromUrl: () => boolean;
}

/**
 * React Query hook that fetches /api/auth/me (only enabled in hub mode)
 */
export function useAuthMe(hubMode: boolean) {
  return useQuery<HubUserInfo>({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.status === 401) {
        // Try refresh first
        const refreshResponse = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        });
        if (refreshResponse.ok) {
          // Retry /me after successful refresh
          const retryResponse = await fetch('/api/auth/me', { credentials: 'include' });
          if (!retryResponse.ok) throw new Error('Not authenticated');
          return retryResponse.json();
        }
        throw new Error('Not authenticated');
      }
      if (!response.ok) throw new Error('Failed to fetch user info');
      return response.json();
    },
    enabled: hubMode,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
}

/**
 * Hook for managing authentication state
 * Handles token storage, URL-based login (magic link), and session-based auth (hub mode)
 */
export function useAuth(): UseAuthReturn {
  const { data: settings, isLoading: settingsLoading } = useSettings();
  const queryClient = useQueryClient();
  const hubMode = settings?.auth?.hubMode ?? false;

  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    username: null,
    authEnabled: false,
    hubMode: false,
    error: null,
  });

  // Hub mode: use /api/auth/me to check session
  const { data: hubUser, isLoading: hubUserLoading, error: hubUserError } = useAuthMe(hubMode);

  /**
   * Get stored token from localStorage
   */
  const getToken = useCallback((): string | null => {
    try {
      return localStorage.getItem(AUTH_TOKEN_KEY);
    } catch {
      return null;
    }
  }, []);

  /**
   * Login with a token (single-cluster mode only)
   */
  const login = useCallback((token: string, username?: string) => {
    try {
      localStorage.setItem(AUTH_TOKEN_KEY, token);
      if (username) {
        localStorage.setItem(AUTH_USERNAME_KEY, username);
      }
      
      const extractedUsername = username || extractUsernameFromToken(token);
      
      setState(prev => ({
        ...prev,
        isAuthenticated: true,
        username: extractedUsername,
        error: null,
      }));
    } catch {
      setState(prev => ({
        ...prev,
        error: 'Failed to save authentication token',
      }));
    }
  }, []);

  /**
   * Logout - clear stored credentials or session cookie
   */
  const logout = useCallback(async () => {
    if (hubMode) {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch {
        // Ignore network errors during logout
      }
      queryClient.removeQueries({ queryKey: ['auth-me'] });
      setState(prev => ({
        ...prev,
        isAuthenticated: false,
        username: null,
      }));
    } else {
      try {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USERNAME_KEY);
        setState(prev => ({
          ...prev,
          isAuthenticated: false,
          username: null,
        }));
      } catch {
        // Ignore errors when clearing
      }
    }
  }, [hubMode, queryClient]);

  /**
   * Check URL hash for token (magic link login, single-cluster mode only)
   */
  const checkTokenFromUrl = useCallback((): boolean => {
    if (hubMode) return false;

    try {
      const hash = window.location.hash;
      if (!hash || !hash.includes('token=')) {
        return false;
      }

      const params = new URLSearchParams(hash.slice(1));
      const token = params.get('token');
      
      if (token) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
        login(decodeURIComponent(token));
        return true;
      }
    } catch (error) {
      console.error('Error parsing token from URL:', error);
    }
    return false;
  }, [login, hubMode]);

  /**
   * Initialize auth state — hub mode uses session cookies, single-cluster uses localStorage
   */
  useEffect(() => {
    if (settingsLoading) {
      return;
    }

    const authEnabled = settings?.auth?.enabled ?? false;

    if (hubMode) {
      // Hub mode: auth state is derived from /api/auth/me query
      if (hubUserLoading) {
        setState(prev => ({ ...prev, isLoading: true, authEnabled, hubMode: true }));
        return;
      }

      if (hubUser) {
        setState({
          isAuthenticated: true,
          isLoading: false,
          username: hubUser.displayName || hubUser.email,
          authEnabled,
          hubMode: true,
          error: null,
        });
      } else {
        setState({
          isAuthenticated: false,
          isLoading: false,
          username: null,
          authEnabled,
          hubMode: true,
          error: hubUserError ? 'Not authenticated' : null,
        });
      }
      return;
    }

    // Single-cluster mode: existing localStorage behavior
    const tokenFromUrl = checkTokenFromUrl();
    
    if (tokenFromUrl) {
      setState(prev => ({
        ...prev,
        isLoading: false,
        authEnabled,
        hubMode: false,
      }));
      return;
    }

    const storedToken = getToken();
    const storedUsername = localStorage.getItem(AUTH_USERNAME_KEY);

    if (storedToken) {
      setState({
        isAuthenticated: true,
        isLoading: false,
        username: storedUsername || extractUsernameFromToken(storedToken),
        authEnabled,
        hubMode: false,
        error: null,
      });
    } else {
      setState({
        isAuthenticated: false,
        isLoading: false,
        username: null,
        authEnabled,
        hubMode: false,
        error: null,
      });
    }
  }, [settings, settingsLoading, hubMode, hubUser, hubUserLoading, hubUserError, checkTokenFromUrl, getToken]);

  /**
   * Listen for auth:unauthorized events (401 responses)
   */
  useEffect(() => {
    const handleUnauthorized = () => {
      if (hubMode) {
        queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      } else {
        logout();
      }
      setState(prev => ({
        ...prev,
        error: 'Session expired. Please login again.',
      }));
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [logout, hubMode, queryClient]);

  return {
    ...state,
    login,
    logout,
    getToken,
    checkTokenFromUrl,
  };
}

/**
 * Extract username from JWT token payload
 */
function extractUsernameFromToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    return payload.email || payload.preferred_username || payload.sub || null;
  } catch {
    return null;
  }
}
