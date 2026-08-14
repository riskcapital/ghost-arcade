# Native Readiness Audit — Feature Perspective

**Date:** 2026-08-13 · **Branch:** `codex/native-main-driver-wip` · **Method:** five parallel code audits (engine-gated Canvas paths, native block reasons, per-layer panel coverage, output/I-O matrix, admitted-gap sweep), findings cross-checked against each other. Everything here is backed by file:line evidence from the audits; nothing is speculation from memory.

Desktop ships native-only (`NATIVE_ENGINE_ONLY = true`) — there is no WebGL fallback. So "only works in WebGL" means **does not work in the shipping app**.

---

## Tier 1 — Broken or missing, show-impacting

| # | Feature | State | Notes |
|---|---------|-------|-------|
| 1 | **Plugin visualizers: fluid, particles, milkdrop, audiomotion, wavejs, hydra, analyzerlab, ghostpilot** | DELIBERATE | Product decision (2026-08-13): these 8 do not carry to v2.0. They will be redesigned for the native renderer; some land before ship. ghostfx + handfx are the native set. Not a bug — but ensure the picker hides them natively so users can't select a dead plugin. |
| 2 | **NDI OUT (both platforms)** | MISSING | Only sender is CPU readback inside the dead WebGL loop; NDI slices excluded from atlas path. NDI **IN is macOS-only** — Windows addon returns null, input stays silently blank. |
| 3 | **WLED content-aware sampling** | MISSING | Samples the cleared WebGL canvas → black. Pattern/test/LED-FX modes still work. Explicit TODO at Canvas.svelte:2464. No Art-Net/sACN exists anywhere. |
| 4 | **Recording audio** | MISSING | Encoder passes `-an`; `hasAudio` hardcoded false. No audio in any native recording on any platform. Windows also records via a degraded 30fps RPC fallback (no `readIOSurfacePixels` twin in the DXGI addon). |
| 5 | **Mapping-mode composition effects** | MISSING | `mappingComposition.effects` has zero references in nativeRendererSync; only VJ composition effects + macros are pushed. Silent no-op. Canvas.svelte:2694 |
| 6 | **VJ Mix source (index −1)** | WRONG | Approximated by "lowest active row's feed", not a real composite; also ignores VJ composition effects in that path. nativeRendererSync.ts:5607 |
| 7 | **Projection simulator** | PARTIAL (corrected) | The POPUP window works — it runs its own WebGL Canvas from state-sync, which is what the operator actually uses (confirmed working in user testing 2026-08-13). Real gaps: (a) **live:// sources (native webcam/capture) don't render in it** — no browser videoElement exists for them; (b) the in-editor panel variant samples the cleared underlay canvas; (c) `persist()` no-op — scenes never saved/restored. Fix (a)+(b) via the native composite mirror. |
| 8 | **Splat texture projection** | MISSING | Entire panel section (8 controls) has zero native plumbing. Known deferred item, still absent. |
| 9 | **ISF image inputs** | MISSING | `shaderImageInputs` picker UI + persistence exist; `update_isf_uniforms` sends float/point/color only. Any ISF with an IMAGE input samples an unbound texture. |
| 10 | **Effect params: 22 amount-only effects** | PARTIAL | Shaders ignore every param except amount: binary-code, block-mosaic, braille-pattern, circuit-board, comic-ink, crosshatch, dot-matrix, geometric-tile, hex-grid, led-wall, linocut, matrix-rain, mosaic-tile, neon-outline, number-grid, spiral-tile, stained-glass, thermal-contour, topo-map, voronoi-shatter, watercolor, woven-fabric. Plus gamma/invert/noise/posterize/pixelate implement 1 of 4–9 params. (ascii fixed 2026-08-13 as the pattern.) |
| 11 | **First-effect compile stall** | BUG | 289KB effect-pass module compiles on first use (~seconds, blocks output). Not covered by boot warm-up. One-line-ish fix: warm it at startup. |
| 12 | **Test pattern & output cursor** | MISSING on output | Test pattern draws only on the editor DOM overlay — never reaches the projector (`set_output_stage` has no field). Output cursor crosshair delivered only to the WebGL output window. |
| 13 | **3D Model: embedded animations never play** | MISSING | `useFileAnimation`/`fileAnimationSpeed` unread natively. Plus 5 of 16 procedural animation types fall through to no motion (unfold, assemble, grow, morphLoop, texturePan) while still listed in the dropdown. |
| 14 | **Media timelapse mode** | WRONG | Full popover UI; plays as a normal loop natively (driver only writes `videoElement.currentTime`). |

