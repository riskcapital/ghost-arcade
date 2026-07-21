# Ghost Arcade - Development Changelog

---

## v1.9.98 - Stage Presets, WLED Mapping, and Loop Transitions (July 2026)

- Stage effects now resolve correctly for every recalled stage preset.
- WLED output survives preset switches and adds Auto, Strip, Matrix, and
  Custom spatial maps; source-region cropping; serpentine and reverse wiring;
  linear-light color calibration, live-palette sampling, and smoothing; and
  LED-order, chase, and solid test modes.
- Added a complete LED performance suite in VJ Mode with 47 native patterns
  across Movement, Organic, Rhythmic, Spatial, Content Aware, and Glitch
  categories. Effects can latch, run momentarily while a button is held,
  stack with five blend modes, follow BPM, run as automatic sequences, and
  target a full rig, controller, named physical range, or multi-controller
  group. Every latch and hold action is MIDI and keyboard mappable.
- VJ videos now use the correct default texture orientation.
- Restored the full grouped Video Loop Creator transition library, including
  the custom Ghost glitch and loop effects.

---

## v0.5.0 — Dual-Deck VJ, Macros, X-Fader Blend Modes, Mobile Companion (May 2026)

The biggest VJ release since the launcher shipped. Adds a full Bank A/Bank B
dual-deck workflow with a real performance crossfader (10 transition styles,
9 output blend modes that combine with the transition), 8-knob macro
effect-bank with a per-effect param editor, 16-slot snapshot bank for
instant scene recall, and a touch-controllable iPad/phone companion at
`http://<your-lan-ip>:9002`. Also: a comprehensive bug-review pass on
the surface area added in 0.3.x, a new ISF geometric-shader-pack (25
primitives), and a hardened crossfader transition pipeline.

### Dual-deck VJ

- **Bank A / Bank B side-by-side decks.** Click the A/B toggle in the VJ
  header to split the launcher into two complete, independent banks.
  Each bank holds its own clip grid, layer states (opacity / blend / solo
  / mute / activeClip), and per-block memory. Stage mode + crossfader
  works per-screen so different physical outputs crossfade independently.
- **Right-click block tabs** → Save Project / Rename / Duplicate / Delete.
  Same right-click resave pattern for stage presets and SynthVision
  keyboard presets.
- **Quantized clip launch.** Set the QUANT dropdown (off / 1/4 / 1/2 /
  1bar / 2bar / 4bar) to schedule clip triggers on a beat boundary
  instead of firing instantly. Anchored to detected audio beats; falls
  back to BPM-based virtual clock when audio is off. Click a queued cell
  again to cancel. STOP ALL flushes the queue.
- **MIDI clock receive + send.** Sync to or drive an Ableton, drum
  machine, or external DAW at 24 PPQN. Auto-flows into the master BPM;
  manual tap tempo overrides when active.

### X-Fader (10 transitions × 9 blend modes)

- **Vertical performance crossfader** between the two banks with snap-to-
  midpoint detent, A/B cut buttons, % readout, and a power toggle.
- **10 transition styles** — dissolve / hard wipe / RGB split / cube /
  shatter / halftone / glitch / liquid / strobe / slide. Each is a
  custom GLSL fragment shader designed so the *midpoint* is the peak
  visual moment (no muddy 50/50 — park the fader at 0.5 for a
  deliberate aesthetic). Compiled lazily; switching transitions costs
  zero recompiles.
- **Output blend modes** (new in this release) — normal / multiply /
  screen / add / difference / darken / lighten / overlay / exclusion.
  Combines *with* the transition: the transition determines the spatial
  journey from A → B; the blend mode determines the per-pixel math at
  any fragment where both decks contribute. So `glitch + multiply` gives
  multiplied scattered shards; `dissolve + screen` gives screen-blended
  noise. At fader extremes the blend overlay falls to 0 and the
  transition output passes through unchanged.
- **Dead-zone tail** (added in 0.4.x dev): every transition smoothly
  retracts to pure A at uMix=0 and pure B at uMix=1, eliminating the
  per-pixel artifacts (wipe diagonal, slide seam, shatter cracks,
  glitch hash) that several transitions used to leak at the endpoints.
- **MIDI route**: `vj:crossfader:value` (CC-mappable), `vj:crossfader:cut-a`,
  `vj:crossfader:cut-b`, `vj:crossfader:transition`, `vj:crossfader:blendMode`.

### Macros (effect-bank wet/dry knobs)

- **8 user-assignable knobs** in the VJ header. Each macro is a wet/dry
  mix for a *bundle of effects* that runs on the composite output. This
  is a major rework of the v1 macro system (which was a destination
  router with per-param min/max/curve config — confusing for operators
  to set up and easy to break).
