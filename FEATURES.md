# Ghost Arcade — Feature & Capability Reference

> Source-of-truth feature inventory for marketing direction, LLM-assisted copywriting, and open-source decisioning.
> **App version:** 0.3.9 · **Generated:** 2026-04-30 · **Schema:** Project file `.gha` v1.9.0

---

## 1. What it is, in one paragraph

**Ghost Arcade** is a desktop VJ + projection-mapping suite for live performance. It runs as a single Electron-packaged binary on Windows and macOS, drives multiple projectors with native edge-blending and dome modes, accepts mic + system-audio input for full audio reactivity, exposes every parameter to MIDI control, and ships with a 36-key Performer mode (SynthVision) plus a Resolume-style clip launcher with **per-block A/B dual decks** — a feature no other major VJ tool currently offers. AI shader generation (Claude + Gemini), AI video generation (Luma Ray 2 + Veo 2), and 127+ effects are built in. Mobile companion control is included out of the box via a local WebSocket bridge and QR pairing.

**Internal codename:** `Shrink Wrap` · **Bundle ID:** `com.shrinkwrap.app` · **Marketing name:** Ghost Arcade

---

## 2. Who it's for

| Audience | What they care about | What Ghost Arcade delivers |
|---|---|---|
| **Touring VJs** | Live clip launching, beat-tight transitions, MIDI controllers, multi-projector output | Dual-deck A/B with 10 transitions, quantized launch (1/4 → 4 bar), full MIDI Learn, Spout out, multi-output slicing |
| **Festival/event LDs** | Stage mapping, multiple screens, song-to-song scenes, fail-safe save format | Mapping mode with corner/mesh/bezier warps, 19 layer shapes, stage presets, .gha project save with backward-compat |
| **Performer-musicians** | Hands-free visuals while playing an instrument, beat sync, simple keyboard layout | SynthVision Performer mode (36 shaders × 14 worlds × 8 styles), DRIFT auto-evolve, BPM sync |
| **Visual artists / shader devs** | ISF compatibility, AI assistance, real-time iteration, custom effects | Full ISF 2.0 support, AI shader generation (Claude/Gemini), .dmfx.json plugin format, 127+ built-in effects |
| **Beginners / hobbyists** | Drag-drop simplicity, preset library, no manual reading | Drag-drop media tray, instant-launch mode, color-coded UI, in-app onboarding |

---

## 3. Tech stack & footprint

- **Runtime:** Electron 33 (Chromium 130 + Node 20)
- **UI:** Svelte 5.46
- **3D / WebGL:** Three.js 0.182 (MIT)
- **Recording:** @ffmpeg/ffmpeg (WebAssembly, LGPL via WASM boundary)
- **Mobile bridge:** Native WebSocket server (`ws` package, MIT) on port 9001
- **Build size:** ~180 MB unpacked
- **Platforms:** Windows (primary, Spout output) · macOS 13+ (Syphon framework prepared, not yet implemented)
- **License of dependencies:** All MIT / permissive. No proprietary SDKs bundled. AI provider API keys are user-supplied.

---

## 4. Top-level operating modes

| Mode | What the user does there |
|---|---|
| **Mapping Mode** | Build the projection layout: place screens, warp them onto physical surfaces, assign content, save as stage presets |
| **VJ Mode** | Live performance: trigger clips on a 4×8 grid (resizable), mix between two independent decks (A/B), apply effects per clip / per layer / per composition |
| **Performer Mode (SynthVision)** | Hands-free generative performance: 36-key layout where each key triggers a different shader, 14 procedural 3D worlds, drift + auto-cycle for self-running sets |

All three modes share the same audio source, same MIDI router, same project file, and same mobile-companion bridge — flip between them mid-set without losing state.

---

## 5. Mapping Mode features

### Output / Display
- **Multi-monitor + multi-projector slicing** — define independent output slices, each with its own crop region, rotation (0/90/180/270), brightness, gamma, contrast, and edge-blend gains
- **Spout sender (Windows)** — zero-copy GPU texture sharing to other Spout-aware apps (Resolume, vMix, OBS); legacy single-sender or per-slice multi-sender modes
- **Edge blending** — soft-edge blends per side (left/right/top/bottom) with adjustable gamma curve (default 2.2) for seamless multi-projector blends
- **Dome / fisheye projection** — angular, stereographic, orthographic, or equirectangular modes with FOV (90–360°), rotation, tilt, X/Y offset, curvature, and truncation
- **Color correction** — per-canvas AND per-output-slice brightness, gamma, contrast
- **Syphon (macOS)** — framework prepared, not yet implemented