## Tier 2 — Partial: dead knobs by layer type

**Correction (2026-08-13):** user layer-by-layer testing during the conversion verified the PRIMARY params of every layer type working natively (transforms, materials, deformations, animations, lighting presets, brushes, stroke types, etc. — consistent with the READY list). The lists below are the long tail of advanced sub-knobs whose fields do not appear in the native packers. Each field must be re-verified individually before wiring — treat this section as candidates, not confirmed defects.

Every one of these is **silent** — the control renders, moves, and does nothing. No panel does per-field native gating (except GPULayerPanel / EffectPicker / LightPaintingPanel).

- **3D Model (largest gap, 35 fields):** PBR roughness/metalness; 13 per-material knobs (hologram, lava, glass, dissolve, fresnel, chrome…); wireframe overlay (5); vertex decoration (3); animationLoop/progress; environment lighting; shadows (3); beat reactivity (beatScale/Rotate/Explode/ColorFlash — native gets one scalar audio level).
- **SVG (27 fields):** pulse-ring, particle-fill, outline style, connection controls, lightning, edge-flow/plasma thickness, particle-link controls, echo/arc-bridge, perShapeColors.
- **Splat:** physics (4), audio band selector + sensitivity + smoothing (native takes one scalar), wireframe render mode (silently renders points), depthTest, cameraOrbit, colorEffectSpeed, mouseInteraction toggle.
- **Light Painting:** entire GPU Particle Brush section (11 controls — spiral/water/smoke/galaxy…, browser-WebGPU only), taperStart/End/Curve, smoothing, pressureSensitive, pingPongHold.
- **Text:** rotateZ, lightAngle, bevelSize. (animation loop/direction are dead in BOTH renderers — not a native regression.)
- **Lines:** afterglow, shared-shader-mask mode (whole feature), plus caps: 8 elements / 384 points (WebGL had none).
- **Edge effects:** hard cap 4 (add UI is unbounded), concentric direction not packed.
- **Media:** per-layer renderQuality (native uses global tier).
- **Group semantics:** no group compositing pass — blend/opacity applied per-child (overlapping children double-blend/darken), group warp dropped outside unified mode, group edge effects/mask/shape dropped, group effects dropped unless overrideStyles.

## Tier 3 — Platform matrix

