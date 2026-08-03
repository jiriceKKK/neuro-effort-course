import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end configuration.
 *
 * The suite runs against the *production* bundle served by `vite preview`, which is the
 * only way to verify that the GitHub Pages base path, the hash routes and the built
 * assets all line up. The Supabase values below are deliberate placeholders: the test
 * intercepts every Supabase request, so no real project is ever contacted.
 */

const PORT = 4173
const BASE_PATH = '/neuro-effort-course/'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI === undefined ? 0 : 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    // Mobile-first product, so the default projection is a phone viewport.
    ...devices['Pixel 7'],
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  outputDir: 'test-results',
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 180_000,
    env: {
      VITE_BASE_PATH: BASE_PATH,
      // Placeholder project that does not exist; all traffic to it is intercepted.
      VITE_SUPABASE_URL: 'https://e2e-placeholder.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_placeholder_not_a_real_key',
      VITE_ALLOW_SIGNUP: 'false',
    },
  },
})
