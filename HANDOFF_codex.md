# Handoff — Master Warp on Per-Display Slice Output

**Branch:** `claude/pensive-hypatia-bFLV6`
**State:** 8 uncommitted modified files locally. Remote has diverged — see "Note on the remote revert" at the bottom.
**Goal:** Master warp visible on **all** output paths simultaneously: editor preview, Fullscreen output window, AND per-screen "Open on display" projector window.

---

## What works ✅

- **Editor preview** — Master warp renders correctly in `.webgpu-present` via the WGSL fragment shader in `src/lib/components/WebGPUCanvas.svelte`. Verified via the on-screen orange handles + cropped warp visible on the editor canvas. Tested with TL corner pulled inward — image content appears in the warped quad, areas outside the quad are correctly black (the intentional crop/keystone semantic).
- **Fullscreen output** (`Fullscreen` button → `OutputSharedTextureDisplayApp` via `?mode=webgpu-display`) — Receives VideoFrames via `MessageChannel`, renders via `importExternalTexture`. Master warp visible on the projector. **Previously verified working** before this session's multi-target refactor; may have regressed (see "Open issues").

## What's broken ❌

- **Per-display slice output** (`Open on display` → `SliceOutputApp` via `?mode=slice-display&sliceId=X`) — Projector goes black when slice window opens. Has gone through three architectural attempts this session, all black.

---

## Architecture overview

The editor process owns the WebGL Three.js scene (`Canvas.svelte` in `bridgeMode`). `WebGPUCanvas.svelte` reads it via `importExternalTexture` and presents to `.webgpu-present`, applying the **master warp inside the WGSL fragment shader**. That canvas is what `outputSharedTexturePresenter.ts` captureStreams.

```
EDITOR (one renderer process)
  Canvas.svelte (WebGL, hidden via opacity:0 in bridgeMode)
    → main-canvas (the source)
  WebGPUCanvas.svelte
    → reads main-canvas via VideoFrame
    → WGSL shader applies master warp (corners + mesh)
    → .webgpu-present (the visible + captured surface)

  outputSharedTexturePresenter.ts (this session: refactored to multi-target)
    captureStream(.webgpu-present) → MediaStreamTrackProcessor → VideoFrame
    Fan-out to N attached output windows via VideoFrame.clone() per frame

OUTPUT WINDOWS (each is supposed to be same-process child via window.open)
  Fullscreen popup  → OutputSharedTextureDisplayApp.svelte (?mode=webgpu-display)
                      Receives VideoFrame, importExternalTexture, render quad
  Per-screen slice  → SliceOutputApp.svelte (?mode=slice-display&sliceId=X)
                      Receives VideoFrame, drawImage with slice crop region
```

---

## Files modified this session

### `src/lib/components/WebGPUCanvas.svelte`
- **Fixed WGSL reserved-word bug**: renamed struct field `meta` → `cfg` (commit `257c848` shipped with `meta` as the master-warp uniform struct member name, which is a WGSL reserved word — pipeline failed to compile silently, everything went black). After this fix the in-shader master warp actually works in WebGPU mode.
- Added per-second `[mwarp] wgsl uniform` diagnostic that dumps mode, rows, cols, all 4 corners, and mesh min/max/NaN count.
- Added degenerate-quad guard: if the corner quad has near-zero area (collapsed/inverted) the shader bails to passthrough instead of black.
- Mesh `if (!found)` branch changed from hard-black to passthrough as a safer fallback.

### `src/App.svelte`
- **Made the WebGPU bridge source-canvas wiring reactive** (was once-only at App mount). Toggling `experimental.editorWebGPU` ON at runtime now properly pushes the WebGL canvas into the WebGPU bridge. Without this, flipping the flag mid-session produced a totally black editor.
- Idempotent: only re-wires when the canvas or bridge instance actually changes (prevents log spam every settings update).

