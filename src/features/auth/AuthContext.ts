import { createContext, useContext } from 'react'

/**
 * Authentication state.
 *
 * `initialising` exists so protected routes never flash the login screen while the
 * persisted Supabase session is still being restored.
 */
export type AuthStatus = 'initialising' | 'signed-in' | 'signed-out' | 'unconfigured'

export interface AuthUser {
  id: string
  email: string | null
}

export interface AuthResult {
  ok: boolean
  /** Czech, ready to show to the learner. */
  error?: string
}

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  allowSignup: boolean
  signIn(email: string, password: string): Promise<AuthResult>
  signUp(email: string, password: string): Promise<AuthResult>
  signOut(): Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (value === null) throw new Error('useAuth musí být použit uvnitř AuthProvider.')
  return value
}

/** Czech translations for the Supabase auth errors a learner can actually hit. */
export function translateAuthError(message: string): string {
  const normalised = message.toLowerCase()
  if (normalised.includes('invalid login credentials')) {
    return 'Nesprávný e-mail nebo heslo.'
  }
  if (normalised.includes('email not confirmed')) {
    return 'E-mail zatím není potvrzený. Zkontrolujte schránku, nebo požádejte správce.'
  }
  if (normalised.includes('user already registered')) {
    return 'Uživatel s tímto e-mailem už existuje.'
  }
  if (normalised.includes('password should be at least')) {
    return 'Heslo je příliš krátké. Použijte alespoň šest znaků.'
  }
  if (normalised.includes('signups not allowed') || normalised.includes('signup is disabled')) {
    return 'Registrace je vypnutá. Účet vytvoří správce v Supabase.'
  }
  if (normalised.includes('rate limit') || normalised.includes('too many requests')) {
    return 'Příliš mnoho pokusů. Zkuste to prosím za chvíli znovu.'
  }
  if (normalised.includes('failed to fetch') || normalised.includes('network')) {
    return 'Nepodařilo se spojit se serverem. Zkontrolujte připojení k internetu.'
  }
  return 'Přihlášení se nezdařilo. Zkuste to prosím znovu.'
}
