/**
 * Test helpers for shared/api client tests.
 *
 * Centralizes the RequestFn mock so individual test files don't need
 * to repeat the `as unknown as RequestFn` cast required to bridge
 * vitest's Mock type to our generic RequestFn signature.
 */

import { vi, type Mock } from 'vitest';
import type { RequestFn } from './client';
import { ApiError } from './client';

// The `as unknown as` cast bridges vitest's Mock type to our generic RequestFn signature.
export function mockRequest(response: unknown): RequestFn & Mock {
  return vi.fn().mockResolvedValue(response) as unknown as RequestFn & Mock;
}

/**
 * Create a mocked RequestFn that rejects with an ApiError.
 *
 * Use this to test how API methods propagate errors from the request layer.
 */
export function mockRequestError(statusCode: number, message: string): RequestFn & Mock {
  return vi.fn().mockRejectedValue(new ApiError(statusCode, message)) as unknown as RequestFn & Mock;
}
