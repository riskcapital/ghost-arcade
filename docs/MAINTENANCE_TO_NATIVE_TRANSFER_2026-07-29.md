# Maintenance to Native Transfer Ledger

Date: 2026-07-29

This document is the source of truth for carrying maintenance-line work into
the Ghost Arcade native renderer version. It covers the released maintenance
work from `v1.9.95` through `v1.9.993`.

The goal is feature parity without compromising the native architecture.
Maintenance behavior is the product specification. Maintenance renderer code
is not automatically the native implementation.

## Branch Baseline

Native worktree:

- Path: `/Users/justinwood/Documents/Ghost Dev/ghost-arcade`
- Branch: `codex/native-main-driver-wip`
- Baseline when this ledger was created: `6fd464565546d99cb2bf4bb0c01fd78c8f42df4d`

Maintenance worktree:

- Path: `/Users/justinwood/Documents/Ghost Dev/ghost-arcade/.worktrees/1.9.991`
- Branch: `codex/1.9.991-maintenance`
- Released baseline: `94277ce0cda038b1fb38c73508f23b31ff4a762c`
- Tag: `v1.9.993`

Shared ancestor:

- Commit: `b6a78341f6863c5da2ae368e764fd493f299cc5d`
- Tag: `v1.9.9`

The two lines have diverged heavily since `v1.9.9`. Do not merge the
maintenance branch wholesale and do not cherry-pick release commits.

## Non-Negotiable Native Rules

1. The native version has no browser-renderer fallback.
2. The native core renders each source once. Preview, output, recording,
   Syphon, deck monitors, and downstream consumers view or sample that native
   result.
3. A UI feature may move directly. A renderer feature must be expressed as a
   native graph, pass, texture, decoder, or presenter capability.
4. Never disable a working native surface or presenter before its native
   replacement is visible and tested.
5. Do not mix presenter geometry changes with unrelated feature ports.
6. Do not copy `Canvas.svelte`, `VJModePanel.svelte`, renderer engines, media
   lifecycle code, or shared types wholesale. Port behavior in focused edits.
7. Preserve the existing native worktree. It contains substantial uncommitted
   work. No reset, clean, checkout-overwrite, or broad conflict resolution.
8. Every transferred feature lands in its own checkpoint with focused tests.
9. Once a native feature is green, its acceptance test becomes append-only
   regression coverage.

See also:

- `docs/NATIVE_PLUGIN_HANDOFF_2026-07-16.md`
- `docs/NATIVE_VIDEO_ENGINE_PLAN_2026-07-14.md`
- `docs/NATIVE_VIDEO_HANDOFF_2026-07-14.md`
- `docs/WEBGPU_MIGRATION.md`

## Status Vocabulary

| Status | Meaning |
| --- | --- |
| `DIRECT` | UI, state, utility, or control work that can usually be ported with small integration edits. |
| `ADAPT` | Product behavior transfers, but it must call native APIs or use native state. |
| `REIMPLEMENT` | The maintenance implementation is tied to the browser renderer and must be rebuilt natively. |
| `OVERLAP` | Native work already exists. Audit behavior and tests instead of copying code. |
| `DEFER` | Intentionally postponed until a named native dependency exists. |
| `DONE` | Native behavior and acceptance gates are verified. |

## Release Ledger

### v1.9.95

Maintenance commit: `e38b3baf`

Delivered:

- Marquee selection no longer intercepts mask-point placement.
- Marquee selection no longer intercepts light-painting clicks.

Native treatment: `DIRECT`

Native acceptance:

- Mask edit mode receives pointer events before marquee selection.
- Light-paint mode receives pointer events before marquee selection.
- Empty-canvas dragging still starts a marquee.

Primary source:

- `src/App.svelte`

### v1.9.96

Maintenance commit: `14b251e9`

Delivered:

