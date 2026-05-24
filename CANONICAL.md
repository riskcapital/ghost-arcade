# Canonical Repository

**This is the only Ghost Arcade repository.**

- Repo: `riskcapital/ghost-arcade` (https://github.com/riskcapital/ghost-arcade)
- Active branch: `ga-main`
- License: AGPL-3.0-only
- Website: https://ghostarcade.live

## What Ghost Arcade is

A single open-source product. Not a "Community" tier. Not a "Pro" tier. Just **Ghost Arcade**.
Free, no paywalls, no watermarks, no license activation.

## Historical / archived repos (do not commit to these)

The following repos exist on GitHub for history and are **archived (read-only)**:

| Archived repo | What it was |
|---|---|
| `riskcapital/ghost-arcade-v0-archive` | Old v0.6.7 OSS public repo before the rename. |
| `riskcapital/ghost-arcade-community` | "Community tier" fork. Folded back into the single OSS product. |
| `riskcapital/ill-visuals` | Previous-brand Pro repo. |
| `riskcapital/ill-visuals-community-archive` | Previous-brand Community repo. |
| `riskcapital/ill-visuals-releases` | Previous-brand release binaries. |

Local `ghost-arcade`, `ghost-arcade-community`, and `ghost-arcade-future` directories on the maintainer's machine are also archived (moved to `_archive/`).

## For future Claude Code sessions

If you are an AI assistant working in this repo:

- **Do not** look for a "community version" or "pro version" of the code — there isn't one.
- **Do not** suggest porting code to/from another Ghost Arcade repo — this is the only one.
- The local sibling directories `ghost-arcade`, `ghost-arcade-community`, `ghost-arcade-future` (if you see them) are stale archives, not parallel codebases.
- Future feature work, refactors, and releases all happen here, on `ga-main`.

## Releases

Release artifacts (signed Windows + notarized macOS installers) live in a separate repo:
`riskcapital/ghost-arcade-releases`. CI pushes there on `v*` tags. That separation is intentional.

## Website

The marketing + download site (https://ghostarcade.live) is a **separate repo** —
this app repo does not contain the website:

- Repo: `riskcapital/ghostarcade-web` (https://github.com/riskcapital/ghostarcade-web)
- Stack: Next.js, deployed on **Vercel** — every push to `main` auto-deploys to production.

**Updating the download links after a release:** the site's download buttons and
every version string derive from a single constant — `RELEASE_VERSION` in
`src/lib/release.ts` (in the `ghostarcade-web` repo). After CI publishes a new
`v*` release to `ghost-arcade-releases`, bump that constant to the new version and
push to `main`; Vercel redeploys and the links update everywhere.

The installer asset names the site expects (`Ghost-Arcade-Setup-{V}.exe`,
`Ghost-Arcade-{V}-arm64.dmg`, `Ghost-Arcade-{V}-x64.dmg`) are produced by
`electron-builder.yml` **in this repo** — so the two repos are coupled by that
naming. Don't rename artifacts here without updating `release.ts` there.

Full step-by-step runbook lives in the website repo:
[`UPDATING.md`](https://github.com/riskcapital/ghostarcade-web/blob/main/UPDATING.md).
