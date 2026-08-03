/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/**
 * Build-time environment.
 *
 * Only these three values reach the browser bundle. Anything secret — a service-role
 * key, an `sb_secret_…` key, the database password — must never be added here, because
 * every `VITE_` variable is inlined into public JavaScript.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_ALLOW_SIGNUP?: string
  readonly VITE_BASE_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
