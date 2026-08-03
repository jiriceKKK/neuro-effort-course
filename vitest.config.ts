import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Tests deliberately run without the PWA plugin: a service worker in jsdom adds
 * nothing but noise. Supabase is never contacted — see tests/setup.ts.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    restoreMocks: true,
  },
})
