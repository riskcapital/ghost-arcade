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
