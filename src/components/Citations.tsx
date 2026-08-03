import type { ReactNode } from 'react'
import { formatCitation, resolveSources } from '../content/loader'

/**
 * Citations under any factual claim.
 *
 * Sources are resolved through the content loader, which fails validation if an ID is
 * unknown — a citation can therefore never silently disappear from the UI.
 */
export function Citations({ sourceIds }: { sourceIds: readonly string[] }): ReactNode {
  if (sourceIds.length === 0) return null
  const sources = resolveSources(sourceIds)

  return (
    <aside className="citations">
      <h3 className="visually-hidden">Zdroje</h3>
      <span aria-hidden="true">Zdroje</span>
      <ul className="citations__list">
        {sources.map((source) => (
          <li key={source.id}>
            {formatCitation(source)}{' '}
            {source.doi !== undefined && (
              <a
                href={`https://doi.org/${source.doi}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                DOI: {source.doi}
              </a>
            )}
            {source.note !== undefined && <div>{source.note}</div>}
          </li>
        ))}
      </ul>
    </aside>
  )
}
