# Ghost Arcade GPU — WebGPU migration roadmap

This document is the staged plan for moving the editor from
THREE.WebGLRenderer to THREE.WebGPURenderer. It exists so the
migration can be done incrementally, in production-safe slices,
with each phase shipping value on its own.

## What's already done

- **WebGPU output presenter** (commit 95c3339, tag
  `webgpu-output-zerocopy-v1`) — the visible output window runs a
  full WebGPU pipeline. ~155μs gpu-submit at 1080p, ~132μs at 4K
  on discrete NVIDIA. True zero-copy via `importExternalTexture`
  on a GpuMemoryBuffer-backed VideoFrame transferred through a
  same-renderer-process MessageChannel.

- **WebGPU capability probe** (`webgpuCapability.ts`) — runs at
  app boot, caches adapter info, gates anything that needs WebGPU.
  URL overrides: `?webgpu-disable=1`, `?webgpu-force=1`,
  `?webgpu-pilot=1`.

- **WebGPU pilot** (`webgpuPilot.ts`) — proves THREE.WebGPURenderer
  + TSL render successfully in this Electron build (Electron 42 /
  Chromium 130 / Three r184). Renders an animated TSL test pattern
  to an off-screen canvas; main compositor samples it to measure
  WebGL2/WebGPU interop cost. NOT integrated into the main render
  path — strictly a measurement instrument.

## What's not done

The editor's main render path is still 100% THREE.WebGLRenderer:

- Compositor + crossfader (`engine.ts`, the `RenderEngine` class)
- Per-layer renderers: ISF shaders (`isf/renderer.ts`), splat
  (`splat/SplatRenderer.ts`), model3d (`model3d/Model3DRenderer.ts`),
  fluid simulation (`effects/fluidSimulation.ts`), particle systems
  (`effects/particleSystem3D.ts`, `particleSystem.ts`), lines
  (`lines/renderer.ts`), SVG (`svg/renderer.ts`), light-painting
  (`lightpainting/renderer.ts`), text (`text/renderer.ts`),
  drawing (`drawing/renderer.ts`)
- 333 ISF shader assets — all hand-authored GLSL fragment shaders

## The hard problem: 333 ISF shaders

Three.js's TSL (Three Shading Language) compiles to both WGSL
and GLSL, so any new material we write going forward is
cross-compatible. But the ISF library is pre-existing GLSL that
TSL can't ingest. Three options:

1. **Runtime GLSL→WGSL transpilation** via `naga` (Mozilla's Rust
   implementation, the same library Firefox uses internally).
   Available via the `naga-web` npm package as a WASM module
   (~600KB). Pre-compile shaders at app boot and cache the WGSL
   results in IndexedDB.

2. **Hand-port** all 333 shaders to TSL. Months of work; loses
   the ability to import community ISF shaders.

3. **Hybrid bridge**: keep ISF shaders rendering on WebGL2 to a
   texture, sample that texture into the WebGPU compositor.
   Short-term technical debt; unblocks all OTHER migration work.

**Decision: hybrid bridge first, naga transpilation last.** This
lets us migrate the compositor + simpler renderers to WebGPU
immediately while deferring the ISF shader question.

## Phased rollout

Each phase ships a working app behind a feature flag. The flag
defaults to OFF until the phase passes its success criteria. Real
users see no behaviour change until cutover.

### Phase 1 — Output presenter (DONE)

✅ `experimental.outputZeroCopy` (default true). WebGPU output
running in production today.

### Phase 2 — `WebGPUEngine` compositor scaffold

**Goal**: prove the WebGPU canvas can be the editor's main render
surface, and that captureStream still works for the output
presenter.

**Scope**:
- New `src/lib/renderer/webgpuEngine.ts` parallel to `engine.ts`.
  Same constructor signature (`new WebGPUEngine(canvas, w, h)`).
- Implements: clear color, render-target creation, single-pass
  composite (one full-screen quad sampling a single texture),
  `dispose()`. NOT layer rendering.
- Uses `THREE.WebGPURenderer` from `three/webgpu` + `THREE.NodeMaterial`
  with TSL color expressions.
- Canvas.svelte adds `experimental.editorWebGPU` flag. When on,
  instantiates `WebGPUEngine` instead of `RenderEngine`. The rest
  of the per-layer pipeline becomes no-op until Phase 3.
- Verify the output presenter still captures pixels from the
  WebGPU-backed editor canvas. (`captureStream()` SHOULD work on
  any GPU-backed canvas, but must be measured — it's the
  unblocker for everything that follows.)

**Success criteria**:
- App boots with `experimental.editorWebGPU = true` and the editor
  shows a clear color (no per-layer rendering yet, intentional).
- Output window opens, receives frames, presents them at 60fps.
- gpu-submit on output stays <500μs.
- No console errors.

### Phase 3 — Layer-renderer migration (incremental)

For each renderer in the layer pipeline, port to WebGPU and add
to `WebGPUEngine`'s render loop. Order from easiest to hardest:

1. **Drawing renderer** (`drawing/renderer.ts`) — canvas2d
   currently, can stay canvas2d and become a sampled texture in
   WebGPU compositor. ~half-day.
2. **Lines renderer** (`lines/renderer.ts`) — simple geometry.
   THREE.WebGPURenderer's PolyLine works out of the box. ~day.
3. **SVG renderer** (`svg/renderer.ts`) — ditto. ~day.
4. **Text renderer** (`text/renderer.ts`) — canvas2d source. ~day.
5. **Light-painting renderer** (`lightpainting/renderer.ts`) —
   simple instanced quads. ~day.
6. **Model3D renderer** (`model3d/Model3DRenderer.ts`) — GLTF +
   AnimationMixer. THREE.WebGPURenderer supports both natively.
   ~3 days for testing across model types.
7. **Splat renderer** (`splat/SplatRenderer.ts`) — gaussian splat
   with custom shaders. Need to port the splat shaders to TSL or
   WGSL. ~1 week.
8. **Particle systems** (`particleSystem.ts`, `particleSystem3D.ts`)
   — port to WebGPU compute shaders. **Huge perf win** here —
   compute shaders are 10-100× faster than the current WebGL
   transform-feedback hacks. ~1 week.
9. **Fluid simulation** (`fluidSimulation.ts`) — same as particles,
   compute shaders. **Even bigger perf win.** ~1-2 weeks.
10. **ISF renderer** (`isf/renderer.ts`) — initially via hybrid
    bridge (render to WebGL texture, sample in WebGPU). Last to
    migrate fully. See Phase 4.

Each port is gated on `WebGPUEngine`'s flag so it only runs in
the new path. The existing WebGL renderers stay untouched.

### Phase 4 — ISF shader transpilation

**Goal**: drop the WebGL2 fallback for ISF shaders.

**Approach**:
- Bundle `naga-web` (~600KB WASM).
- At app boot, transpile the 333 ISF GLSL shaders to WGSL on a
  worker thread. Cache results in IndexedDB keyed by source hash.
- Update ISF runner (`isf/renderer.ts`) to use WGSL via
  RawShaderMaterial with WebGPU.
- Visual regression test against WebGL output for each shader
  (use the existing snapshot harness or build one).

**Risk**: GLSL/WGSL semantics differ in subtle ways (loop
unrolling, integer/float promotion, derivative functions). Some
shaders may need hand-fixes after transpilation. Plan for ~10%
needing manual touch-up.

### Phase 5 — Cutover

- Remove `experimental.editorWebGPU` flag (always on).
- Delete `engine.ts` (the WebGL `RenderEngine`).
- Delete the per-layer WebGL renderers.
- Remove WebGL2 from preload's webgl flag set.
- Update `webgpuCapability.ts`: app refuses to start if WebGPU is
  unavailable. This is the moment the app commits to the WebGPU
  era.

## Estimated timeline

Solo, focused work — extend liberally if multitasking:

- Phase 2: 1-2 weeks
- Phase 3: 4-6 weeks (depends on splat/particle/fluid complexity)
- Phase 4: 2-3 weeks
- Phase 5: 1 week buffer
- **Total: 8-12 weeks of dedicated work**

## Why this is worth doing

1. **Compute shaders unlock 10-100× perf** for fluid + particles.
   Both have been "good enough" but never great because WebGL2
   transform-feedback is a hack. WebGPU compute is the right tool.

2. **Output presenter is already WebGPU.** The editor → output
   transport bypasses all encoding. Once the editor is also
   WebGPU, the entire render→present chain is one WebGPU pipeline
   with zero-copy interop. That's Resolume class for the editor +
   the output simultaneously.

3. **Modern shader development.** New community shaders increasingly
   target WebGPU/WGSL. WebGL2 ISF is a maintenance regime, not a
   forward-looking platform.

4. **Single codepath**. Maintaining WebGL + WebGPU forever is
   cost. Picking WebGPU as the target lets us drop the legacy
   path eventually.

## Why this is risky

1. **WebGPU is still maturing.** Some THREE.js features lack WebGPU
   parity (postprocessing, certain materials). Monitor THREE
   release notes; back out if a feature we depend on is gone.

2. **Driver bugs.** WebGPU shipped to Chrome stable in Apr 2023.
   Older GPUs have flaky implementations. The capability probe
   already handles "no WebGPU" — we'd need to also handle "WebGPU
   present but driver is bad" (specific bug-detection heuristics).

3. **ISF transpilation may regress visuals.** Hand-fix budget for
   the long tail.

## Cherry-pick guide for porting back to Community / Pro

The `webgpu-output-zerocopy-v1` tag captures the output presenter
work. Apply with:

```
git remote add gpu https://github.com/riskcapital/ghost-arcade-gpu.git
git fetch gpu webgpu-output-zerocopy-v1
git cherry-pick 63eef65 95c3339
```

The editor WebGPU migration (Phase 2 onward) will get its own
tag once Phase 2 ships. Migration tags will be sequential
(`webgpu-editor-phase2-v1`, `webgpu-editor-phase3-splat-v1`,
etc.) so Pro/Community can pick up incremental progress.
