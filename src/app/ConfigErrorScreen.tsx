import type { ReactNode } from 'react'
import { MISSING_CONFIG_MESSAGE } from '../lib/supabase/config'
import { getSupabaseConfigResult } from '../lib/supabase/client'

/**
 * Shown instead of a cryptic runtime crash when the Supabase configuration is missing.
 * Names the exact variables and the exact file, in Czech.
 */
export function ConfigErrorScreen(): ReactNode {
  const result = getSupabaseConfigResult()
  const missing = result.ok ? [] : result.missing

  return (
    <div className="auth-screen">
      <main className="auth-card">
        <h1>Chybí nastavení aplikace</h1>
        <p className="preformatted">{MISSING_CONFIG_MESSAGE}</p>

        {missing.length > 0 && (
          <>
            <h2>Chybějící proměnné</h2>
            <ul>
              {missing.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="meta-line">
          Vzor najdete v souboru <code>.env.example</code>. Do prohlížeče nikdy nepatří
          service-role klíč, tajný klíč ani heslo k databázi.
        </p>
      </main>
    </div>
  )
}
