import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../src/features/auth/AuthContext'
import { ProtectedRoute } from '../../src/features/auth/ProtectedRoute'
import { translateAuthError } from '../../src/features/auth/AuthContext'
import { makeAuthValue } from '../helpers/render'

function renderGuard(overrides: Parameters<typeof makeAuthValue>[0]) {
  return render(
    <AuthContext.Provider value={makeAuthValue(overrides)}>
      <ProtectedRoute>
        <p>Chráněný obsah lekce</p>
      </ProtectedRoute>
    </AuthContext.Provider>,
  )
}

describe('ProtectedRoute', () => {
  it('shows a loading state while the persisted session is restored', () => {
    renderGuard({ status: 'initialising', user: null })

    expect(screen.getByText('Načítám přihlášení…')).toBeInTheDocument()
    expect(screen.queryByText('Chráněný obsah lekce')).not.toBeInTheDocument()
  })

  it('shows the Czech login screen when signed out', () => {
    renderGuard({ status: 'signed-out', user: null })

    expect(screen.getByRole('button', { name: 'Přihlásit se' })).toBeInTheDocument()
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Heslo')).toBeInTheDocument()
    expect(screen.queryByText('Chráněný obsah lekce')).not.toBeInTheDocument()
  })

  it('renders the protected content once signed in', () => {
    renderGuard({})
    expect(screen.getByText('Chráněný obsah lekce')).toBeInTheDocument()
  })

  it('shows the Czech configuration screen when Supabase is not configured', () => {
    renderGuard({ status: 'unconfigured', user: null })

    expect(screen.getByRole('heading', { name: 'Chybí nastavení aplikace' })).toBeInTheDocument()
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeInTheDocument()
  })

  it('hides the registration link when signup is disabled', () => {
    renderGuard({ status: 'signed-out', user: null, allowSignup: false })

    expect(screen.getByText(/Registrace je vypnutá/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Zaregistrovat se/ })).not.toBeInTheDocument()
  })
})

describe('LoginScreen behaviour', () => {
  it('validates empty fields in Czech before calling Supabase', async () => {
    const user = userEvent.setup()
    const signIn = vi.fn()
    render(
      <AuthContext.Provider value={makeAuthValue({ status: 'signed-out', user: null, signIn })}>
        <ProtectedRoute>
          <p>Chráněný obsah lekce</p>
        </ProtectedRoute>
      </AuthContext.Provider>,
    )

    await user.click(screen.getByRole('button', { name: 'Přihlásit se' }))
    expect(screen.getByText('Vyplňte prosím e-mail.')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('E-mail'), 'ucastnik@example.com')
    await user.click(screen.getByRole('button', { name: 'Přihlásit se' }))
    expect(screen.getByText('Vyplňte prosím heslo.')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('surfaces a Czech error when the credentials are wrong', async () => {
    const user = userEvent.setup()
    const signIn = vi.fn(async () => ({ ok: false, error: 'Nesprávný e-mail nebo heslo.' }))
    render(
      <AuthContext.Provider value={makeAuthValue({ status: 'signed-out', user: null, signIn })}>
        <ProtectedRoute>
          <p>Chráněný obsah lekce</p>
        </ProtectedRoute>
      </AuthContext.Provider>,
    )

    await user.type(screen.getByLabelText('E-mail'), 'ucastnik@example.com')
    await user.type(screen.getByLabelText('Heslo'), 'spatneheslo')
    await user.click(screen.getByRole('button', { name: 'Přihlásit se' }))

    expect(signIn).toHaveBeenCalledWith('ucastnik@example.com', 'spatneheslo')
    expect(await screen.findByText('Nesprávný e-mail nebo heslo.')).toBeInTheDocument()
  })
})

describe('translateAuthError', () => {
  it('maps Supabase messages to Czech', () => {
    expect(translateAuthError('Invalid login credentials')).toBe('Nesprávný e-mail nebo heslo.')
    expect(translateAuthError('Email not confirmed')).toContain('není potvrzený')
    expect(translateAuthError('Signups not allowed for this instance')).toContain(
      'Registrace je vypnutá',
    )
    expect(translateAuthError('Failed to fetch')).toContain('připojení k internetu')
  })

  it('falls back to a generic Czech message for unknown errors', () => {
    expect(translateAuthError('some unmapped failure')).toBe(
      'Přihlášení se nezdařilo. Zkuste to prosím znovu.',
    )
  })
})
