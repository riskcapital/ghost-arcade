# Windows Verification — Ghost Arcade 2.0

Branch: `codex/native-main-driver-wip` · Written 2026-08-17 after the native-renderer
work landed on macOS (Apple M1 Max). Sections 0–6 were written from **macOS only** unless a
line says otherwise.

> **§7 is a real Windows pass** (2026-08-17, RTX 4070 Laptop / NVIDIA Optimus / Win11, commit
> `16a7fee`). It closes several §4.1 rows and corrects the ffmpeg prerequisite. **Read §7.3
> before touching screen capture** — DXGI Desktop Duplication is a dead end inside Electron.

Work top-to-bottom. Sections 0–2 are "will it even run"; 3 is the feature sweep; 4 is
known-bad — **read it before filing anything**, it will save you chasing four ghosts.

---

## 0. Prerequisites

| Need | Notes |
|---|---|
| Rust toolchain (stable) | The native core is a Rust/wgpu sidecar built per-platform. There is no prebuilt Windows binary in the repo. **`rust-version = 1.96` — older stable fails outright.** |
| Node + npm | Matches the macOS dev setup. |
| VS Build Tools + Windows SDK | Needed for the C++ addons. Verified against VS2019 Build Tools + Win10 SDK 10.0.19041.0. The SDK supplies the C++/WinRT headers the capture addon needs. |
| ~~ffmpeg on PATH~~ | **Superseded — ffmpeg is bundled.** `ffmpeg-static` is a dependency, is listed in `asarUnpack`, and the broker resolves `GA_FFMPEG_PATH` → `ffmpeg-static` → bare PATH, then injects the resolved path into the core's env (`native-renderer-broker.js:336` / `:1880`). PATH ffmpeg is only the last-resort fallback. |
| NDI SDK (optional) | Only needed if testing NDI. CMake autodetects `C:/Program Files/NDI/...` or `NDI_SDK_DIR`. If `NDI_FOUND` is false the addon simply isn't built and NDI options should degrade, not crash. (On this machine the SDK is absent, so `ndi_addon` is skipped and NDI is untestable.) |
| Spout | Windows equivalent of macOS Syphon. `electron/native/spout_addon.cpp` exists. |

```bash
npm install
npm run native:build      # builds the Rust core for the host arch — MUST succeed first
npm run dev               # vite renderer on :1420
npm run desktop:app       # electron shell (needs vite already serving)
```

---

## 1. Does it build on Windows?

- [ ] `cargo build --release --manifest-path native-renderer/Cargo.toml` — clean
- [ ] `npm run native:build` — produces `native-renderer/target/release/ghost-render-core.exe`
- [ ] `npx svelte-check --tsconfig ./tsconfig.desktop.json --threshold error` → **0 errors**
- [ ] `npm run build` (vite production build)

> ⚠️ **Expect the NDI addon to fail here.** See §4.1 — the Windows DXGI receive path has
> never been compiled anywhere. If it breaks the build, it is `#elif defined(_WIN32)`-guarded,
> so stubbing it out is safe and does not affect anything else.

---

## 2. Does the core come up?

- [ ] App launches, canvas renders, no uncaught errors in `scratchpad/desktop-app.log`
- [ ] Status line shows `backend=` (expect **dx12** or **vulkan**, not metal), `ready=true`,
      `shaders=N compiled=N failed=0`, `shaderErr=none`
- [ ] Adapter name is the real GPU, not a software fallback

**Gates** (each ends in a real render against the built core):

- [ ] `node scripts/native-wgsl-check.mjs` — all shaders parse under naga
- [ ] `npx vitest run` — see §4.4 for two known flakes
- [ ] `npm run native:smoke`
- [ ] `npm run native:graph-parity`
- [ ] `npm run native:preview-output-golden`
- [ ] `npm run native:frame-sequence`
- [ ] `npm run native:doctor`
- [ ] `npm run native:broker-contract` — **known partial fail, see §4.3**

> Golden-hash gates encode expected pixel output. If they differ on Windows, that is
> **information, not necessarily a bug** — a different backend can legitimately differ in the
> last bits. Record the delta rather than re-baselining silently.

---

## 3. Feature sweep

