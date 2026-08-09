# Ghost Arcade Native Plugin Handoff

## Purpose

This handoff freezes the current GhostFX and HandFX native-plugin work at a
verified code boundary so another engineer can continue debugging without
disturbing the stable native media, GLSL/ISF, JS, live-source, or preview paths.

The product decision is:

- GhostFX stays and must run as a real persistent native graph.
- HandFX stays and must run as a real persistent native graph.
- Analyzer Lab is removed from the product and is not part of this pass.
- Do not add browser rendering, browser fallback, or placeholder output.
- Do not disable the plugins to make the rest of the app appear stable.

## Branch And Baseline

- Branch: `codex/native-main-driver-wip`
- HEAD: `6fd46456 Checkpoint native live source ingest`
- Earlier stable checkpoints:
  - `3e3939c6 Lock native preview host geometry`
  - `24f90bba Checkpoint native renderer media pipeline`
  - `6ca269bc Harden native renderer freeze gates`

The current plugin work is uncommitted. The worktree also contains unrelated
user files and prior native work. Do not use a broad reset, checkout, clean, or
mass revert. Stage only explicitly reviewed files.

## Confirmed Root Cause

The previous plugin implementation called `queue_compute_graph` on every
Electron render tick for GhostFX, Analyzer Lab, and HandFX. The Rust core
appended each submission to `pending_native_graph_jobs`, so the queue grew
without bound. After switching plugins, enabling audio, or running for a while,
the core became saturated and GLSL/ISF, JS, video, live sources, and the preview
appeared frozen or black.

This was a lifecycle bug, not a shader-performance problem.

## Implemented Architecture

GhostFX and HandFX now use persistent native graph templates:

1. Electron builds and installs the plugin graph once through
   `set_native_graph_layer.effect_graph`.
2. Rust owns that template and clones/runs one graph job per visible plugin
   layer per rendered frame.
3. Rust patches core-owned clock, delta-time, audio, hue, liquid-splat, and
   source-frame values each frame.
4. GhostFX submits no per-frame graph commands from Electron.
5. HandFX submits only new landmark and uniform buffers when MediaPipe produces
   a new landmark frame, using `update_native_graph_buffer`.
6. Neither plugin may call `queue_compute_graph` during steady rendering.

This is the invariant to preserve. Reintroducing per-frame graph construction or
submission will recreate the freeze.

## Relevant Files

### Native core

- `native-renderer/src/main.rs`
  - `NativeGraphLayerKind::GhostFx`
  - `NativeGraphLayerKind::HandFx`
  - `run_native_graph_layers`
  - `native_plugin_graph_frame_job`
  - `apply_update_native_graph_buffer`
  - top-level feature flags `native_ghostfx_graph` and `native_handfx_graph`
- `native-renderer/src/capabilities.rs`
  - command capability for `update_native_graph_buffer`
- `native-renderer/src/native_graph_manifest.rs`
  - GhostFX and HandFX native shader/feature manifests

### Electron/native synchronization

- `src/lib/sync/nativeRendererSync.ts`
  - persistent graph installation during layer setup
  - GhostFX core-owned frame advancement
  - HandFX landmark-buffer updates only on new MediaPipe frames
- `src/lib/api/native-renderer.ts`
  - `update_native_graph_buffer` RPC type
- `src/lib/renderer/nativePluginGraphs.ts`
  - GhostFX and HandFX graph builders
  - HandFX input-buffer extraction
- `src/lib/renderer/nativePluginInventory.ts`
  - authoritative native plugin inventory: GhostFX and HandFX only

### Product surface

- `src/lib/plugins/registry.ts`
  - Analyzer Lab registration removed
- `src/App.svelte`
  - Analyzer Lab controls removed

### Regression coverage

- `src/lib/renderer/nativePluginGraphs.native.test.ts`
- `src/lib/sync/nativeRendererSync.native.test.ts`
- `src/lib/renderer/nativeRendererCore.native.test.ts`

## Latest Capability Fix

The first cold boot after the persistent-graph work compiled every shader, but
the app reported an incomplete native graph catalog:

```text
ghostfx:feature:native_ghostfx_graph
handfx:feature:native_handfx_graph
```

The manifests existed, but the core's top-level feature map did not advertise
those two flags. `native_ghostfx_graph: true` and
`native_handfx_graph: true` were added to the core capability response and the
release core was rebuilt successfully.