- **Right-click any knob → Edit Macro popover.** Add effects via the same
  EffectPickerModal the layer/clip/composition effects panels use.
  Drag-reorder, enable/disable per-effect, set per-effect opacity and
  blend mode, expand any effect inline to tune its full parameter
  schema (sliders + selects for every numeric / enum param the effect
  type exposes).
- **Single wet/dry mix at top of bundle**, not per-effect opacity scaling.
  Each effect runs at its authored opacity (preserving what you tuned
  in the param panel); the macro knob mixes the chain's wet output
  with the dry composite via `mix(dry, wet, knob)`. Knob=0 → original
  passthrough. Knob=1 → fully effected. Predictable and immune to the
  per-effect blend issues that affected the v1 implementation.
- **Auto-pulse**: set a macro's pulse mode (1/4 / 1/2 / 1bar / 2bar /
  4bar) + waveform (sine / tri / saw-up / saw-down / square / pulse) to
  cycle the knob value automatically on the master BPM. Hands-free
  build-ups + breakdowns.
- **MIDI route**: `vj:macro:N:value` (1-8) for hardware controller.
- **Bundles stack**: each macro's wet output becomes the next macro's
  dry input, so all 8 macros can be partially open simultaneously and
  the visual is stable + predictable.

### Snapshots (16-slot scene bank)

- **Bottom-right SNAPS launcher** with 16 slots. Each slot captures a
  complete freeze of layer opacities, blend modes, solos / mutes (both
  decks), crossfader state + transition + blend mode, quantization grid,
  master opacity, and macro values.
- **Shift-click** to save current state. **Click** to recall. **Right-click**
  for rename / overwrite / clear. Different from blocks (clip-grid
  scenes) and macros (continuous knobs) — snapshots are live-state
  freezes for instant scene jumps.
- **Saves with the project** (.gha format v1.9.0). Bind hardware buttons
  to `vj:snapshot:N` (1-16) for instant scene recall.

### Mobile Companion (iPad / phone surface)

- **Touch-controllable VJ surface** at `http://<your-lan-ip>:9002`. WebSocket
  protocol bridges desktop ↔ tablet at 30Hz throttled.
- **iPad layout (landscape + portrait)** — clip grids per deck, vertical
  crossfader column between them, snapshot bank across the top, macro
  knobs + tap tempo + master opacity along the bottom. Portrait
  reflows: macros full-width row, tempo + master split 50/50 below.
- **Same control surface as desktop** — trigger clips, drag opacity
  faders, change blend modes, toggle the crossfader, pick transition +
  blend mode, recall/save snapshots, drive macros, tap tempo, change
  quantization.
- **Pulse-aware TAP button** flashes in tempo via a dedicated `beat_pulse`
  WS channel that bypasses the throttled state-sync.

### Project format v1.9.0

- Adds top-level `macros`, `snapshots`, and per-`vjClipLauncher` fields
  for `crossfaderEnabled` / `crossfaderValue` / `crossfaderTransition` /
  `crossfaderCurve` / `crossfaderBlendMode` / `selectedDeck` /
  `quantization` / `bankBClipGrid` / `bankBLayerStates`.
- Backwards-compatible: old projects without the new fields load with
  sane defaults (crossfader off, no snapshots, all 8 macros empty).
- Right-click block tabs / stage presets / SV keyboard presets → Save
  Project (overwrite in place) instead of the old delete-and-recreate
  flow.

### Onboarding tour

- First-launch tour walks new operators through the major surfaces in
  9 steps: VJ mode, dual-deck, quantized launch, audio reactivity,
  MIDI clock, macros, right-click resave, snapshots, ready-to-perform
  send-off. Re-triggerable from File → Show Feature Tour.

### Geometric Shader Pack

- **25 ISF primitives** added under `geometric-shader-pack/` (squares,
  circles, lines, triangles, polygons in various distortion / kaleidoscope
  / strobe variants). Increases the bundled library to 316 effects.

### Removed: Setlist (.gset) feature

- Removed the multi-song `.gset` setlist feature. Loading a song .gha
  mid-set blacks the output for 500ms-2s while project state tears down
  and rebuilds, which was unacceptable mid-show. Snapshots cover same-
  show scene recall without that interruption; for multi-song shows,
  save each song as its own .gha and use File → Open between sets.
  (Previously-saved .gset files are no longer loadable; .gha projects
  are unaffected.)

### Bug fixes

- **Mobile master opacity slider** wasn't reaching the desktop renderer
  — ws-server was missing the `set_vj_master_opacity` broadcast case.
- **Mobile X-fader transition picker** — desktop validation whitelist
  carried stale strings from a v1 mobile surface, silently rejecting
  glitch / shatter / liquid / etc. and falling back to dissolve.
- **Crossfader transitions leaked artifacts at uMix=0/1** — added shared
  smoothstep dead-zone tail to the buildShader() helper.
- **Macro popover opacity slider** was initiating a drag-reorder gesture
  instead of receiving slider input — scoped `draggable` to the ⋮⋮
  handle only.
