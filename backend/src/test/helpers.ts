/**
 * Shared test helpers for backend e2e tests.
 * Provides mock factories and utilities used across test files.
 */

import { mock } from 'bun:test';

/**
 * Add timeout to async operations for K8s-dependent tests.
 * Used to gracefully skip tests when no cluster is available.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]);
}

/** Default timeout for K8s-dependent tests */
export const K8S_TEST_TIMEOUT = 2000;

/**
 * Creates a mock fetch function that returns a predefined JSON response.
 * Returns a restore function to reset globalThis.fetch.
 */
export function mockFetch(
  response: unknown,
  options?: { ok?: boolean; status?: number }
): () => void {
  const originalFetch = globalThis.fetch;
  // @ts-expect-error - mocking fetch for tests
  globalThis.fetch = mock(() =>
    Promise.resolve({
      ok: options?.ok ?? true,
      status: options?.status ?? 200,
      statusText: 'OK',
      json: () => Promise.resolve(response),
    } as Response)
  );
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/**
 * Helper type for service mock setup.
 * Returns the original method so it can be restored in afterEach.
 */
export type MockRestore<T> = { original: T; restore: () => void };

/**
 * Replace a method on a service singleton and return a restore function.
 *
 * Usage:
 *   const restore = mockServiceMethod(autoscalerService, 'detectAutoscaler', async () => fixture);
 *   // ... run test ...
 *   restore();
 */
export function mockServiceMethod<S extends Record<string, any>, K extends keyof S>(
  service: S,
  method: K,
  implementation: S[K],
): () => void {
  const original = service[method];
  service[method] = implementation;
  return () => {
    service[method] = original;
  };
}
