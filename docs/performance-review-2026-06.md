# Performance Review — June 2026

Goal: maximum sustained frame rate and zero memory growth during multi-hour live
shows, with output paths as close to fully zero-copy as the platform allows.

Method: five parallel code audits (render loop, output/zero-copy, memory leaks,
state sync/stores, Electron main + native), findings cross-verified against the
source. Items the audit got wrong were dropped (e.g. keyframe playback was
reported as writing the project store per frame — it doesn't; it mutates render
clones and restores them after render, which is the right design).

Already fixed this session (commits `9bd8d0c`, `7f7b9d8`, plus upstream `b7c9f95`):
- Stage 3D relay published a full `exportProject()` every 100ms on any project
  tick, even with the window closed; receiver ran `importProject()` per poll.
  Now diff-routed (none / per-layer patch / full) and gated on the window being
  open. Idle full-imports went from ~10/s to 0.
- Stage 3D viewport black on packaged Windows builds (composer present path).

---

## P0 — Highest impact during a live set

### 1. Modulation → clip-grid clone storm (CPU, allocation)
`src/lib/stores/vjClipLauncher.ts:1232` — `batchUpdateShaderValues()` runs per
modulated VJ layer per audio tick (up to 60Hz). Each call does
`targetGrid.map(row => [...row])` — a full clip-grid clone (layers × columns
arrays) — plus layerStates array clone, to update a few scalar shader values.
With 2–4 modulated layers that is 120–240 grid clones/second, all garbage.
Each store tick also wakes every `vjClipLauncher` subscriber (panels, sync).
**Fix:** separate hot channel for shader values — either a dedicated
`shaderValuesByLayer` store the renderer reads directly, or mutate the active
clip's `shaderValues` in place and notify a lightweight version counter store;
keep the structural store for grid topology only.

### 2. VJ-state broadcast serializes all clip grids at 30Hz
`src/lib/sync/stateBroadcast.ts` — `doBroadcastVJState()` (33ms debounce, runs
whenever an output/OSR window is connected) maps `blocks` + `clipGrid` +
`bankBClipGrid` through `stripClipGrid` and `JSON.parse(JSON.stringify(...))`
on every VJ store tick. Driven by P0-1 above, that's full-grid serialization at
30Hz during any audio-modulated set with an output window open (tens of MB/s).
**Fix:** split the payload like the project path now is: grids/topology only on
structural change (clip added/moved/removed); per-tick payload = layerStates +
faders + crossfader only (the existing `buildLiveVJStatePayload(…, false)`
shape). Receivers already merge shallowly, so this is shape-compatible.

### 3. Spout/Syphon/NDI CPU readback path
`src/lib/components/Canvas.svelte:1971` (full-frame `getImageData`),
`src/lib/output/blendRenderer.ts:569` (`gl.readPixels` per slice per frame).
~26 MB/s at 1080p60 single output; multiplies per slice and at 4K. The Windows
OSR/DXGI zero-copy path exists and is the default; the CPU path is the fallback
and the only path for NDI and macOS Syphon today.
**Fix (staged):**
  a. Make sure the CPU fallback never engages silently — surface a visible
     "CPU texture share" warning in the UI when active (flag exists:
     `cpuTextureShareSendAllowed`).
  b. Async readback: replace blocking `readPixels` with PBO + fence
     (`gl.fenceSync`/`clientWaitSync` next frame) so the stall leaves the
     render thread. Three.js exposes `WebGLRenderer.readRenderTargetPixelsAsync`.
  c. macOS: route Syphon through IOSurface texture handoff in the native addon
     (today it takes the same CPU image path as the fallback).
  d. NDI: NDI is inherently a CPU-frame API; keep async sends (already
     non-blocking) but feed them from the async readback in (b).

### 4. Synchronous `fs.appendFileSync` on every console line (main process)
`electron/main.js:68-86` — every `console.log/warn/error` in the main process
(and forwarded renderer messages) appends to the debug log synchronously.
1–5ms main-thread block per line; main-process jank lands on IPC, window
management, and native sends during shows.
**Fix:** buffer lines, flush with async `fs.appendFile` every 500ms / 100 lines.

### 5. Stage 3D LED glow readback stall
`src/lib/stage3d/Stage3DRenderer.ts:746` — `readRenderTargetPixels` (1×1) per
frame creates a GPU sync point right after a render; 0.3–1ms typical, worse
under load. Already staggered one-LED-per-frame and now try/caught (b7c9f95).
**Fix:** same async PBO/fence pattern as P0-3b, reading the previous frame's
result (1 frame of color latency is invisible for room glow).

---

## P1 — Real but smaller per-frame costs

1. **Stage-mode per-frame layer cloning** — `Canvas.svelte` ~1373–1464: VJ
   injection spreads new layer objects + effect arrays every frame (10–30
   allocations/frame). Cache clones keyed by (layer id, clip texture identity),
   patch opacity in place. ~1–3ms/frame on big rigs.
2. **`vjResolved`/bucketing rebuilt per frame** — `Canvas.svelte` ~1305–1360:
   memoize on (vjLayers identity, crossfader state, bank).
3. **Render plan rebuild + reverse per frame** — `engine.ts` ~1718: cache until
   the layers array identity changes.
4. **OSC messages: one `webContents.send` per message** —
   `electron/main.js:1095-1113`: a busy controller sends 100+ msgs/s, each a
   separate IPC. Batch a UDP packet's messages into one send; coalesce ≤16ms.
5. **WLED UDP sends unbounded in flight** — `electron/main.js:1145-1168`: add
   an in-flight cap (drop frame if ≥2 pending per socket).
