---
name: shader-authoring
description: Guidelines for authoring high-quality ISF shaders that ship in ghost-arcade / Ghost Arcade. Covers the ISF header, audio uniforms, categories, common bugs from the audit, a hard performance budget, and a pre-ship checklist. Use this when creating new `.fs` files or reviewing existing ones.
trigger_when: user wants to create, add, edit, import, fix, or optimize a shader (`.fs`) in this repo
---

# Shader authoring — ghost-arcade

Every shader in the default library was audited against the rules below. Follow them and your shader will (a) compile, (b) look seam-free at every parameter value, (c) render fast enough for a live VJ set, and (d) surface the right controls in the UI.

## 1. Where files live

- **Live library** — `public/ISF/*.fs` (this is what the app loads at runtime).
- **Cube / 3D room** — `public/ISF/cube shaders/*.fs` (subfolder for the window-into-a-room series).
- **User-generated** — `user-shaders/*.fs` (AI-generated or imported; tracked by `src/lib/stores/shaderLibrary.ts`).
- **Staging** — `new-shaders/*.fs`, `CuratedISF/*.fs`, `30pack/*.fs` — not in the live library until copied into `public/ISF/` and registered in the manifest.
- **Manifest** — `public/ISF/manifest.json` registers every live shader with `tier`, `category`, `defaults` (per-input overrides), `featured`, `defaultLoad`, and `enabled`.

## 2. File skeleton

Every shader starts with a JSON metadata block inside a `/* … */` comment, then GLSL. The metadata becomes the UI — so treat it like a product spec.

```glsl
/*{
    "CREDIT": "Your real name or handle",
    "DESCRIPTION": "One-sentence pitch that matches what the shader actually renders",
    "ISFVSN": "2.0",
    "CATEGORIES": ["Generator"],
    "INPUTS": [
        {"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "Speed"},
        {"NAME": "intensity", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Intensity"},
        {"NAME": "tint", "TYPE": "color", "DEFAULT": [0.4, 0.7, 1.0, 1.0], "LABEL": "Tint"}
    ]
}*/

#ifdef GL_ES
precision highp float;
#endif

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * RENDERSIZE) / RENDERSIZE.y;
    vec3 col = vec3(0.0);
    // ... your shader here ...
    gl_FragColor = vec4(col * intensity, 1.0);
}
```

**Hard rules:**
- `CREDIT` must be a real value. `"Your Name"` is a placeholder and will get flagged. If you don't want credit, omit the field entirely.
- `DESCRIPTION` must match the rendered output. If it says "jellyfish" and it renders a crystal lattice, rename the file or rewrite the description.
- `"INPUTS": []` (empty) produces a shader with no UI — never ship this in the default library. Aim for **3–10 parameters**.
- The filename is what users see in the library. Match the name to the aesthetic.

## 3. Built-in uniforms (auto-injected)

You do **not** declare these. The runtime (`src/lib/isf/renderer.ts`) injects them.

| Name | Type | Meaning |
|---|---|---|
| `RENDERSIZE` | `vec2` | Output resolution in pixels |
| `TIME` | `float` | Seconds since start |
| `TIMEDELTA` | `float` | Seconds since last frame |
| `FRAMEINDEX` | `int` | Frame counter |
| `DATE` | `vec4` | (year, month, day, seconds) |
| `isf_FragNormCoord` | `vec2` | UV in `[0,1]` — alternative to `gl_FragCoord.xy / RENDERSIZE` |

**Shadertoy aliases** also work — `iResolution`, `iTime`, `mainImage(out vec4, in vec2)` — the renderer converts them. You can paste Shadertoy shaders and they'll usually run after adding the ISF header.

## 4. Audio uniforms (for `"Audio Reactive"` category)

If your shader reads any of these, **its manifest category MUST be `"Audio Reactive"`** — otherwise users can't filter it:

