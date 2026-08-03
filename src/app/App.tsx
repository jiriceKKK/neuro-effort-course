import type { ReactNode } from 'react'
import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import { AuthProvider } from '../features/auth/AuthProvider'
import { ProtectedRoute } from '../features/auth/ProtectedRoute'
import { SyncProvider } from '../persistence/sync/SyncProvider'
import { AppLayout } from './AppLayout'
import { ContentGate } from './ContentGate'
import { DashboardScreen } from '../features/dashboard/DashboardScreen'
import { CourseMapScreen } from '../features/lessons/CourseMapScreen'
import { LessonRunnerScreen } from '../features/lessons/LessonRunnerScreen'
import { ReviewScreen } from '../features/reviews/ReviewScreen'
import { ProgressScreen } from '../features/progress/ProgressScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'

/**
 * Application root.
 *
 * `HashRouter` is deliberate: GitHub Pages serves static files only, so a deep link like
 * `/lekce/demo-rpe` would 404 on refresh under BrowserRouter. Hash routing keeps every
 * route reachable under a repository subpath without any server rewrite rules.
 */
export function App(): ReactNode {
  return (
    <HashRouter>
      <AuthProvider>
        <ContentGate>
          <Routes>
            <Route
              element={
                <ProtectedRoute>
                  <SyncProvider>
                    <AppLayout />
                  </SyncProvider>
                </ProtectedRoute>
              }
            >
              <Route index element={<DashboardScreen />} />
              <Route path="kurz" element={<CourseMapScreen />} />
              <Route path="lekce/:lessonId" element={<LessonRunnerScreen />} />
              <Route path="opakovani" element={<ReviewScreen />} />
              <Route path="postup" element={<ProgressScreen />} />
              <Route path="nastaveni" element={<SettingsScreen />} />
              <Route path="*" element={<NotFoundScreen />} />
            </Route>
          </Routes>
        </ContentGate>
      </AuthProvider>
    </HashRouter>
  )
}

function NotFoundScreen(): ReactNode {
  return (
    <div className="card">
      <h1>Stránka nenalezena</h1>
      <p>Odkaz, který jste otevřeli, v aplikaci neexistuje.</p>
      <Link className="button lesson-card__link" to="/">
        Zpět na přehled
      </Link>
    </div>
  )
}
