# Session Progress — 2026-06-09/10

Resume/review doc. Everything below is committed + pushed to `main` unless
marked **in progress**. Branch is clean except the in-flight Phase 2 (no
uncommitted code yet — only investigation).

---

## 1. Shipped this session (all committed + pushed)

### Stage 3D + UI fixes
- **Stage 3D blank on packaged Windows** — composer present path (upstream
  `b7c9f95`) + dev-mode window load (`9bd8d0c`).
- **Shader/clip-swap flicker** (mapping mode) — black-hold texture during
  source swap + opaque-black RT init. Verified 0 bleed frames. (`deab472`)
- **VJ-stage screens split/flipped vs 3D stage** — unified the corner-Y
  convention (canvas Y-down) across Apply-Stage, engine unified-crop, and
  Stage3D LED placement + crop. (`14427ed`)
- **LED glow = hard spotlight → soft area light** — RectAreaLight sized to
  the panel, live colour tracking preserved. (`deab472`)
- **Multi-select layers now highlight** in the tray (skin `!important` was
  overriding it) + reduced row padding. (`14427ed`)
- **Venue scenery fully editable** — drag now persists (was snapping back:
  `persistAllSelected` used a broken lookup; now `resolveTargetGroup`),
  all 49 venue pieces listed in the tree with select/hide/restore/reset
  + a dedicated inspector. (`8edf6e3`)
- Main editor window `backgroundThrottling:false` — minimizing the editor
  no longer freezes Spout/NDI/WLED + audio sync mid-show. (`14427ed`)

### Performance (see `docs/performance-review-2026-06.md`)
- **Modulation hot path** — `batchUpdateShaderValues` no longer clones the
  clip grid per audio tick (0 store ticks; was 120-240 grid clones/sec).
  (`ce4b4d8`)
- **Slim VJ broadcasts** — grids only on structural change. (`ce4b4d8`)
- **Memory leak batch** — video-element release on clip delete/overwrite
  (orphan-checked), bounded shader-input cache, thumbnail cleanup, ISF
  image-input texture disposal. (`01c436f`)
- **Async main-process logging** + **WLED in-flight cap**. (`01c436f`)
- **Render-loop allocation diet** — cached VJ→layer injection, memoized id
  parse. (`02f00b7`)
- **Async PBO slice readback** (no render stall) + **async LED glow
  readback** + **OSC IPC batching**. (`9c2a566`)

Open perf items (not started): localStorage debounce on preset cycling,
error-queue TTL, Spout CPU-swizzle SIMD (only matters when CPU path runs).

---

## 2. IN PROGRESS — Multi-slice zero-copy senders

Goal: a user sending **2-3+ separate Spout/Syphon outputs** (each a
crop/warp slice of the master → its own named sender → another app like
Resolume/MadMapper/OBS) gets GPU-resident, flat-cost output. Today this
path is broken: `spout_send_image` ignores the per-slice name, so multiple
Spout sender-slices stomp one sender. (NDI is fine; CPU by protocol.)

