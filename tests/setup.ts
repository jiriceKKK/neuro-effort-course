import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

/**
 * Test environment.
 *
 * Two guarantees matter here:
 *  1. IndexedDB is the in-memory `fake-indexeddb` implementation, so persistence tests
 *     are real Dexie round-trips without a browser;
 *  2. no test can reach a real Supabase project — `fetch` is stubbed to reject, so an
 *     accidental network call fails loudly instead of silently hitting production.
 */

vi.stubGlobal(
  'fetch',
  vi.fn(async (input: RequestInfo | URL) => {
    throw new Error(
      `Testy nesmí volat síť. Zachyceno volání: ${typeof input === 'string' ? input : String(input)}`,
    )
  }),
)

if (globalThis.crypto === undefined) {
  const { webcrypto } = await import('node:crypto')
  vi.stubGlobal('crypto', webcrypto)
}

afterEach(() => {
  cleanup()
})