- **MIDI requestMIDIAccess** would hang indefinitely on macOS Electron 33
  — added retry + timeout.

---

## v0.3.5 – v0.3.9 (April – May 2026)

Development snapshots between v0.3.4 and v0.5.0. Highlights consolidated
into the v0.5.0 entry above. Notable interim fixes:

- **v0.3.5** — In-app updater modal, demo download spinner, projection-
  tools cleanup
- **v0.3.6** — Reverted broken testPattern force-reset; new layers
  default to grid
- **v0.3.7** — Mac MIDI controller fix, grid shader regression fix,
  test pattern toggle
- **v0.3.8 / v0.3.9** — Internal dev bumps consolidated into v0.5.0

---

## v0.3.4 — Demo Project, Portable Saves, Mask + Pen-Tool Fixes (April 2026)

A polish + correctness release focused on the install-to-first-use experience. Fresh installs now download a demo composition automatically, project saves are portable across machines, and several mask + custom-shape papercuts are fixed.

### First-launch demo

- **Auto-download a demo project on first launch.** New installs trigger `loadDemoProject()` once after the EULA + welcome flow finish. Demo bundles a composition + ~17 media clips + a 3D model. Hosted on `riskcapital/ghost-arcade-releases` under the `demo-assets` tag (107 MB) — GitHub CDN, no Vercel bandwidth.
- **Progress overlay during download.** Centered card with brand-gradient progress bar, percentage, and a "first-launch download — won't happen again" hint. Shows for both auto-import and manual `File → Load Demo Project`.
- **Silent failure when offline / 404.** No alert popup; user lands on a blank composition. The `ghostarcade-first-demo-imported` localStorage flag is set BEFORE the download attempt so failed launches don't retry on every cold start.

### Portable project saves (the real fix)

- **Native Electron save dialog** replaces the browser `showSaveFilePicker` API on desktop, giving us a real filesystem path.
- **Blob URLs materialize to sibling files on save.** Every `blob:` URL referenced anywhere in the project (mediaLibrary, layer sources, modelData, VJ clips, compositions) is fetched, written to the chosen project directory using its original filename, and replaced with `./<filename>` in the saved JSON. Result: a `.gha` file that opens cleanly on any machine if the sibling files travel with it.
- **`resolveSrc` produces `file://` URLs** so resolved absolute paths actually load in `<video>` and `<img>` elements (previously only Three.js loaders worked because they use fetch). Spaces, `#`, and `?` properly URL-encoded.
- New IPC handlers: `save_project_dialog`, `save_file_text`. `save_file_binary` reused for media writes.

### Performer mode

- **Auto-load first preset on entry** if there's at least one saved preset and no cached clip state. Removes the manual "click a preset to populate" step on fresh launches. Won't fire mid-session — only when entering with no clips assigned.

### Mask system

- **Feather is one-sided** — softens only the inside edge instead of bleeding outward into surrounding pixels. Fixed in both `polygonMaskShader` (click-point masks) and the layer-shape SDF masks (circle, triangle, custom polygon).
- **Mask enable/disable toggle works correctly** — `enableMask()` was short-circuiting via `mask: layer.mask || {...}`, leaving the existing disabled mask untouched. Now force-sets `enabled: true` while preserving points/feather/inverted.

### Pen tool — custom shape layer

- **Illustrator-style click-and-drag-to-bend.** Click adds a sharp anchor; click-drag adds a smooth anchor with bezier handles in the drag direction (cpOut tracks the mouse, cpIn mirrors). 4px drag threshold prevents casual clicks from accidentally creating curves.
- **Live curve preview during drag.** SVG path renders the in-progress bezier from the previous vertex through the dragging handles to the new anchor — updates every mousemove. Dashed before threshold (still a straight line), solid + cyan handles after.
- **Smoother shape clipping** — bezier tessellation bumped 10 → 24 steps per segment so tight curves stay inside the visual outline.

### 3D Model layer

- **Model survives mode switches.** Previous `onDestroy` revoked the blob URL when the panel unmounted (which it does on every mode switch), leaving `modelData` pointing at a dead blob. Renderer silently lost the model until the user re-picked the file. Blob lifetime now follows the layer (revoked only when replaced or layer deleted).
- **Reload icon next to the file picker** — uses cached File object for instant reload, falls back to file picker if app was restarted. Belt-and-suspenders for any future state-loss scenario.

### Cloud shaders

- (rolled in from late v0.3.3 work) Cache key is unique per shader so different cloud shaders on the same layer render correctly. Modal is cloud-aware with source filters + per-card badges. Find Latest button moved into the modal header. Disk persistence at `{userData}/shaders/<id>.fs`.

### EULA

- **Single EULA prompt on install** — `EULA.rtf` renamed in `build-resources/` so NSIS no longer auto-detects it as the installer license page. The in-app `EULAModal` is now the single source.