This capability fix has not yet been manually cold-boot verified. That is the
first task for the next engineer. Do not redesign the plugin route before doing
that check.

## Verification At Handoff

Release build:

```bash
npm run native:build
```

Result: passes. Only the two existing `kIOSurfaceIsGlobal` deprecation warnings
remain.

Graph builder suite:

```bash
npx vitest run \
  src/lib/renderer/nativePluginGraphs.native.test.ts \
  --config vitest.native.config.ts
```

Result: 7/7 passed.

Native synchronization lifecycle:

```bash
npx vitest run src/lib/sync/nativeRendererSync.native.test.ts
```

Result: 42/42 passed. This includes the guard that GhostFX emits no render-tick
commands and HandFX emits only buffer updates, never `queue_compute_graph`.

Real native Metal integration:

```bash
npx vitest run \
  src/lib/renderer/nativeRendererCore.native.test.ts \
  --config vitest.native.config.ts \
  -t "renders every enabled plugin through native graph source frames"
```

Result: 1 passed, 10 skipped by the filter. GhostFX drift advances between two
snapshots after a single install command, and all tested GhostFX scenes and all
five HandFX modes produce visible native frames.

## First Cold-Boot Check

1. Ensure no stale Electron or `ghost-render-core` process is running.
2. Run `npm run desktop`.
3. Confirm startup does not report the two feature-missing messages above.
4. Confirm the graph catalog reports full/ready rather than partial.
5. Confirm an installed GhostFX or HandFX layer reports one persistent graph
   layer, not a growing pending-job count.
6. Leave the terminal attached while manually switching scenes and enabling
   audio/camera.

If the catalog is still partial, inspect the feature response actually received
by Electron before changing shader or graph code. The release binary was rebuilt
after the flags were added, so also rule out a stale core process or stale binary
path.

## Manual Acceptance

### GhostFX

- Open Plugins and apply GhostFX.
- Test Drift, Ribbons, and Liquid.
- Each scene must animate continuously after controls are released.
- Enable microphone/audio input and verify the visual keeps animating.
- Change parameters and switch scenes repeatedly; work must remain bounded and
  responsiveness must not degrade over time.

### HandFX

- Apply HandFX and enable the camera.
- Test Paint, Ink, Pinch Spray, Neon Skeleton, and Panel.
- Landmarks must affect the native result without installing a replacement graph
  every camera frame.
- Camera updates must not slow GLSL/ISF, JS, video, live sources, or the preview.

### Stability smoke

- Rapidly switch between GhostFX, HandFX, GLSL/ISF, JS, and video.
- Confirm no graph queue growth, black output, preview offset, or desktop bleed.
- Turn audio and camera on/off several times.
- Let the app run for at least ten minutes and confirm responsiveness does not
  decay.

## Non-Negotiable Regression Rules

1. No browser rendering or browser fallback in the native version.
2. No per-frame `queue_compute_graph` for persistent plugin layers.
3. No decoder, MediaPipe, graph-build, or precompile work may block the render
   thread.
4. Do not edit presenter geometry, host transparency, or native media lifecycle
   while debugging plugins.
5. Already-working native surfaces must remain working after every plugin change.
6. If a plugin fails, diagnose its graph or capability state; do not hide it,
   disable it, or replace it with a placeholder.

## Working-Tree Scope

Likely plugin-scope tracked files:

```text
native-renderer/src/capabilities.rs
native-renderer/src/main.rs
native-renderer/src/native_graph_manifest.rs
src/App.svelte
src/lib/api/native-renderer.ts
src/lib/plugins/registry.ts
src/lib/renderer/nativeRendererCore.native.test.ts
src/lib/sync/nativeRendererSync.native.test.ts
src/lib/sync/nativeRendererSync.ts
```

New plugin-scope files:

```text
src/lib/renderer/nativePluginGraphs.native.test.ts
src/lib/renderer/nativePluginGraphs.ts
src/lib/renderer/nativePluginInventory.ts
```

`src/lib/components/Canvas.svelte` and `src/lib/components/MediaTray.svelte`
contain prior work that must not be casually reverted. `.claude/settings.local.json`,
the `.blend` files, and the `native-mobile` trees are unrelated to this plugin
pass.