- Effect Bundle expanded parameters show the effect name.
- Image drag/drop no longer changes VJ cell dimensions.
- Still images receive video-equivalent transform controls.
- GIFs animate in the active output.
- Mapping media layers rename from dropped content.
- Mapping presets and VJ blocks support drag reordering.
- Mapping preset videos rehydrate when recalled.
- `Cmd/Ctrl+,` opens settings.
- `Cmd/Ctrl+M` toggles MIDI Learn.
- MIDI clock and MIDI control can use separate inputs.
- Video playback speed can sync to beats and bars.

Native treatment:

- UI labels, cell sizing, reorder, shortcuts: `DIRECT`
- Image transforms: `ADAPT`
- GIF presentation: `REIMPLEMENT`
- Preset video rehydration: `ADAPT`
- MIDI routing and clock split: `DIRECT`
- Beat/bar video speed: `ADAPT`

Native acceptance:

- VJ grid dimensions never change after any image drop.
- Image transform state changes the native media graph.
- GIF decode advances in preview, output, and recording from one native source.
- Recalled video presets bind their persisted source without manual replace.
- MIDI clock and controls operate concurrently from separate devices.
- Beat/bar speed changes the native playback clock without drift.

Primary sources:

- `electron/main.js`
- `electron/preload.cjs`
- `src/App.svelte`
- `src/lib/components/Canvas.svelte`
- `src/lib/components/MacroKnobBar.svelte`
- `src/lib/components/OutputWindow.svelte`
- `src/lib/components/PresetTray.svelte`
- `src/lib/components/SettingsPanel.svelte`
- `src/lib/components/VJModePanel.svelte`
- `src/lib/midi/*`
- `src/lib/stores/layers.ts`
- `src/lib/stores/vjClipLauncher.ts`
- `src/lib/types.ts`

### v1.9.97

Maintenance commit: `37ae86ab`

Delivered:

- Mesh-warp arrow nudging uses the global nudge sensitivity.
- Shift plus arrow applies the established coarse multiplier.
- Done Editing Mask exits edit mode without disabling the mask.
- The pencil button reopens mask editing.
- Warp editing continues while an enabled mask remains active.
- A Mask Layer masks all lower hierarchy layers and accepts no media.

Native treatment:

- Nudge sensitivity and mask edit state: `DIRECT`
- Hierarchical Mask Layer compositing: `REIMPLEMENT`

Native acceptance:

- Corner, mesh, master, and slice nudging use one sensitivity setting.
- Mask edit state is independent from mask enabled state.
- A Mask Layer affects every lower layer and no higher layer.
- Mask Layer cannot accept media.
- Preview, output, and recording show the same mask result.

Primary sources:

- `src/App.svelte`
- `src/lib/components/LayerPanel.svelte`
- `src/lib/components/MeshWarpHandles.svelte`
- `src/lib/components/SettingsPanel.svelte`
- `src/lib/components/WarpHandles.svelte`
- `src/lib/renderer/engine.ts`
- `src/lib/stores/layers.ts`
- `src/lib/stores/maskEditing.ts`
- `src/lib/types.ts`

### v1.9.98

Maintenance commit: `790ecfc8`

Delivered:

- Stage effects work across every stage preset.
- WLED state persists across stage presets.
- Auto, Strip, Matrix, and Custom LED mappings.
- LED crop, serpentine, reverse, range, group, and controller targeting.
- Linear-light color handling and shader-palette sampling.
- LED order, chase, solid, and diagnostic tests.
- Forty-seven performance patterns with latch, hold, stack, blend, BPM, and auto.
- MIDI and keyboard triggers for LED effects.
- VJ videos render upright and unmirrored.
- The complete Loop Creator transition library is restored.

Native treatment:

- Stage preset ownership and trigger state: `DIRECT`
- WLED control model and pattern engine: `ADAPT`
- Native composite color sampling for LEDs: `REIMPLEMENT`
- Video orientation: `OVERLAP`
- Loop Creator UI and transition catalog: `DIRECT`
- Loop render/export path: `ADAPT`

