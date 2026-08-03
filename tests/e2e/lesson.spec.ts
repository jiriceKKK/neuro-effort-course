import { expect, test, type Page, type Route } from '@playwright/test'

/**
 * Mobile end-to-end pass over the production bundle.
 *
 * Every Supabase call is intercepted, so the suite verifies the real built application
 * — base path, hash routing, service worker registration, Czech UI — without touching a
 * live project. Learner data still goes through the real IndexedDB layer.
 */

const FAKE_USER_ID = '00000000-0000-4000-8000-000000000001'

/**
 * The stubbed origin is cross-origin to the preview server, so the browser still runs
 * its CORS checks against fulfilled responses. Without these headers — and without an
 * answer to the preflight — supabase-js only ever sees a network failure.
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
}

async function fulfilJson(route: Route, body: string): Promise<void> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS_HEADERS })
    return
  }
  await route.fulfill({
    status: 200,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    body,
  })
}

async function stubSupabase(page: Page): Promise<void> {
  // Playwright matches routes in reverse registration order, so the broad catch-alls are
  // registered first and the specific token handler last.
  await page.route('**/rest/v1/**', async (route) => {
    // Learner-data writes succeed silently; the point here is the UI, not the backend.
    await fulfilJson(route, '[]')
  })

  await page.route('**/auth/v1/**', async (route) => {
    await fulfilJson(route, '{}')
  })

  await page.route('**/auth/v1/token**', async (route) => {
    await fulfilJson(
      route,
      JSON.stringify({
        access_token: 'e2e-access-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'e2e-refresh-token',
        user: {
          id: FAKE_USER_ID,
          aud: 'authenticated',
          role: 'authenticated',
          email: 'ucastnik@example.com',
          email_confirmed_at: '2026-01-01T00:00:00.000Z',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          identities: [],
        },
      }),
    )
  })
}

async function signIn(page: Page): Promise<void> {
  await page.goto('./')
  await expect(page.getByRole('button', { name: 'Přihlásit se' })).toBeVisible()
  await page.getByLabel('E-mail').fill('ucastnik@example.com')
  await page.getByLabel('Heslo').fill('tajne-heslo')
  await page.getByRole('button', { name: 'Přihlásit se' }).click()
  await expect(page.getByRole('heading', { name: 'Přehled' })).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await stubSupabase(page)
})

test('the Czech application loads under the GitHub Pages base path', async ({ page }) => {
  await page.goto('./')

  await expect(page).toHaveTitle(/Neurokognitivní psychologie úsilí/)
  expect(new URL(page.url()).pathname).toBe('/neuro-effort-course/')

  const manifestHref = await page.getAttribute('link[rel="manifest"]', 'href')
  expect(manifestHref).toContain('/neuro-effort-course/')
})

test('a learner signs in and works through a demo lesson on a phone viewport', async ({ page }) => {
  await signIn(page)

  // Dashboard shows both demo lessons and the synchronisation state.
  await expect(page.getByRole('heading', { name: 'Jak poznat silnější psychologický důkaz' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Reward prediction error není samotná odměna' })).toBeVisible()

  await page.getByRole('link', { name: 'Začít lekci' }).first().click()

  // Demo banner before any lesson content.
  await expect(page.getByText(/Ukázková lekce pro ověření aplikace/)).toBeVisible()
  expect(page.url()).toContain('#/lekce/demo-evidence')

  // Prediction block: commit first.
  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: 'Potvrdit odhad' }).click()
  await expect(page.getByText('Co na to model a data')).toBeVisible()
  await page.getByRole('button', { name: 'Pokračovat' }).click()

  // Explanation block.
  await expect(page.getByText('Klíčový princip')).toBeVisible()
  await page.getByRole('button', { name: 'Pokračovat' }).click()

  // Multiple choice: nothing is revealed before an answer plus a confidence rating.
  await expect(page.getByRole('heading', { name: 'Co z toho vyplývá' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Odeslat odpověď' })).toBeDisabled()

  await page
    .getByRole('radio', { name: /Mezi ranním cvičením a nižší prokrastinací je vztah/ })
    .check()
  await expect(page.getByRole('button', { name: 'Odeslat odpověď' })).toBeDisabled()

  await page.getByLabel('Jak jistý/á si jste svou odpovědí?').fill('70')
  await expect(page.getByRole('button', { name: 'Odeslat odpověď' })).toBeEnabled()
  await page.getByRole('button', { name: 'Odeslat odpověď' }).click()

  await expect(page.getByText('Odpověděli jste správně.')).toBeVisible()
  await expect(page.getByText('Správná odpověď')).toBeVisible()
  await expect(page.getByText(/Další opakování:/)).toBeVisible()

  // The layout must never scroll sideways on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('progress survives a reload', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Začít lekci' }).first().click()

  await page.getByRole('radio').first().check()
  await page.getByRole('button', { name: 'Potvrdit odhad' }).click()
  await page.getByRole('button', { name: 'Pokračovat' }).click()
  await expect(page.getByRole('heading', { name: /Pět typů důkazu/ })).toBeVisible()

  await page.reload()

  await expect(page.getByRole('heading', { name: /Pět typů důkazu/ })).toBeVisible()
  await expect(page.getByText('Blok 2 z 7')).toBeVisible()
})