### Warping
- **Corner pin** — 4-point quadrilateral warp
- **Mesh grid** — N×N draggable mesh for curved-surface mapping
- **Custom bezier shapes** — pen-tool drawn closed/open paths with `cpIn`/`cpOut` control handles per vertex
- **Layer transform** — independent position, scale, rotation, flipH, flipV per layer

### Layer shapes (19 total)
Rectangle, circle, ellipse, equilateral / isosceles / right triangle, polygon (3–12 sides), star (with adjustable inner radius), line (configurable lineWidth + lineCap), polyline, fully-custom bezier paths. All shapes support feather, scale, rotation, and invert.

### Masking & Cropping
- **Click-point polygon masks** with adjustable feather softness (0–1) and invert
- **Crop region** per layer (x / y / width / height, all 0–1 normalized)
- **Edge feather** as a dedicated effect for independent per-side feathering

### Layer types (10)
| Type | Use |
|---|---|
| `media` | Image / video / ISF shader / Three.js iframe / p5.js / JS animation / Spout / integrated effect / SynthVision |
| `lines` | Generative procedural strokes |
| `svg` | Animated SVG with 24+ fill modes (liquid, shimmer, particles, lightning, etc.) and 30+ tunable params |
| `color` | Solid HSL fill |
| `lightpainting` | 13 brush types (glow, neon, flame, electric, ribbon, particle, smoke, laser, calligraphy, spray, paintbrush, marker, watercolor) |
| `text` | Rendered text with 17 animation styles |
| `splat` | Point clouds + Gaussian splats (PLY / .splat) |
| `model3d` | GLTF / GLB / OBJ / FBX 3D models with skeletal animation playback |
| `screen` | VJ-bridge layer that pulls live output from a VJ deck for stage routing |
| `group` | Container with children; "unified" (one shader stretched across children) or "individual" (per-child) shader modes |

---

## 6. VJ Mode features

### The grid
- **Default 4 layers × 8 columns**, dynamically resizable up to 32 × 64
- **Multiple "blocks" per project** — each block is a complete A+B scene; switching blocks flips the entire grid (both decks, both clip grids) in lockstep
- **Drag-and-drop** from media library / shader library / saved presets
- **Right-click context menu** per cell: Edit / Preview, Copy, Paste, Clear

### Dual-deck A/B crossfader (unique to Ghost Arcade)
- Toggle the **A/B Crossfader** in the header → grid splits into **two side-by-side independent decks**
- Each deck has its own clipGrid, layerStates (opacity / blend / solo / mute / effects), and active clips
- **Vertical crossfader strip** between decks with **10 transition shaders**:
  - dissolve · wipe · rgb-split · cube · shatter · halftone · glitch · liquid · strobe · slide
- **3 fader response curves**: linear · constant-power · sharp-cut
- **Cut-A / Cut-B** snap buttons
- **Per-VJ-layer crossfade** in stage mode — each mapped Screen sees its own A/B mix of its assigned VJ layer (so different physical screens can show different VJ layers, each independently fading)
- **Per-block A+B persistence** — block 1 has its own A+B scene, block 2 a completely different one; switching blocks flips both decks together
- **All saved in the project file** (`.gha` v1.8) — re-open a project mid-mix and the fader position, transition choice, and Bank B clips are exactly where you left them

### Quantized clip launch
- Selectable grid: **OFF (instant)** / 1/4 / 1/2 / 1 bar / 2 bar / 4 bar
- Anchored to detected audio beats when audio is active; falls back to BPM-based virtual clock when audio is off
- **Pulsing orange border** on cells waiting to fire
- Click-queued-cell-again **cancels** the queued trigger (back-out without firing)
- **STOP ALL** flushes the queue (no time-bombs after panic)
- Header shows pending-trigger count
- **Per-bank routing** — queue Bank A on bar 1, Bank B on bar 2, both fire on schedule

### Mix vs Stage modes
- **MIX** — VJ output replaces the mapping layers entirely (full-screen visuals)
- **STAGE** — VJ deck drives `vjLayerIndex`-tagged Screen layers in the mapping; multiple physical screens can share a VJ layer, each crossfading independently. Group layers in mapping distribute the merged texture to all children.

### Layer controls (per deck)
Solo · Mute · Stop · Opacity (with optional MIDI/audio modulation) · Blend mode (15+ modes) · Effect chain · Live preview thumbnail · Drag-to-reorder

### Composition / Layer / Clip effects
Three independent effect slots — composition-wide, per-layer, or per-clip. All 127+ effects available at every level. Effects also right-click context: enable/disable, params, audio modulation per param.

