# Windows Native Driver — Handoff & Test Plan

**Branch:** `codex/native-main-driver-wip`
**Last commit:** `8be8be18` — everything after that is **uncommitted working tree** (~108 files).
**Goal:** bring the native Rust + wgpu renderer to full parity with release v1.9.993. Native should be an upgrade, not a downgrade.
**Written:** 2026-08-10, after a macOS session. Everything below was developed and verified on an M1 Max. **None of it has run on Windows yet.** That is the job.

---

## 1. Read this first

The native core (`native-renderer/`, Rust + wgpu) is a **separate process** from Electron. It renders the composite and hands frames back over a shared-texture transport. Most Windows risk lives at that boundary, because the macOS transport is IOSurface and the Windows transport is a DXGI shared handle — two different code paths behind one interface.

The Rust core is platform-neutral and **cross-compiles clean for Windows today** (`npm run native:check:windows` passes, warnings only). The gaps are in the Electron presenter layer, not the core.

---

## 2. Build and run

```bash
npm install
```

```bash
npm run native:build
```

```bash
npm run desktop
```

Native addons (Electron side) build separately and are **required**:

```bash
cd electron/native && npm run build
```

Verify a healthy boot by finding this in the log:

```
ready=true shaders=63 compiled=63 failed=0
```

Zero `panic` lines. If shaders compiled < 63 or `failed` > 0, stop and fix that before testing anything else.

After changing Rust, force a rebuild — stale fingerprints have bitten this project repeatedly:

```bash
rm -rf native-renderer/target/release/.fingerprint/ghost-render-core-* && npm run native:build
```

Full gate before declaring anything done:

```bash
npm run native:full-check
```

---

## 3. How to read the status line (do not skip this)

Every few seconds `NativeRendererSync` prints a dense status line. **It is the single best debugging tool in this codebase** — a Syphon bug in this session was diagnosed entirely from it, without a debugger.

```
uploads=0(0cpu/0file/0b64/0json/0shared/2032sharedReject/2032reject)
last=shared-texture-unsupported:1920x1080/0->0b
```

Decoded: 2032 frames arrived with valid 1920×1080 metadata and the core **rejected every one**. That is not a connection failure, it is an import failure — a completely different investigation. The counters distinguish "no data" from "data the core won't take", which is the distinction that matters most on a new platform.

Other fields worth knowing:

- `blocked=N(Xfx/Ysrc)` + `lastBlock=` — layers the native path refused, and why.
- `previewMode=` — how the editor preview gets its pixels.
- `nativeFps=0.0` at idle is **normal**. The core renders on demand; with no layers and nothing dirty it stops. Don't chase it.

If a rejection reason is unclear, it is printed on the `reason=` field of the `native shared texture import rejected` warning. (That message used to stringify to `[object Object]`; it was fixed this session to interpolate the reason.)

---

## 4. What to test on Windows, in priority order

### 4.1 Shared-texture INPUT — highest risk

This session found and fixed a macOS bug where the Syphon receive surface wasn't created with `kIOSurfaceIsGlobal`, so the core (a separate process) got `null` from `IOSurfaceLookup` and rejected every frame. Syphon **out** worked the whole time, which made it look like a connection problem when it was a cross-process visibility problem.

**Windows has the structurally identical risk**: a DXGI shared handle must be opened by the receiving process, and handle duplication/permission rules differ from IOSurface. Test each input independently — do not assume one working input means they all work:

- Spout IN (from Resolume / MadMapper / OBS)
- Spout OUT (Ghost → another app)
- Webcam
- Screen capture
- NDI in/out

For each: watch `sharedReject` in the status line. If it climbs, the transport is broken even if the UI says "Live".

Relevant: `native-renderer/src/main.rs` → `import_dxgi_source_frame`, and `electron/native/spout_addon.cpp`.

### 4.2 Deck monitors — known missing

The core returns, verbatim:

> deck monitor shared-texture presentation is not yet implemented on DXGI

So the VJ deck A/B confidence monitors will be blank on Windows. The core-side render already happens (`render_deck_monitors` is compiled for both platforms) — only the presentation is missing. This is a real gap to close, not a bug to chase.

### 4.3 Native multi-screen slice output — macOS only right now

Implemented this session, macOS only. The core half **is** platform-neutral: it composites one full frame per slice display into a shared texture with that slice's crop, rotation, colour grade, per-edge blend, black-level lift and geometry warp. What's macOS-only is the *presentation* — `electron/native/native_preview_addon.mm` parents a native layer into each slice window and pumps the IOSurface into it.

On Windows, `attachSliceNativeLayer` returns false (it early-returns on non-darwin), so **slice windows fall back to the WebGL path** — each window renders the whole scene in WebGL and crops it, exactly as release v1.9.993 does. That fallback works and now honours blackout and freeze (fixed this session). So Windows multi-screen output is *functional but not native*.

Closing this needs a DXGI equivalent of the preview addon's `monitorAttach` / `monitorSetIOSurface` pair. Everything upstream is already in place:

- `set_slice_outputs` command (per-slice geometry + grade)
- `get_slice_output_state` RPC (publishes per-slice shared-texture handles)
- `slice_native_presentation_state` IPC (tells a slice window whether to skip its own renderer)

### 4.4 Everything ported this session

Verify these behave the same on Windows as on macOS:

- **Blackout / freeze** — must blank and hold the *projector*, not just the editor preview.
- **Macro effect bundles + composition effects** — run as a composite-stage chain in the compositor shader.
- **Output stage** — crop, rotation, brightness/contrast/gamma, edge blending, dome projection.
- **Slice warps** — rect crop, corner (keystone) warp, mesh warp, and master warp.
- **Keyframes and the layer sequencer** under the native driver.

---

## 5. Known limitations (deliberate, not bugs)

- **Composite-stage effects** only cover the compositor's nine in-shader colour ops (invert, grayscale, brightness, contrast, gamma, saturation, hue, posterize, noise). A blur / colorama / displacement on a macro or at composition level is **dropped and logged by name**, not silently misapplied. Anything else needs a real post pass.
- **Output warp control grids cap at 16×16.** A larger mesh falls back to the rect crop and logs which screen lost its warp.
- **Slice count caps at 8** (`MAX_SLICE_OUTPUTS`). Each slice is a full composite pass per frame — that is the honest cost of rendering each projector at its own resolution instead of cropping a downscaled master.
- **Cross-machine asset portability**: `AssetRef.projectPath` sibling copies are never written, and `recordMissingAsset` has no callers. Moving a project between machines may still need a resync. Worth knowing before a show.
- **Projection-sim persistence** is a no-op (`persist()`).

---

## 6. Architecture pointers

| Concern | Where |
|---|---|
| Compositor shader (one fullscreen pass, ≤64 layers) | `native-renderer/src/heartbeat.wgsl` |
| Core process, commands, RPC, render loop | `native-renderer/src/main.rs` |
| Command / RPC name registry | `native-renderer/src/capabilities.rs` |
| Editor → core command feed | `src/lib/sync/nativeRendererSync.ts` |
| Command type definitions | `src/lib/api/native-renderer.ts` |
| Electron main: windows, addons, pumps | `electron/main.js` |
| Slice output window | `src/SliceOutputApp.svelte` |
| Reference WebGL slice math (native ports must match this) | `src/lib/output/blendRenderer.ts` |

**The `Uniforms` struct is mirrored by hand** between `heartbeat.wgsl` and `main.rs`. Field order must match exactly or every frame silently corrupts. Check it after any change:

```bash
awk '/^struct Uniforms \{/,/^\}/' native-renderer/src/main.rs | grep -oE "^    [a-z_0-9]+:" | tr -d ' :' > /tmp/rs.txt; awk '/^struct Uniforms/,/^}/' native-renderer/src/heartbeat.wgsl | grep -oE "^  [a-z_0-9]+:" | tr -d ' :' > /tmp/wg.txt; diff /tmp/rs.txt /tmp/wg.txt && echo "FIELD ORDER MATCHES"
```

---

## 7. Driving the core directly

The core speaks newline-delimited JSON over stdio, so you can test it **without launching the app** — much faster than a full boot, and it isolates core bugs from Electron bugs. `scratchpad/probe-slice.mjs` is a working example; the shape is:

```js
child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
```

Send `start` first (`{ backend: 'd3d12', width, height, decode_backend: 'ffmpeg_d3d11va' }` on Windows) or nothing renders and every query comes back empty. Slice targets are created lazily inside the render loop, so allow ~1s before querying `get_slice_output_state`.

Useful methods: `capabilities`, `set_output_state`, `set_composite_effects`, `set_output_stage`, `set_slice_outputs`, `get_slice_output_state`, `frame_snapshot`.

---

## 8. Two recurring bug classes

Both bit repeatedly during this port. Check for them before deep-diving anything else.

**Svelte reactivity.** A store or prop read *inside a function body* is invisible to dependency tracking, so the UI goes stale until something unrelated forces an update. Fix by naming the dependency in the reactive expression itself. Hit in the ISF panel, the warp handles, and the Canvas ISF parse block.

**Silent no-ops under the native driver.** Anything implemented inside Canvas's WebGL render body, or gated behind `if (engine …)`, never runs natively — `engine` is never created, because `onMount` early-returns into the native shell. The feature doesn't error; it just does nothing. If something "doesn't work in native", grep for its `engine.` call site first.

---

## 9. Before going live

- Commit the working tree. **Author must be `justin@dreamscience.art`** — never `designwithap` (no GitHub account, blocks Vercel).
- Run `npm run native:full-check` on Windows.
- Test on the real projector rig, not just a second monitor — edge blending, black-level lift and keystone warp can only really be judged on the actual surfaces.
- Confirm blackout genuinely blanks every projector. It is the show kill switch, and on Windows the slice windows are on the WebGL fallback path, which is a *different* implementation from the macOS native one.
