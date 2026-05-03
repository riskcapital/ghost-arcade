---
name: custom-effects
description: Guidelines for authoring custom post-processing effects in ghost-arcade / Ghost Arcade. Covers how the effects chain renders, the 3 pieces every new effect needs (catalog entry + param defs + shader), the defensive-programming rules distilled from auditing all 134 built-in effects, and a pre-ship checklist. Use when creating a new effect or fixing an existing one.
trigger_when: user wants to create, add, edit, import, fix, or optimize an **effect** (post-processing pass) — distinct from a shader (layer content source)
---

# Custom effects — ghost-arcade

**Effects vs shaders — know the difference.**

- **Shaders** (`public/ISF/*.fs`) are layer content sources. They generate an image from nothing. Picked from the MediaTray.
- **Effects** (`src/lib/renderer/shaders/*.ts`) are post-processing passes. They take a layer's current texture as `uTexture` and output a modified version. Added to a layer via the `+ Add Effect` button → EffectPickerModal.

A layer can have **one source** and **many effects**. Effects render as a chain of full-screen ping-pong passes.

If you're working on a `.fs` file in `public/ISF/`, you want `shader-authoring.md`, not this.

## 1. The three pieces of an effect

Every effect is three things wired together:

| Piece | File | Role |
|---|---|---|
| **Shader** (the GLSL) | `src/lib/renderer/shaders/<pack>.ts` | Fragment shader that reads `uTexture` + uniforms and writes `gl_FragColor`. |
| **Catalog entry** | `src/lib/effects/effectCatalog.ts` | Declares the effect's `type`, `label`, `category`, `description`, `previewCSS`. Controls what appears in the EffectPickerModal and its tier-gate. |
| **Param defs** | `src/lib/effects/effectParamDefs.ts` | Declares each parameter's slider (name, min, max, step, type). Controls what appears in the properties panel when the effect is selected. |

If any one of these is missing the effect either won't appear in the picker, will have no controls, or will crash at compile time.

## 2. Architecture

```
┌─ Layer source (shader/video/image) ─┐
│                                      ▼
│                            ┌─── effectTargetA ──┐
│                            │                    ▼
│                            │    [Effect 1] — writes to effectTargetB
│                            │                    │
│                            │    [Effect 2] — writes to effectTargetA
│                            │                    │
│                            │    [Effect N] ─────▼
└────────────────────────────┴─────► Final output
```

Each effect is a `THREE.ShaderMaterial` rendered to a full-screen quad. Uniforms are updated per-frame via `updateEffectUniforms(material, effect, width, height, time)` ([engine.ts](src/lib/renderer/engine.ts)).

**Implication for shader authors:** your fragment shader will run **once per pixel per effect in the chain** — keep it cheap. A layer with 5 effects chained at 1080p = 5 × 2M pixel-shader invocations per frame. Target ≤ 300 instructions/pixel for any single effect.

## 3. Shader skeleton

Every effect shader has the same uniform scaffold:

```glsl
precision highp float;

uniform sampler2D uTexture;    // Input — the layer (or previous effect's output)
uniform vec2 uResolution;      // Output resolution in pixels
uniform float uTime;           // Seconds since start

// Standard parameter slots — not all effects use all of them
uniform float uAmount;         // Primary intensity/amount slider (0..1 canonical)
uniform float uAmount2;        // Secondary (e.g. spread, scale)
uniform float uAmount3;        // Tertiary
uniform float uThreshold;      // Luma / cutoff threshold
uniform float uAngle;          // Direction in radians
uniform vec2 uCenter;          // Focus point in UV (0..1)
uniform vec3 uColor;           // Tint / key color

varying vec2 vUv;              // UV in [0, 1]

void main() {
  vec4 src = texture2D(uTexture, vUv);
  vec4 outColor = src;

  // …your effect here, reading vUv, sampling uTexture, writing outColor…

  gl_FragColor = vec4(clamp(outColor.rgb, 0.0, 1.0), clamp(outColor.a, 0.0, 1.0));
}
```

**Why the standard uniform names?** So the `updateEffectUniforms` pipeline can wire your effect without special-casing it. If you need a uniform that doesn't fit, add it — but the 8 standard slots cover ~90% of effects.

## 4. Catalog entry

Add an entry to the right category block in [src/lib/effects/effectCatalog.ts](src/lib/effects/effectCatalog.ts):

```ts
{
  type: 'myCoolEffect',         // unique kebab/camelCase — this is the EffectType
  label: 'My Cool Effect',       // displayed in the picker
  category: 'Stylize',           // one of the category names below
  description: 'One-line pitch of what it does',
  previewCSS: 'filter: hue-rotate(90deg) saturate(2);',  // css for the thumbnail fallback
}
```

