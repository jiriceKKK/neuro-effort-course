import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

/** Email + password only. Magic links, OAuth and social login are out of scope. */
export function LoginScreen(): ReactNode {
  const { signIn, signUp, allowSignup } = useAuth()
  const emailId = useId()
  const passwordId = useId()
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (email.trim() === '') {
      setError('Vyplňte prosím e-mail.')
      return
    }
    if (password === '') {
      setError('Vyplňte prosím heslo.')
      return
    }

    setBusy(true)
    const result = mode === 'sign-in' ? await signIn(email.trim(), password) : await signUp(email.trim(), password)
    setBusy(false)

    if (!result.ok) {
      setError(result.error ?? 'Přihlášení se nezdařilo.')
      return
    }
    if (mode === 'sign-up') {
      setNotice('Účet byl vytvořen. Pokud je vyžadováno potvrzení e-mailu, zkontrolujte schránku.')
    }
  }

  return (
    <div className="auth-screen">
      <main className="auth-card">
        <h1>Neurokognitivní psychologie úsilí</h1>
        <p className="meta-line">
          {mode === 'sign-in'
            ? 'Přihlaste se, aby se váš postup ukládal i do cloudu.'
            : 'Vytvořte si účet pro ukládání postupu.'}
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <div className="field">
            <label className="field__label" htmlFor={emailId}>
              E-mail
            </label>
            <input
              id={emailId}
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor={passwordId}>
              Heslo
            </label>
            <input
              id={passwordId}
              className="input"
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>

          <p aria-live="polite" role="status">
            {error !== null && <span className="error-text">{error}</span>}
            {notice !== null && <span>{notice}</span>}
          </p>

          <button className="button button--block" type="submit" disabled={busy}>
            {busy
              ? 'Přihlašuji…'
              : mode === 'sign-in'
                ? 'Přihlásit se'
                : 'Zaregistrovat se'}
          </button>
        </form>

        {allowSignup ? (
          <p className="meta-line" style={{ marginTop: '1rem' }}>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
                setError(null)
                setNotice(null)
              }}
            >
              {mode === 'sign-in' ? 'Nemáte účet? Zaregistrovat se' : 'Zpět na přihlášení'}
            </button>
          </p>
        ) : (
          <p className="meta-line" style={{ marginTop: '1rem' }}>
            Registrace je vypnutá. Účty vytváří správce v administraci Supabase.
          </p>
        )}
      </main>
    </div>
  )
}
