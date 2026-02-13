/**
 * Shared API Client for KubeAIRunway
 *
 * This module provides a configurable API client that works in both
 * the main frontend (browser) and the Headlamp plugin environments.
 *
 * Usage:
 * ```typescript
 * const client = createApiClient({
 *   baseUrl: 'http://localhost:3001',
 *   getToken: () => localStorage.getItem('token'),
 * });
 *
 * const deployments = await client.deployments.list();
 * ```
 */

/**
 * Configuration for the API client
 */
export interface ApiClientConfig {
  /**
   * Base URL for API requests (e.g., 'http://localhost:3001' or '')
   * Empty string means same-origin requests
   */
  baseUrl: string;

  /**
   * Function to retrieve the authentication token
   * Return null if no token is available
   */
  getToken: () => string | null;

  /**
   * Optional callback when a 401 Unauthorized response is received
   */
  onUnauthorized?: () => void;

  /**
   * Optional custom fetch implementation (for testing or special environments)
   */
  fetchImpl?: typeof fetch;
}

/**
 * API Error with status code information
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Creates a request function configured with the given options
 */
export function createRequestFn(config: ApiClientConfig) {
  const fetchFn = config.fetchImpl || fetch;

  return async function request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${config.baseUrl}/api${endpoint}`;

    // Build headers with auth token if available
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    };

    const token = config.getToken();
    if (token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetchFn(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      // Handle 401 Unauthorized
      if (response.status === 401 && config.onUnauthorized) {
        config.onUnauthorized();
      }

      // Try to parse error response body
      let errorMessage: string;
      try {
        const error = await response.json();
        errorMessage =
          error.error?.message ||
          error.message ||
          `Request failed with status ${response.status}`;
      } catch {
        // Response body is empty or not valid JSON
        errorMessage = `Request failed with status ${response.status}: ${response.statusText || 'No response body'}`;
      }

      throw new ApiError(response.status, errorMessage);
    }

    return response.json();
  };
}

/**
 * Type for the request function
 */
export type RequestFn = ReturnType<typeof createRequestFn>;
