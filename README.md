# Neurokognitivní psychologie úsilí, motivace a změny chování

Interaktivní kurz v češtině o tom, jak vzniká úsilí, co s ním dělá odměna a proč je
změna chování těžší, než se zdá.

Tato verze je **technický základ + dvě ukázkové lekce**, ne hotový kurz. Slouží k ověření
architektury: obsah v JSON, běh lekcí offline, měření skutečného aktivního času,
plánování opakování, synchronizace do Supabase a nasazení jako PWA na GitHub Pages.

> Ukázkové lekce jsou v aplikaci označené a jejich obsah zatím neprošel finálním
> odborným auditem.

---

## What this is (engineering summary)

A local-first PWA. Course content ships as validated JSON inside the bundle; learner
state is written to IndexedDB first and pushed to Supabase through a durable outbox.
Everything the learner sees is Czech; the code and this documentation are English.

## Technology

| Area | Choice |
| --- | --- |
| UI | React 19 + TypeScript (strict), plain CSS with design tokens |
| Build | Vite, `vite-plugin-pwa` |
| Routing | `react-router-dom` with `HashRouter` (GitHub Pages has no server rewrites) |
| Content validation | Zod, plus cross-reference checks in `src/content/validation.ts` |
| Local persistence | IndexedDB via Dexie |
| Cloud persistence | Supabase (auth + Postgres with Row Level Security) |
| Tests | Vitest, React Testing Library, `@testing-library/user-event`, Playwright |
| Hosting | GitHub Pages via GitHub Actions |

Deliberately **not** used: Next.js, React Native/Expo, Firebase, a custom backend,
Supabase Edge Functions, AI APIs, Redux, a UI framework.

## Local setup

```bash
git clone https://github.com/<owner>/neuro-effort-course.git
cd neuro-effort-course
npm ci
cp .env.example .env.local   # then fill in the two Supabase values
npm run dev
```

The dev server runs at `http://localhost:5173/`. Without Supabase configuration the app
shows a Czech configuration-error screen instead of crashing.

## Environment variables

`.env.local` is git-ignored and must never be committed.

| Variable | Required | Meaning |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | yes | Project URL, e.g. `https://abcdefgh.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes | Publishable (anon) key — safe in a browser **only** because RLS is enabled |
| `VITE_ALLOW_SIGNUP` | no (default `false`) | `true` shows a registration form; otherwise an admin creates users |
| `VITE_BASE_PATH` | no | Overrides GitHub Pages base-path detection |

The browser never needs a service-role key, an `sb_secret_…` key or the database
password. See [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md).

## Commands

```bash
npm run dev                # development server
npm run build              # type-check + production build
npm run preview            # serve the production build locally
npm run lint               # ESLint
npm run typecheck          # tsc across app, node tooling and tests
npm run test               # Vitest in watch mode
npm run test:run           # Vitest once
npm run test:e2e           # Playwright against the production bundle
npm run content:validate   # course-content validation
npm run content:audit-mcq  # multiple-choice bias audit
npm run check              # all of the above gates, in order
```

`npm run check` runs lint → type-check → content validation → MCQ audit → tests →
production build, and is the same command CI runs before deploying.

## Tests

156 unit and integration tests plus 3 Playwright end-to-end tests. No test touches a real
Supabase project: `tests/setup.ts` makes `fetch` throw, and the e2e suite intercepts every
Supabase request. Details: [docs/TESTING.md](docs/TESTING.md).

## Production build and deployment

Pushing to `main` runs `.github/workflows/deploy-pages.yml`, which installs with
`npm ci`, runs `npm run check`, builds, and publishes `dist/` through the official
GitHub Pages actions. The base path is derived from the repository name at build time —
the GitHub user name is never hardcoded.

Deployed URL: `https://<owner>.github.io/neuro-effort-course/`

Full instructions, including how to install the app on iPhone, Android and desktop:
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Documentation

| Document | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layers, data flow, sync, conflict handling, MVP limits |
| [docs/CONTENT_AUTHORING.md](docs/CONTENT_AUTHORING.md) | Lesson schema, block types, how to add content |
| [docs/QUESTION_QUALITY.md](docs/QUESTION_QUALITY.md) | MCQ quality rules and the audit thresholds |
| [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) | Migration, first user, RLS verification |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | GitHub Pages, Actions variables, PWA install |
| [docs/TESTING.md](docs/TESTING.md) | Test architecture, mocking, offline and mobile testing |
| [CLAUDE.md](CLAUDE.md) | Standing rules for AI-assisted work in this repository |
| [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) | What was built, what was not, remaining manual steps |

## Licence and content

Icons in `public/icons/` are generated locally by `scripts/generate-icons.ts`; no
third-party or branded artwork is bundled. Every scientific source in
`src/content/sources.json` was verified against Crossref before being cited.