| Name | Type | Range | Use |
|---|---|---|---|
| `audioLevel` | `float` | 0–1 | Overall RMS loudness |
| `audioBass` | `float` | 0–1 | Low-band energy |
| `audioMid` | `float` | 0–1 | Mid-band energy |
| `audioHigh` | `float` | 0–1 | High-band energy |
| `audioBeat` | `float` | 0–1 | Transient / beat flash |
| `audioBeatPhase` | `float` | 0–1 | Phase within a beat cycle |
| `audioBPM` | `float` | bpm | Detected tempo |
| `audioSpectralCentroid` | `float` | 0–1 | Brightness of the spectrum |
| `sampleWaveform(u)` | `float` | -1 to 1 | Sample the scope waveform at `u∈[0,1]` |
| `sampleFFT(u)` | `float` | 0–1 | Sample the FFT at `u∈[0,1]` |

Always provide a fallback so the shader still animates when audio is silent:

```glsl
float bassFallback = 0.3 + 0.2 * sin(TIME * 0.8);
float bass = max(audioBass, bassFallback);
```

## 5. INPUT types

```jsonc
// Float slider (most common)
{"NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "Speed"}

// Boolean checkbox
{"NAME": "animate", "TYPE": "bool", "DEFAULT": true, "LABEL": "Animate"}

// Integer dropdown — use LABELS + VALUES for named options
{"NAME": "mode", "TYPE": "long", "DEFAULT": 0,
 "LABELS": ["Smooth", "Blocky", "Striped"], "VALUES": [0, 1, 2], "LABEL": "Mode"}

// Color picker (RGBA 0–1)
{"NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.5, 0.2, 1.0], "LABEL": "Tint"}

// 2D point (e.g. focus center)
{"NAME": "focus", "TYPE": "point2D", "DEFAULT": [0.5, 0.5], "LABEL": "Focus"}
```

`LABEL` is what the slider panel displays. Default to the capitalized `NAME` if omitted — but a good `LABEL` makes the shader feel curated.

## 6. Categories (pick exactly one)

| Category | What goes here |
|---|---|
| `"Visual"` | Stylistic treatments meant to composite / sit in front of other content (plasma, noise, grids, overlays, calibration tools). |
| `"Generator"` | Self-contained renderable scenes (fractals, particle systems, tunnels, 3D SDFs). |
| `"Audio Reactive"` | **Any** shader that reads audio uniforms. Non-negotiable. |
| `"Simulation"` | Time-accumulating systems that read as physical motion (bouncing balls, flocking, fluid, fireflies). |
| `"3D Room"` | The `ROOM_*` / `3D_*` window-into-a-room series — they share a parallax-layered composition convention. |
| `"Uncategorized"` | Rare. Use as a holding pen, not a final home. |

## 7. Pitfalls from the shipped-library audit

These are the bug classes we've hit and fixed across the default 100 shaders. Read the **Why** for each — it's the part that keeps you from making it again.

### 7.1 The atan2 seam
```glsl
float angle = atan(uv.y, uv.x);     // returns (-π, +π]
// BAD: discontinuity at the negative-x axis
tunnelUV = vec2(angle / PI, z);
```
`atan(y,x)` jumps by 2π across the negative x-axis. If you feed `angle/PI` into a fractal / voronoi / hex grid, every pixel on that ray jumps by `2 * scale` and you get a visible horizontal seam.

**Fix — embed the angle on a cylinder** so sampling is C∞:
```glsl
tunnelUV = vec2(cos(angle), sin(angle) + z);
```

**Exception** — if your downstream use is `sin(angle * N)` where `N` is an integer, the 2π jump lands on a full period and you're seamless by luck. Every other case needs the cos/sin embedding.

### 7.2 Division by potentially-zero denominators
```glsl
float dd = 1.0 - length(uv);      // hits 0 at radius=1
c *= 0.2 / dd;                    // NaN / flashing ring at the unit circle
```
Clamp the denominator. The cheapest safe form:
```glsl
c *= 0.2 / max(abs(dd), 0.05);
```

