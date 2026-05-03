# Shrink Wrap — Complete Product Overview

**Shrink Wrap** is a professional projection mapping, VJ performance, and real-time visual effects platform built as a native desktop application. It combines traditional projection mapping tools with AI-powered content generation, 3D rendering, point cloud visualization, and a full live performance system — all in a single integrated package.

- **Platform:** Windows (Mac planned)
- **Engine:** Tauri 2.9 + Three.js + WebGL
- **Version:** 0.1.0
- **Identifier:** com.shrinkwrap.app

---

## Table of Contents

1. [Layer System](#1-layer-system)
2. [Projection Mapping](#2-projection-mapping)
3. [ISF Shader Library](#3-isf-shader-library-310-shaders)
4. [Three-Body Orbital Dynamics Mega-Shader](#4-three-body-orbital-dynamics-mega-shader)
5. [Point Cloud & Gaussian Splat Engine](#5-point-cloud--gaussian-splat-engine)
6. [3D Model Renderer](#6-3d-model-renderer)
7. [Video & Image Support](#7-video--image-support)
8. [VJ Performer Mode (SynthVision)](#8-vj-performer-mode-synthvision)
9. [AI Content Generation](#9-ai-content-generation)
10. [Audio Reactivity & Beat Detection](#10-audio-reactivity--beat-detection)
11. [Fluid Simulation](#11-fluid-simulation)
12. [Particle System](#12-particle-system)
13. [SVG & Generative Drawing](#13-svg--generative-drawing)
14. [Light Painting](#14-light-painting)
15. [Text Rendering & Animation](#15-text-rendering--animation)
16. [Post-Processing Effects (81+)](#16-post-processing-effects-81)
17. [Mobile Remote Control](#17-mobile-remote-control)
18. [Spout Output Integration](#18-spout-output-integration)
19. [Project Management](#19-project-management)
20. [Performance & Rendering](#20-performance--rendering)
21. [Consumer Use Cases](#21-consumer-use-cases)

---

## 1. Layer System

Shrink Wrap uses a multi-layer compositing system where any number of visual sources can be stacked, blended, and independently controlled.

### Supported Layer Types

| Layer Type | Description |
|---|---|
| **Media** | Images, videos, ISF shaders |
| **Generative** | Vector drawing shapes with procedural fills and animations |
| **SVG** | Animated SVG content with fill modes and effects |
| **Color** | Solid color layers with HSL control |
| **Light Painting** | Freehand or pen-tool stroke animation with brush effects |
| **Text** | Rendered text with 3D extrusion, 17 animation styles |
| **Splat** | Point clouds, gaussian splats, PLY files with full 3D control |
| **Model3D** | GLTF, GLB, FBX 3D models with materials, animations, deformations |
| **Screen** | System/screen capture content |

### Layer Properties
- **Opacity:** 0–1 continuous
- **Position & Scale:** Normalized coordinate system
- **Rotation:** Full 360° rotation
- **Flip:** Horizontal and vertical mirroring
- **Content Fit:** Stretch, fill (cover), crop (contain)
- **Effects Chain:** Unlimited stacked post-processing effects per layer
- **Render Quality:** Per-layer quality multiplier (0.25x–1.0x) for performance tuning

### Blend Modes (26)

normal, multiply, screen, difference, add, subtract, overlay, darken, lighten, exclusion, hardlight, softlight, color-dodge, color-burn, hue, saturation, color, luminosity, divide, average, negation, phoenix, linear-light, hard-mix, vivid-light, pin-light

---

## 2. Projection Mapping

### Corner Pinning (4-Point Perspective Warp)
Click-and-drag any corner of a layer to apply real-time perspective correction. Maps rectangular content onto non-rectangular surfaces like buildings, furniture, or sculptural objects.

### Mesh Warping
Configurable subdivision grid (rows × columns) with per-point dragging for fine surface-conforming warps. Handles curved and irregular surfaces that corner pinning alone cannot address.

### Edge Blending
Independent feather controls on all four sides of each layer with adjustable softness (0–1). Enables seamless multi-projector setups where projected images overlap and blend smoothly at the seams.

### Layer Masking
Click-point polygon mask creation for each layer. Features include:
- Arbitrary polygon shapes (click to add vertices)
- Inverted mask option (show outside, hide inside)
- Feather/softness control for soft-edged masks

### Layer Shapes (19 Types)
Rectangle, Circle, Ellipse, Triangle (equilateral, isosceles, right), Polygon (3–12 sides), Star, Line, Polyline, Custom pen-tool shapes with Bezier curves. All shapes support rotation, feather, and scale.

### Multi-Projector Output
- Secondary output windows rendered to any connected display
- Spout output for integration with other projection software
- Per-layer rendering quality control for performance optimization

---

## 3. ISF Shader Library (310+ Shaders)

Shrink Wrap ships with over 310 ISF (Interactive Shader Format) fragment shaders — real-time GPU-accelerated visual generators that produce infinite, never-repeating visuals. Every shader runs at 60fps and responds to real-time parameter adjustments.

### Shader Categories

#### DM Series — Design & Motion (53 shaders)
Procedural visual generators covering the full spectrum of generative art:
- **Gradients & Color:** SolidColor, GradientWave, ColorBreath, PrismLight
- **Grids & Patterns:** GridMatrix, HexGrid, CircuitBoard, UVGrid, TestPattern, TestBars, SafeArea
- **Organic Motion:** PlasmaFlow, LiquidMetal, WaterRipple, SmokeWisp, FluidSimulation
- **Particle Systems:** FireParticles, ParticleVortex, PixelRain
- **Geometric:** Kaleidoscope, SacredGeometry, Spirograph, MorphingShapes, GeometricPulse, ConcentricRipples
- **Space & Cosmos:** Starfield, AuroraBorealis, WormholeTravel, DNAHelix
- **Energy & Electric:** EnergyField, ElectricStorm, LaserBeams, NeonLines, EdgeGlow, Spotlight
- **Fractal & Zoom:** FractalZoom, MandelbrotPulse, InfiniteZoom
- **Retro & Glitch:** GlitchBlocks, RetroSun, Oscilloscope, Strobe
- **Data & Networks:** NodeNetwork, DigitalRain, CellularNoise
- **Utility & Calibration:** CenterCrosshair, CornerPins, SpectrumWaves, WaveformBars

#### SM Series — Spatial & Motion-Reactive (42 shaders)
Physics-based simulations and reactive visual effects:
- **Physics Simulations:** BouncingBalls, GravityDropBalls, LavaLampBlobs, BubbleRise, SandClock
- **Liquid & Fluid:** LiquidFill, TidalPool, MoltenCore
- **Growth & Erosion:** VineCrawl, ErosionGrowth, CellularMitosis
- **Atmospheric:** SmokeChamber, RainDrops, AuroraCurtain, Fireflies
- **Electric & Energy:** ElectricFence, AsymmetricLightning, EdgePlasma, SeismicPulse
- **Structural:** FacadeCrack, BrickCollapse, ShatterGlass, SurfaceShatter
- **Depth & Space:** TunnelDepth, WireframeCorridor, GeometricAbyss
- **Nature & Science:** SpiderWeb, MagneticFilings, GravitationalLensing, SwarmIntelligence, BreathingMembrane
- **Interactive:** RippleTank, ConcentricEcho, PressureMap, TopographicFlood, RadarSweep
- **Games:** PongArena, RicochetLaser
- **Data:** DigitalRain, WaveformWalls, GyroscopeRings

#### AR Series — Audio-Reactive (20 shaders)
Designed specifically for music visualization and sound-driven performance:
- **Frequency Visualization:** FrequencyRings, FrequencyTerrain, WaveformHelix, WaveletDecomp
- **Sound Science:** CymaticPatterns (Chladni-style), Lissajous, DoublePendulum, HarmonicVoronoi
- **Organic Audio:** SpectralAurora, SmokeTendrils, Ferrofluid, SpectralFluid, ReactionDiffusion, CrystalGrowth
- **Geometric Audio:** SDFMorph, DisplacementSphere, TopoMesh, GeodesicBloom, MobiusStrip
- **Physics Audio:** StrangeAttractor (Lorenz, Rössler)

#### ThreeBody Series — Orbital Dynamics (31 shaders)
See [Section 4](#4-three-body-orbital-dynamics-mega-shader) for full details.

#### ROOM Series — Immersive 3D Environments (20 shaders)
2D-to-3D immersive room effects that create depth and atmosphere:
EmberDrift, SmokeLayers, LavaLampDepth, FireflyGarden, CrystalRain, NeonGrid, AuroraCurtains, ElectricTendrils, LiquidChrome, JellyfishFloat, StormCell, DustShafts, PortalVortex, PlasmaWalls, FogCathedral, CascadePour, SporeCloud, GlitchDepth, CosmicNebula, MoltenCore

#### 3D Series — Full 3D Object Generation (20 shaders)
Raymarched 3D scenes rendered entirely in the fragment shader:
SphereCluster, ChromeSpheres, WireframeGeo, CubeField, NeonCubes, MetaballBlob, FluidCube, OrganicSculpt, CrystalCluster, ShatteredCube, InfiniteHall, PlasmaSphere, TorusKnot, NebulaCloud, MorphCube, VoxelTerrain, BubbleMass, LatticeWorld, AbstractPillars, MoltenCore

#### Numbered Series (86 shaders)
Additional procedural generators spanning sacred geometry, fractals, orbital wireframes, neural networks, DNA helixes, lasers, terrain generation, tessellations, and cellular systems.

#### Legacy & Experimental (38 shaders)
Unique experimental shaders including crystal-dimension, fractal-dimension-supreme, organic-dimension, psychedelic-noise-flow, cosmic-wave, galaxy-of-universes, trippy-mandala, and more.

### ISF Input Types
Every shader exposes real-time controllable parameters:
- **Float** — Continuous slider with range and default
- **Bool** — Toggle switch
- **Long** — Dropdown selector with labeled options
- **Color** — RGBA color picker
- **Point2D** — XY coordinate control
- **Image** — Reference to another layer or media source
- **Event** — Momentary trigger button

---

## 4. Three-Body Orbital Dynamics Mega-Shader

The flagship shader system — a scientifically accurate simulation of periodic three-body gravitational orbits rendered as real-time generative art. Based on peer-reviewed solutions from Šuvakov-Dmitrašinović (2013) and Li-Liao catalogs of equal-mass periodic three-body solutions.

### 30 Orbit Types
Each orbit is a mathematically exact periodic solution where three equal-mass bodies orbit each other in repeating patterns:

Figure-Eight, Butterfly I, Butterfly II, Butterfly III, Star Weave, Infinity Cross, Clover Leaf, Lotus, Trefoil Knot, Celtic Braid, Crystal Star, Windmill, Crown Loop, Double Helix, Mandala, Dragonfly, Yin-Yang, Moth II, Moth III, Cascade, Labyrinth I, Labyrinth II, Vortex, Whirlpool, Galaxy Arm, Serpentine, Ribbon Dance, Pendulum, Solar Flare, Tidal Flow

### 12 Visual Effects Per Orbit
Each orbit can be rendered in any of 12 artistic styles:

| Effect | Description |
|---|---|
| Orbits | Clean trajectory paths |
| Ribbons | Volumetric flowing bands |
| Particles | Point-based rendering |
| Fire | Flame/thermal colors |
| Neon | Hard-edged glowing lines |
| Plasma | Energized plasma trails |
| Stardust | Glittering particle clouds |
| Wireframe | Geometric mesh lines |
| Kaleidoscope | Mirrored symmetries |
| Glitch | Digital corruption artifacts |
| Nebula | Soft cloud formations |
| Bloom | Soft glow rendering |

**30 orbits × 12 effects = 360 unique visual combinations** — all from a single consolidated shader.

### Quality Levels
- **Low:** 150 integration steps (fast, performance-friendly)
- **Medium:** 250 integration steps (balanced)
- **High:** 350 integration steps (ultra-detailed)

### Real-Time Parameters
- Simulation speed (0.05–3.0x)
- Camera zoom (0.3–5.0x)
- Trail thickness (0.1–3.0x)
- Glow intensity (0.2–5.0)
- Auto-rotation speed
- Manual 3D rotation (X/Y axes)
- Camera distance (2.0–20.0)
- Three independent color pickers for orbital path gradients

---

## 5. Point Cloud & Gaussian Splat Engine

Full 3D point cloud rendering and visualization engine powered by Three.js with custom GPU shaders.

### Supported Formats
- **PLY** — Standard point cloud format with vertex colors, normals, UV coordinates
- **.splat** — Native gaussian splat binary format (32 bytes per splat)
- **Multi-texture PLY** — Artec 3D scanner format with separate texture atlas and per-face UV mapping

### Render Modes (6)
Points, Spheres, Gaussians, Billboards, Cubes, Wireframe (connects nearby points with lines)

### Animation Types (13)
none, explode, implode, slice, voxelSnap, peel, gravity, swarm, morph, orbit, wave3d, scatter, spiral

### Displacement Effects (8)
none, noise (Perlin/simplex), audioReactive (driven by microphone), wave (sine propagation), glitch (random offset), wind (turbulent), magnetic (attraction/repulsion fields), ripple (from interaction point)

### Color Effects (13)
none, chromatic (depth-based shift), heatmap (density mapping), pointillist (cycling per-point), hologram (scan lines), rainbow (gradient mapping), audioColor (music-driven), depthGradient (Z-based), neon (glow), pastel (soft tones), cyberpunk (magenta/cyan), fire (flame palette), ice (frost palette)

### Opacity Effects (8)
none, depthOfField (focal plane blur), fog (volumetric), pulse (breathing), proximity (cursor reveal), dissolve (random in/out), scanReveal (line-based), audioFade (music-driven)

### Creative Effects (7)
none, feedback (temporal loops), kaleidoscope (mirrored), constellation (connect nearby points), datamosh (glitch aesthetic), pixelSort, echo (temporal ghosting)

### Mouse Interactions (5)
none, attract (pull points toward cursor), repel (push points away), swirl (rotate around cursor), reveal (show points near cursor)

### Texture Mapping
- 7 UV projection modes: Spherical, Cylindrical, Planar XY/XZ/YZ, Box, Native (from file)
- Image or video texture sources
- Blend control (0–1 mix between point colors and texture)
- Scale and offset controls
- Automatic native UV detection for PLY files with embedded coordinates

### Camera Controls
Auto-rotate, manual orbit (X/Y), roll (Z rotation), FOV, pan offset, distance, look-at target

### Physics
Gravity, friction, bounciness, turbulence, attractor strength and position

### Slice Plane
Interactive cutting plane on X/Y/Z axis with position, thickness, and animation modes (hide, reveal, isolate)

---

## 6. 3D Model Renderer

Full 3D model loading, rendering, and effects engine built on Three.js.

### Supported Formats
GLB, GLTF, OBJ, FBX — with automatic animation detection for skeletal and keyframe animations

### Material Types (15)
standard (PBR), wireframe, glass, chrome, hologram, lava, ice, neon, xray, toon, matcap, fresnel, dissolve, glitch, normal (visualization), depth

Each material has specific parameters:
- **Standard PBR:** Roughness, metalness, emissive color/intensity
- **Glass:** Index of refraction, transmission
- **Hologram:** Scanline density, flicker speed
- **Lava:** Flow speed, heat intensity
- **Toon:** Number of shading levels
- **Dissolve:** Noise scale, edge glow color

### Wireframe Modes (9)
none, classic, animated (flowing), glow (soft), neon (hard tubes), pulse (brightness), rainbow, dotted, thick

### Vertex Decorations (7)
none, spheres, cubes, pyramids, points, stars, diamonds — place geometry at every vertex of the model

### Deformation Types (15)
none, noise (Perlin), wave, twist, bend, taper, spherify, inflate, explode, implode, shatter, melt, pixelate (voxelize), jelly, breathe

### Animation Types (15)
none, rotate, orbit, bounce, swing, float, shake, spiral, fadeIn, scaleIn, unfold, assemble, grow, morphLoop, colorCycle, texturePan

### Echo/Trail Effects (17)
none, ghostTrail, motionBlur, afterimage, strobeCopies, stream, swarm, grid, radial, spiral, random, fountain, tornado, explosion, orbit, matrix, dna, kaleidoscope

### Rendering Styles (9)
solid, wireframeSolid, pointCloud, voxel, sketch, blueprint, holographic, thermal, ascii

### Lighting Presets (7)
studio (3-point), dramatic (high contrast), neon (colored rim), sunrise (warm), moonlight (cool), disco (animated colors), none

### Textures (3 Channels)
- **Diffuse:** Image, video, or shader texture with blend amount, UV scale, offset, rotation
- **Normal Map:** Surface detail without geometry
- **Emissive Map:** Self-illumination patterns

### Audio Reactivity
- Scale response, rotation response
- Deformation response, color response, emissive response
- Selectable frequency band per response: sub, bass, lowMid, mid, highMid, high, all

### File Animations
Automatic detection and playback of embedded skeletal/keyframe animations from GLTF/GLB/FBX files with speed control.

---

## 7. Video & Image Support

### Supported Formats
- **Images:** PNG, JPG, WebP, GIF, BMP
- **Video:** MP4, WebM, MOV, AVI

### Playback Modes
- **Loop:** Continuous repeat (default)
- **Once:** Single playback then stop
- **Timelapse:** Frame-by-frame stepping at configurable intervals (1–30 seconds)

### Playback Controls
- Play/pause toggle
- Playback speed multiplier
- Trim start/end (normalized 0–1)
- Manual frame stepping
- Duration and current time display

### Content Fit
- **Stretch:** Distort to fill layer dimensions
- **Fill:** Maintain aspect ratio, crop overflow
- **Crop:** Maintain aspect ratio, letterbox

All video and image layers support the full effects chain (81+ post-processing effects), all 26 blend modes, and all projection mapping features.

---

## 8. VJ Performer Mode (SynthVision)

A complete live visual performance system built into the application, designed for VJs, live performers, and interactive installations.

### Keyboard-Mapped Clip Launcher
36 keyboard slots arranged in 4 rows mirroring a QWERTY keyboard:
- **Row 1 (1–0):** 10 slots
- **Row 2 (Q–P):** 10 slots
- **Row 3 (A–L):** 9 slots
- **Row 4 (Z–M):** 7 slots

Each slot can be assigned any content type: ISF shaders, videos, images, Three.js animations, p5.js sketches, fluid simulations, particle systems, point clouds, or 3D models. Press a key to instantly trigger that visual.

### A/B Crossfader
Vertical crossfader between two decks (A and B) for smooth transitions between visual sources. Supports manual fading and snap-to-deck.

### 36 Built-In Mega-Shaders
Each mega-shader has 3–6 real-time controllable parameters for live tweaking:
Hyperspace, Fractal, Liquid Metal, Electric Storm, Hologram Grid, Neural Network, and 30 more unique generative effects.

### 3D Worlds (14 Environments)
Full 3D scenes rendered in real-time: PARTICLES, CUBES, FRACTAL, TERRAIN, NODES, FLUID, CRYSTAL, VORTEX, STARFIELD, ORGANISM, AURORA, DNA, SWARM, RINGS. Each world has 6 adjustable parameters (count, size, scale, speed, etc.).

### Camera Modes (12 Visual Effects)
Real-time webcam processing with:

| Mode | Description |
|---|---|
| DIRECT | Clean camera feed |
| LO-FI | Pixelated VHS glitch |
| THERMAL | Heat vision mapping |
| EDGE DETECT | Neon edge outlines |
| MOTION PARTICLES | Particles spawn from movement |
| ASCII | Real-time text character rendering |
| LIQUID FLOW | Motion creates flowing liquid |
| LAVA LAMP | Rising blobs react to motion |
| KALEID | Kaleidoscope mirroring |
| DNA HELIX | Double helix follows motion |
| DATAMOSH | Compression artifact glitch |
| SILHOUETTE | Body outline only |

### Camera Blend Modes (4)
ADD, SUBTRACT, MULTIPLY, NORMAL — control how the camera layer composites with shader content.

### Camera Spaces (6)
ORBIT, FLY, LANDSCAPE, TUNNEL, ZERO-G, FALL — different 3D camera behaviors for world navigation.

### Visual Styles (8)
NEON, MONO, OUTLINE, LOWPOLY, CHROME, VOID, HOLO, EMBER — global aesthetic filters applied to the entire output.

### SPACE Bar Effects (6 Triggers)
Momentary effects triggered by the spacebar for beat-synced accents:
- **Pump** — Intensity pulse
- **Shockwave** — Radial wave from center
- **Twist** — Spiral rotation
- **Chromatic** — RGB separation
- **Pixelate** — Blocky degradation
- **Strobe** — Flash effect

### Modulation System (9 Parameters)
Shader parameters can be dynamically modulated by audio or time:
CHAOS, SPEED, ZOOM, COLOR, GLOW, WARP, MIRROR, FEEDBACK, LOFI

### Shader Auto & Drift
- **Shader Auto:** Automatically cycles through ISF effects and 3D worlds at configurable intervals
- **Drift:** Smoothly evolves shader parameters toward random targets, creating constantly changing visuals without manual input

### Keyboard Presets
Save and recall complete keyboard assignments as named presets. Multiple presets stored persistently for different performance setups.

### VJ Clip Grid
4 layers × 8 columns (expandable to 32 layers × 64 columns). Per-clip solo/mute controls. Per-layer opacity, blend mode, and effect chains.

### Compositions
Save complete visual states (all layer settings, effects, parameters) as named compositions. Instant recall during performance.

---

## 9. AI Content Generation

Shrink Wrap integrates multiple AI systems for generating custom visual content directly within the application. No coding required — describe what you want in natural language and the AI generates production-ready shaders, animations, and videos.

### AI Providers

| Provider | Models | Use Cases |
|---|---|---|
| **Claude** (Anthropic) | Opus 4.6, Sonnet 4.6 | Shader generation, animation generation |
| **Gemini** (Google) | 3.1 Pro, 2.5 Flash | Shader generation, animation generation |
| **Luma** (Dream Machine) | Ray 2, Ray Flash 2 | AI video generation |
| **Veo** (Google) | Veo 2.0 | AI video generation |

### ISF Shader Generation
Describe a visual effect in plain English and the AI generates a complete ISF fragment shader:
- Full GLSL shader code with ISF metadata
- Automatic parameter extraction (sliders, toggles, color pickers)
- WebGL compilation validation
- Instant preview in the shader library
- Iterative refinement — describe changes to evolve the shader

### Three.js Animation Generation
AI creates complete HTML canvas animations with custom vertex/fragment shaders, parametric shapes, and 60fps rendering — all from a text description.

### p5.js Sketch Generation
Generate procedural art, interactive sketches, and generative animations using the p5.js framework. Instant preview with built-in parameter controls.

### AI Video Generation
Generate short video clips from text prompts or reference images:
- **Luma Ray 2:** Up to 9 seconds, up to 4K resolution, multiple aspect ratios (16:9, 9:16, 1:1, 4:3, 21:9), loop enhancement, keyframe support
- **Luma Ray Flash 2:** Faster generation at lower cost
- **Google Veo 2.0:** 5–8 second clips, 16:9 and 9:16 aspect ratios

### BYOK (Bring Your Own Key)
Users can enter their own API keys for any provider. Advanced users who prefer to manage their own AI costs can bypass any credit system entirely.

---

## 10. Audio Reactivity & Beat Detection

Every visual element in Shrink Wrap can respond to music and sound in real-time.

### Audio Input
- Microphone input (WebAudio API)
- System audio capture
- File playback

### Frequency Band Analysis (6 Bands)
| Band | Range | Typical Sound |
|---|---|---|
| Sub | 20–60 Hz | Sub bass rumble |
| Bass | 60–250 Hz | Kick drum, bass guitar |
| Low Mid | 250–500 Hz | Low vocals, warmth |
| Mid | 500–2,000 Hz | Vocals, snare presence |
| High Mid | 2,000–4,000 Hz | Presence, clarity |
| High | 4,000–20,000 Hz | Cymbals, air, hi-hats |

### Beat Detection
- Real-time beat trigger detection
- Beat intensity measurement (0–1)
- Time since last beat
- Beat counter
- Beat phase (0–1 smooth cycling for animation sync)
- Automatic BPM estimation with confidence rating
- Dynamic range: 60–200 BPM with history-based smoothing

### Audio-Responsive Features
- **Point cloud displacement** reacts to specific frequency bands
- **Point cloud color cycling** driven by audio level
- **Point cloud opacity** fades with the music
- **3D model scale, rotation, deformation, color, and emissive** all map to audio
- **Fluid simulation intensity** responds to sound
- **Particle system count and speed** driven by audio
- **All 81+ effects** support audio envelope modulation
- **VJ performer mode** has full BPM-sync and audio modulation

### Layer Sequencer
Beat-synced or fixed-time layer visibility sequencing:
- Pattern presets: snake, every-other, random, custom
- Crossfade between patterns
- BPM synchronization
- Automatic pattern cycling

---

## 11. Fluid Simulation

Real-time GPU-accelerated fluid dynamics simulation with multiple visual modes.

### Render Modes (5)
| Mode | Description |
|---|---|
| SMOKE | Grayscale smoke plumes |
| FIRE | Flame colors (orange/yellow/white gradient) |
| INK | Colored fluid propagation |
| NEON | Bright neon glow trails |
| THERMAL | Heat map color visualization |

### Physics Parameters
- **Viscosity** (0.00001–0.01): Fluid thickness/resistance
- **Vorticity** (0–50): Spinning motion intensity
- **Dissipation** (0–0.1): Energy loss per frame
- **Velocity Dissipation** (0–0.1): Motion damping
- **Pressure Iterations** (20–50): Simulation quality/accuracy
- **Curl** (0–50): Swirl intensity

### Visual Parameters
- Intensity (0.5–3.0)
- Contrast (0.5–2.0)
- Saturation (0–1)
- Hue Shift (0–1)
- Glow (0–1)

### Interaction
- Mouse/touch input for force injection
- Audio-reactive intensity
- Usable as a standalone layer or as a VJ clip source

---

## 12. Particle System

3D particle simulation engine with multiple rendering modes and physics behaviors.

### Particle Modes (4)
| Mode | Description |
|---|---|
| SPHERES | 3D sphere geometry particles |
| TENDRILS | Flowing particle trails |
| VOXELS | Minecraft-style cubic particles |
| POINTCLOUD | Simple point geometry |

### Parameters
- **Count:** Density (auto-scales with resolution)
- **Size:** 1–100 pixels
- **Speed:** 0–20+ units/second
- **Audio Reactivity:** 0–1 sensitivity to microphone input
- **Mouse Influence:** 0–1 cursor attraction/repulsion
- **Turbulence:** 0–1 chaos factor
- **Color A / Color B:** RGB gradient endpoints

### Physics Behaviors
- Gravity-based falling and floating
- Boid-like flocking (swarm intelligence)
- Collision detection
- Wind and force fields
- Mouse repulsion and attraction
- Trail rendering and motion blur

---

## 13. SVG & Generative Drawing

### Drawing Shapes (19 Types)
Line, Polyline, Freehand (with smoothing and pressure sensitivity), Point-Click Line, Circle, Ellipse, Rectangle, Rounded Rectangle, Triangle, Polygon (3–12 sides), Star, Arc, Ring, Spiral, Wave, Bezier, Text

### Fill Modes (7)
| Mode | Description |
|---|---|
| Solid | Single color fill |
| Gradient | Linear gradient with angle and spread |
| Shimmer | Animated sparkle effect |
| Pulse | Expanding ring animation |
| Noise | Procedural texture fill |
| Particles | Particle emitter fill |
| Liquid | Flowing liquid animation |

### Color Modes (6)
perShape (individual colors), rainbow (hue cycling), monochrome, complementary, analogous, white

### SVG Animations (20+ Types)
Outlines, liquid fill, particle systems, edge particles, energy pulses, connections, glow nodes, ripples, lightning bolts, edge flow, inner glow, nebula effects, heartbeat pulsing, plasma tendrils, particle linking, echo layers, arc bridges

### Edge Effects
Programmable fill, stroke, and animation on shape edges with independent blend modes. Supports all 7 fill modes on edges separately from shape fills.

### Drawing Parameters (80+)
Full control over fill mode parameters, color cycling speed, animation properties, and post-processing (bloom, chromatic aberration, vignette) per generative layer.

---

## 14. Light Painting

Long-exposure style light trail drawing with animated playback — simulates the effect of waving lights in front of a camera with a long shutter speed.

### Brush Types (8)
| Brush | Description |
|---|---|
| Glow | Soft, diffuse long-exposure trails |
| Neon | Hard-edged tube effect |
| Flame | Flickering fire trail |
| Electric | Lightning/spark trail |
| Ribbon | Flat 3D-twisting ribbon |
| Particle | Dotted point trail |
| Smoke | Wispy, diffuse trail |
| Laser | Thin, sharp beam |

### Brush Properties
- Primary and secondary color (for gradient glow halos)
- Size (1–100 pixels)
- Opacity (0–1)
- Glow intensity (0–5)
- Softness (0–1)
- Jitter (random position noise)
- Taper (thin stroke endpoints)
- Pressure sensitivity toggle

### Drawing Modes
- **Freehand:** Continuous smooth path
- **Pen:** Bezier anchor points with control handles

### Animation Controls
- Loop modes: forward, reverse, ping-pong, once
- Animation speed (0.1–5x)
- Trail length / persistence (0–1)
- Draw speed (0.1–10x playback rate)
- Stagger strokes (sequential playback with configurable delay)

### Global Light Painting Effects (20+ Parameters)
Bloom, motion blur, afterglow, color shift over time, echo copies (1–10 with decay), snake drawing (head-proportional reveal), multi-color glow, pulse (brightness animation), strobe, wave distortion, sparkle particles, flicker, breathing (size oscillation)

---

## 15. Text Rendering & Animation

### Text Properties
- Font family (system fonts), size, weight (100–900), style (normal/italic)
- Fill color, stroke color with width
- Alignment (left, center, right)
- Letter spacing, line height
- Background color
- Shadow (color, blur, offset)

### Text Animations (17 Types)
| Animation | Description |
|---|---|
| none | Static text |
| ticker | Horizontal marquee scroll |
| letterReveal | Letters appear one by one |
| typewriter | Classic typewriter with cursor |
| fadeInLetters | Each letter fades in sequentially |
| waveY | Vertical sine wave per letter |
| waveX | Horizontal sine wave per letter |
| elastic | Bouncy spring physics |
| scramble | Random characters resolve to correct text |
| glitch3d | RGB split with perspective distortion |
| perspective3d | 3D rotation effect |
| flipLetters | Y-axis letter rotation |
| spiralIn | Letters spiral inward to position |
| explode | Letters burst apart and reassemble |
| liquid | Fluid warp distortion |
| neonPulse | Glow intensity cycling |
| matrixRain | Cascading character rain |
| bounce | Physics-based dropping |

### Animation Parameters
Speed multiplier, loop toggle, direction (forward/reverse/alternate), stagger delay (per-letter timing), intensity (effect strength 0–1)

### 3D Text Extrusion
- Enable/disable 3D mode
- Extrude depth (0–100 pixels)
- Extrude color (side face color)
- Rotation X/Y/Z (isometric angles)
- Light angle (0–360°) and intensity (0–1)
- Bevel size (0–10 pixel edge highlight)

---

## 16. Post-Processing Effects (81+)

Every layer supports an unlimited chain of stacked post-processing effects with per-effect opacity and blend mode control.

### Masking (2)
Vignette (with roundness control), Edge Feather (independent per-side)

### Color (15)
Colorama (cosine palette), Plasma, Invert, Posterize, Exposure, Gamma, Vibrance, Temperature Tint, Color Balance, Curves, Lift Gamma Gain, Thermal, Night Vision, Filmic Tonemap, Selective Color

### Stylize (14)
Dither (4 modes), Edge Detect (4 modes), Outline, Emboss, VHS (tracking/noise/distortion), Glitch (RGB split/jitter), RGB Shift, Scanlines, Pixelate, Halftone, Toon (cel-shading), Kuwahara, Oil Paint, Watercolor

### Blur & Focus (7)
Blur, Sharpen, Directional Blur, Zoom Blur, Radial Blur, Tilt Shift, Defocus Bokeh

### Light & Glow (7)
Bloom, Chromatic Aberration, God Rays, Halation, Anamorphic Streak, Lens Dirt, Diffusion Promist

### Generate & Texture (4)
Noise (static/animated), Film Grain, Heat Haze, CRT (monitor scanlines)

### Distort (9)
Kaleidoscope, Mirror, Wave, Fisheye, Lens Distortion, Displacement, Twirl, Pinch/Bulge, Polar Transform

### Keying (5)
Chroma Key (green/blue screen), Luma Key (brightness), Difference Key, Erode, Dilate

### Premium Color (3)
False Color, Shadow Recovery, Highlight Rolloff

### Premium Stylize (6)
Compression Artifacts, ASCII, Comic Ink, DataMosh Lite, Scanline Drift, Tape Dropout

### Premium Warp (4)
Ripple Caustics, Shockwave, Droste Recursive, Slit Scan

### Premium Atmosphere (5)
Volumetric Fog, Rain/Fog/Snow Overlay, Particle Overlay, Glint Starburst, Emboss Relight

### Premium Text & Pattern (12)
Dot Matrix, Matrix Rain, Binary Code, Crosshatch, Block Mosaic, Number Grid, Braille Pattern, Circuit Board, Stained Glass, Woven Fabric, Mosaic Tile, Neon Outline, Pixel Sort, Linocut, Topo Map, LED Wall

### Premium 3D & Advanced (10)
Explode 3D, Terrain 3D, Sphere Project, Cube Project, Tunnel Flight, Infinite Mirror, Fractal Warp, Crystal Refract, Feedback Zoom, Fluid Distort, Wormhole, Geometric Tile

### Premium Trails & Echo (6)
Motion Trails, Echo Repeat, Ghost Double, Strobe Flash, Light Paint, Recursive Echo

### VJ Quick Controls (4)
Brightness, Contrast, Saturation, Hue — fast per-layer adjustments

---

## 17. Mobile Remote Control

Control Shrink Wrap from any mobile device via a WebSocket-based remote control system.

### Connection
- QR code scanning from the desktop app
- Automatic network discovery
- Real-time state synchronization with low latency

### Mobile Control Surfaces
| Panel | Controls |
|---|---|
| **VJ Clip Grid** | Tap to trigger clips, visual feedback for active clips |
| **Mixer Strip** | Per-layer opacity faders, blend mode selection |
| **XY Fader** | Smooth 2D control pad for parameter mapping |
| **Shader Parameters** | Real-time faders for all ISF shader inputs |
| **Effects Panel** | Add, remove, and edit effect chains |
| **Master Section** | Crossfader, master opacity, global controls |
| **Block Selector** | Switch between clip pages/banks |
| **Column Triggers** | Fire entire columns of clips simultaneously |

### Network Protocol
JSON messages over WebSocket with real-time bi-directional state synchronization. Desktop acts as host; any number of mobile devices can connect as controllers.

---

## 18. Spout Output Integration

### Spout Sender
Send Shrink Wrap's output to any Spout-compatible application in real-time:
- **OBS Studio** — for streaming and recording
- **vMix** — for broadcast production
- **Resolume** — for multi-source VJ setups
- **TouchDesigner** — for interactive installations
- **Any Spout receiver** — zero-latency GPU-to-GPU texture sharing

### Output Resolutions
- Match Canvas (same as project resolution)
- 1080p (1920×1080)
- 4K (3840×2160)

### Spout Receiver
Embed external Spout sources as layers within Shrink Wrap:
- FluidGen plugin output
- Particles3D plugin output
- Any external Spout sender

---

## 19. Project Management

### Save & Load
Complete project serialization including all layers, settings, effects, media references, and VJ assignments.

### Compositions
Named snapshots of complete visual states. Save any number of compositions and recall them instantly during performance.

### Stage Presets
Save VJ mapping layer assignments for different venue configurations.

### Media Library
Organized collection of videos, images, shaders, and generated content with:
- Folder organization
- Search and filtering
- Thumbnail previews
- Drag-and-drop to canvas or clip slots

### Undo/Redo
Full action history for non-destructive editing.

### Multi-Layer Selection
Click, Shift+click (range), Ctrl+click (toggle) for batch operations on multiple layers simultaneously.

---

## 20. Performance & Rendering

### GPU Optimization
- Forces discrete GPU usage on NVIDIA Optimus and AMD PowerXpress laptops
- WebGL 2.0 with hardware-accelerated rendering
- GPU rasterization and zero-copy enabled
- Hardware overlay support

### Quality Scaling
- Per-layer render quality multiplier (0.25x–1.0x)
- Global shader quality settings (full, half, quarter resolution)
- Adaptive performance scaling

### Canvas Configuration
- Custom dimensions from 128 to 7,680 pixels
- Presets: 1920×1080, 1080×1920, 1080×1080, 1024×768, 3840×2160, 1280×720

### Output
- Real-time output window on secondary displays
- Spout sender for external application integration
- Full-resolution rendering at 60fps

### Startup
- Shader library preloaded at boot for instant access
- Splash screen with loading progress
- Application ready to perform the moment it opens

---

## 21. Consumer Use Cases

### Live VJ Performance
Shrink Wrap replaces traditional VJ software (Resolume, MadMapper) with a keyboard-driven performance system. Trigger 36 visual clips instantly, crossfade between decks, modulate parameters with audio, and control everything from a mobile device. The 310+ built-in shaders mean performers never run out of content.

### Architectural Projection Mapping
Map content onto buildings, stages, and sculptural objects using corner pinning and mesh warping. Edge blending enables multi-projector setups for large-scale installations. Layer masking allows content to be precisely fitted to architectural features.

### Live Music & Concert Visuals
Audio-reactive shaders and beat detection create visuals that respond naturally to music. 6-band frequency analysis lets different elements respond to different parts of the mix. BPM sync locks animations to the beat. Camera modes add performer interaction.

### Interactive Art Installations
Point cloud and 3D model support enable immersive data-driven art. Mouse interaction modes (attract, repel, swirl, reveal) create responsive installations. Webcam processing with motion detection adds audience participation.

### Event Production
Pre-programmed compositions can be recalled instantly for corporate events, weddings, and stage shows. The project save/load system enables complex multi-scene setups. Output windows drive projectors directly.

### Content Creation & Motion Graphics
AI shader and video generation enable rapid prototyping of visual content. The 81+ effects chain replaces standalone compositing software. Light painting and text animation create unique motion graphics elements.

### Education & Science Visualization
The Three-Body orbital dynamics shader makes peer-reviewed physics research visually accessible. Point cloud support enables scientific data visualization. The ISF shader format is an industry standard used in academic creative coding.

### Nightclub & Venue Installation
Permanent installations benefit from the auto-cycle and drift features that generate constantly evolving visuals without operator input. Spout output integrates with existing venue AV systems. Mobile remote allows staff to control visuals from anywhere in the venue.

### Worship & Houses of Worship
Text rendering with animations provides lyric display capabilities. Ambient generative visuals create atmosphere. Multi-projector support covers wide stage designs. Pre-programmed compositions allow non-technical operators to run complex visual sequences.

### Film & Video Production
Chroma key, luma key, and difference key effects enable real-time compositing. The fluid simulation and particle system create practical-effect alternatives. Screen capture layers enable picture-in-picture workflows.

---

## Technical Summary

| Metric | Value |
|---|---|
| ISF Shaders | 310+ |
| Three-Body Orbits | 30 (× 12 effects = 360 combinations) |
| Blend Modes | 26 |
| Post-Processing Effects | 81+ |
| Point Cloud Effects | 49 (13 color + 8 opacity + 7 creative + 13 animation + 8 displacement) |
| 3D Model Materials | 15 |
| 3D Model Deformations | 15 |
| 3D Model Animations | 15 |
| 3D Model Echo/Trail Effects | 17 |
| Text Animations | 17 |
| Light Painting Brushes | 8 |
| SVG Fill Modes | 7 |
| SVG Animations | 20+ |
| Drawing Shapes | 19 |
| Camera Visual Modes | 12 |
| Fluid Sim Modes | 5 |
| Particle Modes | 4 |
| Audio Frequency Bands | 6 |
| VJ Keyboard Slots | 36 |
| 3D Worlds | 14 |
| Spacebar Effects | 6 |
| AI Providers | 4 (Claude, Gemini, Luma, Veo) |
| Supported File Formats | 15+ (PLY, .splat, GLB, GLTF, FBX, OBJ, MP4, WebM, MOV, AVI, PNG, JPG, WebP, GIF, BMP) |
