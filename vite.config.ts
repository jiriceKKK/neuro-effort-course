import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * GitHub Pages serves project sites from `https://<user>.github.io/<repo>/`, so the
 * production bundle needs a base path that matches the repository name. The GitHub
 * user name is never hardcoded — only the repository name matters, and it is resolved
 * from the first source that answers:
 *
 *   1. `VITE_BASE_PATH`            — explicit escape hatch (also usable for custom domains).
 *   2. `GITHUB_REPOSITORY`         — "owner/repo", injected by GitHub Actions.
 *   3. `git remote get-url origin` — local production builds and forks.
 *   4. `/`                         — safe fallback (correct for a user/organisation site).
 *
 * Development always uses `/` so that `vite dev` behaves like a root-hosted app.
 */
function resolveBasePath(mode: string): string {
  const explicit = process.env.VITE_BASE_PATH?.trim()
  if (explicit) return normaliseBase(explicit)
  if (mode !== 'production') return '/'

  const actionsRepo = process.env.GITHUB_REPOSITORY?.split('/')[1]?.trim()
  if (actionsRepo) return normaliseBase(actionsRepo)

  const gitRepo = repositoryNameFromGitRemote()
  if (gitRepo) return normaliseBase(gitRepo)

  return '/'
}

function repositoryNameFromGitRemote(): string | null {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    // Matches both https://host/owner/repo(.git) and git@host:owner/repo(.git)
    const match = /([^/:]+?)(?:\.git)?$/.exec(url)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

function normaliseBase(value: string): string {
  const trimmed = value.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? '/' : `/${trimmed}/`
}

export default defineConfig(({ mode }) => {
  const base = resolveBasePath(mode)

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        // The Czech update prompt in src/app/UpdatePrompt.tsx drives the update,
        // so the service worker must not silently take over an open session.
        registerType: 'prompt',
        injectRegister: null,
        includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png', 'offline.html'],
        manifest: {
          id: base,
          name: 'Neurokognitivní psychologie úsilí',
          short_name: 'Úsilí a motivace',
          description:
            'Interaktivní kurz o neurokognitivní psychologii úsilí, motivace a změny chování.',
          lang: 'cs',
          dir: 'ltr',
          // Relative values resolve against the manifest URL, which already lives at
          // the repository base path — this keeps the app installable under any subpath.
          start_url: './',
          scope: './',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: '#1b2a4a',
          background_color: '#f7f8fb',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: 'icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // Course content is bundled into the JS chunks, so precaching the app shell
          // also makes every demo lesson available offline after the first visit.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,woff2}'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [/^\/api\//],
          cleanupOutdatedCaches: true,
          clientsClaim: false,
          skipWaiting: false,
          runtimeCaching: [
            {
              // Learner data and auth must never be served from a cache: a stale
              // session or stale progress is worse than a clear offline error.
              urlPattern: ({ url }) =>
                url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in'),
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  }
})
