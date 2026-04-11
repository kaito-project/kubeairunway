/**
 * Test helpers for shared/api client tests.
 *
 * Centralizes the RequestFn mock so individual test files don't need
 * to repeat the `as unknown as RequestFn` cast required to bridge
 * vitest's Mock type to our generic RequestFn signature.
 */

import { vi, type Mock } from 'vitest';
import type { RequestFn } from './client';

/**
 * Create a mocked RequestFn that resolves to the given value on every call.
 *
 * Returns a `vi.fn()` typed as both `RequestFn` (so it satisfies the factory
 * signatures) and `Mock` (so tests can use `.toHaveBeenCalledWith` etc.).
 */
export function mockRequest<T>(response: T): RequestFn & Mock {
  return vi.fn().mockResolvedValue(response) as unknown as RequestFn & Mock;
}