### Misc

- Manifest curated to **291 ISF shaders** (down from 302; removed legacy/unused entries, added AstralJellyfish).

---

## v0.3.3 — First Signed Windows Release (April 2026)

Identical to v0.3.2 functionally. The Windows installer is now signed with **Azure Artifact Signing** (formerly Trusted Signing) under the **Justin Wood** verified publisher identity, eliminating the "Unknown publisher" warning on Windows install.

- `electron-builder.yml` `win.azureSignOptions` configured against the `ghost-arcade-prod` certificate profile in the `JustinWood` signing account (East US endpoint).
- GitHub Actions Windows build installs the `TrustedSigning` PowerShell module, authenticates via Service Principal (`AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` repo secrets), and signs the .exe in-pipeline before publishing.
- RFC 3161 timestamp from `timestamp.acs.microsoft.com` keeps signed binaries valid past the (intentionally short-lived) cert expiry.
- macOS path unchanged — Apple notarization continues as before.

> Note on SmartScreen: signing eliminates the unknown-publisher warning, but Windows SmartScreen also evaluates per-certificate reputation. The first ~25–100 downloads of v0.3.3 may still see "Windows protected your PC" until the cert builds reputation. Subsequent releases signed with the same cert inherit the established reputation.

---

## v0.3.2 — Shader Catalog Fixes, Pen-Tool Bezier, Mask Bug Fixes (April 2026)

A maintenance + UX release. Fixes the cloud-shader workflow that shipped in v0.3.1, two long-standing mask bugs, and adds Illustrator-style click-and-drag bezier editing to the custom shape pen tool.

### Cloud Shader Workflow

- **Fix: cloud shaders no longer break the layer renderer** when picking a different cloud shader on the same layer. The cache key for library shaders was a constant (`'library-shader'`), so two different shaders on the same layer collided and the renderer reused the first material — second pick showed the first shader's output. Cache key is now `library-shader:${id}`, unique per shader.
- **Shader Library modal is now cloud-aware.** Bundled, cloud, AI-generated, and user-imported shaders all flow through the same grid + filter pipeline. Per-card source badges (CLOUD / AI / MINE) for visual distinction. New "All / Bundled / Library" source filter.
- **"Find Latest" moved into the modal header** with inline status banner (was floating below the tray).
- **Cloud shaders are library-only by default.** Find Latest pulls them into the library; users opt them into the tray via the modal. Previously every sync dumped the entire catalog into the tray.
- **Re-add cloud shaders after deletion.** Deleting a cloud shader from the tray now lets you re-add it from the library modal — the modal's click handler used to early-return for non-bundled shaders.
- **Disk persistence for synced shaders.** Cloud shaders write to `{userData}/shaders/<id>.fs` via three new IPC handlers. Survives localStorage clears and reinstalls. App startup hydrates from disk if the in-memory store is empty.
- **Thumbnails sync everywhere.** When the tray generates a thumbnail for a library shader, it writes the dataURL back to the persistent store so the modal sees it. The modal also lazily generates thumbnails for any library shader missing one.

### Mask Bug Fixes

- **Mask feather no longer bleeds outside the polygon.** The `polygonMaskShader` and the layer-shape SDF masks both had symmetric `smoothstep(-feather, feather, dist)`, which softened the edge on BOTH sides — feather created an outward halo around the masked region. Now the feather is one-sided: full visibility well inside, smooth fade across the inner band, hard transparent outside the boundary.
- **"Enable Mask" checkbox actually re-enables the mask.** Previously, `enableMask()` did `mask: layer.mask || {...}` — when a mask had been disabled, the OR short-circuited to the existing (still-disabled) object and the toggle never re-enabled. Now: if a mask exists, force `enabled: true` while preserving points/feather/inverted. New mask creation behavior unchanged.

### Pen Tool — Custom Shape Layer

- **Illustrator-style click-and-drag-to-bend.** Click adds a sharp anchor (existing). Click and DRAG adds a smooth anchor with bezier handles in the drag direction — cpOut tracks the mouse, cpIn is mirrored. Drag distance threshold (4px) keeps a casual click from accidentally introducing curve handles.
- **Live curve preview during drag.** SVG path draws the in-progress bezier segment from the previous vertex through the in-progress handles to the new anchor — updates every mousemove so the curve bends in real time. Dashed before threshold (still a straight line), solid + cyan handles after.
- Works in both draw mode (appending points) and add mode (inserting on edges).
- Existing gestures preserved: vertex drag, handle drag (Alt to break symmetry), right-click to close, dbl-click vertex to toggle corner/curve.
- **Smoother shape clipping.** Custom shape bezier tessellation bumped 10 → 24 steps per segment. Tight curves now stay inside the smooth visual outline; the rendered shape no longer pokes out at corners.

### Other