### `src/lib/components/ScreenPanel.svelte`
- `openOnDisplay` now uses `window.open` + `configure_next_output_window` when `outputZeroCopy` is on (mirrors the Fullscreen path's mechanism), and calls `attachOutputWindow(newWin, 'slice:'+sliceId)` to register the slice with the editor's multi-target presenter.
- `closeOnDisplay` correspondingly calls `detachOutputWindow('slice:'+sliceId)`.
- `toggleMasterWarp(enabled)` now clears stale corners/mesh on enable — guards against the persisted-degenerate-geometry-blacks-out scenario.

### `electron/main.js`
- `setWindowOpenHandler` now allows `?mode=slice-display` URLs through (previously only `?mode=webgpu-display`).
- `did-create-window` listener captures slice-display BrowserWindows into the existing `sliceWindows` Map keyed by sliceId, so the legacy `output_close_slice_window` IPC still works.
- Slice windows get `frame: false, fullscreen: true` overrides (matches the legacy IPC slice-window appearance).

### `src/lib/sync/outputSharedTexturePresenter.ts`
- **Major refactor: single-target → multi-target.** Replaced `targetWindow` / `outboundPort` / `pendingChannel` module locals with `targets: Map<string, TargetState>`. Each attached window has its own port + pending channel + lastTransformJson.
- `attachOutputWindow(target, id = 'main')` — adds a target. `detachOutputWindow(id)` — removes one. Pump stops when the last target detaches.
- `pump()` now fan-outs each frame: posts the original to the first port, `VideoFrame.clone()` for the rest, transfers each clone separately. Per-port `postMessage` failures detach that target without affecting the others.
- Message listener routes `ghostarcade-output-ready` by `event.source` matching against attached `target.window`; falls back to "exactly one awaiting" if `event.source` is missing.
- `setOutputCursor` / `setOutputCursorStyle` broadcast to all attached ports.
- `getOutputSharedTexturePresenterStats()` now returns `targetCount` / `targetsWithPort` too.

### `src/SliceOutputApp.svelte`
- Detects `window.opener && sliceId` → `zeroCopySliceMode = true`. In that mode it does the **same MessagePort + VideoFrame handshake as OutputSharedTextureDisplayApp**: top-of-script `window.addEventListener('message', handlePortIntake)`, on mount `signalReadyToOpener()`, port's `onmessage` stores `latestFrame: VideoFrame`.
- `presentOneFrame` draws the slice's crop region from `latestFrame` via `drawImage(frame, sx, sy, sw, sh, 0, 0, w, h)`.
- Legacy IPC path (window.opener missing) still mounts `<Canvas />` + uses local `blendRenderer` master-warp tick — preserved as fallback.
- **Diagnostics:** a static green canary in the top-right corner of the slice window prints `SLICE MOUNT sliceId=... zc=1` the moment the component mounts (independent of canvas painting). An on-canvas status overlay prints frames-received / src dims / crop / drawImage error (red if `drawImage` threw, green if succeeded). `!slice` branch draws the frame full-screen + an orange diagnostic so a missing slice config from BroadcastChannel surfaces visibly.
- Duck-types VideoFrame (instead of `instanceof VideoFrame`) in case cross-process Mojo transfer makes the constructor identity differ in the slice's renderer process.

### `src/lib/sync/outputComposite.ts`
- `[mwarp]` debug default flipped to ON (silence with `window.__MWARP_DEBUG__ = false`).

---

## Where we got stuck

The slice display window is **black** despite:
1. The editor's presenter log showing `MessageChannel established with target slice:...` ✅
2. The pump running and `frame N format=NV12 dim=1920x1080 ts=... fanout=1` for the first 5 frames ✅
3. `ScreenPanel.svelte:[ScreenPanel] slice ... opened on display 5 [zero-copy]` ✅

Yet the user reports "black no text" — meaning the slice window's projector shows pure black, no canary, no status overlay. The static `SLICE MOUNT` canary div was added in the **most recent edit** but the user hasn't tested that build yet (left mid-session). When they reboot and test:

- **No canary visible** → SliceOutputApp's Svelte component never mounted in that window. JS error at script-init in the slice window. Open DevTools on the slice window (`GHOSTARCADE_OUTPUT_DEVTOOLS=1` env var enables it for fullscreen — extend the same to slice windows in `electron/main.js`'s `did-create-window` for slice-display).
- **Canary visible, canvas all black** → Component mounted but `presentCtx` never got set, or rAF never ran. The new `[SliceOutput] presentOneFrame skipped — presentCtx=... presentCanvas=...` warning should print every 60 frames if so.
- **Canary + orange "NO SLICE CONFIG" overlay** → BroadcastChannel state-sync isn't delivering `settings.output.slices` to the slice window. Same-origin same-session SHOULD work cross-window, but maybe the agent cluster is different in this Electron config.
- **Canary + diagnostic at top, black canvas** → drawImage(VideoFrame) failing silently or returning transparent.