### Recording
Record VJ output (with audio) directly to MP4 / WebM via in-app FFmpeg (WASM). Live recording indicator + duration in header. Pro-tier gated.

### Right-click resave UX
- Right-click a **block tab** → Save Project (Ctrl+S) / Rename / Duplicate / Delete
- Right-click a **stage preset** → Update Preset (overwrite with current scene) / Rename / Save Project / Delete
- Right-click a **SynthVision keyboard preset** → Update / Rename / Delete
- Eliminates the "delete + re-save under same name" workflow

### MIDI surface (VJ-specific paths)
| Path | What it controls |
|---|---|
| `vj:{layer}:opacity` / `vj-b:{layer}:opacity` | Per-layer opacity, Bank A / Bank B |
| `vj:{layer}:solo` / `mute` / `blend` | Per-layer state, both banks |
| `vj:{layer}:trigger:{col}` / `vj-b:{layer}:trigger:{col}` | Cell trigger, both banks |
| `vj:column:{col}` / `vj-b:column:{col}` | Whole-column trigger |
| `vj:block:{idx}` | Switch active block |
| `vj:crossfader:value` / `:transition` / `:curve` | Fader, transition selector, curve |
| `vj:crossfader:cut-a` / `cut-b` | Snap-to-A / snap-to-B buttons |
| `vj:quantize` | Cycle quantization grid (OFF→4bar) |
| `vj:quantize-clear` | Panic-flush queued triggers |
| `vj:stopall` | Stop both decks + clear queue |
| `vj:macro1` / `macro2` | Two assignable global macros |
| `vj:stage:{idx}` | Load stage preset |

---

## 7. Performer Mode (SynthVision)

A **36-key keyboard performance layer** designed for hands-free VJing while playing an instrument or DJing.

- **36 built-in shaders** mapped across 4 keyboard rows (1-0 / Q-P / A-L / Z-M)
- **14 procedural 3D worlds**: Particles, Cubes, Fractal, Terrain, Nodes, Fluid, Crystal, Vortex, Starfield, Organism, Aurora, DNA, Swarm, Rings — each with 6 tunable parameters
- **8 visual styles**: Neon, Mono, Outline, Lowpoly, Chrome, Void, Holo, Ember
- **6 camera spaces**: Orbit, Fly, Landscape, Tunnel, Zero-G, Fall
- **Camera input modes** (12): direct, lofi (pixelated VHS), thermal, edge (neon outlines), particles, ascii, liquid, lava, mirror, dna, datamosh, silhouette
- **12 spacebar trigger effects**: pump, shockwave, flash, zoom, twist, glitch, scatter, chromatic, strobe, ripple, pixelate, invert
- **DRIFT mode** — slowly randomizes all params over time (hands-free evolution)
- **SHADER AUTO** — auto-cycles to a new random shader / world at the configured interval
- **BPM SYNC** — all motion + auto-cycle ties to the global BPM
- **Saved presets** — both project-scoped and global (cross-project) keyboard layouts
- **Right-click on saved presets** → Update / Rename / Delete

---

## 8. Audio reactivity

- **Audio sources**: microphone (with device picker), system loopback (Windows WASAPI / macOS ScreenCaptureKit), audio file
- **Single source of truth UI**: `AudioInputPicker` component used identically in mapping mode, VJ mode, and Performer mode (no mode-specific toggles)
- **6-band FFT**: sub / bass / lowMid / mid / highMid / high (8-band split into kick + snare events on roadmap)
- **Beat detector** with `isBeat` events, `beatIntensity`, `timeSinceLastBeat`, `beatCount`
- **BPM auto-detection** + **manual tap tempo** (UI in both mapping top bar and VJ header)
- **Modulation engine** — assign any band / amplitude / beat-phase / LFO (sine/saw/square/tri) to drive any shader uniform, effect param, layer opacity, blend, splat / model3d property, or the global crossfader value
- **Curve + smoothing** per modulation route
- **Bank-aware modulation** — Bank B layers and effects are independent modulation targets
- **Crossfader as modulation target** — audio band drives the A/B fader directly (e.g. kick drum auto-snaps to Deck A)
- **Inline EQ tweaks panel** — click the FFT bars in the header to open sensitivity + smoothing controls + live per-band readout
- **Sensitivity** (0.2× → 3×) and **smoothing** (0 → 0.95) globally tunable

---

## 9. MIDI

