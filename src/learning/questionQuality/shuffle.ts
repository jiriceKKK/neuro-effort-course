/**
 * Deterministic option shuffling.
 *
 * Two callers need different things from the same algorithm:
 *  - the lesson runner shuffles with a random seed once per attempt, then stores the
 *    resulting order so a reload cannot reshuffle a half-finished question;
 *  - the MCQ audit shuffles with a seed derived from the question ID, so the reported
 *    position distribution is reproducible across machines and CI runs.
 *
 * Correctness is never a function of position — evaluation always compares option IDs.
 */

/** mulberry32: small, fast, and stable across engines. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a over UTF-16 code units — deterministic seed from any string key. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Fisher–Yates. Returns a new array; the input is never mutated. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const random = createRandom(seed)
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const a = result[i] as T
    const b = result[j] as T
    result[i] = b
    result[j] = a
  }
  return result
}

/** Cryptographically random seed for a fresh learner attempt. */
export function randomSeed(): number {
  const globalCrypto = globalThis.crypto
  if (globalCrypto !== undefined && typeof globalCrypto.getRandomValues === 'function') {
    const buffer = new Uint32Array(1)
    globalCrypto.getRandomValues(buffer)
    return buffer[0] as number
  }
  return Math.floor(Math.random() * 0xffffffff)
}

/**
 * Reorders option IDs for display.
 *
 * @param optionIds IDs in authoring order.
 * @param seed Omit for a fresh random attempt; pass a value to reproduce an order.
 */
export function shuffleOptionIds(optionIds: readonly string[], seed = randomSeed()): string[] {
  return seededShuffle(optionIds, seed)
}