6. **localStorage writes on preset cycling** — `hydra.ts:38`, `milkdrop.ts:48`
   (and `stage3d/store.ts` persist-per-mutation): debounce to ~500ms–1s.
7. **Keyframe debug `JSON.stringify`** — `Canvas.svelte:1480`: throttled to
   1/s but serializes the whole override map; gate behind a verbose flag.
8. **Spout CPU fallback swizzle loop** — `electron/native/spout_addon.cpp:329`:
   scalar RGBA→BGRA + flip; SIMD or let SpoutDX handle format. Only matters
   when the CPU path is engaged (see P0-3a).

---

## P2 — Memory leaks (multi-hour show safety)

| # | Leak | Location | Growth driver |
|---|------|----------|---------------|
| 1 | `videoElementCache` entries never deleted when a clip is removed from the grid | `vjClipLauncher.ts` (~536) | per clip add→delete; holds HTMLVideoElement + decoder |
| 2 | `vjShaderInputCache` unbounded | `vjClipLauncher.ts:13` | per unique shader code string (keys are whole shader sources) |
| 3 | Thumbnail video elements never paused/src-cleared | `recorder.ts:351`, `offlineRender.ts:453` | per recording / offline render |
| 4 | Blob URL not revoked after thumbnail | `offlineRender.ts:364` | per offline render |
| 5 | `imageInputTextureCache` (ISF image inputs) never disposed | `Canvas.svelte:563` | per unique image input |
| 6 | `sliceWindows` map entry leaks if window closed externally | `electron/main.js:174` | per slice window; add `closed` handler |
| 7 | `wledSockets` only closed via explicit IPC | `electron/main.js:183` | per removed controller |
| 8 | Error-report queue: bounded count (50) but no TTL | `electron/main.js:2656` | error storms |

Generally the codebase is disciplined: THREE disposal on layer teardown, rAF
cancellation, store unsubscribes, and recorder stream cleanup are all in place.

---

## Zero-copy state map (today)

| Path | Windows | macOS | Status |
|------|---------|-------|--------|
| WebGPU output window (`mode=webgpu-display`) | zero-copy | zero-copy | VideoFrame → MessagePort (same renderer process) → `importExternalTexture`. The flagship path; default on. |
| Master warp composite | zero-copy | zero-copy | GPU warp pass + captureStream, no readback |
| Slice windows (same-renderer `window.open`) | zero-copy | zero-copy | falls back to a full local compositor if the port handshake fails — fallback is expensive; make failures loud |
| Spout single output | zero-copy via OSR/DXGI (default), CPU fallback | n/a | fallback = P0-3 |
| Spout multi-slice | CPU readback per slice | n/a | biggest zero-copy gap on Windows |
| Syphon | n/a | CPU readback | IOSurface handoff is the fix |
| NDI | CPU (protocol-inherent) | CPU | async sends already; feed from async readback |
| Stage 3D window | zero-copy | zero-copy | local compositor in the same GL context, textures never leave GPU |
| Recording | encoder-internal | encoder-internal | fine |
| WLED | tiny intentional readback (≤0.5KB) | same | fine |

Architectural invariant worth documenting for contributors: **true zero-copy
output requires the window to be opened via `window.open` from the editor
renderer** (same renderer process). Chromium silently drops GpuMemoryBuffer
backing on cross-process MessagePort transfer, which turns "zero-copy" into a
hidden CPU path with no error.

## Progress

- ✅ P0-1 modulation hot channel (`ce4b4d8`) — 0 store ticks per audio batch, verified live
- ✅ P0-2 slim VJ broadcasts (`ce4b4d8`) — grids only on structural change, verified live
- ✅ P0-4 async main-process logging (`01c436f`)
- ✅ P1-5 WLED in-flight cap (`01c436f`)
- ✅ P2-1/2/3/5 leak batch (`01c436f`) — video element release on clip clear/overwrite
  (orphan-checked for duplicated clip ids), bounded shader-input cache, thumbnail
  element cleanup, ISF image-input texture disposal. P2-6 (sliceWindows closed
  handler) was already handled in main.js — audit claim was stale. Blob-URL revoke
  claims (P2-4) were WRONG — those URLs are media-library `src`es, intentionally
  long-lived; documented in code instead.
- ✅ P1-1/2 render-loop injection cache — VJ→layer injection (stage + mapping
  binding paths) now reuses the layer clone + merged effects array per layer with
  identity-based invalidation; only the injected source object is rebuilt per
  frame (textures change per frame; cached VJ sources are mutated in place, so a
  frozen copy would drift). VJ id regex parse memoized; texture resolver hoisted
  out of the frame body. Verified by driving stage mode synthetically.
- ✅ P1-7 keyframe debug stringify behind `__GA_KF_DEBUG__` flag.
- ⚠️ P1-3 render-plan caching REJECTED as unsafe: buildRenderPlan depends on
  hasLayerTexture(), which flips when video/shader textures finish decoding on
  the SAME layer objects — identity-keyed caching would leave late-arriving
  textures permanently invisible. Removed a dead per-frame Set allocation instead.

## Suggested execution order

1. P0-1 + P0-2 together (one PR: modulation hot channel + VJ broadcast split) —
   biggest steady-state CPU win for audio-reactive sets.
2. P2-1..5 leak batch (one PR) — cheap, mechanical, show-safety.
3. P0-4 async logging + P1-4/5 (main-process hygiene PR).
4. P0-3b async readback (PBO/fence) — unlocks P0-5 and improves every CPU-share
   fallback; then 3c (Syphon IOSurface) for macOS parity.
5. P1-1..3 render-loop allocation diet.
6. Multi-slice OSR capture on Windows (design task — one OSR window per slice
   with native DXGI capture) to close the largest remaining zero-copy gap.