### 7.3 Oversampled parametric curves
```glsl
#define SAMPLES 400.0                      // Lissajous — 400 is overkill
for (float i = 0.0; i < SAMPLES; i++) { …sample curve… }
```
100–150 samples render identically to 400 for most continuous curves. **Default SAMPLES to 128**, not 400. Torus knots, Moebius strips, oscilloscope curves, orbit paths — all look the same at half the cost.

### 7.4 Brute-force curve drawing instead of SDF
Sampling 60 points along an ellipse and taking `min(length(uv-p))` is O(N·pixels). Prefer an analytic SDF of the curve. If you must brute-force, sample ≤30 points and inline the loop.

### 7.5 Shadowing GLSL built-ins
```glsl
float dot = length(gv);           // dot() is now shadowed for the rest of the scope
```
Never name a local `dot`, `mix`, `length`, `cos`, `sin`, `reflect`, `normal`, `texture`. If the compiler doesn't error, the next edit will silently break.

### 7.6 Dead variables / refactor leftovers
Set-but-never-read locals waste GPU registers and confuse readers. A pattern we found repeatedly: four assignments to `seedPos` where only the last one is used. If you're experimenting, delete the earlier attempts before saving.

### 7.7 O(n²) pairwise loops
```glsl
for (int i = 0; i < nodes; i++)
    for (int j = i+1; j < nodes; j++)     // 435 pairs at nodes=30
        // draw connection i→j
```
If you ship this, **cap `MAX` at 20** (190 pairs is tolerable, 435 isn't), and add a "draw only nearest K" guard inside the inner loop.

### 7.8 FBM octaves per raymarch step
```glsl
for (int i = 0; i < 80; i++) {
    float d = sceneSDF(p);         // sceneSDF calls fbm() with 5 octaves
    …
}
```
That's 80 × 5 = 400 noise samples per pixel **before** normal and AO. Either drop octaves to 3, or compute the expensive noise once per pixel at hit time rather than per march step.

### 7.9 Invisible category mismatch
If the shader reads `audioBass` but its category is `"Generator"`, the Audio Reactive filter misses it. Always match. See §6.

### 7.10 Runtime loop bounds
WebGL 1 requires loop bounds to be compile-time constants. The runtime parser (`src/lib/isf/parser.ts`) rewrites `for (int i=0; i<count; i++)` to `for (int i=0; i<64; i++)` with a hard cap when `count` is a uniform — but the fix is crude. **Always write your loops with a `const` / literal upper bound and `break` early:**

```glsl
for (int i = 0; i < 30; i++) {     // const bound — WebGL-safe
    if (i >= nodeCount) break;      // early-exit on the runtime value
    …
}
```

## 8. Performance budget

Target: **60 fps at 1080p on mid-range integrated GPUs** (Intel Iris, M1 base). That's ~16 ms / frame. Rough per-pixel budgets for what lives under that ceiling:

| Shader class | Per-pixel instruction ceiling |
|---|---|
| 2D generators (grids, plasma, voronoi) | ≤ 200 ops |
| Particle systems | N particles × constant-cost inner loop; ≤ 1 k ops total |
| Raymarched 3D SDFs | ≤ 60 march steps × ≤ 6 SDF primitives |
| Audio-reactive raymarch | Above + one audio lookup per SDF eval |

Post-audit, the heaviest **default** shaders sit around 4 k ops/pixel — acceptable but near the edge. If yours computes more than `80 march × 30 SDF calls`, profile before shipping.

**Quick perf wins** (actually used during the audit pass):
- `SAMPLES 400 → 200` for parametric curves (halves cost, no visible change).
- `MAX_STEPS 80 → 60` for raymarchers with most of their detail near the surface.
- FBM octaves `5 → 3` for surface displacement (the high octaves rarely survive tone mapping).
- Trail loops `5 → 3` with fade rescaled to `1/3` (particles still streak).

## 9. Pre-ship checklist

Run through this every time before you share or import your shader:

- [ ] Metadata block is **valid JSON** (paste into a JSON validator if unsure).
- [ ] `CREDIT` is real (not `"Your Name"`) or omitted entirely.
- [ ] `DESCRIPTION` matches what renders.
- [ ] Filename matches the aesthetic and description.
- [ ] `INPUTS` has **3–10** parameters with sensible `MIN`/`MAX`/`DEFAULT`/`LABEL`.
- [ ] `CATEGORIES` is exactly one of the six canonical values.
- [ ] Audio uniforms → category is `"Audio Reactive"` (non-negotiable).
- [ ] Every atan2 usage is downstream of either an integer-period trig or a cos/sin embedding.
- [ ] No division without a clamped denominator.
- [ ] No set-but-unused locals; no shadowed built-ins.
- [ ] Loops have const upper bounds (with runtime `if (i >= N) break;` guards).
- [ ] `SAMPLES`, `MAX_STEPS`, FBM octaves are inside the §8 budget.
- [ ] Dropped into the dev server: (a) compiles, (b) has no visible seams at default params, (c) stays above 30 fps at 1080p, (d) every parameter visibly changes the output.

## 10. Using your shader in Ghost Arcade

The shader library is **curated by the Ghost Arcade team** — users can't drop files into it directly. But you can use your own shaders in your own projects alongside the built-in library. Your shaders live in the project's Media Tray (not the global library), so they travel with the project file.

To use a shader you've authored:

1. In the app, open the **Media Tray** and click **Add Files** at the bottom.
2. Pick your `.fs` (or `.isf`) file. It appears under the **Shaders** tab.
3. Drag it onto a layer — or double-click — to apply. The sliders declared in your ISF header wire up automatically.
4. Save the project (`File → Save`). The shader is embedded in the project file, so reopening or sharing the project keeps it intact.

### For maintainers adding to the official library

This part is **not applicable to end users** — it describes how the Ghost Arcade team adds curated shaders to the shipped library. Leave the skill section here so AI assistants working on the repo understand the format:

```jsonc
// public/ISF/manifest.json — team-only
{
    "file": "YourShader.fs",
    "tier": "demo",                 // "demo" (free) or "pro" (license-gated)
    "category": "Generator",        // must match the ISF CATEGORIES entry
    "tags": [],
    "defaults": { "speed": 0.5 },   // curator-tuned preset overrides
    "featured": false,
    "defaultLoad": false,           // true = included in the curated 100 defaults
    "enabled": true                 // false = hidden (soft delete)
}
```

If you've written a shader worth sharing, post it in the Ghost Arcade community forums — great community contributions may get added to the official curated library in future updates.

## 11. Thumbnail

Thumbnails live at `public/ISF/thumbnails/YourShader.jpg`. They're regenerated by the curator tool (`tools/shader-admin/`) but you can also capture one manually (512×288 is the standard). The library card shows the thumbnail, so make it look like the hero moment of the shader, not an unflattering first-frame.

## 12. Reference files to copy-paste from

When you need a pattern, start from a known-good shader:

| Pattern | Reference |
|---|---|
| Clean 2D voronoi | `public/ISF/DM-CellularNoise.fs` |
| Well-optimized raymarcher | `public/ISF/organic-dimension.fs` (comment explicitly describes the optimization pass) |
| Audio-reactive SDF | `public/ISF/AR-DisplacementSphere.fs` |
| Parametric 3D curve | `public/ISF/37_TorusKnot.fs` (post-audit — SAMPLES=120 is the target) |
| Clean HSV palette | `public/ISF/mega-blob-fusion.fs` (7 hand-tuned palettes) |
| Proper kaleidoscope fold | `public/ISF/22_FractalAtomicFlower.fs` |
| Seamless tunnel | `public/ISF/fractal-tunnel-cosmos.fs` (mode 0 uses the cos/sin embedding from §7.1) |

## 13. When in doubt

If a rule above isn't clear, look at `src/lib/isf/parser.ts` and `src/lib/isf/renderer.ts` — that's the runtime truth. Anything that compiles there will ship.