Native acceptance:

- Any stage preset can run, stop, and recall its own Stage FX.
- Any stage preset can address every configured WLED target.
- LED sampling reads the native composite or a native downsample, never a
  second browser render.
- Sampled LED colors match the native frame under an sRGB golden fixture.
- LED latch, hold, MIDI, keyboard, and BPM behavior match maintenance.
- Video orientation is identical in mapping, VJ, Stage, output, and recording.
- Every Loop Creator transition renders and exports without a black frame.

Primary sources:

- `src/lib/components/Canvas.svelte`
- `src/lib/components/LEDFXPanel.svelte`
- `src/lib/components/MediaTray.svelte`
- `src/lib/components/SettingsPanel.svelte`
- `src/lib/components/VJModePanel.svelte`
- `src/lib/led/*`
- `src/lib/renderer/engine.ts`
- `src/lib/stores/globalPresets.ts`
- `src/lib/stores/stagePresetSurfaces.ts`
- `src/lib/stores/surface.ts`
- `src/lib/stores/vjClipLauncher.ts`
- `src/lib/utils/videoLoop.ts`
- `src/lib/wled/*`

### v1.9.99

Maintenance commit: `2a3d7ad9`

Delivered:

- Armed VJ videos reuse warmed media and avoid an initial black frame.
- Master corner and mesh warp support keyboard nudge.
- Dropdown and drag cleanup prevents stale controls in long sessions.
- Compact LED pattern selection and custom one-to-four-color layouts.
- GPU Shader and Text Creator are available to VJ decks.
- New ISF visuals, including Warp Loom.
- Stable OSC routes for VJ clips, mapping presets, transport, crossfader,
  macros, and LED control.
- The desktop app prevents display sleep while running.
- Unfinished shader-manifest entries were removed.

Native treatment:

- Armed video lifecycle: `OVERLAP`
- Master warp nudge and stale dropdown cleanup: `DIRECT`
- LED UI and color model: `DIRECT`
- GPU Shader/Text deck entries: `ADAPT`
- ISF catalog: `ADAPT`
- OSC routes: `DIRECT`
- Keep-awake: `DIRECT`

Native acceptance:

- An armed native video presents motion on trigger without a black/gray frame.
- Opening and closing menus repeatedly does not leave stale overlays or
  document listeners.
- GPU Shader and Text sources create independent native deck sources.
- ISF files enter through the native GLSL/ISF host unchanged.
- Every documented OSC path validates and dispatches.
- Keep-awake is acquired while the app is active and released on shutdown.

Primary sources:

- `electron/main.js`
- `electron/preload.cjs`
- `src/App.svelte`
- `src/lib/components/Canvas.svelte`
- `src/lib/components/LEDFXPanel.svelte`
- `src/lib/components/MediaTray.svelte`
- `src/lib/components/PluginIcon.svelte`
- `src/lib/components/VJModePanel.svelte`
- `src/lib/control/*`
- `src/lib/osc/*`
- `src/lib/renderer/gpuShaderCatalog.ts`
- `src/lib/stores/vjClipLauncher.ts`
- `src/lib/types.ts`

### v1.9.991

Maintenance commit: `d8e5c865`

Delivered:

- VJ videos decode and park at trim-in before activation.
- Trimmed clips and column triggers start from trim-in.
- Unified Stage groups preserve source order across vertical rows.
- Stage geometry supports undo, redo, grouped drag, and Escape cancel.
- Multi-selected slices stretch from every edge and scale uniformly.
- Full-strength blend modes were restored; opacity is the final mix.
- Saved Mapping projects recreate videos after portable paths resolve.

Native treatment:

- Trim and trigger contract: `OVERLAP`
- Unified Stage texture ordering: `ADAPT`
- Stage editing history and multi-transform UI: `DIRECT`
- Blend semantics: `REIMPLEMENT`
- Portable media restore: `ADAPT`

Native acceptance:

- Trimmed native video starts and loops exactly at trim-in.
- Programmatic column launch obeys the same trim contract as pointer launch.
- Vertical and horizontal Stage groups preserve logical texture order.
- Stage undo/redo restores complete geometry and selection state.
- Native blend passes match maintenance fixtures at multiple opacities.
- Reopened projects bind media from portable references without Replace.

Primary sources:

- `src/lib/components/Canvas.svelte`
- `src/lib/components/StageDesigner.svelte`
- `src/lib/components/WarpHandles.svelte`
- `src/lib/renderer/engine.ts`
- `src/lib/stores/layers.ts`
- `src/lib/stores/surface.ts`
- `src/lib/stores/vjClipLauncher.ts`
- `src/lib/utils/*`

### v1.9.992

Maintenance commit: `d55970db`

Delivered:

- OSC listener starts reliably and opens its configured UDP port.
- OSC Learn uses an in-app editor instead of `prompt()`.
- OSC paths validate, normalize, and show examples.
- MIDI/OSC can operate VJ video play, restart, and scrub.
- Trimmed loops return to trim-in.
- VJ media uses durable file references to reduce relinking.
- GLB embedded materials and textures are preserved.
- VJ block removal moved to a context menu; clip-cell quick remove remains.

Native treatment:

- OSC listener, Learn UI, validation, and routing: `DIRECT`
- Native video control commands and trim loops: `OVERLAP`
- Durable file references: `ADAPT`
- GLB materials/textures: `REIMPLEMENT`
- Context menus: `DIRECT`

Native acceptance:

- Windows and macOS show a bound UDP socket immediately after OSC enable.
- OSC Learn never calls browser `prompt()`.
- Invalid paths explain the failure before save.
- MIDI and OSC video controls update the native decoder session.
- Project reopen restores video and model media without relink.
- Native GLB rendering preserves embedded base color, texture transforms,
  alpha mode, emissive, roughness, and metallic data.

Primary sources:

- `electron/main.js`
- `src/App.svelte`
- `src/lib/components/Canvas.svelte`
- `src/lib/components/LayerPanel.svelte`
- `src/lib/components/MediaTray.svelte`
- `src/lib/components/Model3DPanel.svelte`
- `src/lib/components/SettingsPanel.svelte`
- `src/lib/components/VJModePanel.svelte`
- `src/lib/control/*`
- `src/lib/midi/*`
- `src/lib/renderer/Model3DRenderer.ts`
- `src/lib/stores/oscStore.ts`
- `src/lib/storage/*`
- `src/lib/types.ts`

### v1.9.993

Maintenance commit: `94277ce0`

Delivered:

- Professional splat and point-cloud loading, color, orientation, transforms,
  animation, displacement, lighting, fog, transparency, modulation, and
  keyframing.
- Expanded 3D model materials, lighting, shadows, deformation, wireframe,
  vertices, background transparency, transforms, and performance safeguards.
- More responsive VJ triggering and direct file-to-deck drag/drop.
- Media restore and first-frame safeguards.
- Live Deck A and Deck B monitors beside Program.
- Deck monitors reuse compositor bank textures without duplicate source
  rendering, decode, or readback.
- Presenter resize, attachment, and stale-frame safeguards.
- Splat parser tolerates trailing bytes.

Native treatment:

- Splat/point-cloud renderer and effects: `REIMPLEMENT`
- 3D model renderer and effects: `REIMPLEMENT`
- VJ pointer/drag behavior: `DIRECT`
- Video restore and first-frame safety: `OVERLAP`
- A/B source monitors: `REIMPLEMENT`
- Presenter safeguards: `OVERLAP`
- PLY parsing: `DIRECT`

Native acceptance:

- Large PLY and Gaussian splat fixtures load with progress through final GPU
  upload, maintain color, and never block the UI thread.