- **License deactivate API** (server-side, on `riskcapital/shrinkwraplive`) now accepts `machineFingerprint` as a fallback. Resolves the "license and machine id were missing" error when deactivating from the website's account page.
- **macOS license persistence.** The user-facing path: now that the deactivate API works, fresh v0.3.x installs on macOS can re-activate after deactivating the orphan machine entry on the website.

---

## v0.3.1 — Shader Lab, Reflective Chambers, Cloud Sync (April 2026)

> Note: an earlier v0.4.0 build was published with a typo in the default catalog
> URL (`ghost-arcade.com` vs `ghostarcade.live`). v0.3.1 supersedes it — same
> features, correct domain.

### Overview
A shader-heavy release. Twelve new ISF shaders built from scratch under a new "Shader Lab" workflow, plus universal upgrades to every 3D-chamber shader (movable vanishing point, mirror-reflective walls). On the app side, fixed a bug where user-imported shaders disappeared after switching layers, and shipped a cloud-sync button that pulls the latest shaders from the public catalog.

### Shader Lab Collection (12 new shaders in `shader-lab/`)

Edge-reactive minimal:
- **DataNebula** — Iridescent volumetric pigment compressing against the layer's edges with thin-film color shifts.
- **EdgeEcho** — Concentric pulse frames echoing inward from the chamber edge with perimeter runners and corner flashes.
- **ChladniPlate** — Eigenmodes of a vibrating rectangular membrane. Wavefunction is mathematically zero at the edges; nodal lines bloom into Chladni figures.

3D chambers:
- **QuantumChamber** — Raymarched 3D particle-in-a-box. Probability density |ψ|² oscillates inside; ray-integrated cube wireframe lights all 12 edges.
- **ShadowBoxBouncers** — Diffusely lit greyscale chamber with bouncing 3D spheres casting soft shadows on every wall.
- **FluidChamber** — Dense flow-field particle system (up to 1280 particles) with selectable flow modes: traveling waves, curl noise, vortex, radial breathing.
- **FluidChamberV2** — Same flow chamber, but particles can render as Blobs, Spheres, Voxels, Pyramids, Metaballs, or random Multi mix.
- **AquariumFill** — 3D chamber fills with volumetric water from a top pour source. Beer-Lambert absorption, animated caustics, ripples on the surface, fresnel highlights, splash.
- **GrowingTendrils** — Organic tendrils sprout from the floor, grow upward toward the ceiling, wriggling with layered sine wobbles through grow/hold/retract phases.
- **LaserGrid** — Glowing laser poles spanning the chamber (vertical / horizontal / both modes), bouncing back and forth with continuous line-shaped soft shadows on the walls.
- **LavaChamber** — Metaball liquid through Wyvill-kernel density field with isosurface raymarching, slow lava-lamp motion, optional turbulence.
- **VoxelCity** — Minecraft-style voxel cityscape that grows from all six walls. DDA raycast, per-wall sine waves drive shifting tower heights, voxel-DDA shadow casting.

### 3D Chamber Universal Upgrades

Applied to all nine room shaders (QuantumChamber, ShadowBoxBouncers, FluidChamber, FluidChamberV2, AquariumFill, GrowingTendrils, LaserGrid, LavaChamber, VoxelCity):

- **`vanishPointX` / `vanishPointY`** inputs (default 0.5, 0.5). Move the vanishing point off-center to compose multi-cube layouts where each cube's chamber recedes toward a shared focal point. Front face still fills the layer rectangle exactly; only the back face and interior recede.
- **`wallReflection`** input (default 0). Wall surfaces become mirrors, single-bounce reflecting the chamber's contents (particles, blobs, lasers, tendrils, etc.) onto themselves. Implementation: `intersectAndShade` extracted as a helper, `shadeOuter` reflects the ray once and calls `shadeOnce` for the secondary pass — no GLSL recursion required.

### Media Tray Persistence Fix

**Bug:** Adding a `.fs` shader via "Add Files" only made it visible on the layer it was added to. Switching layers, deleting the originating layer, or reloading the app made the shader vanish.

**Root cause:** Dropped shaders were appended to a component-local array in `MediaTray.svelte`, not routed through the persistent `shaderLibrary` store. Since `MediaTray` is destroyed and remounted on every layer switch, the local array reset every time.

**Fix:**
- `addMediaFile()` now calls `shaderLibrary.addShader()` for `.fs` drops, persisting to localStorage and the optional WebSocket server.
- `hydrateUserShaders()` runs in all three `onMount` paths (cache hit, cache wait, fresh fetch) to merge persisted shaders back into the active list.
- New `userAdded` flag on `ShaderItem`, surfaced as a small cyan dot before the shader name in the tray.

### Cloud Shader Sync