**Categories** (free in bold, paid in *italic*):
- **Masking** — vignette, edge feather, shape mask
- **Color** — exposure, curves, thermal, night-vision, selective color
- **Stylize** — dither, glitch, VHS, halftone, toon, CRT
- **Blur & Focus** — blur, sharpen, tilt-shift
- **Light & Glow** — bloom, chromatic aberration, god rays, halation
- **Generate** — noise, grain, heat haze
- **Distort** — kaleidoscope, mirror, wave, fisheye, displacement
- **Keying** — chroma key, luma key, erode/dilate
- *Premium Color / Stylize / Warp / Atmosphere / Text / 3D / Depth / Feedback / Trails* — see [effectCatalog.ts](src/lib/effects/effectCatalog.ts)
- **Blob Tracking** — blob track, contour, heatmap
- **Time-Based** — time smear, chronophotography

Tier is **auto-derived** from category: anything with a `"Premium"` prefix becomes `pro`, everything else is `demo`. So to gate an effect behind the paid tier, put it in a Premium category.

## 5. Param defs

Add per-slider config to [src/lib/effects/effectParamDefs.ts](src/lib/effects/effectParamDefs.ts):

```ts
export const myCoolEffectParams: EffectParamDef[] = [
  { name: 'uAmount',    label: 'Intensity', type: 'slider', min: 0, max: 1,   default: 0.5, step: 0.01 },
  { name: 'uAmount2',   label: 'Softness',  type: 'slider', min: 0, max: 2,   default: 1.0, step: 0.01 },
  { name: 'uColor',     label: 'Tint',      type: 'color',  default: [1,0.5,0.2,1] },
  { name: 'uThreshold', label: 'Threshold', type: 'slider', min: 0, max: 1,   default: 0.5, step: 0.01 },
];
```

Wire it into the main `EFFECT_PARAM_DEFS` map keyed by your effect's `type`.

## 6. Register the shader

Import the shader string in the effect material factory (`engine.ts` → `createEffectMaterial`), and map `myCoolEffect` → your shader + uniforms.

## 7. Defensive programming rules (from the audit)

We audited all 134 shipping effects. These patterns show up everywhere the effect breaks under an edge-case input — guard against them:

### 7.1 Divide by a uniform? Clamp the denominator.
```glsl
// BAD — Inf when uAmount = 0
temp = pow(temp, 1.0 / uAmount);

// GOOD — floor the denominator
temp = pow(temp, 1.0 / max(uAmount, 0.05));
```

### 7.2 `normalize(vec)` on a value that can be zero? Add an epsilon.
```glsl
// BAD — NaN at the exact center pixel
vec2 dir = normalize(uv - 0.5);

// GOOD — shift away from (0,0) by ε
vec2 dir = normalize((uv - 0.5) + vec2(1e-6));

// ALSO GOOD — branch on distance
float d = length(uv - 0.5);
vec2 dir = d > 1e-5 ? (uv - 0.5) / d : vec2(0.0);
```

### 7.3 `pow(base, exp)` — clamp both sides.
```glsl
// GOOD
vec3 out = pow(max(src.rgb, vec3(0.0)), vec3(max(0.05, gamma)));
```
Negative bases under fractional exponents are undefined in GLSL. Small exponents near zero are OK but cause NaN only if paired with base=0.

### 7.4 Arrays indexed by a runtime expression — avoid in GLSL ES 1.0.
```glsl
// RISKY — one pack shipped this and it compiles on ANGLE but not every driver.
float bayer[16];
bayer[0] = 0.0; …
float v = bayer[by * 4 + bx];  // runtime index — out of spec in ES 1.0

// SAFE — use an if/else ladder, a texture lookup, or fix the index at compile time.
float v;
if (by == 0 && bx == 0) v = 0.0/16.0;
else if (by == 0 && bx == 1) v = 8.0/16.0;
// …
```

### 7.5 Runtime loop bounds — const only.
WebGL 1 requires `for` loop bounds to be compile-time constants. Use a const cap + early `break`:
```glsl
for (int i = 0; i < 32; i++) {       // const bound
  if (i >= steps) break;              // runtime early exit
  …
}
```
The parser (`src/lib/isf/parser.ts`) will rewrite runtime bounds to a hard cap of 64/100 as a fallback — but it's crude, so write the const form yourself.

### 7.6 Accumulator divides — floor them.
```glsl
// BAD — div by 0 when no samples contributed
outColor.rgb = accum / totalWeight;

// GOOD
outColor.rgb = accum / max(totalWeight, 0.001);
```

### 7.7 Clamp texture coordinates to avoid wrap artifacts.
Three.js render targets default to `ClampToEdgeWrapping`, but if you compute a `sampleUv` that can go outside [0,1], explicitly `clamp(sampleUv, 0.0, 1.0)` before `texture2D`. Effects that don't clamp often show subtle seams on the screen edge.