- Transform gizmos move, rotate, and scale in object space with hover feedback.
- Splat and model effects operate in native compute/render passes.
- Deck A, Deck B, Program, output, and recording use one native graph.
- Deck monitors add no source render, decode, CPU readback, or simulation.
- Presenter remains attached and correctly cropped through repeated resize,
  maximize, display-scale, and monitor changes.
- App-level black-frame smoke remains green.

Primary sources:

- `src/lib/components/Canvas.svelte`
- `src/lib/components/MediaTray.svelte`
- `src/lib/components/Model3DPanel.svelte`
- `src/lib/components/Object3DTransformGizmo.svelte`
- `src/lib/components/SplatPanel.svelte`
- `src/lib/components/VJModePanel.svelte`
- `src/lib/renderer/Model3DRenderer.ts`
- `src/lib/renderer/WebGPUCanvas.svelte`
- `src/lib/splat/*`
- `src/lib/stores/vjClipLauncher.ts`
- `src/lib/types.ts`

## Subsystem Transfer Matrix

| Subsystem | Status | Maintenance behavior to preserve | Native implementation rule |
| --- | --- | --- | --- |
| Pointer priority and marquee | `DIRECT` | Mask/light painting wins over marquee | Keep routing in UI event layer |
| Warp nudge | `DIRECT` | One global sensitivity everywhere | Share one store/helper |
| Mask editing | `DIRECT` | Edit state separate from enabled state | Preserve state contract |
| Mask Layer | `REIMPLEMENT` | Masks lower hierarchy only | Native mask/compositor pass |
| VJ grid and drag/drop | `DIRECT` | Stable cells, direct deck drop | UI and storage path |
| Image transforms | `ADAPT` | Same controls as video | Native source transform uniforms |
| GIF | `REIMPLEMENT` | Animated everywhere | Native decode/upload session |
| Video trigger/trim/loop | `OVERLAP` | Instant, exact, no black frame | Persistent native decoder sessions |
| Video/path persistence | `ADAPT` | Reopen without Replace | Resolve before native bind |
| MIDI and OSC | `DIRECT` | Reliable sockets, learn, routes | Dispatch native commands |
| Stage preset ownership | `DIRECT` | FX and WLED on every preset | Stable preset IDs |
| Stage texture ordering | `ADAPT` | Correct vertical/horizontal order | Native UV/slice ordering |
| Stage geometry history | `DIRECT` | Undo/redo and multi-stretch | UI state/history |
| WLED patterns | `ADAPT` | Full performance catalog | Keep pattern/control engine |
| WLED color sampling | `REIMPLEMENT` | Match visible content | Native composite downsample |
| Text source | `ADAPT` | VJ deck source | Native text texture/pass |
| GPU Shader source | `ADAPT` | VJ deck source | Native instrument graph |
| ISF library | `ADAPT` | Unmodified `.fs` compatibility | Native GLSL/ISF ingestion |
| Blend modes | `REIMPLEMENT` | Full strength plus final opacity | Native linear compositor passes |
| Loop Creator | `ADAPT` | Full transition library | Native/offline transition passes |
| GLB materials | `REIMPLEMENT` | Preserve embedded PBR textures | Native model material system |
| Point cloud/splat | `REIMPLEMENT` | Full professional suite | Native buffers, sort, compute, render |
| 3D model suite | `REIMPLEMENT` | Materials, FX, lighting, wireframe | Native scene/render graph |
| A/B monitors | `REIMPLEMENT` | Zero duplicate rendering | View native bank textures |
| Presenter geometry | `OVERLAP` | No drift, crop, holes, or stale frames | One geometry authority |
| Keep-awake | `DIRECT` | Prevent sleep while active | Electron power-save blocker |

## High-Risk Overlap

These files changed in both histories and must be ported behavior-by-behavior:

- `electron/main.js`
- `electron/preload.cjs`
- `package.json`
- `src/App.svelte`
- `src/lib/components/Canvas.svelte`
- `src/lib/components/LayerPanel.svelte`
- `src/lib/components/MacroKnobBar.svelte`
- `src/lib/components/MediaTray.svelte`
- `src/lib/components/MeshWarpHandles.svelte`
- `src/lib/components/OutputWindow.svelte`
- `src/lib/components/SettingsPanel.svelte`
- `src/lib/components/SplatPanel.svelte`
- `src/lib/components/VJModePanel.svelte`
- `src/lib/components/WarpHandles.svelte`
- `src/lib/components/WebGPUCanvas.svelte`
- `src/lib/renderer/gpuShaderCatalog.ts`
- `src/lib/splat/SplatRenderer.ts`
- `src/lib/splat/plyLoader.ts`
- `src/lib/stores/layers.ts`
- `src/lib/stores/maskEditing.ts`
- `src/lib/stores/vjClipLauncher.ts`
- `src/lib/theming/studio-skin.css`
- `src/lib/types.ts`
- `src/lib/utils/videoLoop.ts`

At ledger creation, these maintenance-owned files were also already dirty in
the native worktree:

- `electron/main.js`
- `electron/preload.cjs`
- `package.json`
- `src/App.svelte`
- `src/lib/components/Canvas.svelte`
- `src/lib/components/MediaTray.svelte`
- `src/lib/components/VJModePanel.svelte`
- `src/lib/stores/vjClipLauncher.ts`
- `src/lib/types.ts`

Do not replace or auto-merge any of them.

## Ordered Transfer Plan

### Phase 0: Protect the Current Native Baseline

- [ ] Record a native checkpoint once current work is internally consistent.
- [ ] Capture `git status`, native test status, and presenter smoke results.
- [ ] Do not include unrelated maintenance transfers in this checkpoint.

### Phase 1: Low-Risk Control and Interaction

- [ ] Pointer priority for mask/light painting.
- [ ] Global warp nudge sensitivity.
- [ ] Mask edit-state behavior.
- [ ] Keyboard shortcuts and stale-dropdown cleanup.
- [ ] Context-menu removal behavior.
- [ ] Keep-awake lifecycle.

These should not touch native render passes.

### Phase 2: Durable Control Paths

- [ ] OSC socket startup and status.
- [ ] In-app OSC Learn editor.
- [ ] Path validation and documentation.
- [ ] Separate MIDI clock/control inputs.
- [ ] Route MIDI/OSC actions into native graph/decoder commands.

### Phase 3: Persistence and Media Contracts

- [ ] Portable media references and project reopen.
- [ ] Preset video rebind after path resolution.
- [ ] Trim-in trigger and loop semantics.
- [ ] Beat/bar playback-speed contract.
- [ ] Image transforms.
- [ ] GIF native decode.

Do not modify the proven native video hot path without its stress suite.

### Phase 4: Mapping, Stage, and Hierarchy

- [ ] Mapping auto-rename and preset reorder.
- [ ] Stage preset FX ownership.
- [ ] Stage geometry history and multi-transform.
- [ ] Unified Stage slice/UV order.
- [ ] Native hierarchical Mask Layer.

### Phase 5: Native Compositing and Offline Output

- [ ] Full native blend-mode suite.
- [ ] Layer opacity as final mix control.
- [ ] Native Loop Creator transitions.
- [ ] Verify preview/output/recording parity.

### Phase 6: WLED Performance Suite

- [ ] Port controller/range/group/pattern state.
- [ ] Port latch/hold/MIDI/keyboard behavior.
- [ ] Add native composite palette sampling/downsample.
- [ ] Add native color golden and multi-controller soak.

### Phase 7: Source Inventory

- [ ] VJ Text Creator native source.
- [ ] VJ GPU Shader native source.
- [ ] Maintenance ISF catalog through native ISF host.
- [ ] Remove unavailable entries honestly until their native capability exists.

### Phase 8: Native 3D