- **WebMIDI** auto-discovery of all connected devices
- **MIDI Learn UI** — overlay shows every learnable control with its current binding; click → wiggle controller → bound
- **Three message types**: continuous CC, note on/off (toggle or momentary), discrete CC for dropdowns
- **Channel-specific routing**
- **Routing scopes**: `map:` (mapping params) / `vj:` (Bank A) / `vj-b:` (Bank B) / `sv:` (SynthVision)
- **MIDI clock receive/send** — framework prepared, not yet wired (roadmap)

---

## 10. Effects library — 127+ effects across 16 categories

Single source of truth at `src/lib/effects/effectCatalog.ts`.

### Core (free tier)
| Category | Examples |
|---|---|
| **Masking** | Vignette · Edge feather (per-side) |
| **Color** | Colorama · Plasma · Invert · Posterize · Exposure · Gamma · Vibrance · Temperature/Tint · Color Balance · Curves · Lift/Gamma/Gain · Thermal · Night Vision · Filmic Tonemap · Selective Color |
| **Stylize** | Dither · Edge Detect · Outline · Emboss · VHS · Glitch · RGB Shift · Scanlines · Pixelate · Halftone · Toon · Kuwahara · Oil Paint · Watercolor |
| **Blur & Focus** | Gaussian Blur · Sharpen · Directional Blur · Zoom Blur · Radial Blur · Tilt-Shift · Defocus Bokeh |
| **Light & Glow** | Bloom · Chromatic Aberration · God Rays · Halation · Anamorphic Streak · Lens Dirt · Diffusion Pro-Mist |
| **Generate & Texture** | Noise · Film Grain · Heat Haze · CRT |
| **Distort** | Kaleidoscope · Mirror · Wave · Fisheye · Lens Distortion · Displacement · Twirl · Pinch/Bulge · Polar Transform |
| **Keying** | Chroma Key · Luma Key · Difference Key · Erode · Dilate |
| **Analysis** | Blob Track · Blob Contour |

### Premium (all included — no separate tier)
- **Premium Color**: False Color · Shadow Recovery · Highlight Rolloff
- **Premium Stylize**: Compression Artifacts · ASCII · Comic Ink · Datamosh Lite · Scanline Drift · Tape Dropout
- **Premium Warp**: Ripple Caustics · Shockwave · Droste Recursive · Slit Scan · Fractal Warp · Fluid Distort · Wormhole
- **Premium Atmosphere**: Volumetric Fog Overlay · Rain/Fog/Snow Overlay · Particle Overlay FX · Glint Starburst · Emboss Relight
- **Premium Text**: Dot Matrix · Matrix Rain · Binary Code · Crosshatch · Block Mosaic · Number Grid · Braille Pattern · Circuit Board · Stained Glass · Woven Fabric · Mosaic Tile · Neon Outline
- **Premium 3D**: Explode 3D · Terrain 3D · Sphere/Cube/Cylinder Project · Torus Tunnel · Diamond Gem · Shatter 3D · Möbius Strip · Voxel Displace · Wave Surface · Prism Split · Origami Fold · Mirror Room · Geometric Tile · Hex Grid · Spiral Tile · Shingle Stack · Voronoi Shatter
- **Premium Depth**: Tunnel Flight · Infinite Mirror · Crystal Refract
- **Premium Trails**: Motion Trails · Echo Repeat · Ghost Double · Strobe Flash · Light Paint · Recursive Echo
- **Premium Feedback**: Feedback Zoom

### Custom user effects
`.dmfx.json` plugin format — users define a manifest with parameter definitions (slider / select / color / toggle), embed GLSL or JS, drop into the effect picker. Loadable per-project or globally.

---

## 11. Content sources

| Source | Format | Notes |
|---|---|---|
| **ISF Shaders** | .fs (GLSL ES 1.0 + JSON header) | ISF 2.0 spec compatible. 30+ built-in geometric shader pack ships with the app |
| **Three.js scenes** | iframe / inline JS | Pro-tier gated |
| **p5.js sketches** | iframe / inline JS | Pro-tier gated |
| **AI-generated shaders** | Text prompt → ISF shader | Powered by Claude (Opus 4.6 / Sonnet 4.6 / Haiku 4.5) or Gemini (3.1 Pro / 2.5 Flash / Pro / Lite) |
| **AI-generated video** | Text prompt → MP4 | Luma Ray 2 / Ray Flash 2 / Veo 2.0 |
| **Video files** | mp4, mov, webm, ogg, mkv | Trim start/end · loop / once / timelapse · variable playback rate |
| **Image files** | jpg, png, gif, webp, bmp | |
| **3D models** | .glb, .gltf, .obj, .fbx | Skeletal animation playback (`AnimationMixer`) |
| **Point clouds / splats** | .ply, .splat | Gaussian splat rendering + classic point cloud |
| **Spout sources** (Windows) | Live texture from another app | Receive Resolume, OBS, etc. as a clip |
| **Integrated WebGL plugins** | FluidGen, Particles3D, etc. | Pro-tier gated |
| **System screen capture** | "Screen" media type | |
| **Webcam** | Live camera feed with 12 effect modes | |