New "Find Latest" button in the shader-tab footer. Clicking it:
1. Hits `https://ghost-arcade.com/api/shaders/catalog` (override via `localStorage['ghost-arcade-shader-catalog-url']`)
2. Diffs against local shaders by id + version
3. Downloads new entries and updates entries whose version has bumped
4. Adds them to `shaderLibrary` with `source: 'cloud'` so they persist + show a purple `•` badge
5. Shows a toast: "Synced 3 new, 1 updated" / "You're up to date" / "Must be online to find latest shaders"

User-added and AI-generated shaders are never touched by sync. No auto-sync on app launch — strictly a manual button.

### Files

#### Added
- `shader-lab/AquariumFill.fs`
- `shader-lab/ChladniPlate.fs`
- `shader-lab/DataNebula.fs`
- `shader-lab/EdgeEcho.fs`
- `shader-lab/FluidChamber.fs`
- `shader-lab/FluidChamberV2.fs`
- `shader-lab/GrowingTendrils.fs`
- `shader-lab/LaserGrid.fs`
- `shader-lab/LavaChamber.fs`
- `shader-lab/QuantumChamber.fs`
- `shader-lab/ShadowBoxBouncers.fs`
- `shader-lab/VoxelCity.fs`

#### Modified
- `src/lib/stores/shaderLibrary.ts` — added `source`, `version`, `author` fields; `getCatalogUrl`/`setCatalogUrl`; `syncFromCloud()` method.
- `src/lib/components/MediaTray.svelte` — `userAdded` / `cloudShader` flags; `savedShaderToItem` helper; `hydrateUserShaders`; "Find Latest" button + sync handler; `.user-badge` and `.cloud-badge` styles.

---

## Session 3 - UX Rework: Scale, Screen Layers, VJ Minimize, Flips, Delete (Feb 2026)

### Overview
Major UX rework session replacing the initial canvas toolbar/scale tool implementation with pro-level natural drag handles, introducing the Screen layer type for VJ-to-mapping bridging, adding VJ panel minimize, universal flip arrows with actual renderer support, and Delete key layer removal.

### Stage/Mix Mode Fixes
1. Removed the `.stage-active` CSS that made the VJ overlay transparent in Stage mode. The correct behavior: the VJ panel stays fully visible in both Mix and Stage modes. The output preview automatically reflects the correct Canvas.svelte render path — **Mix** shows standard VJ composite (all VJ layers as full-screen quads), **Stage** shows mapping layout with Screen layers receiving VJ content via `vjLayerIndex` injection.

2. **Fixed stage mode black screen (Canvas.svelte + engine.ts):**
   - **Canvas.svelte**: Changed stage mode condition from `vjState.stageMode && vjLayers` to `vjState.stageMode && vjState.isLive` — the old condition required active VJ clips (`vjLayers` non-null) to enter the stage render path, meaning stage mode could never activate when no clips were triggered. Added null-safe guards around VJ layer processing.
   - **engine.ts**: Added `'screen'` to the render engine's layer visibility filter. The filter only accepted 8 hardcoded types (`media`, `generative`, `svg`, etc.) — Screen layers were silently excluded before rendering, even when they had valid VJ source textures injected by the stage mode logic. Fixed: `(l.type === 'media' || l.type === 'screen') && l.source`.

### Features Implemented

#### 1. Uniform Scale Handle (WarpHandles Integration)
**Files Modified:** `src/lib/components/WarpHandles.svelte`, `src/App.svelte`

- **Removed** the canvas toolbar with Select/Scale mode buttons from App.svelte
- **Removed** all associated scale tool state (`activeTool`, `isScaling`, `scaleStartDistance`, etc.), handlers (`handleScaleHandleDown`, `handleScaleMove`, `handleScaleUp`), scale handles SVG overlay, and CSS (`.canvas-toolbar`, `.tool-btn`, `.scale-handles-overlay`)
- **Removed** V/S keyboard shortcuts for tool switching
- **Added** a uniform-scale drag handle to `WarpHandles.svelte`:
  - Positioned 40px below the bottom edge (symmetric to the rotate handle above the top edge)
  - Cyan circle (`#00ccff`) with resize icon, `ns-resize` cursor
  - Dashed cyan line connects handle to bottom edge midpoint
  - Drag up to enlarge, drag down to shrink
  - Math: `scaleFactor = 1 + (startY - currentY) * 0.005`, clamped to `[0.05, 10]`
  - All 4 corners scaled uniformly around the layer centroid using `getCenter()`
  - Follows exact same pattern as the existing rotate handle (`dragging = 'scale'`, stored in `dragTarget`)
  - History recorded on mouseup for undo support
  - Hover, dragging, and locked CSS states match existing handle patterns

#### 2. Delete Key Support
**Files Modified:** `src/App.svelte`

