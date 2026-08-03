import { Component, type ErrorInfo, type ReactNode } from 'react'
import { getContent } from '../content/loader'
import { ContentErrorScreen } from './ContentErrorScreen'

/**
 * Validates the whole content bundle before any screen renders, so an authoring mistake
 * surfaces immediately and identically everywhere rather than only on the screen that
 * happens to touch the broken lesson.
 *
 * In development the loader also logs the full validation report to the console.
 */
export function ContentGate({ children }: { children: ReactNode }): ReactNode {
  try {
    getContent()
  } catch (error) {
    return <ContentErrorScreen error={error} />
  }
  return <ContentBoundary>{children}</ContentBoundary>
}

interface BoundaryState {
  error: unknown
}

/** Catches content errors thrown later, e.g. by an unresolved citation. */
class ContentBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('Chyba při vykreslování obsahu:', error, info.componentStack)
    }
  }

  override render(): ReactNode {
    if (this.state.error !== null) return <ContentErrorScreen error={this.state.error} />
    return this.props.children
  }
}