---

## 12. Project file format

- **Extension:** `.gha`
- **Schema version:** 1.8.0
- **Storage:** JSON (UTF-8) with embedded base64 for binary assets when saving
- **Backward compatible** with v1.5 / v1.6 / v1.7 saves (older versions still load; missing fields default safely)
- **What's saved:**
  - All mapping layers (warps, masks, crops, effects, sources)
  - All VJ blocks with both Bank A and Bank B clip grids per block
  - VJ layer states (opacity, blend, solo, mute, effects) for both banks
  - Crossfader state (enabled, value, transition, curve)
  - Quantization grid setting
  - Stage presets (project-scoped)
  - SynthVision keyboard presets (project-scoped)
  - Modulation assignments
  - Keyframe timelines
  - Composition-wide effects
  - Audio settings (sensitivity, smoothing, BPM override)
  - Master opacity, selected layer, and selected deck

- **What's NOT saved (session-only):** pending quantize triggers, live audio analysis, recording state, VJ live state, stage mode active flag

- **Save flow:**
  - **Ctrl+S** overwrites the loaded file in place (Electron native path tracking)
  - **Ctrl+Shift+S** opens Save As dialog
  - **Recent files** menu (last 8) tracks per-file thumbnails + paths
  - **Auto-save** to crash-recovery file
  - **Right-click any block tab / stage preset / SV preset → Save Project** for in-context save without hunting for the menu

- **Preset export** — separate `.json` for portable preset bundles (without project structure)

---

## 13. Keyframe timeline