- **Delete** or **Backspace** key deletes the currently selected layer
- Guarded by `inInput` check (won't fire when typing in text fields)
- Uses existing `project.removeLayer(id)` which handles:
  - Layer array cleanup
  - Auto-selection of the next layer
  - Multi-select state cleanup
  - Undo history via `recordDiscreteAction()`

#### 3. Screen Layer Type + VJ Layer Assignment
**Files Modified:** `src/lib/types.ts`, `src/lib/stores/layers.ts`, `src/lib/components/LayerPanel.svelte`

- **Extended `LayerType`** with `'screen'` variant
- **`createLayer()` factory** updated: screen layers initialize with `vjLayerIndex: 0`
- **New `createScreenLayer()` factory** in types.ts
- **New store methods** in layers.ts:
  - `addScreenLayer(name?)` - creates Screen layer with default VJ Layer 0
  - `setLayerVJIndex(id, vjLayerIndex)` - updates which VJ layer feeds a screen layer
- **LayerPanel UI**:
  - "Screen (VJ Output)" button in the add-layer dropdown menu with monitor icon SVG
  - Screen layer config: `{:else if layer.type === 'screen'}` block with "VJ Layer Source" label and `<select>` dropdown populated from `$vjClipLauncher.numLayers`
  - CSS: `.screen-layer-config`, `.screen-label`, `.screen-vj-select`
- **Canvas.svelte**: No changes needed - existing stage mode rendering (lines 233-275) already handles `vjLayerIndex` injection, so Screen layers with a `vjLayerIndex` automatically receive VJ content in stage mode

#### 4. VJ Panel Minimize + Reopen
**Files Modified:** `src/lib/components/VJModePanel.svelte`, `src/App.svelte`

- **`minimizeVJMode()` function** in VJModePanel.svelte: calls `vjClipLauncher.setOpen(false)` only - `isLive` stays `true`, VJ output keeps running
- **Minimize button** (`_` icon) added to `.header-right` before the Exit button
  - SVG minus/underscore icon, tooltip "Minimize (VJ stays live)"
  - CSS: `.minimize-btn` with hover states
- **VJ Reopen button** in App.svelte:
  - Condition: `$vjClipLauncher.isLive && !$vjClipLauncher.isOpen`
  - Fixed-position button top-right corner (z-index 200)
  - Pulsing red dot (`.live-dot-pulse` with CSS `@keyframes livePulse`) + "VJ Live -- Open Panel" text
  - Clicking calls `vjClipLauncher.setOpen(true)` to reopen panel
  - CSS: `.vj-reopen-btn` with glassmorphism background, red border accent

#### 5. Flip/Orientation Arrows on All Layer Types + Renderer Support
**Files Modified:** `src/lib/components/LayerPanel.svelte`, `src/lib/renderer/shaders.ts`, `src/lib/renderer/engine.ts`

**UI Changes (LayerPanel.svelte):**
- **Removed** old SVG-only flip controls (`<div class="flip-controls">` with Flip H / Flip V buttons)
- **Added** universal `.orientation-controls` div with 4 directional arrow buttons for ALL layer types
  - Placed in the common properties area before type-specific blocks
  - Arrows: Up (normal V), Down (flip V), Left (flip H), Right (normal H)
  - Each button uses `class:active` based on current `flipH`/`flipV` state
  - Only calls `toggleLayerFlipH/V` when the state needs to change
  - CSS: `.orientation-controls` flex row, `.orient-label` uppercase label, `.orient-btn` 26px squares with purple accent active state

**Renderer Changes (shaders.ts + engine.ts):**
- **Added `uFlipH` and `uFlipV` boolean uniforms** to the `textureFragmentShader`
- **Added flip UV logic** in shader `main()`:
  ```glsl
  if (uFlipH) layerUv.x = 1.0 - layerUv.x;
  if (uFlipV) layerUv.y = 1.0 - layerUv.y;
  ```
  Applied before shape warping and crop, so flips affect the texture sampling
- **Added uniform declarations** in `createLayerMaterial()` (engine.ts): `uFlipH: { value: false }`, `uFlipV: { value: false }`
- **Set uniforms per-layer** in the render loop (after shape masking uniforms):
  ```typescript
  obj.material.uniforms.uFlipH.value = layer.flipH || false;
  obj.material.uniforms.uFlipV.value = layer.flipV || false;
  ```
- **Result**: Flips now actually render on the WebGL canvas. Previously the `flipH`/`flipV` properties were stored but never read by the renderer, making them cosmetic-only.

---

## Session 2 - Initial UX Features (Feb 2026)

### Overview
First pass at UX improvements: media tray collapse, Stage/Mix toggle, canvas click-to-select, scale tool, and copy/paste shortcuts.

### Features Implemented

#### 1. Media Tray Collapse (VJModePanel)
- `mediaTrayCollapsed` state toggle
- Chevron button at top of `.media-tray-vj`
- Collapsed: 40px width with expand arrow
- Expanded: full 320px with all tabs/content
- CSS transition on width

#### 2. Stage/Mix Toggle on VJ Header
- MIX/STAGE segmented pill buttons in `.vj-header`
- Only visible when `$vjClipLauncher.isLive`
- STAGE mode: `.vj-overlay.stage-active` with `background: transparent; pointer-events: none`
- Header and stage presets bar stay interactive
- Audio bar and bottom panel hidden in stage mode
- Stage presets bar moved to right after header

#### 3. Canvas Click-to-Select
- Point-in-quadrilateral hit-testing: `triSign()`, `pointInTriangle()`, `pointInQuad()`, `hitTestLayers()`
- Modified `handleViewportMouseDown`: converts mouse coords through viewport pan/zoom, canvas offset, OpenGL Y-flip
- Iterates layers in reverse order (topmost first)
- Guarded: won't fire on warp handles or shape overlays

#### 4. Copy/Paste Shortcuts
- `Ctrl+C`: Copy selected layer (JSON serialized, strips texture/videoElement)
- `Ctrl+V`: Paste with new UUID, +0.02 offset, " Copy" suffix
- `Ctrl+D`: Duplicate via `project.duplicateLayer()`
- All guarded by `inInput` check

---

## Session 1 - Unlimited VJ Layers + Stage Mode Foundation (Feb 2026)

### Overview
Extended the VJ system from fixed 4x8 grid to dynamic dimensions (up to 32 layers x 64 columns), added Stage Mode for bridging VJ clips to mapping layers, and implemented per-effect opacity/blend modes.

### Features Implemented

#### Dynamic VJ Grid
- `numLayers` / `numColumns` on `VJClipLauncherState` (defaults: 4/8, max: 32/64)
- `addLayer()`, `removeLayer()`, `addColumn()`, `removeColumn()` methods
- All constant references (`NUM_VJ_LAYERS`, `NUM_VJ_COLUMNS`) replaced with dynamic store values across modulation.ts, performanceEngine.ts, SynthVision.svelte, PerformancePad.svelte

#### Stage Mode Architecture
- `stageMode: boolean` and `stagePresetId: string | null` on VJClipLauncherState
- `setStageMode()`, `toggleStageMode()`, `setStagePreset()` methods
- `vjLayerIndex?: number` on Layer interface (types.ts)
- `StagePreset` type with per-layer VJ source mappings
- Stage preset CRUD: `saveStagePreset()`, `loadStagePreset()`, `deleteStagePreset()`
- Canvas.svelte three-path render dispatch: stage mode, pure VJ, normal mapping

#### Per-Effect Opacity & Blend Mode
- `opacity` and `blendMode` added to Effect interface
- Per-effect blend pass in effects renderer with dedicated `effectBlendTarget`
- Fixed ping-pong swap bug with third render target

#### Project Format
- Version bumped to 1.4.0
- Export/import updated for dynamic VJ dimensions and stage presets

---

## Architecture Notes

### Coordinate System
- Normalized 0-1 with Y-up (OpenGL convention)
- Viewport transform: `contentX = (mouseX - viewportPanX) / viewportZoom`
- Canvas offset for letterboxing: `canvasOffsetX`, `canvasOffsetY`
- Y-flip for screen coords: `screenY = (1 - normalizedY) * canvasHeight`

### WarpHandles Handle Types
- **Corner** (purple circles): Direct corner manipulation
- **Edge** (cyan rectangles): Parallel edge movement
- **Move** (center cross): Whole layer translation
- **Rotate** (pink circle, above top edge): Angular rotation around centroid
- **Scale** (cyan circle, below bottom edge): Uniform scale around centroid

### VJ-to-Mapping Bridge (Screen Layers)
```
Screen Layer (mapping mode)
  └─ vjLayerIndex: N
       └─ Canvas.svelte stage mode injects VJ Layer N's source
            └─ VJ clip texture replaces Screen layer's content
```

### File Map (Key Files)
| File | Purpose |
|------|---------|
| `src/App.svelte` | Main app: viewport, keyboard handlers, click-to-select, VJ reopen |
| `src/lib/components/WarpHandles.svelte` | Corner/edge/move/rotate/scale drag handles |
| `src/lib/components/VJModePanel.svelte` | VJ deck UI, Stage/Mix toggle, minimize |
| `src/lib/components/LayerPanel.svelte` | Layer list, properties, flip arrows, Screen config |
| `src/lib/components/Canvas.svelte` | WebGL renderer orchestration, 3-path dispatch |
| `src/lib/types.ts` | All type definitions, layer factories |
| `src/lib/stores/layers.ts` | Project store, layer CRUD, VJ index methods |
| `src/lib/stores/vjClipLauncher.ts` | VJ state: grid, clips, layers, stage mode |
| `src/lib/renderer/engine.ts` | THREE.js render engine, uniforms, per-layer setup |
| `src/lib/renderer/shaders.ts` | GLSL vertex/fragment shaders |
| `src/lib/renderer/effects.ts` | Post-processing effect shaders |