There's also a recurring `A VideoFrame was garbage collected without being closed` warning in the editor console. Likely from old slice windows after rapid re-opens — each `openOnDisplay` creates a new window/MessageChannel and the previous one's in-flight frames may not get closed cleanly. Not the root cause of the black output, but worth fixing.

## A recent regression to investigate

User's last test reported "no outputs of any kind working" — including Fullscreen which had been working perfectly **before** the multi-target presenter refactor. The fan-out pump now does `VideoFrame.clone()` for additional targets; if `clone()` returns null/throws or the resulting clone can't be transferred properly, fullscreen could be receiving broken frames. Worth verifying Fullscreen still works on its own (no slice attached) before piling on more slice fixes.

## Hypotheses worth testing first

1. **Slice window is in a different renderer process despite same-origin.** Chromium's site-isolation may split it. Check via the slice window's DevTools: `chrome://process-internals` (if accessible in Electron) OR just `window.opener.document` access — throws cross-origin error if cross-process. If cross-process, BroadcastChannel + VideoFrame transfer DO still work (Mojo IPC), but `instanceof VideoFrame` returns false (already worked around with duck-typing).
2. **`drawImage(VideoFrame)` not supported in this Chromium version's slice-window renderer.** Try replacing with `createImageBitmap(frame).then(bmp => ctx.drawImage(bmp, ...))` as a more conservative path.
3. **The slice window mounts SliceOutputApp but Svelte 5's reactivity for `$: slice = $settings.output.slices.find(...)` isn't firing.** Test by hard-coding `slice = { cropX:0, cropY:0, cropW:1, cropH:1, ... }` and seeing if the projector gets the full frame.

## Suggested next steps for the new agent

1. **First: confirm Fullscreen still works alone.** Boot fresh, open Fullscreen (no slice). If broken, the multi-target presenter regression is priority #1 — easiest fix is to bypass the fan-out when there's only one target (the previous single-target code path is preserved in git history).
2. Open DevTools on a slice display window. Add to `electron/main.js`'s slice-display `did-create-window` branch:
   ```js
   if (process.env.GHOSTARCADE_SLICE_DEVTOOLS === '1') newWindow.webContents.openDevTools({ mode: 'detach' });
   ```
   Reboot with `GHOSTARCADE_SLICE_DEVTOOLS=1 npm run desktop`. The slice window's console will reveal what's actually happening.
3. If the canary doesn't appear, the bug is at component mount. If the canary appears but canvas is black, the bug is downstream of the rAF loop.

---

## Note on the remote revert

While we were debugging, another local session pushed two commits to this branch's remote:

```
59b325a docs: handoff note for the zero-copy master-warp (local-session task)
1c86eb8 revert(output): restore working readback master-warp; abandon zero-copy attempts
```

That session **reverted the zero-copy master-warp work** and went back to the readback-based path (which works correctly across all outputs, but pays the GPU→CPU→GPU cost per frame). The local files in *this* session do NOT have those reverts — they're the in-progress zero-copy attempt described above.

Two paths forward for whoever picks this up:

- **Continue local (this session's approach).** Get the WGSL master warp + multi-target zero-copy presenter working all the way to per-screen slices. Higher upside (true zero-copy on every output) but the slice-display path is still broken.
- **Take the remote revert.** `git stash && git pull` — restores the working readback master warp on every output. Master warp visible everywhere immediately, at the cost of GPU↔CPU readback per frame. This is the lower-risk path if "make master warp visible everywhere" is the goal and the perf hit is acceptable.

The remote revert + handoff doc reflects another agent's judgment that the zero-copy experiment had taken too long. That's not necessarily wrong — but the WGSL shader IS working in the editor + Fullscreen (when not regressed by the slice work). Only the per-screen slice path is blocking shipping all-zero-copy. A focused investigation per the hypotheses above could close the gap in well under an hour.
