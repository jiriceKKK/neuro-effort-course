import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { getLocalRepository } from '../../persistence/local/repository'
import { useSync } from '../../persistence/sync/syncContext'
import { useAuth } from '../auth/AuthContext'
import { SyncBadge } from '../../components/SyncBadge'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { getSupabaseClient } from '../../lib/supabase/client'
import { SupabaseRemoteRepository } from '../../persistence/remote/remoteRepository'
import { DEFAULT_USER_SETTINGS, LOCAL_USER_ID } from '../../types/learner'

type PendingAction = 'none' | 'reset-local' | 'delete-cloud'

/**
 * Settings and data.
 *
 * Both destructive actions are confirmed separately and the dialog spells out exactly
 * what disappears — wiping the device is not the same as wiping the cloud copy.
 */
export function SettingsScreen(): ReactNode {
  const { user, signOut } = useAuth()
  const { state: syncState, syncNow, notifyLocalChange } = useSync()
  const repository = useMemo(() => getLocalRepository(), [])
  const userId = user?.id ?? LOCAL_USER_ID
  const sessionId = useId()
  const retentionId = useId()

  const [sessionMinutes, setSessionMinutes] = useState<number>(
    DEFAULT_USER_SETTINGS.preferredSessionMinutes,
  )
  const [targetRetention, setTargetRetention] = useState<number>(
    DEFAULT_USER_SETTINGS.targetRetention,
  )
  const [pending, setPending] = useState<PendingAction>('none')
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    void repository.getUserSettings(userId).then((settings) => {
      if (!active) return
      setSessionMinutes(settings.preferredSessionMinutes)
      setTargetRetention(settings.targetRetention)
    })
    return () => {
      active = false
    }
  }, [repository, userId])

  const saveSettings = useCallback(
    async (patch: { preferredSessionMinutes?: number; targetRetention?: number }) => {
      await repository.saveUserSettings(userId, patch)
      notifyLocalChange()
      setMessage('Nastavení bylo uloženo.')
    },
    [notifyLocalChange, repository, userId],
  )

  async function handleExport(): Promise<void> {
    const data = await repository.exportUserData(userId)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `neuro-effort-course-data-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setMessage('Export byl stažen jako soubor JSON.')
  }

  async function handleResetLocal(): Promise<void> {
    setBusy(true)
    await repository.clearLocalData()
    setBusy(false)
    setPending('none')
    setMessage('Lokální data byla smazána. Data v cloudu zůstala nedotčena.')
  }

  async function handleDeleteCloud(): Promise<void> {
    if (user === null) return
    const client = getSupabaseClient()
    if (client === null) {
      setMessage('Aplikace není připojena k databázi, cloudová data nelze smazat.')
      setPending('none')
      return
    }
    setBusy(true)
    try {
      await new SupabaseRemoteRepository(client).deleteAllUserData(user.id)
      setMessage('Data v cloudu byla smazána. Lokální kopie ve vašem zařízení zůstala.')
    } catch (error) {
      setMessage(
        `Smazání cloudových dat se nezdařilo: ${error instanceof Error ? error.message : 'neznámá chyba'}`,
      )
    }
    setBusy(false)
    setPending('none')
  }

  return (
    <article>
      <h1>Nastavení a data</h1>

      <section className="card">
        <h2>Synchronizace</h2>
        <div className="cluster">
          <SyncBadge status={syncState.status} pendingCount={syncState.pendingCount} />
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void syncNow()}
            disabled={syncState.status === 'syncing'}
          >
            Synchronizovat nyní
          </button>
        </div>
        <p className="meta-line">
          {user === null
            ? 'Nejste přihlášeni. Odpovědi se ukládají do zařízení a odešlou se po přihlášení.'
            : `Přihlášeni jako ${user.email ?? user.id}.`}
        </p>
        {syncState.lastSyncedAt !== null && (
          <p className="meta-line">
            Poslední úspěšná synchronizace:{' '}
            {new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'long', timeStyle: 'short' }).format(
              new Date(syncState.lastSyncedAt),
            )}
          </p>
        )}
        {syncState.lastError !== null && (
          <p className="error-text">Poslední chyba: {syncState.lastError}</p>
        )}
      </section>

      <section className="card">
        <h2>Studijní preference</h2>
        <div className="field">
          <label className="field__label" htmlFor={sessionId}>
            Preferovaná délka jedné studijní seance (minuty)
          </label>
          <input
            id={sessionId}
            className="input"
            type="number"
            min={5}
            max={240}
            step={5}
            value={sessionMinutes}
            onChange={(event) => setSessionMinutes(Number(event.target.value))}
            onBlur={() => void saveSettings({ preferredSessionMinutes: sessionMinutes })}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={retentionId}>
            Cílová úspěšnost při opakování
          </label>
          <span className="field__hint">
            Hodnota mezi 0 a 1. Použije se, až prototypový plánovač nahradí plný model.
          </span>
          <input
            id={retentionId}
            className="input"
            type="number"
            min={0.5}
            max={0.99}
            step={0.01}
            value={targetRetention}
            onChange={(event) => setTargetRetention(Number(event.target.value))}
            onBlur={() => void saveSettings({ targetRetention })}
          />
        </div>
      </section>

      <section className="card">
        <h2>Vaše data</h2>
        <div className="cluster">
          <button type="button" className="button button--secondary" onClick={() => void handleExport()}>
            Exportovat data jako JSON
          </button>
          <button
            type="button"
            className="button button--danger"
            onClick={() => setPending('reset-local')}
          >
            Smazat lokální data
          </button>
          {user !== null && (
            <button
              type="button"
              className="button button--danger"
              onClick={() => setPending('delete-cloud')}
            >
              Smazat data v cloudu
            </button>
          )}
        </div>
        <p className="meta-line">
          Export obsahuje postup, odpovědi, plán opakování i osobní poznámky uložené v tomto
          zařízení.
        </p>
      </section>

      {user !== null && (
        <section className="card">
          <h2>Účet</h2>
          <button type="button" className="button button--secondary" onClick={() => void signOut()}>
            Odhlásit se
          </button>
          <p className="meta-line">
            Odhlášení nemaže lokální data. Nesynchronizované odpovědi zůstanou uložené v
            zařízení.
          </p>
        </section>
      )}

      <p role="status" aria-live="polite">
        {busy ? 'Pracuji…' : (message ?? '')}
      </p>

      <ConfirmDialog
        open={pending === 'reset-local'}
        title="Smazat lokální data?"
        description={
          'Z tohoto zařízení se smaže: postup ve všech lekcích, všechny odpovědi a pokusy, ' +
          'plán opakování, osobní poznámky, nastavení a fronta nesynchronizovaných změn.\n\n' +
          'Data, která už byla odeslána do cloudu, zůstanou zachována. Nesynchronizované ' +
          'změny budou nenávratně ztraceny.'
        }
        confirmLabel="Smazat lokální data"
        onCancel={() => setPending('none')}
        onConfirm={() => void handleResetLocal()}
      />

      <ConfirmDialog
        open={pending === 'delete-cloud'}
        title="Smazat data v cloudu?"
        description={
          'Ze serveru se nenávratně smaže veškerý váš postup, všechny odpovědi, záznamy ' +
          'událostí, plán opakování, poznámky i nastavení.\n\n' +
          'Lokální kopie v tomto zařízení zůstane zachována. Účet se nemaže — ten může ' +
          'odstranit pouze správce.'
        }
        confirmLabel="Nenávratně smazat data v cloudu"
        onCancel={() => setPending('none')}
        onConfirm={() => void handleDeleteCloud()}
      />
    </article>
  )
}
