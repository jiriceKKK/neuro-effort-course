# Deployment

The application is a static bundle published to GitHub Pages by GitHub Actions. There is
no server to run.

## 1. Repository variables

The build needs the two public Supabase values. They are **variables**, not secrets — the
publishable key ends up in the JavaScript bundle either way, and marking it secret only
makes the workflow log confusing.

1. GitHub → your repository → **Settings**.
2. **Secrets and variables → Actions**.
3. Open the **Variables** tab → **New repository variable**.
4. Add these, with exactly these names:

| Name | Value | Required |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` | yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | yes |
| `VITE_ALLOW_SIGNUP` | `false` (or `true`) | optional, defaults to `false` |

> Never add a service-role key, an `sb_secret_…` key or the database password here. The
> frontend does not need them, and anything the build can read ends up in the bundle.

## 2. Enabling GitHub Pages

1. **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Save. Do not select "Deploy from a branch" — the workflow uses the artifact-based
   deployment, and the branch mode would ignore it.

The first successful workflow run creates the `github-pages` environment automatically.

## 3. The workflow

`.github/workflows/deploy-pages.yml` runs on every push to `main` and on manual dispatch:

1. checkout;
2. Node 22 LTS with npm caching;
3. `npm ci`;
4. `actions/configure-pages@v5`;
5. **`npm run check`** — lint, type-check, content validation, MCQ audit, tests, build;
6. `npm run build` with `GITHUB_REPOSITORY` set, so the base path resolves to `/<repo>/`;
7. `actions/upload-pages-artifact@v3` with `dist`;
8. `actions/deploy-pages@v4` in the `github-pages` environment.

Permissions are `contents: read`, `pages: write`, `id-token: write`. Concurrency uses the
`pages` group with `cancel-in-progress: false`, so a newer commit supersedes a queued
deployment but a running one is allowed to finish.

Because step 5 is the full `check`, a lint error, a type error, invalid content, an MCQ
bias failure or a failing test all stop the deployment.

## 4. Running the workflow manually

1. **Actions** tab → **Deploy to GitHub Pages** in the left sidebar.
2. **Run workflow** → pick `main` → **Run workflow**.

To re-run a failed attempt: open the run → **Re-run all jobs** (or **Re-run failed
jobs**). Use *all jobs* after changing a repository variable, since the build step needs
to run again to pick it up.

## 5. Finding the deployed URL

* **Settings → Pages** shows it at the top once the first deployment finishes.
* The **deploy** job summary links to it (`page_url`).
* It follows the pattern:

  ```
  https://<owner>.github.io/<repository-name>/
  ```

  For this repository: `https://<owner>.github.io/neuro-effort-course/`

Deep links use the hash, e.g.
`https://<owner>.github.io/neuro-effort-course/#/lekce/demo-rpe`.

## 6. Base path

`resolveBasePath` in `vite.config.ts` takes the first available answer:

1. `VITE_BASE_PATH` — explicit override, also used for a custom domain (`/`);
2. `GITHUB_REPOSITORY` — `owner/repo`, injected by Actions → `/repo/`;
3. `git remote get-url origin` — local production builds and forks;
4. `/` — fallback, correct for a `<owner>.github.io` user site.

Development always uses `/`. The GitHub user name is never hardcoded.

If you move the project to a custom domain, add a repository variable
`VITE_BASE_PATH` with the value `/` and a `public/CNAME` file.

## 7. Verifying the PWA scope

After a deployment:

1. Open the deployed URL, then DevTools → **Application**.
2. **Manifest**: name „Neurokognitivní psychologie úsilí“, `scope` and `start_url` both
   resolving under `/<repository-name>/`, `display: standalone`, and all three icons
   loading (192, 512, maskable 512).
3. **Service workers**: one worker, status *activated and is running*, with a scope of
   `https://<owner>.github.io/<repository-name>/`. A scope of `/` would be wrong and
   would fail to register.
4. Reload once, then tick **Offline** in the Network panel and reload again — the app
   shell and both demo lessons must still open.
5. Check that Supabase requests are **not** cached: with Offline ticked, the sync badge
   must read `Offline`, not `Synchronizováno`.

When a new version is deployed, an already-open installation shows the Czech prompt
„Je dostupná nová verze aplikace.“ with **Aktualizovat** / **Později**. The service
worker never takes over an open lesson without asking.

---

## Instalace aplikace do zařízení

Následující část je určená koncovým uživatelům.

Aplikaci není potřeba stahovat z App Store ani Google Play. Otevřete adresu kurzu
v prohlížeči a přidejte si ji na plochu — bude se chovat jako běžná aplikace, včetně
vlastní ikony a fungování bez internetu.

### iPhone a iPad (Safari)

1. Otevřete adresu kurzu **v Safari**. V jiném prohlížeči instalace na iOS nefunguje.
2. Klepněte na ikonu **Sdílet** (čtvereček se šipkou nahoru) ve spodní liště.
3. Sjeďte v nabídce dolů a zvolte **Přidat na plochu**.
4. Potvrďte **Přidat** vpravo nahoře.
5. Aplikaci teď spustíte ikonou na ploše. Otevře se na celou obrazovku, bez adresního
   řádku.

### Android (Chrome)

1. Otevřete adresu kurzu v Chrome.
2. Buď klepněte na nabídku **⋮** vpravo nahoře a zvolte **Přidat na plochu** či
   **Nainstalovat aplikaci**, nebo použijte pruh s nabídkou instalace, pokud se objeví
   sám.
3. Potvrďte **Instalovat**.
4. Aplikace se objeví v seznamu aplikací i na ploše.

### Počítač (Chrome, Edge)

1. Otevřete adresu kurzu.
2. V adresním řádku vpravo klepněte na ikonu instalace (monitor se šipkou), nebo použijte
   nabídku prohlížeče → **Instalovat**.
3. Potvrďte **Instalovat**. Aplikace se otevře ve vlastním okně a najdete ji mezi
   ostatními programy.

### Práce bez připojení

Po prvním úspěšném otevření zůstane aplikace i s ukázkovými lekcemi dostupná offline.
Odpovědi, poznámky a postup se ukládají přímo do zařízení a odešlou se na server,
jakmile budete znovu online. Stav uvidíte v pravém horním rohu: `Synchronizováno`,
`Offline`, `Čekající změny`, `Probíhá synchronizace`, nebo `Chyba synchronizace`.
Ruční odeslání najdete v **Nastavení → Synchronizovat nyní**.

### Aktualizace

Když vyjde nová verze, aplikace se zeptá: **„Je dostupná nová verze aplikace.“**
Zvolte **Aktualizovat** pro okamžité načtení, nebo **Později**, pokud jste zrovna
uprostřed lekce. Rozdělaná lekce se aktualizací neztratí.