Plan: `docs/multi-slice-zerocopy-plan.md` (the "Atlas OSR + native
sub-region fan-out" architecture). Decision: **full native zero-copy**
(Option C), not the cheaper CPU instance-map.

### Phase 1 — DONE + committed (`05ecc44`)
One hidden compositor renders ALL sender slices into a single atlas
texture (existing warp/crop/color/blend shader, per-tile viewport+scissor).
- `src/lib/output/atlasLayout.ts` — shelf-packer + 9 unit tests (passing).
- `src/lib/output/blendRenderer.ts` — atlas-present path
  (`beginSliceAtlasFrame` / `renderSliceAtlasTile` / `endSliceAtlasFrame`),
  reuses the readback path's shader (no duplication).
- `src/SliceAtlasApp.svelte` + `?mode=slice-atlas` in `src/main.ts`.
- `electron/main.js` — `texshare_atlas_layout` intake stub + `atlasState`;
  preload allowlist entries.
- **Verified (Electron):** two half-width slices → atlas 1922×1080, left
  tile correct red crop, right tile correct blue crop, gap black (no bleed).

### Phase 2 — ALL DONE incl. 2d Windows verification (2026-06-12)
End-to-end verified on Windows: quadrant test pattern → 2 sender
slices → atlas OSR → SpoutAtlasOutput → two independent named senders
(`atlasTestA`/`atlasTestB`, 960×1080 each) received with correct,
independent content AND orientation matching the single-output
reference convention. Verified programmatically with the addon's own
SpoutReceiver (same receive path for reference + atlas senders, so the
convention comparison is exact). Teardown verified (slices→0 stops the
atlas + drops both senders).

Fixes that came out of 2d:
- **Vertical flip** — fixed via `ATLAS_VERT_SHADER` (V flipped) in
  blendRenderer. NOTE: the shared VERT_SHADER bypasses camera/model
  matrices (`gl_Position = vec4(position, 1.0)`), so a mirrored ortho
  camera is IGNORED and a negative quad scale only flips THREE's
  winding state → backface-culls the quad (black tiles). UV flip is
  the only correct mechanism here.
- **applyWarpUniforms NaN-black** — `slice.brightness/contrast/gamma/
  edgeBlend*` had no `?? defaults`; a slice missing them uploaded NaN
  uniforms → whole tile black. Now defaulted like blackLevel already
  was.
- **spoutEnabled gate** — output-mode windows (slice-atlas,
  slice-display, visible output) were starting/stopping the MASTER
  spout sender (state-sync mirrors spoutEnabled=true into them);
  closing/reloading one issued spout_stop_sender and killed the
  editor's output. Gate now also excludes `isOutputMode`.

Open items for Phase 4/5 hardening:
- Atlas window has NO context-loss recovery: observed one
  `[webgpuShared] device lost` → all WebGL contexts lost → atlas black
  forever (engine pauses, paint keeps sending black). Needs an
  auto-reload watchdog in main (e.g. detect contextLost via console or
  a heartbeat IPC).
- Master sender didn't stop when spoutEnabled was flipped false via a
  direct settings-store update (OSR kept sending @60fps) — verify the
  normal UI toggle path, may be CDP-test artifact.
- Eyeball check in OBS/Resolume still worthwhile (programmatic
  verification used the addon receiver; convention matches the
  production-proven single-output sender, so risk is low).

Dev-loop gotchas that cost time (also in project memory):
- CDP `Runtime.evaluate` with `replMode:true` silently breaks
  `awaitPromise` (returns `{}`) — omit replMode.
- Vite under OneDrive can serve STALE transforms after an edit
  (file-watcher lag): `fetch('/src/...').then(t => t.includes(...))`
  in the target window to confirm what's actually served before
  concluding a fix "didn't work".
- `scripts/cdp-eval.mjs`, `cdp-console.mjs`, `cdp-shot.mjs` were added
  for driving/verifying headless windows (atlas window has no UI).

**2a. `SpoutAtlasOutput` C++ class** — DONE (in `spout_addon.cpp`,
registered in `Init`; `configure(regions)` + `sendAtlas(handle)` +
`release()`; per-name BGRA staging textures on one shared external
device; out-of-bounds regions skipped during resize races).
- Owns ONE external D3D11 device on the discrete GPU (mirror
  `SpoutOutput::CreateExternalDevice` / `FindDiscreteGpuAdapter`).
- Holds `std::map<name, unique_ptr<Sender>>` where each Sender =
  `{ spoutDX, ID3D11Texture2D (BGRA, per-slice size), w, h, x, y }`.
- `configure(regions)`: regions = `[{name,x,y,w,h}]`. Create/resize
  per-name sender + texture (each `spout.OpenDirectX11(m_device)` +
  `SetSenderName`), drop stale, store regions.
- `sendAtlas(handleBuffer, atlasW, atlasH)`: `OpenSharedResource1` the
  atlas handle ONCE on `m_device1`; for each region
  `CopySubresourceRegion(senderTex, 0,0,0,0, atlasTex, 0, &box)` where
  `box = {x, y, 0, x+w, y+h, 1}` (top-left — captured atlas is top-down),
  then `sender.spout.SendTexture(senderTex)`. Flush.
- `release()`. Register in `Init`.
- KEY: src (atlas) + all dst (sender) textures on the SAME device, BGRA
  (Chromium OSR is B8G8R8A8). No keyed-mutex acquire (single-output path
  doesn't either).

**2b. main.js orchestration** — DONE (`texshare_start_atlas`/`stop_atlas`
handlers, atlas OSR window loading `?mode=slice-atlas` with its own
paint pump, `texshare_atlas_layout` → `configure()` + window resize,
paint → `sendAtlas`, teardown in `closeAuxiliaryWindows`, renderer
status via new `texshare-atlas-status` channel). Original plan:
- `texshare_start_atlas` (from editor when ≥1 spout/syphon sender slice):
  create `new addon.SpoutAtlasOutput()` + a hidden OSR window loading
  `?mode=slice-atlas` (mirror `createSpoutOsrWindow`: `offscreen:{
  useSharedTexture:true}`, `setFrameRate(OSR_PAINT_FPS)`).
- `texshare_atlas_layout` (already stubbed): on change → `atlasOutput.
  configure(regions)` + resize the atlas OSR window to atlasW×atlasH.
- atlas OSR `paint` handler → `atlasOutput.sendAtlas(handle, codedW,
  codedH)` (regions already in the addon from configure). Release texture
  each paint (pool exhaustion guard, like single-output).
- `texshare_stop_atlas` + teardown in `closeAuxiliaryWindows`.

**2c. Renderer routing** (`Canvas.svelte`) — DONE (reactive lifecycle on
the sender-slice set via `isAtlasSenderSlice`, independent of the master
`spoutEnabled` toggle; per-slice CPU readback+send skipped when
`atlasFanoutActive`; `texshare-atlas-status` listener with CPU fallback
when the atlas dies). Original plan:
- When atlas is active, SKIP `renderSlicePixelsAsync` + `spout_send_image`
  for every spout/syphon SENDER slice (NDI slices keep the async readback).
- Drive `texshare_start_atlas`/`stop_atlas` from the sender-slice set
  (already tracked via `lastSliceIdsKey`).

**2d. Build + verify**
- Build: the addon rebuilds via `@electron/rebuild` (electron-builder runs
  it; also `npx cmake-js` direct). Vendored SpoutDX is at
  `electron/native/vendor/SPOUTSDK` (confirm present). `build/Release/
  spout_addon.node` is the output.
- Test: needs a **Spout receiver app** on this PC (Spout demo receiver,
  OBS Spout-source plugin, Resolume, or MadMapper). Configure 2 sender
  slices, confirm TWO independent named senders appear with correct,
  independent content.

### ✅ RESOLVED (was: ⚠️ open issue) — vertical orientation
Fixed via `ATLAS_VERT_SHADER` (see 2d fixes above). Original notes:
Phase 1's atlas comes out GL-framebuffer bottom-up: a source TOP stripe
lands at the displayed-atlas BOTTOM (confirmed via pixel probe). The
captured atlas is therefore vertically flipped per tile. Fix by matching
the single-output `SendTexture` orientation — likely `setAtlasSource`
`flipY: true` (best guess) OR a flip in the tile draw. **Do NOT guess the
direction — pin it against a real Spout receiver** (single-output is the
right-side-up reference). This is the first thing to nail once 2a/2b are
wired and a receiver is showing pixels.

### Phase 3 — macOS Syphon parity (NOW UNBLOCKED — next up)
`SyphonAtlasOutput` in `syphon_addon.mm`: `CGLTexImageIOSurface2D` the
atlas once, sub-rect blit per tile → per-name `SyphonServer`. Built +
verified on the Mac/codex dev (Syphon framework must be vendored — see
CMakeLists FATAL_ERROR instructions). Mirror the single-output flip
convention.

### Phase 4/5 — NDI no-regression + degraded-status badge; atlas-dim guard + docs.

---

## 3. Environment / how to resume

- Dev run: `npm run desktop` (Vite + Electron). For CDP testing:
  `npm run dev` then `VITE_DEV_SERVER_URL=http://localhost:1420 npx
  electron . --remote-debugging-port=9234`.
- Native rebuild after editing the addon: electron-builder `--dir` runs
  `@electron/rebuild`; or build directly with cmake-js in `electron/native`.
- **CDP gotcha:** bare `import('/src/...')` in a *plain Edge* page can hang
  / hit a separate Vite `?v=` module instance — verify against the DOM or
  in Electron, not Edge. (Cost me time this session.)
- Tasks tracked in the task list (#11 done, #12 in progress, #13-15 pending).
- Memory notes in the project memory dir (`ghost-arcade-debug-packaged.md`).

## 4. Suggested first action after reboot
Write `SpoutAtlasOutput` (2a) — it's the foundation and the riskiest part.
Build it, then wire 2b/2c, then open a Spout receiver and resolve the
orientation flip (2d) in one sitting.