- [ ] Native GLB material and texture preservation.
- [ ] Native model lighting/shadow/deformation/wireframe/vertex suite.
- [ ] Native point-cloud and Gaussian-splat pipeline.
- [ ] Shared 3D transform gizmo state and commands.
- [ ] Large-asset progress and cancellation.

### Phase 9: A/B Source Monitoring

- [ ] Expose native Deck A and Deck B bank textures.
- [ ] Present those textures beside Program.
- [ ] Prove no duplicate decode, simulation, graph run, or CPU readback.

### Phase 10: Presenter Hardening

- [ ] Lock one geometry authority.
- [ ] Re-run resize/maximize/display-scale soak.
- [ ] Verify app chrome, overlays, menus, and controls remain above native pixels.
- [ ] Verify no desktop holes, drift, crop, or stale frame.

Presenter work is last in this sequence unless it blocks visibility. Do not
reopen the geometry architecture while transferring unrelated features.

## Required Gates

Every transfer must run the narrowest relevant tests plus these shared gates.

### Native Black-Frame Smoke

Boot the app and visibly render:

- one native GPU instrument,
- one ISF source,
- one JS/native-capture source,
- one image,
- one video.

Average preview luma must exceed the threshold within the timeout. Enabled
surfaces cannot silently produce black.

### Single-Render Gate

For a fixture scene, confirm:

- each source renders once,
- preview views the native composite,
- output views the same composite,
- recording consumes the same native result,
- A/B monitors view bank textures,
- no browser instrument renderer exists.

### Color Gate

Capture a horizontal color ramp, 50% gray, saturated primaries, and alpha
patches through:

- native frame snapshot,
- output readback,
- editor preview readback.

Use the established linear-internal and sRGB-boundary contract. Results must be
near-byte equal within the documented tolerance.

### Presenter Geometry Gate

Repeatedly:

- resize,
- maximize and restore,
- move between displays,
- change display scale,
- open and close panels,
- toggle output.

The native surface must remain attached to the canvas bounds with no lag,
desktop exposure, crop, duplicated controls, or stale frame.

### Video Gate

Verify:

- trigger-to-motion within one frame after armed readiness,
- no black, gray, or green first frame,
- exact trim-in start and loop,
- exact scrub seek,
- no one-shot decoder in steady-state playback,
- stable playback while shaders and JS sources animate.

### Resource Gate

Run repeated create/destroy cycles for:

- videos,
- ISF pipelines,
- JS/native captures,
- effects,
- splats,
- models,
- preview/output surfaces.

Track native textures, buffers, pipelines, decoders, processes, and GPU memory.
All counts must return to the documented idle baseline.

## Porting Procedure

For each feature:

1. Start from the maintenance release diff that introduced the behavior.
2. Read the complete native destination before editing.
3. Port pure types, state, utilities, and tests first.
4. Add or extend the native capability/API.
5. Connect UI state to that native capability.
6. Run focused tests and the relevant shared gates.
7. Commit the feature alone.
8. Update this ledger from its current status to `DONE`.

Useful inspection commands:

```bash
git diff v1.9.9..v1.9.993 -- path/to/file
git show v1.9.993:path/to/file
git log --oneline v1.9.9..v1.9.993 -- path/to/file
git diff --name-status v1.9.9..v1.9.993
```

These commands are for inspection. Do not redirect a maintenance file over a
native file.

## Immediate Next Slice

The safest first transfer is the low-risk interaction tranche:

1. Mask/light-paint pointer priority.
2. Shared warp nudge sensitivity.
3. Mask edit-state separation.
4. Keyboard shortcuts.
5. Stale-dropdown listener cleanup.
6. Keep-awake lifecycle.

Before that tranche begins, checkpoint the current native work at an internally
consistent stopping point. After the tranche, run the native black-frame smoke
to prove that control/UI work did not disturb presentation.

The next renderer-facing tranche should be OSC/MIDI command routing, because it
adds professional control without changing source rendering. Video, 3D, splat,
A/B monitor, and presenter work should remain isolated in their named phases.