### 7.8 Dead code rots.
If you iterate on an effect and a local variable no longer feeds into the output, delete it. A shipped shader had `int samples = int(min(uRadius * 2.0 + 1.0, 21.0));` that was never read — wasted a register and confused readers.

### 7.9 Shadowing GLSL built-ins.
Don't declare locals named `dot`, `mix`, `length`, `cos`, `sin`, `reflect`, `normal`, `texture`. It might compile now and break on the next edit.

### 7.10 Audio-reactive effect? Same rules as shaders.
Effects can read `audioBass`, `audioBeat`, etc. if the runtime passes them. Always provide a fallback so the effect still animates with audio silent:
```glsl
float bassFallback = 0.3 + 0.2 * sin(uTime * 0.8);
float bass = max(audioBass, bassFallback);
```

## 8. Performance budget

Effects **chain**. 5 chained effects at 1080p = 5 × 2.07M pixel invocations per frame = the whole 16 ms budget if each effect is only 100 ops/pixel.

Targets:
- **2D recolor / threshold effects** (brightness, invert, colorama, posterize): ≤ 30 ops/pixel.
- **Convolution effects** (blur, sharpen, edge-detect, emboss): ≤ 9 texture reads + math. Separable blur if radius > 4.
- **Displacement / warp effects** (wave, fisheye, kaleidoscope, shockwave): ≤ 2 texture reads.
- **Raymarched / multi-sample effects** (god rays, bokeh, defocus): ≤ 16-sample inner loop.
- **Recursive / accumulating effects** (feedback, mirror, echo): ≤ 12 iterations.

**Post-audit findings:**
- The heaviest single-mode shader is `premium-pack::defocusBokeh` at 81 samples. Uses a ring mask early-out. Near the ceiling.
- `basic::blurShader` uses a 21×21 kernel = 441 samples — acceptable but ripe for a separable rewrite.
- `basic::outlineShader` at max thickness+glow = 32 samples — bounded.

## 9. Pre-ship checklist

- [ ] Shader string compiles (drop into dev server, check console).
- [ ] Every uniform referenced in the shader has a matching entry in `effectParamDefs.ts`.
- [ ] Catalog entry exists with correct `type`, `label`, `category`, `description`, `previewCSS`.
- [ ] Every `normalize(v)` on a computed vector has an `ε` guard.
- [ ] Every `1 / uAmount*` has a `max(uAmountN, ε)` floor.
- [ ] `pow(x, n)` guards the base; `max(n, ε)` the exponent if it can reach 0.
- [ ] No runtime-indexed local arrays; no shadowed built-ins.
- [ ] Loop bounds are const; runtime values are early-break guards.
- [ ] Output is `clamp(…, 0.0, 1.0)` on rgb; alpha preserved from source.
- [ ] Tested chained with 2 other effects at 1080p — still above 30 fps.
- [ ] Every parameter visibly changes the output across its full slider range.

## 10. Reference effects to copy-paste from

| Pattern | Reference |
|---|---|
| Simple color transform | `basic.ts::brightnessShader`, `basic.ts::saturationShader` |
| Convolution / edge kernel | `basic.ts::sharpenShader`, `basic.ts::edgeDetectShader` |
| Multi-mode mega-shader (if/else ladder) | `pro-pack.ts::proPackShader` (32 modes — the gold standard for guard discipline) |
| Luma-gated bloom / halation | `premium-pack.ts::bloom`, `premium-pack.ts::halation` |
| Polar / radial distortion | `premium-pack.ts::polarTransform`, `premium-pack2.ts::wormhole` |
| Raymarched 3D overlay | `premium-standalone.ts::torusTunnelShader`, `premium-standalone.ts::diamondGemShader` |
| Feedback / echo loop | `premium-pack2.ts::feedbackZoom`, `premium-pack2.ts::recursiveEcho` |
| Audio-reactive overlay | effects that read `audioBass`/`audioBeat` through `updateEffectUniforms` |

## 11. User-imported effects (future)

Currently all 134 effects are built-in. There's **no UI path** for users to drop in their own `.ts` effect yet — that's a planned feature (`Phase 3` in the roadmap). When it ships:

- User-authored effects will live in `user-effects/*.ts` (mirroring the `user-shaders/` pattern).
- An import flow in the EffectPickerModal will accept a single-file `.ts` export and register its catalog entry + paramDefs + shader at runtime.
- The runtime will validate the shader compiles and its declared uniforms match the paramDefs before accepting.

Until then, adding a new effect means editing the three files in §1 directly and rebuilding.

## 12. When in doubt

Authoritative runtime behavior lives in:
- `src/lib/renderer/engine.ts` — the ping-pong pipeline and `createEffectMaterial` / `updateEffectUniforms`.
- `src/lib/effects/effectCatalog.ts` — the registry + tier gating.
- `src/lib/effects/effectParamDefs.ts` — the UI schema.

If this doc and the code disagree, the code is correct and this doc is stale — please update.