### 3.1 GPU instruments (the headline work)
- [ ] **Smoke Riders** — orbs ride the fluid, emission breathes smoothly (no pulsing/flicker)
- [ ] **Fluid Riders** — orbs weave through the liquid with a visible waterline, not a shell in front
- [ ] Lower **Orb Opacity** → orbs read as individual glass bubbles, see-through, not a uniform dim
- [ ] **Light shafts** on both: set a tight spot, confirm orbs cast visible shadow beams through the medium
- [ ] **Volumetric Nodes** (was "volumetric balls") — node/line connectors, cylinder mode is see-through,
      geometry switch (sphere/cube/rounded box/octahedron/capsule/torus), shafts land on the ground plane
- [ ] **Quality tiers actually differ** — Low → Ultra changes particle/grid counts and cost.
      Reference macOS cost at 1080p: Volumetric Nodes 43.6 / 33.3 / 30.3 / 28.8 fps across the four tiers;
      Smoke Riders Ultra is expensive (~11.5 fps) by design.
- [ ] **3D Smoke Resolution picker** works (this was a no-op until recently — verify 48 vs 64 actually differ)

### 3.2 Show timeline (mapping mode)
- [ ] Panel opens from the **Show** pill; sized as a tray, nothing behind bleeds through
- [ ] Drop an audio file → waveform draws
- [ ] Arrange preset clips with durations; playback swaps compositions on the boundaries
- [ ] **Spacebar** toggles the playhead (and does NOT fire while typing in a field)
- [ ] Drag a **transition** onto a junction, resize it, confirm it visibly crossfades (not a hard cut)
- [ ] Save project → quit → reopen → timeline, audio tracks and clips all restore

### 3.3 Audio
- [ ] Clip audio is **off by default**; enabling "Play audio" on a video clip produces sound
- [ ] Master clip-audio control works; if muted, the red "muted" chip appears (do not confuse with silence)
- [ ] Live **REC** captures audio — mic, system/internal mix, show audio, or any combination
- [ ] Audio-reactive visuals respond to a live input

### 3.4 Render to video
- [ ] Export produces a file at the requested fps/duration (verify with `ffprobe`)
- [ ] **Exported motion speed matches what you saw live** (this was 1.7–3.8× fast before it was fixed)
- [ ] A **Save dialog** appears when the MP4 finishes; cancelling still leaves a findable file
      and the panel shows its path with a Reveal button
- [ ] Exports are silent — **expected**, see §4.2

