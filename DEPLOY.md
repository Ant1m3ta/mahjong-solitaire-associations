# Deployment

The live site is hosted on GitHub Pages and served at:

**https://ant1m3ta.github.io/mahjong-solitaire-associations/**

## Deploying updates

Every push to `main` triggers `.github/workflows/deploy.yml`, which runs
`npm ci && npm run build` on a fresh Ubuntu runner and uploads `dist/` to
GitHub Pages. There is nothing to do beyond pushing:

```bash
git add .
git commit -m "..."
git push origin main
```

The deploy usually completes in about a minute. The new build appears on
the live URL within a few seconds after the workflow finishes.

## Checking deploy status

- Workflow runs: https://github.com/Ant1m3ta/mahjong-solitaire-associations/actions
- Deployment history (with the live URL of each deploy): the **Environments → github-pages** sidebar on the repo home page.

## Manual re-deploy

If you need to redeploy without a code change (e.g. after editing repo
settings), open the **Actions** tab, pick the **Deploy to GitHub Pages**
workflow, and click **Run workflow → main**.

Or push an empty commit:

```bash
git commit --allow-empty -m "Re-deploy"
git push
```

## Local verification before pushing

```bash
npm run build      # runs tsc, then vite build — both must pass
npm run preview    # serves dist/ locally so you can sanity-check the build
```

`npm run build` is the same command CI runs. If it fails locally it will
fail in CI; fix it before pushing.

## Subpath gotcha

The site is served under the repo subpath, not the domain root. Two
things keep that working — if either is changed, assets will 404 on Pages:

- `vite.config.ts` sets `base: '/mahjong-solitaire-associations/'`.
- Code that references assets in `public/` must go through
  `import.meta.env.BASE_URL` instead of starting paths with `/`. Example
  in `src/components/CardView.tsx`:

  ```ts
  src={`${import.meta.env.BASE_URL}images/${card.imageId}.png`}
  ```

If the repo is ever renamed, update `base` to match the new repo name.

## Required repo settings

These are one-time settings already configured; listed here for recovery:

- Repository visibility: **Public** (GitHub Pages on free accounts requires this).
- Settings → Pages → Build and deployment → Source: **GitHub Actions**.
