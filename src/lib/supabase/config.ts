/**
 * Frontend Supabase configuration.
 *
 * The browser bundle uses exactly two secrets-adjacent values, both of which are safe to
 * ship *only* because Row Level Security is enabled on every user table. A service-role
 * key, a `sb_secret_…` key or the database password must never appear in a VITE_
 * variable — everything with that prefix is embedded in public JavaScript.
 */

export interface SupabaseConfig {
  url: string
  publishableKey: string
  allowSignup: boolean
}

export type SupabaseConfigResult =
  | { ok: true; config: SupabaseConfig }
  | { ok: false; missing: string[] }

export interface RawEnv {
  VITE_SUPABASE_URL?: string | undefined
  VITE_SUPABASE_PUBLISHABLE_KEY?: string | undefined
  VITE_ALLOW_SIGNUP?: string | undefined
}

export function readSupabaseConfig(env: RawEnv): SupabaseConfigResult {
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''

  const missing: string[] = []
  if (url === '') missing.push('VITE_SUPABASE_URL')
  if (publishableKey === '') missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  if (missing.length > 0) return { ok: false, missing }

  return {
    ok: true,
    config: {
      url,
      publishableKey,
      allowSignup: (env.VITE_ALLOW_SIGNUP ?? 'false').trim().toLowerCase() === 'true',
    },
  }
}

/** Czech configuration-error text shown instead of a cryptic runtime crash. */
export const MISSING_CONFIG_MESSAGE =
  'Aplikace není připojena k databázi.\n\n' +
  'Doplňte proměnné VITE_SUPABASE_URL a\nVITE_SUPABASE_PUBLISHABLE_KEY do souboru .env.local.'