| Feature | macOS | Windows |
|---|---|---|
| Recording | READY (60fps zero-copy, **no audio**) | PARTIAL (30fps RPC fallback, no audio) |
| Screenshot | READY | READY |
| Syphon/Spout OUT (full frame) | READY (core-side pump) | READY |
| Syphon/Spout IN | READY (fixed 8/12) | READY (untested on hardware) |
| Multi-slice named senders | PARTIAL (OSR WebGL re-render, not native frames) | PARTIAL (same) |
| NDI OUT / IN | WIRED (main-process composite pump: IOSurface CPU tap → async NDI send; per-slice transport toggle in Screens inspector) / READY | MISSING / GROUNDWORK (DXGI named shared-texture receiver path in ndi_addon.cpp, untested on hardware; CPU receiveFrame fallback works) |
| Native slice display output | READY | MISSING (WebGL fallback; note: `dxgi_preview_addon` already exports `monitorAttach`/`monitorSetSharedTexture` — blockers are the core's slice export + JS `darwin` guards) |
| Deck monitors | READY | MISSING ("not yet implemented on DXGI") |
| Live capture (webcam/display/window) | READY | READY (stale comment at win_capture_addon.cpp:19 claims window capture unsupported — it IS implemented) |
| Video decode | **CPU only** (`ffmpeg_software` — no VideoToolbox) | HW (`ffmpeg_d3d11va`) |
| Offline render-to-video | READY | READY |
| Intel Mac / Linux | Experimental / untested | — |

## Tier 4 — Reliability & UX hazards

1. **3-strike route kill switch:** 3 failures building a graph permanently disable the route, suppress further warnings, and blank the layer. LayerPanel *deliberately hides* the badge for `route-unavailable` on native-ready shaders → layer looks normal, renders nothing. (This is the `planet:route-unavailable` seen in diagnostics; also triggered transiently during shader warm-up at boot.)
2. **One unsupported effect blocks the whole layer** — not just that effect. Layer disappears from output.
3. **>4 effects on a layer silently exits the native effect path** entirely.
4. **All-or-nothing capability gates:** video needs all 7 decode-pump flags (one missing = every video AND animated GIF blocked); 3 compute-graph flags missing = every GPU shader, instrument, plugin, and effect chain dead.
5. **No decode fallback:** CPU/synthetic decode fallbacks force-disabled; failed decode = permanently blank source. Also `blob:`/`data:`/`http(s):` URIs are blocked outright.
6. **~25 silent numeric caps** (4 effects, 4 edge effects, 8 mask shapes/64 points, 32 shape points, 16×16 warp grids, 8 slices, 64 layers, splat/model/lines/svg point budgets, 2-graphs-per-frame queue throttle…). None surface to the operator.
7. **Dead gate:** `nativePluginUnavailableReason` is a stub returning null — the plugin filter never filters.
8. **Blocked-layer surfacing is passive:** aggregate status-line counter + one settings text row; no operator-facing alert.
9. **Edge blend may read double-applied in the editor preview** (DOM overlay + core both draw it).
10. **`window.__ghostarcadeOutputCanvas` is undefined natively** → VJ panel output preview gets null. Lines "Reset Animations" button has no listener natively.
11. **Older-core policy calls silently ignored** (target FPS, present policy, texture pool, decode tuning) while UI shows them applied.

## Tier 5 — Assets, gates, ship logistics

- **Asset portability:** `AssetRef.projectPath` sibling copies have NO writer; `recordMissingAsset` has zero callers → "Locate Missing Media" flow doesn't exist; cross-machine moves depend on origin-machine absolute paths.
- **Validation gates:** `native:wgsl-check` now runs (fixed 2026-08-13) but reports 3 instrument shaders failing (light-painting/lines/text — likely harness limitation vs. fullscreen-pass assumption, NOT confirmed either way); `native:effect-golden` fails on pre-existing `invert` drift. Neither can currently gate a release.
- **Packaging:** core not staged into `extraResources` (no platform ships a core binary in a packaged build yet); Windows needs `dxcompiler.dll`/`dxil.dll` beside the exe; mac needs the **universal** binary (`native:build:universal` — plain `native:build` is host-only now).
- **CHANGELOG has zero native entries** — newest section predates the port.
- **Stale doc:** `NATIVE_STATUS_2026-08-08.md` wrong on 3 points (mask layer is done; playbackSyncBeats done for VJ clips; effect coverage now 182/184).

## Verified READY (spot-check confirmed, do not re-audit)

Compositor + 63 shaders; media layers (images, video, GIF incl. trim/loop/rate/crop/fit/flip/chroma-key); custom shapes incl. bezier + warp; mask layer (native pass, done); text/lines/SVG/light-painting/splat/model3d base rendering + animations; 10 native GPU shaders; ghostfx + handfx; keyframes; sequencer; macros + VJ composition effects; blackout/freeze; output stage (crop/rotation/grade/edge blend/dome/master warp); per-slice warp + grading; slice windows (native on mac, fallback elsewhere); Syphon/Spout both directions; webcam + selfie mirror (incl. under effects); screen capture; screenshots; offline export; MIDI/OSC/WLED-pattern control paths; state broadcast to satellite windows; StageFX; VJ crossfade; deck monitors (mac); autosave/AssetRef load paths.

---

## Suggested v2.0 line

**Fix before ship (high value, bounded):** effect-pass warm-up (#11) · mapping composition effects (#5) · test pattern to core (#12) · timelapse (#14) · 3-strike suppression + blocked-layer visibility (Tier 4 #1/#2) · recording audio (#4) · projection-sim escape hatch + persistence (#7) · effect param batches (#10, batched with goldens).

**Ship as documented limitations:** plugin visualizers ×8 (position ghostfx/handfx as the native set) · NDI (mark experimental/unavailable) · WLED content sampling (patterns only) · splat texture projection · 3D model advanced knobs · group compositing semantics · Windows slice/deck-monitor presentation · Intel/Linux experimental.

**Decide:** VJ Mix semantics (#6) — real composite is core work; the approximation may be acceptable if documented.