- **Per-clip keyframe tracks** keyed by clip ID (so switching clips on a layer shows that clip's independent keyframes)
- **Auto-record** mode — arm a track, move a slider, keyframes lay down at current playhead position
- **Easing**: linear · ease-in · ease-out · ease-in-out · step · custom bezier
- **Numeric and boolean keyframes**
- **Playback engine** with rAF tick + looping
- **Timeline zoom** (default 40 px/sec)
- Keyframes survive clip switches (they're keyed per-clip, not per-layer)

---

## 14. Mobile companion

- **Local WebSocket server** on port 9001 (binary + JSON frames)
- **HTTP static** on port 9002 for the mobile UI
- **QR code pairing** — scan from any phone on the same network, no app store install required
- **Mobile UI modes**:
  - **Mapping** — drag corner-warp points directly with finger, fine-tune projector alignment from FOH
  - **VJ** — phone becomes a clip-launcher controller (keyboard layout simulator)
  - **Paint** — light painting with Apple Pencil pressure response, brush selection, color presets, real-time SVG stroke preview
- **Multi-client** — multiple phones can connect simultaneously (e.g. one for warp, one for clip launch)

---

## 15. AI features

| Feature | Provider | Models |
|---|---|---|
| **Shader generation** (text → ISF) | Anthropic Claude | Opus 4.6, Sonnet 4.6, Haiku 4.5 |
| | Google Gemini | 3.1 Pro, 2.5 Pro, 2.5 Flash, 2.5 Flash Lite |
| **Video generation** (text → MP4) | Luma | Ray 2, Ray Flash 2 |
| | Google | Veo 2.0 |

- **API keys are user-supplied** — stored in localStorage, never bundled
- **Provider-agnostic abstraction** — switching providers is a settings toggle, no code changes
- **Generated content saves to media library** with the original prompt as metadata
- **Demo tier** allowance: 3 generations/month with bundled keys; **Pro / own-keys** unlimited

---

## 16. Settings panel

| Section | What's tunable |
|---|---|
| **Recording** | Format (webm-vp9 / webm-vp8 / mp4-h264) · video bitrate · audio bitrate (default 128 kbps) · auto-download · save directory · include audio |
| **Output** | Spout enable / name / resolution · multi-slice config · per-slice rotation, crop, brightness, gamma, contrast, edge blend · dome mode + parameters |
| **UI** | Color scheme (Midnight Coral / Purple Green / Cyberpunk) · quality preset (low / med / high / ultra) · grid overlay · VJ layout reversed |
| **AI** | Provider selection · API keys (Claude, Gemini, Luma, Replicate) · model selection per provider |
| **Default Layer Shader** | Test pattern shown on new layers (crosshair / grid / outline / testpattern / none) |

---

## 17. Licensing tiers

| Tier | Includes |
|---|---|
| **Demo** | All core features with output watermark · 3 AI generations/month · no video export |
| **Starter** | (TBD) |
| **Pro** | All 127+ effects · Spout · video export · Three.js · p5.js · FluidGen · Particles3D · own AI API keys (unlimited) · advanced MIDI · output slicing |
| **Enterprise** | Pro + priority support |

10 feature gates currently exist:
1. premium-effects · 2. spout · 3. fluidgen · 4. particles3d · 5. threejs · 6. p5js · 7. own-api-keys · 8. midi-edit · 9. vj-slicing · 10. video-export

---

## 18. What makes Ghost Arcade different

These are the things no other VJ tool currently does, ranked by "actually unique" → "improved over the alternatives":

1. **Per-block A/B dual decks** — every "scene" in a project is its own complete A+B mix. Switch blocks → both decks flip together. No competitor has this; the closest is Resolume's column system but it's single-deck.
2. **Per-VJ-layer crossfading in stage mode** — when projecting onto multiple physical screens, each screen gets its own A/B mix of its assigned VJ layer. So your two side screens crossfade between A and B for layer 1 while the middle screen independently crossfades for layer 2.
3. **One source of truth for audio** — the same `AudioInputPicker` component renders identically in mapping, VJ, and Performer modes. Toggle audio on in one place, all three modes are live. Every other VJ tool has separate audio settings per mode.
4. **AI shader generation in-app** — text prompt → working ISF shader in seconds, with zero shader knowledge required. Anthropic Claude or Google Gemini.
5. **AI video generation in-app** — text prompt → MP4 video clip dropped straight into the media library. Luma Ray 2 or Veo 2.
6. **Mobile companion built-in** — no separate app to download, no MIDI bridge to configure. Scan a QR, your phone is a controller. Apple Pencil pressure works for live light painting.
7. **127+ effects, ISF + custom plugin format** — covers every visual style without leaving the app. Custom `.dmfx.json` plugin manifests for community-contributed effects.
8. **36-key Performer mode** — SynthVision is essentially a built-in second app for performer-musicians. 36 shaders × 14 worlds × 8 styles × 6 spaces. DRIFT for self-evolving sets.
9. **Quantized launch with per-deck queues** — beat-tight clip launches with OFF/instant always available for beginners. Per-bank queues mean you can stack drops on different bars across both decks.
10. **Color-coded UI** for dual-deck performance — cyan accents = Bank A, coral accents = Bank B, throughout the entire interface and even in the scrollbars. Visual muscle memory carries across mapping, VJ, and Performer.
11. **Native Spout output with multi-slice** — every other tool requires an external Spout sender plugin and doesn't offer per-slice color correction.
12. **Backward-compat project files** — v1.5/1.6/1.7 saves still open in v1.8. Performer-friendly: never breaks an existing show.
13. **Full ISF 2.0 compatibility** — drop in any ISF shader from interactiveshaderformat.com or VDMX libraries. Most tools have partial implementations or proprietary formats.

---

## 19. Roadmap

### Shipped in 0.3.x (most of section 19 — done)

- ✅ **MIDI clock receive** — sync to Ableton / drum machine / DAW (24 PPQN, auto-flows into master BPM)
- ✅ **MIDI clock send** — drive slaved devices at master BPM
- ✅ **8-band FFT** — sub / bass / lowMid / mid / highMid / treble / air / presence
- ✅ **Kick / snare separation** — adaptive-threshold onsets, exposed as `kick` + `snare` modulation sources
- ✅ **Macros (effect-bank)** — 8 wet/dry knobs, each driving a stack of effects on the composite output (right-click → add effects via the same picker as layer effects). MIDI route `vj:macro:N:value`.
- ✅ **Macro beat-pulse** — auto-cycle a macro at 1/4, 1/2, 1, 2, 4 bar with sine/tri/saw/square/pulse waveforms
- ✅ **Per-band gain** in EQ panel — 8 sliders for boosting kick / cutting harsh treble
- ✅ **Onboarding tour** — first-run walkthrough of all the above, re-triggerable from File → Show Feature Tour

- ✅ **Snapshots** — 16-slot bank that captures + recalls full live VJ state (per-layer opacity / blend / solo / mute on both decks, crossfader, quantization, master opacity, macro values). Right-click rename / overwrite / clear; MIDI route `vj:snapshot:N` for hardware recall.

### Still on the list

- **Ableton Link integration** — cross-platform tempo discovery (laptop + FOH MacBook + band's MPC auto-sync). Needs an Electron native module (`@ableton/link-rs` or similar). ~1 day port.
- **NDI sender** — alternative to Spout for cross-network video. Needs native NDI SDK binding.
- **Syphon (macOS)** — implementation of the framework that's already prepared. Native-bridge work.
- **Smart preset library** — community-shared shader / mapping / macro packs

---

## 20. Open-source considerations

### Why it would be safe to open-source
- **All runtime dependencies are MIT or LGPL** (FFmpeg via WASM is the only LGPL bit, used as a binary, not statically linked → safe per LGPL §6)
- **No bundled API keys** — Claude / Gemini / Luma keys are user-supplied via settings UI, stored in localStorage
- **No backend lock-in** — the entire app runs offline. The optional `server/ws-server.js` (mobile companion) is a 100-line script with no proprietary code
- **No analytics, no telemetry, no crash reporting service** currently configured
- **No payments SDK bundled** — Stripe is presumably handled out-of-band on the marketing site
- **No auth provider in the desktop app** — license verification is tier-flag-based, not OAuth

### Things to consider before publishing
- **Brand assets** — `logo.png`, the icon set, the "Shrink Wrap" / "Ghost Arcade" wordmarks. Strip from the OSS repo, or release with permission.
- **Bundled shader library** (310+ ISFs) — some are CC-BY remixes from interactiveshaderformat.com. Audit each for redistribution rights before bundling.
- **Feature gate system** — keep it as-is in OSS (so Pro-tier users get value), or flatten to a single-tier OSS edition? Easiest answer: OSS edition removes the gates, keeps the gate code dormant.
- **AI shader prompts** — the system prompts that turn text into ISF are arguably the secret sauce. Decide whether to ship them in the OSS repo or keep proprietary.
- **Mobile companion server** — currently bundled in the same repo. Could split into its own repo for a cleaner OSS surface.
- **Electron vs Tauri** — codebase has scaffolding for both. Electron is the shipped target. If going OSS, a Tauri build would cut the binary from ~180 MB to ~20 MB and feel more credible to OSS-leaning users. ~2 weeks of porting work.
- **License choice** — MIT is simplest. AGPL-3 protects against SaaS forks (useful if there's a commercial cloud version planned). GPL-3 is community-friendly but excludes proprietary plugins. Personal recommendation for a tool like this: **MIT or Apache 2.0** to maximize adoption.

### Hybrid model to consider
A common approach for tools like this:
- **Open-source the core** (mapping engine, VJ launcher, audio engine, effect catalog, ISF runner) → MIT
- **Keep proprietary**: the brand, the AI shader system prompts, advanced premium effects, the licensing gate, and the cloud features (if any)
- Users can compile from source with full functionality minus the AI prompt presets, OR install the official binary for the polish + AI prompts + brand

This gives you a credible OSS story for technical users while preserving the commercial moat.

### Other tools that pulled this off
- **OBS Studio** — fully OSS (GPL-2), commercial ecosystem grew around it (Streamlabs, Teleprompter, etc.)
- **Blender** — fully OSS (GPL-3), Blender Foundation funded by training + commercial support
- **Resolume Wire** (the node editor) — free / closed; main app is closed paid. Lost mind-share to TouchDesigner Free.
- **TouchDesigner** — closed paid, very strong commercial presence, but no community contributions to engine
- **VDMX** — closed paid, single developer, niche pro market

The OSS path historically grows community + plugin ecosystems faster but requires either a sustainable revenue model on top (services, support, hosted features) OR a sponsoring foundation. The closed-paid path keeps margins higher per-user but caps mind-share.

---

## 21. Marketing copy snippets — drop directly into other LLMs

### One-liner taglines
- **Ghost Arcade — the only VJ tool with two complete decks per scene.**
- **Mapping. VJ. Performer. One app, one timeline, one audio source.**
- **AI-generated shaders in seconds. Live for the whole show.**
- **From bedroom rehearsal to festival mainstage — no plugin chains, no sync headaches.**

### 30-second elevator pitch
> Ghost Arcade is a desktop VJ + projection-mapping tool that does three things no one else has put in one app: **per-block A/B dual decks** (every scene is its own complete A+B mix), **AI-generated shaders and video** built in (text prompt to live visual in seconds), and a **mobile companion** that pairs over a QR code so your phone is a controller out of the box. ISF-compatible, 127+ effects, full MIDI Learn, Spout output with edge blending and dome mode, and the only Performer mode in the category — a 36-key keyboard layer where each key is a different generative shader. Runs as a single 180 MB binary on Windows and macOS. Free tier with watermark, Pro tier unlocks recording + premium effects + Three.js / p5.js / FluidGen.

### Feature highlights for landing page bullets
- **Dual-deck A/B with 10 transitions** — fade between two completely independent decks like a DJ mixer
- **Quantized launch (1/4 → 4 bar, or instant)** — beat-tight drops with no setup
- **Stage mode + crossfader** — different physical screens get different per-layer A/B mixes simultaneously
- **AI shader & video generation** — Claude / Gemini / Luma / Veo, your keys, no monthly fee
- **Mobile control via QR code** — no app store install
- **Full ISF 2.0 + 127+ effects + .dmfx.json plugins**
- **Save once, reload exactly where you left off** — fader position, transition, both decks

### Audience-specific copy

**For touring VJs:**
> Tight beat-quantized launches that anchor to your detected beats. MIDI Learn anything (`vj:crossfader:value`, `vj-b:0:opacity`, `vj:quantize` — you name it). Spout out with multi-slice color correction so your projector blend doesn't fall apart at the edges. Save your show, reopen mid-set, the fader is exactly where you parked it.

**For festival LDs:**
> Stage mode bridges your VJ deck to physical screens. Two side screens on layer 1, middle screen on layer 2, each independently crossfading between A and B as you move one fader. Group layers distribute correctly. Every block is its own A+B scene — switch blocks for the next song, both decks flip in lockstep.

**For performer-musicians:**
> Performer mode (SynthVision) is a 36-key keyboard layer designed for live use. 36 shaders × 14 procedural 3D worlds × 8 styles × 6 camera spaces. DRIFT mode for hands-free evolution. Tap tempo from anywhere. Your visuals run themselves while you play.

**For shader devs / artists:**
> Full ISF 2.0 compatibility. AI shader generation from text prompts (Claude / Gemini). Custom `.dmfx.json` plugin format for community effects. Live param panel with audio modulation per uniform. Right-click any clip → live preview before you launch.

**For beginners:**
> Drag a video onto the grid. Click to play. Click another to switch. Add an effect. Done. Every advanced feature (quantization, dual decks, MIDI Learn) is opt-in — defaults are "instant trigger, single deck, no MIDI."

---

## 22. File / directory map (for your reference)

| Path | Contents |
|---|---|
| `src/lib/components/Canvas.svelte` | Main render loop · stage injection · per-VJ-layer crossfade dispatch |
| `src/lib/components/VJModePanel.svelte` | VJ Mode UI (header, dual decks, crossfader strip, clip cells) |
| `src/lib/components/SynthVision.svelte` | Performer mode UI |
| `src/lib/components/AudioInputPicker.svelte` | Shared audio source picker |
| `src/lib/components/AudioMeterPanel.svelte` | Header FFT meter + EQ tweaks popover |
| `src/lib/components/BpmTapWidget.svelte` | Shared TAP tempo + BPM readout |
| `src/lib/components/ClipPreviewPanel.svelte` | Right-click cell preview |
| `src/lib/stores/vjClipLauncher.ts` | VJ deck state · blocks · crossfader · quantization |
| `src/lib/stores/audio.ts` | Audio store · BPM · bands · beat events |
| `src/lib/stores/synthVision.ts` | Performer state · 14 worlds · 36 shaders |
| `src/lib/stores/layers.ts` | Project file save/load · stage presets · SV presets |
| `src/lib/stores/settings.ts` | All settings (output, recording, AI, UI, dome) |
| `src/lib/audio/analyzer.ts` | FFT engine · beat detection · BPM tracking |
| `src/lib/audio/modulation.ts` | Modulation engine (audio → params) · bank-aware |
| `src/lib/midi/midiRouter.ts` | MIDI dispatch (map / vj / vj-b / sv scopes) |
| `src/lib/renderer/engine.ts` | Three.js render pipeline · bank FBOs · crossfade material |
| `src/lib/renderer/crossfadeTransitions.ts` | 10 transition fragment shaders |
| `src/lib/effects/effectCatalog.ts` | 127+ effect registry |
| `src/lib/isf/` | ISF 2.0 parser + runtime |
| `src/lib/splat/` | PLY + Gaussian splat renderer |
| `src/lib/model3d/` | GLTF / GLB / OBJ / FBX renderer with animation |
| `server/ws-server.js` | WebSocket mobile companion server |

---

*End of feature reference. For the latest unpacked build, see `dist-electron-v8-quantize/win-unpacked/Ghost-Arcade.exe`.*
