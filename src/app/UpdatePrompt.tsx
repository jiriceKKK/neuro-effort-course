import { useState, type ReactNode } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Czech prompt shown when a new build is waiting.
 *
 * The service worker is registered with `registerType: 'prompt'`, so it never takes over
 * an open lesson without asking — an unannounced reload mid-answer would lose context.
 *
 * This component is rendered from main.tsx only: the `virtual:pwa-register/react` module
 * exists solely in a Vite build with the PWA plugin, and keeping it out of App.tsx lets
 * the test suite render the application without the plugin.
 */
export function UpdatePrompt(): ReactNode {
  const [dismissed, setDismissed] = useState(false)
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error: unknown) {
      console.error('Service worker se nepodařilo zaregistrovat:', error)
    },
  })

  if (!needRefresh || dismissed) return null

  return (
    <div className="update-prompt" role="alertdialog" aria-labelledby="update-prompt-title">
      <p id="update-prompt-title" style={{ fontWeight: 600 }}>
        Je dostupná nová verze aplikace.
      </p>
      <div className="cluster">
        <button type="button" className="button" onClick={() => void updateServiceWorker(true)}>
          Aktualizovat
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => setDismissed(true)}
        >
          Později
        </button>
      </div>
    </div>
  )
}
