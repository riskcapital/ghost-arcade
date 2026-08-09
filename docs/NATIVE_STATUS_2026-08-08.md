# Native Conversion Status & Release Parity — 2026-08-08

Audited: native worktree (`codex/native-main-driver-wip`) vs released `v1.9.993`
(`.worktrees/1.9.991`). Supersedes the checkbox state in
`MAINTENANCE_TO_NATIVE_TRANSFER_2026-07-29.md` (its Phase 2 OSC/MIDI, Phase 6
WLED, and Phase 8 3D/splat tranches are now essentially complete despite being
unchecked there).

## Native conversion status

Desktop is native-only (`NATIVE_ENGINE_ONLY`, settings.ts) — no browser-renderer
fallback.

### Fully native ✅
- **Layer types**: media, gpu, color, lines, svg, lightpainting, text, splat,
  model3d, group, screen (+ 19 native graph instruments incl. planet, ink-cloud,
  handfx render, performer-world, vj-crossfade).
- **Effects**: 182/184 public effect types have native passes
  (`nativeEffectCoverage.summarizeNativeEffectCoverage.complete === true`).
- **Sources**: local video (native decode pump w/ trigger sessions, trim, scrub),
  still images, ISF/FS shaders, live ingest (Syphon/Spout/NDI/webcam/screen —
  IOSurface *and* DXGI import).
- **VJ**: deck feeds single-graph, all 10 crossfade transitions + 9 blend modes
  native, MAP preset mixer (native branch in `nativeEffectiveLayers`), stage
  mode, deck A/B confidence monitors (macOS, zero-copy IOSurface presenters),
  slot blend modes (group blend rides onto children — flattened, see caveat in
  `resolveNativeGroupLayers`).
- **Output**: projector window (core swapchain), Syphon out (macOS) / Spout out
  (Windows), offline render (`captureBackend: 'native'` via frame-sequence
  export), Stage FX (dedicated native RAF driver), WLED pattern engine.
- **Control**: MIDI (incl. separate clock input), OSC (bindings, in-app Learn,
  reliable listener, VJ/Pro-DJ-Link template, boot init), keyboard paths, warp
  nudge + multi-select edge stretch (Warp/MeshWarp).

### Partial ⚠️
- **Editor embedded preview presenter** — works, but core still reports
  `production_ready: false` / `needs_underlay_lock_in` (main.rs ~2670).
- **JS/three.js/p5 sources** — native only when a fragment shader can be
  extracted; real scene-graph JS renders blank.
- **MediaPipe HandFX** — render graph native; landmark inference still browser
  WASM pushed into the core.
- **Loop Creator** — encodes via Electron FFmpeg (not core), and is missing 12
  transition exprs vs release (see parity gaps).
- **3D stage window / projection simulator** — own-window WebGL by design
  (authoring surfaces); 3D-window LED color sync with native output still open.

### Missing / broken in native mode ❌ (priority order)
1. **Live REC button + screenshot** capture the cleared WebGL canvas → empty.
   Route through `nativeLiveFrameRecorder` / `export_frame_snapshot` (already
   used by projection sim + offline render).
2. **Animated GIF** — first frame only; no native GIF decode session (release
   used gifuct-js browser-side).
3. **Mask layer** — type exists, but no creation UI and no native compositor
   pass (release: engine.ts mask units).
4. **WLED composite color sampling** — degrades to clear color natively (TODO at
   the `tickWLEDSenders` call site in Canvas.svelte); needs native downsample
   readback.
5. **Windows deck-monitor presentation** — DXGI stub (`main.rs`
   "not yet implemented on DXGI"); the only remaining Windows-parity gap in the
   core (DXGI source import + output export + Spout all work).
6. Hidden/deferred: adv-lightpaint, pixel-fx, media line/polyline shapes,
   gpuFluidSim + eulerianMagnify (stateful), KTX2 (never started), NDI sender.

## Release parity gaps (v1.9.95 → v1.9.993)

Byte-identical vs release (no action): wled/, osc/, midi/, control/, capture/,
surface.ts, stagePresetSurfaces.ts, maskEditing.ts, storage/, keyboardStore,
ISF/CuratedISF/user-shaders assets. splat/ is a native superset.

Missing, by size:
- **L**: animated GIF (above); mask layer (above).
- **M**: Loop Creator's 12 missing transition exprs (hlwind/hrwind/vuwind/
  vdwind, cover×4, reveal×4 — picker lists them, encoder renders wrong result);
  Stage Designer undo/redo/Escape/grouped-drag (store API exists in surface.ts,
  UI never wired); beat/bar video playback sync (`playbackSyncBeats` type
  survives, UI + store + clock application missing); direct OS-file → deck cell
  drop (only imports to library today).
- **S/M**: VJ pointer-based responsive triggering (press-slop/dedupe handlers);
  VJ block drag reordering (UI + `reorderBlocks` store method both absent);
  master/screen warp keyboard nudge (WarpHandles/MeshWarp done;
  MasterWarpHandles + ScreenWarpHandles not wired).
- **S**: mapping preset drag reorder (reorderComposition has no caller); global
  stage presets never load (`loadStagePresetSnapshot` uncalled — save/rename/
  delete work); mapping media transport missing `data-midi-path` learn attrs
  (paths already routed); 8 LIVE-* ISF visuals absent from public/ISF manifest;
  Warp Loom GPU shader displaced by smoke-riders; `output_exit_fullscreen` /
  `output_window_status` IPC; version/doc drift (package.json 1.9.9, missing
  changelog + release-notes entries).

Degraded vs release:
- Stage FX live toggle doesn't stop automation / toggle-off on re-click
  (`toggleStageActiveEffect` / `toggleMappingStageActiveEffect` not ported).
- Global stage preset save stores raw layers JSON instead of
  `createStagePresetSnapshot` (likely drops surfaces/FX/WLED preset-owned
  state).
- Loop encoder dropped release's transition-verification metadata + xfade input
  normalization; silent wasm fallback can encode the wrong transition
  "successfully".
- No native counterpart to release's `videoReadiness.hasDecodedVideoFrame`
  first-frame gate (may be covered by native decoder sessions — verify).
- MacroKnobBar expanded-params header block (cosmetic).

Fixed during this audit: OSC listener now initializes at boot
(`oscStore.initialize()` in App onMount, `destroy()` on teardown).
