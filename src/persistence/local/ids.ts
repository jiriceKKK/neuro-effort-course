/**
 * Stable identifier helpers.
 *
 * Every event and attempt gets a UUID generated on the client *before* it is stored.
 * That is what makes synchronisation idempotent: re-pushing a row that already reached
 * Supabase conflicts on the primary key instead of creating a duplicate.
 */

export function newUuid(): string {
  const globalCrypto = globalThis.crypto
  if (globalCrypto !== undefined && typeof globalCrypto.randomUUID === 'function') {
    return globalCrypto.randomUUID()
  }
  if (globalCrypto !== undefined && typeof globalCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    globalCrypto.getRandomValues(bytes)
    // RFC 4122 version 4 / variant 10xx
    bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40
    bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
  throw new Error('Prostředí neposkytuje bezpečný generátor náhodných čísel.')
}

/** Composite local key for tables whose primary key is (userId, secondary). */
export function compositeKey(userId: string, secondary: string): string {
  return `${userId}::${secondary}`
}

export function parseCompositeKey(key: string): { userId: string; secondary: string } {
  const separator = key.indexOf('::')
  if (separator === -1) throw new Error(`Neplatný složený klíč: ${key}`)
  return { userId: key.slice(0, separator), secondary: key.slice(separator + 2) }
}
