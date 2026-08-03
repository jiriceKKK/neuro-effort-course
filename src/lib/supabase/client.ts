import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readSupabaseConfig, type SupabaseConfig, type SupabaseConfigResult } from './config'

/**
 * The Supabase client is created exactly once.
 *
 * Multiple clients would each install their own auth listener and storage lock, which
 * shows up as sessions that refresh twice or log each other out. Sessions are persisted
 * so an installed PWA restores the login after a cold start.
 */

let cachedConfig: SupabaseConfigResult | null = null
let client: SupabaseClient | null = null

export function getSupabaseConfigResult(): SupabaseConfigResult {
  cachedConfig ??= readSupabaseConfig(import.meta.env)
  return cachedConfig
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConfigResult().ok
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const result = getSupabaseConfigResult()
  return result.ok ? result.config : null
}

export function isSignupAllowed(): boolean {
  return getSupabaseConfig()?.allowSignup ?? false
}

/** Returns the shared client, or `null` when the app is not configured. */
export function getSupabaseClient(): SupabaseClient | null {
  if (client !== null) return client
  const result = getSupabaseConfigResult()
  if (!result.ok) return null

  client = createClient(result.config.url, result.config.publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The app uses HashRouter, so there is never an auth code in the query string.
      detectSessionInUrl: false,
      storageKey: 'neuro-effort-course-auth',
    },
  })
  return client
}

/** Test hook: inject a fake client and configuration so no production project is touched. */
export function setSupabaseTestClient(
  next: SupabaseClient | null,
  config: SupabaseConfigResult | null = null,
): void {
  client = next
  cachedConfig = config
}
