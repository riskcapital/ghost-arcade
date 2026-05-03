# Session Handoff — Shader Catalog + v0.3.1 Release

**Date:** 2026-04-24
**Context for next session:** I built the shader catalog system (app + website + admin), shipped the desktop app as v0.3.1, but the website deploy on Vercel is stuck. This doc tells the next agent (or you) exactly where everything stands and what to do next.

---

## ✅ What's fully done

### 1. Desktop app v0.3.1 — published to GitHub releases
- **Repo:** `riskcapital/ghost-arcade` (main branch HEAD: `f0a8ff6`)
- **Tag:** `v0.3.1` pushed; GitHub Action built + signed + notarized successfully
- **Release page:** https://github.com/riskcapital/ghost-arcade-releases/releases/tag/v0.3.1
- **Assets shipped:**
  - `Ghost-Arcade-Setup-0.3.1.exe` (Windows, 142 MB)
  - `Ghost-Arcade-0.3.1-arm64.dmg` (Mac Apple Silicon, 176 MB)
  - `Ghost-Arcade-0.3.1-x64.dmg` (Mac Intel, 182 MB)
  - `latest.yml`, `latest-mac.yml` (auto-update manifests)
- **What's in v0.3.1:**
  - 12 new shader-lab `.fs` shaders
  - Universal `vanishPointX/Y` and `wallReflection` inputs on all 9 room shaders
  - MediaTray persistence fix (dropped `.fs` files now persist via `shaderLibrary` store across layer switches)
  - "Find Latest" cloud sync button + purple cloud-shader badge
  - Default catalog URL: `https://ghostarcade.live/api/shaders` (correct domain)