### 3.5 Output paths (most Windows risk)
- [ ] Multi-screen slice output — **see §4.1, macOS-only today**
- [ ] **Spout** send works (Windows' Syphon)
- [ ] NDI — see §4.1
- [ ] Blackout / freeze still blank and hold the output
- [ ] **Clear all layers → output goes black.** Verify on every surface: canvas, slice windows,
      Spout/NDI consumers. A stale "ghost" frame here is a real bug (it was fixed on macOS).

### 3.6 Projects
- [ ] Save / open / autosave-recovery round-trip
- [ ] Imported 3D models and media resolve by path (not re-embedded as base64)
- [ ] Projection sim scene persists with the project

---

## 4. Known-bad — do not chase these

### 4.1 Windows platform gaps (expected, not regressions)
> Updated 2026-08-17 after a Windows pass on RTX 4070 Laptop / NVIDIA Optimus / Win11.
> Several rows below were closed — see §7 for what now works.

| Area | State |
|---|---|
| **NDI IN (DXGI)** | Written on macOS, `#elif defined(_WIN32)`-guarded, **never compiled or run**. The NDI SDK is absent on the Windows test machine, so CMake skips `ndi_addon` entirely and NDI stays untestable. The cross-platform CPU `receiveFrame` fallback is untouched. |
| **Deck monitors** | Core still returns *"not yet implemented on DXGI"*. **Infrastructure now exists** — `dxgi_preview_addon.cpp` exposes `monitorAttach` / `monitorSetSharedTexture` / `monitorDetach`. This is wiring work now, not missing plumbing. |
| **Slice output targets** | Core-side is platform-neutral; only presentation was macOS-only. Same as deck monitors: the DXGI presenter now provides the `monitorAttach` pair, so this is wiring. Windows still falls back to the per-slice WebGL path today. |
| **NDI OUT** | Implemented for macOS only (IOSurface → sendImage pump). Not wired for Windows. |
| **Syphon** | macOS-only by definition; Windows uses Spout. |

### 4.2 Deliberate, not broken
- **Offline exports have no audio track.** True across the whole app; there is no audio muxing in
  the offline renderer. The show's audio *does* drive audio-reactive visuals deterministically in
  an export. Live REC captures audio normally.
- **Individual small orbs don't each carve a readable light beam** at default radius (~0.042).
  They dapple collectively. Needs ~0.09+ or a tight spot. Geometry, not a bug.
- **Spatial transitions (wipes/iris)** aren't available on the show timeline — only dissolve,
  dip-to-black and additive. Needs a core-side scene-composite target.

### 4.3 `native:broker-contract` partially fails
The graph-manifest half is fixed. It still fails later on an unrelated **projection-sim** assertion:
the mesh preview reports `bright_pixels: 0` (max luma 0.265) against a `> empty` check. Rotation *is*
honoured — checksums and pixel counts differ — nothing just clears the brightness threshold.
Unresolved on macOS too; not Windows-specific. **Do not "fix" it by nudging the threshold** without
first establishing whether it is a real rendering regression.

### 4.4 Known test flakes
Both fail only under full-suite parallel load and pass in isolation. A background task was started
to fix them; if it has landed, ignore this.
- an ISF wgsl-probe checksum assertion
- a video-decode test ("decodes still images and advances video frames") under multi-core contention

### 4.5 Measurement hygiene
The probe scripts in the scratchpad **leak `ghost-render-core` processes that keep rendering at 60fps
and poison every subsequent timing**. Before and after any perf measurement:
```bash
pgrep -f ghost-render-core | wc -l    # must be 0   (Windows: use tasklist / Get-Process)
```
This nearly produced a phantom 2.6× regression report. Use min-of-N and paired interleaved builds.

---

## 5. Blocking item for shipping 2.0

**The native core is not packaged.** `electron-builder.yml` has **no `native-renderer` entry**, but a
packaged app looks for the binary at `resources/native-renderer/` (`electron/native-renderer-broker.js:1979`).
Nothing copies it there. Dev works only because of a fallback to `native-renderer/target/release/`.

So a packaged 2.0 build would ship **without the renderer that is the entire point of the conversion.**

Needed before cutting a build:
- [ ] Add `native-renderer` to `electron-builder.yml` (`extraResources`), per-platform binary
- [ ] Produce a Windows `ghost-render-core.exe` from a Windows cargo build
- [ ] **Ship `dxcompiler.dll` + `dxil.dll` beside `ghost-render-core.exe` on Windows.** The core
      selects `Dx12Compiler::DynamicDxc` and loads these at runtime. Without them wgpu silently
      falls back to FXC and cold boot goes from ~7s back to ~50s. (`static-dxc` would bundle DXC
      into the binary but needs ATL, which the VS Build Tools install here does not ship.)
- [ ] Verify a **packaged** build launches and renders — not just `npm run desktop:app`
- [x] ~~Decide the ffmpeg story~~ — **done**: `ffmpeg-static` is bundled and asarUnpacked, and the
      broker injects `GA_FFMPEG_PATH` into the core. Nothing further required.
- [ ] Decide the NDI story (docs say the SDK/runtime is deliberately **not** bundled; the long-term
      answer in `docs/ndi-setup.md` is NDI's dynamic-loading model so CI can build the addon without the SDK)

Compare with the existing Syphon precedent: `electron-builder.yml` ships `Frameworks/Syphon.framework`
via `extraFiles` with signing exclusions — that is the shape to copy.

---

## 6. Open bugs carried into this pass
Tracked, reproducible, not Windows-specific:
- **VJ crossfader**: deck B doesn't appear until past ~50% of the fader throw (dissolve). The
  double-curve cause was fixed; something downstream remains.
- **Fluid Riders texture input**: the `Texture Influence` param exists but the splat pass never
  samples a source frame, so it is palette-driven only.
- **Ground shadow stepping** in Volumetric Nodes at Balanced (64³) in the far corner; Ultra (80³) is clean.
- **Connectors don't cast shadow** in Volumetric Nodes — only nodes splat into the opacity volume.

---

## 7. Windows pass — 2026-08-17 (RTX 4070 Laptop · NVIDIA Optimus · Win11)

Everything here was run on Windows hardware. Landed in commit `16a7fee`.

### 7.1 Fixed — the Windows path did not work at all before this
| Fix | Detail |
|---|---|
| **Backend was Vulkan, not D3D12** | `Instance::default()` enables `Backends::all()` and wgpu picked Vulkan for the NVIDIA adapter, so every `as_hal::<Dx12>()` (output export, DXGI source import, slice export) returned `None`. Meanwhile `native_backend_name()` is a compile-time `cfg!` constant that always reports `"d3d12"` on Windows — **the status line was lying**. Now pinned to `Backends::DX12`. If DXGI things ever look broken again, verify the *adapter's* backend, not the status line. |
| **Cold boot 51s → ~7s** | wgpu's default `Dx12Compiler::Auto` fell back to FXC for the 63-shader warm-up. Now `DynamicDxc`. |
| **`start` RPC timed out** | 8s (fine for Metal) left the core alive but the app stuck on NATIVE OFFLINE while FXC ground away. Now 180s on win32. |
| **Silent export failure** | `create_output_export_target(...).ok()` swallowed its error. Now logged, plus the selected adapter/backend is printed at startup. |
| **Hierarchy mask was a no-op** | Three stacked bugs: the sync filtered every shape on a `closed` flag the mask editor never sets; the mask ran *before* the content it was supposed to clip (layers sort descending by z, so the multiply hit an empty composite); and mask layers carry `color=(0,0,0,0)` so an `a > 0.001` gate skipped them. Mask now runs as a second pass over the accumulated composite. |
| **Editor preview was blank** | Windows had no presenter at all. `dxgi_preview_addon.cpp` is the DXGI twin of `native_preview_addon.mm`. |
| **Live capture did not exist** | `win_capture_addon.cpp` — Media Foundation webcam + WGC screen/window. |

### 7.2 Preview presenter — read this before changing it
Windows **cannot** copy the macOS arrangement directly. macOS parents a Metal view *below* the web
content (`addSubview:positioned:NSWindowBelow` + `hitTest: nil`). A Win32 **child** HWND always
composites *above* its parent's Chromium surface, so a child can never be an underlay — DOM chrome
(warp handles, custom-shape points, light painting) ends up buried and un-clickable.

The working arrangement: the main window is `transparent: true` + frameless on Windows, and the
presenter is a **borderless top-level window kept one z-slot behind** the Electron window, showing
through the canvas's alpha hole. The DOM stack already computed to `rgba(0,0,0,0)` cross-platform,
so no CSS changes were needed. Consequence: no OS title bar, so window controls are DOM buttons and
the toolbar acts as the caption (drag + double-click-to-maximize) driven from the main process —
Chromium consumes input over `-webkit-app-region: drag`, so the renderer never sees the double-click.

### 7.3 Screen capture — do NOT use DXGI Desktop Duplication
Duplication is unusable inside Electron: Windows allows **one `IDXGIOutputDuplication` per output per
process**, and Chromium already holds one for `desktopCapturer` thumbnails. `DuplicateOutput` returns
`DXGI_ERROR_UNSUPPORTED` regardless of adapter, `VIDEO_SUPPORT`, format list, or GPU-preference —
none of those are the problem. **Windows.Graphics.Capture** has no such limit and is the only path
that can capture a single window. Verified: monitor 1920×1200 and window 1600×900, both streaming.

### 7.4 Verified working on Windows
- Boot: `ready=true`, `backend=d3d12`, 63/63 shaders, 0 failures, 0 panics, ~7s
- Native preview underlay with all DOM chrome interactive on top
- Window controls, toolbar drag, double-click-to-maximize
- Mask layer clipping (rotated polygon → content inside, black outside)
- Webcam (mapping + VJ), screen capture, per-window capture
- Light painting: real OS drag → stroke rendered by the core
- **Snapshots**: save / recall / persist, and recall reaches the core (sync events fire on recall)

### 7.5 Still red on Windows
| Item | Notes |
|---|---|
| `native:wgsl-check` | **Not Windows-specific.** Fails on `shaderModule.ts: Shader module call references unknown WGSL symbol source`, introduced by `bbd8a7b`. It's a Node-side assembly step, so it is red on macOS too. |
| `native:doctor` — noise golden | `actual=1368,4968,7568 expected=1987,5587,8187`, constant delta 619 on channel 0. Consistent with a genuine D3D12-vs-Metal difference in the noise op. Per §2, record it — do not silently re-baseline. |
| `native:doctor` — `fullV2=pending(2)` | Down from 4. DXGI export now reports `outputSharedTexture=on`. Remaining: editor preview not flagged "production zero-copy", and the Spout sender not active-ready. |
| MediaPipe + native webcam together | An OS constraint, not a bug: MF (Windows) and AVFoundation (macOS) both take the camera exclusively, so `getUserMedia` fails while a native session is live. **Check `live_capture_addon.mm` for the same destructor bug fixed on Windows** — a base destructor cannot dispatch to a derived `Release()`, which leaked the MF reader and held the camera for the app's lifetime. If macOS has it, MediaPipe stays broken there until restart even after stopping the source. |
