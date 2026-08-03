import type { ReactNode } from 'react'
import { ContentValidationError } from '../content/validation'

/**
 * Content-error screen.
 *
 * Invalid course content is never rendered partially. In production the learner sees
 * the failing file, object and field — enough for an author to fix it — but never a raw
 * stack trace.
 */
export function ContentErrorScreen({ error }: { error: unknown }): ReactNode {
  const issues = error instanceof ContentValidationError ? error.issues : []

  return (
    <div className="auth-screen">
      <main className="auth-card" style={{ maxWidth: '42rem' }}>
        <h1>Obsah kurzu se nepodařilo načíst</h1>
        <p>
          Data lekcí neprošla kontrolou, a proto se nezobrazují. Nejde o chybu vašeho
          zařízení ani o ztrátu vašeho postupu.
        </p>

        {issues.length > 0 ? (
          <>
            <h2>Nalezené problémy</h2>
            <ul>
              {issues.map((issue, index) => (
                <li key={`${issue.file}-${index}`}>
                  <strong>{issue.file}</strong>
                  {issue.objectId !== null && <> · objekt <code>{issue.objectId}</code></>}
                  {issue.field !== '' && <> · pole <code>{issue.field}</code></>}
                  <div>{issue.reason}</div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="error-text">
            {error instanceof Error ? error.message : 'Neznámá chyba obsahu.'}
          </p>
        )}

        <p className="meta-line">
          Autor obsahu chybu ověří příkazem <code>npm run content:validate</code>.
        </p>
      </main>
    </div>
  )
}