### 2. v0.4.0 release — orphan, ignore it
- Was published earlier with the wrong default domain (`ghost-arcade.com` with dash, doesn't resolve).
- Tag `v0.4.0` and release page exist on `riskcapital/ghost-arcade-releases` but should be **deleted via GitHub UI** when convenient. Harmless if left in place — nothing references it.

### 3. Website code — committed + pushed
- **Repo:** `riskcapital/shrinkwraplive` (main branch HEAD: `999bbab`)
- **Latest commits:**
  - `999bbab` — Remove `/shaders → /#features` permanent redirect
  - `1733fc8` — Add shader catalog system (migration, public API, admin CRUD, admin UI, seed script)
- **What was added in `shrinkwraplive`:**
  - `supabase/migrations/20260401000000_shaders.sql` — `shaders` table with RLS
  - `src/app/api/shaders/catalog/route.ts` — public GET catalog endpoint
  - `src/app/api/shaders/[id]/content/route.ts` — public GET shader code
  - `src/app/api/admin/shaders/route.ts` — admin GET (list) + POST (create)
  - `src/app/api/admin/shaders/[id]/route.ts` — admin GET/PUT/DELETE
  - `src/app/admin/shaders/page.tsx` + `AdminShadersClient.tsx` — admin upload/edit UI with auto-thumbnail generation
  - `src/lib/shaderThumbnail.ts` — client-side WebGL thumbnail generator
  - `src/app/admin/AdminShell.tsx` — added "Shaders" nav item
  - `src/app/shaders/page.tsx` — refactored to pull from catalog API
  - `scripts/seed-shaders.mjs` — bulk-import script for shader-lab files
  - `package.json` — added `seed:shaders` script

---

## 🔴 What's broken / blocked

### 1. Vercel is NOT auto-deploying website pushes
- **Symptom:** Pushes to `riskcapital/shrinkwraplive:main` from this session never triggered a Vercel deploy. The current production deploy on Vercel is `4d7a1cAAH` — a manual redeploy of an older commit from 2 days ago. Latest git deploy on Vercel is `9ByvhmUeM` from **Apr 21** (commit `6783562`).
- **Root cause:** Vercel's GitHub git integration appears disconnected. The CLI confirmed this: `vercel link` succeeded but printed:
  > 💡 To deploy every commit automatically, connect a Git Repository (vercel.link/git)
- **Live state of ghostarcade.live:**
  - `/shaders` → 308 redirect to `/#features` (old, before redirect removal commit)
  - `/api/shaders/catalog` → 404 (route doesn't exist on the live build)
- **Fix needed:** Reconnect GitHub integration in Vercel dashboard OR force a fresh deploy.

### 2. `vercel deploy --prod` from CLI succeeded uploading but failed at build step
- **Deploy ID:** `dpl_H43NfLZ2rQzB6szKcoxoVDSsEH69`
- **Project ID:** `prj_Yd1Osebdv0lkj7PtUCONtcPPhBNa`
- **Team:** `team_MePKR2TUkiqaKzaP6LjYqNsY` (`justin-woods-projects-0cba399c`)
- **Error:** `{"status":"error","reason":"deploy_failed","message":""}` — empty error message
- **Local `next build`:** **succeeds** with all 4 new routes registered. So the code is fine; something differs in Vercel's build environment.
- **Likely culprits to investigate:**
  - Missing env var on Vercel that we need at build time (Supabase keys are presumably already there since the existing site works)
  - Hobby tier build timeout/memory limit
  - Some Vercel-specific Next.js compilation difference
- **How to get logs:** Open https://vercel.com/justin-woods-projects-0cba399c/shrinkwraplive/H43NfLZ2rQzB6szKcoxoVDSsEH69 in browser

### 3. Supabase migration NOT applied
- **File:** `shrinkwraplive/supabase/migrations/20260401000000_shaders.sql`
- **State:** Written, committed, but never applied to the live Supabase database.
- **Impact:** Even if Vercel deploys successfully, `/api/shaders/catalog` will return 500 because the `shaders` table doesn't exist.

### 4. Catalog NOT seeded
- **Script:** `shrinkwraplive/scripts/seed-shaders.mjs`
- **State:** Ready to run but blocked on the migration. Once migration is applied, run it to push all 12 shader-lab `.fs` files into the catalog with `show_on_frontend=true`.

### 5. Vercel env vars still point at v0.3.0 download URLs
- **File:** `shrinkwraplive/.env.local` shows the values that ARE in Vercel today (`DOWNLOAD_URL_*` + `DOWNLOAD_VERSION` all reference v0.3.0).
- **Need to update in Vercel dashboard:**
  ```
  DOWNLOAD_URL_WINDOWS      = https://github.com/riskcapital/ghost-arcade-releases/releases/download/v0.3.1/Ghost-Arcade-Setup-0.3.1.exe
  DOWNLOAD_URL_MACOS        = https://github.com/riskcapital/ghost-arcade-releases/releases/download/v0.3.1/Ghost-Arcade-0.3.1-arm64.dmg
  DOWNLOAD_URL_MACOS_INTEL  = https://github.com/riskcapital/ghost-arcade-releases/releases/download/v0.3.1/Ghost-Arcade-0.3.1-x64.dmg
  DOWNLOAD_VERSION          = 0.3.1
  ```

### 6. Browser-cached /shaders 308 redirect
- The old redirect was `permanent: true` (HTTP 308). Browsers cache permanent redirects aggressively.
- After the new deploy lands, hard-refresh (Cmd+Shift+R) or visit `/shaders?v=2` to bust the local cache.

---

## 🧰 Tools/auth state on this machine

- `vercel` CLI v52 installed globally
- Vercel logged in as `dreamscienceai` (= `justin@dreamscience.art`)
- Project linked locally at `shrinkwraplive/.vercel/` → project `prj_Yd1Osebdv0lkj7PtUCONtcPPhBNa`, team `justin-woods-projects-0cba399c`
- `psql` NOT installed
- `supabase` CLI NOT installed
- `gh` CLI NOT installed
- `pg` Node package NOT installed in shrinkwraplive

---

## 🎯 Recommended order for next session

### Step 1: Fix the Vercel git integration (5 min)
1. Open https://vercel.com/dashboard → shrinkwraplive → **Settings → Git**
2. Reconnect the GitHub repo (`riskcapital/shrinkwraplive`, branch `main`)
3. Trigger a redeploy from latest commit
4. Watch the build log for errors. If it fails, the empty error from CLI will be replaced with actual stack trace.

### Step 2: Apply Supabase migration (2 min)
- Open Supabase dashboard → SQL editor
- Paste contents of `shrinkwraplive/supabase/migrations/20260401000000_shaders.sql`
- Click Run. (Idempotent — `IF NOT EXISTS` everywhere.)

### Step 3: Seed the catalog (2 min)
```
cd /Users/justinwood/Documents/illDev/shrinkwraplive
NEXT_PUBLIC_SUPABASE_URL='https://YOUR-REF.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='eyJ...' \
npm run seed:shaders
```

### Step 4: Update Vercel env vars (3 min)
- Vercel dashboard → shrinkwraplive → Settings → Environment Variables
- Edit the four `DOWNLOAD_*` vars per the table above
- Trigger a redeploy

### Step 5: Verify (5 min)
1. Visit `https://ghostarcade.live/shaders` (hard-refresh) — should show 12 shaders with live previews
2. Visit `https://ghostarcade.live/admin/shaders` (logged in as admin) — manage catalog
3. `curl https://ghostarcade.live/api/shaders/catalog` — JSON array of 12 entries
4. Open desktop app v0.3.1, click "Find Latest" — should pull all 12 with purple `•` badges
5. Visit `https://ghostarcade.live/download` — buttons should point to v0.3.1 assets

### Step 6 (optional): Delete the orphan v0.4.0 release
- GitHub: https://github.com/riskcapital/ghost-arcade-releases/releases/tag/v0.4.0 → Delete release + delete tag
- Or leave it; nothing references it. Just confusing for users browsing release history.

---

## 📁 Where to find things

| File | Purpose |
|---|---|
| `Ghost-Arcade/CHANGELOG.md` | v0.3.1 entry at top |
| `Ghost-Arcade/shader-lab/*.fs` | 12 new shaders source |
| `shrinkwraplive/supabase/migrations/20260401000000_shaders.sql` | Apply this in Supabase SQL editor |
| `shrinkwraplive/scripts/seed-shaders.mjs` | Run after migration |
| `shrinkwraplive/.env.local` | Has Stripe + download URL env vars (NO Supabase keys; those live in Vercel dashboard) |
| `shrinkwraplive/.vercel/project.json` | Local Vercel project link (created this session) |

---

## 🔍 Useful one-liners for diagnostics

```bash
# Confirm release is live
curl -s "https://api.github.com/repos/riskcapital/ghost-arcade-releases/releases/tags/v0.3.1" | grep '"name"'

# Check Vercel deploy state
curl -sI "https://www.ghostarcade.live/api/shaders/catalog?b=$(date +%s)"
# Expect: 200 (live) or 404 (deploy hasn't picked up new code yet)

# After migration + seed, sanity-check:
curl -s "https://www.ghostarcade.live/api/shaders/catalog" | python3 -m json.tool | head -30

# Force a Vercel deploy from local once env is correct:
cd shrinkwraplive
vercel --prod --yes

# Get deploy logs for debugging build failures:
vercel inspect <deploy-url> --logs
# OR open the inspect URL in a browser
```

---

## 🚨 Stripe key exposure (separate todo)

`Ghost-Arcade/stripe.txt` contains live Stripe credentials and was previously git-tracked. User indicated it's no longer committed but if the repo was ever public:
1. Rotate keys in Stripe dashboard
2. Verify it's in `.gitignore`
3. `git filter-repo` to scrub from history if needed

This is independent of the shader work but worth noting.
