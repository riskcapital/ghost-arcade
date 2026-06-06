# Mobile Shader Curation

Audience: unskilled VJs on a Capacitor-wrapped mobile app. Pool: ~483 `.fs` files across `CuratedISF/`, `ISF/`, `public/ISF/` (the canonical pool). Audio uniforms actually used in the codebase: `audioBass, audioMid, audioHigh, audioLevel, audioBeat` (most common), plus `audioSpectralCentroid` and `audioFFT` in a few. Standard ISF `FFT` sampler is virtually unused — everything is scalar uniforms.

## SHIP-AS-IS (20 picks)

All audio-reactive, all ≤20-iter loops, all 2D (no raymarching).

| File | Why pick | Audio uniforms |
|---|---|---|
| public/ISF/AR-FrequencyRings.fs | Spectrum rings pulsing outward — instantly readable as audio | audioBass, sampleFFT |
| public/ISF/AR-CymaticPatterns.fs | Chladni-style standing waves, hypnotic, single-pass | audioBass, audioMid, audioHigh |
| public/ISF/AR-SpectralAurora.fs | Aurora ribbons modulated by spectrum — gorgeous and cheap | audioBass, audioMid, audioHigh |
| public/ISF/AR-Lissajous.fs | Clean curves, classic audio toy, 2 small loops | audioBass, audioHigh |
| public/ISF/AR-WaveformHelix.fs | Twisting waveform ribbon, 2 small loops | audioWaveform, audioLevel |
| public/ISF/AR-ReactionDiffusion.fs | Turing-pattern morph, only 5/6-iter loops | audioBass, audioMid |
| public/ISF/AR-CrystalGrowth.fs | Crystal facets bloom on beat, ≤6-iter loops | audioBeat, audioBass |
| public/ISF/AR-HarmonicVoronoi.fs | 3x3 voronoi cells pulsing with mids — lush color | audioMid, audioBeat |
| public/ISF/AR-TopoMesh.fs | Topographic contour lines breathing, 5-iter fbm | audioBass, audioMid |
| public/ISF/AR-WaveletDecomp.fs | Multi-band bars, very legible "music meter" vibe | audioFFT, audioLevel |
| public/ISF/AR-StrangeAttractor.fs | Lorenz/aizawa trails — mesmerizing | audioBass, audioBeat |
| public/ISF/cube shaders/ROOM_07_AuroraCurtains.fs | Atmospheric aurora — beat-pumped curtains | audioBeat, audioHigh |
| public/ISF/cube shaders/ROOM_01_EmberDrift.fs | Floating embers, warm + beat-reactive | audioBeat, audioHigh |
| public/ISF/cube shaders/ROOM_19_CosmicNebula.fs | Deep-space twinkle + nebula gas | audioBeat, audioHigh |
| public/ISF/cube shaders/ROOM_11_StormCell.fs | Lightning flashes on transients | audioBeat, audioHigh |
| public/ISF/cube shaders/ROOM_05_CrystalRain.fs | Falling crystals with bass thump | audioBeat, audioBass |
| public/ISF/cube shaders/ROOM_15_FogCathedral.fs | Volumetric god rays | audioBeat, audioHigh |
| public/ISF/cube shaders/ROOM_10_JellyfishFloat.fs | Glowing jellies — beat propagates as pulse rings | audioBeat, audioHigh |
| public/ISF/cube shaders/ROOM_02_SmokeLayers.fs | Layered smoke parallax, hypnotic | audioBeat, audioHigh |
| public/ISF/cube shaders/ROOM_17_SporeCloud.fs | Bioluminescent particles, dreamy | audioBeat, audioHigh |

## AUGMENT (16 picks)

Visually strong, GPU-cheap, no audio. Inject the bracketed lines just after the input declarations.

| File | Why pick | Where to inject audio |
|---|---|---|
| public/ISF/DM-PlasmaFlow.fs | Classic flowing plasma, 0 loops | `speed *= 1.0 + audioBass*1.5; hueOffset += audioBeat*0.1;` |
| public/ISF/DM-Kaleidoscope.fs | Symmetric eye-candy | `speed *= 1.0 + audioMid*2.0;` rotate on `audioBeat` |
| public/ISF/DM-AuroraBorealis.fs | Soft moving curtains, 5-iter | `intensity *= 1.0 + audioHigh*1.5;` |
| public/ISF/DM-LiquidMetal.fs | Chrome ripples, 5-iter | `flow += audioBass*0.4; reflect += audioHigh*0.3;` |
| public/ISF/DM-VoronoiFlow.fs | 3x3 voronoi — beautiful color | `scale *= 1.0 + audioBass*0.5;` |
| public/ISF/DM-RadialPulse.fs | Already-shaped for audio reactivity | `pulseScale *= 1.0 + audioBeat*0.8;` |
| public/ISF/DM-EnergyField.fs | Electric tendrils, 6-iter | `intensity *= 1.0 + audioMid*1.5;` |
| public/ISF/DM-Tunnel.fs | Endless tunnel — easy `speed` hook | `speed *= 1.0 + audioBass*2.0;` |
| public/ISF/DM-NeonLines.fs | 20 scrolling lines, glowy | `lineWidth *= 1.0 + audioHigh*0.6;` |
| public/ISF/SM-Fireflies.fs | 60 drifting fireflies, pulsing | `pulseRate *= 1.0 + audioBeat*1.5; glowRadius *= 1.0 + audioBass*0.8;` |
| public/ISF/SM-LavaLampBlobs.fs | Slow blobs, 10-iter | `blobScale *= 1.0 + audioBass*0.4;` |
| public/ISF/SM-AuroraCurtain.fs | Curtain alternative — different palette | `swayAmount *= 1.0 + audioMid*1.5;` |
| public/ISF/SM-RippleTank.fs | Concentric ripples, 6-iter | trigger new ripple on `audioBeat` |
| public/ISF/SM-MagneticFilings.fs | Iron-filing field lines | `fieldStrength *= 1.0 + audioBass*0.8;` |
| public/ISF/SM-BouncingBalls.fs | 12 balls — bounce on bass | `gravity += audioBass*2.0;` |
| public/ISF/SM-BreathingMembrane.fs | Organic pulse, perfect breath hook | `breathRate *= 1.0 + audioBeat*1.0;` |

Total: **36 picks** (target window 35–50, sitting comfortably).

## CUT

- Raymarched / heavy iteration (≥64 iter, SDF marches): **~85**
  Includes all `3D_01..3D_20`, AR-Ferrofluid/MobiusStrip/SDFMorph/DisplacementSphere/FrequencyTerrain (80–90 iter marches even though audio-reactive — too expensive on phone GPUs), all ThreeBody-* (80/150/200 step orbit integration), CuratedISF/synth heavy ones (47/52/54/61/67/70/71/72/78), DimensionalRift, AbyssalHelix, Magpie-Bloom, fractal-tunnel-cosmos, FractalVoronoiBloom, VoronoiTerrainFlyover, MoltenVoronoiCore, OssiferousRadiolaria, mega-blob-fusion, tron-organic-fusion, etc.
- Multi-pass / feedback: **2** (Neon psy.fs, PC-ParticleTrails.fs — require persistent buffer)
- Test patterns / utility / debug: **11** (DM-TestBars, DM-TestPattern, DM-SafeArea, DM-CornerPins, DM-UVGrid, DM-Spotlight, DM-SolidColor, DM-Strobe, DM-CenterCrosshair, DM-EdgeGlow, DM-GridMatrix)
- Visually redundant duplicates: **~30** (CuratedISF/* mirrors of public/ISF/*; ISF/ legacy folder fully duplicates public/ISF/; `Trippy Mandala.fs` vs `TrippyMandala.fs`; `gpt*`, `00-*` early prototypes; `Untitled Shader.fs`)
- PC-* point-cloud FX that require an `inputImage`: **7** (PC-DataStream, PC-EnergyField, PC-HologramScan, PC-NebulaDissolve, PC-ParticleTrails, PC-PointExplosion, PC-VoxelWorld) — no source camera/image in mobile VJ context
- Image-input shaders 84–88 (ImageReliefTerrain, ImageDepthLayers, etc.): **5** — same reason
- M3D-* (require input image): **6**
- Didn't make visual cut (generic / weak): **~280** (everything else — the bulk of pre-AR/DM/SM legacy generators, the `00-*` and numbered `01..98` early synth set, the CuratedISF dimensions, etc.)

## Notes

- **Naming convention is meaningful**: `AR-` prefix = built audio-reactive; `DM-` = display/mapping (no audio); `SM-` = shape map (no audio); `ROOM_` = atmospheric depth-window (audio-reactive); `3D_` = raymarched SDF (audio-reactive but expensive); `PC-`/`M3D-` = point-cloud or image FX. This lets us bucket fast.
- **Audio uniforms actually used in the codebase** differ from the brief's expected list. The dominant set is `audioBass / audioMid / audioHigh / audioLevel / audioBeat`. `audioBeat` is the most common (86 hits) — the codebase clearly favors transient detection over raw FFT. `audioWaveform` and the ISF `FFT` sampler are nearly unused; only AR-FrequencyRings has a `sampleFFT()` helper. Recommend the mobile audio engine continue to publish that exact set.
- **The AR series is a trap**: half of them are audio-reactive but contain 80-iter raymarches (Ferrofluid, MobiusStrip, SDFMorph, DisplacementSphere, FrequencyTerrain). On mid-tier mobile these will drop to <20fps. The picks above are the 2D / low-iter subset only.
- **Standouts not picked** for variety reasons: AR-SpectralFluid is gorgeous but uses an `FBM_OCTAVES` define — verify it's ≤6 before shipping; if so, swap in for one of the DM picks.
- **ROOM_ series is the hidden gem**: cheap fbm-based atmospheric windows with `audioBeat`+`audioHigh` already wired. Ten ship-as-is picks come from there; could push to 15 if we want a "rooms" category.
- **Curated/synth duplication**: `CuratedISF/synth/*` is a strict subset of `public/ISF/*` (numbered files). Treat `public/ISF/` as canonical and delete the others before shipping to keep the asset bundle small.
- **Bundle hygiene**: ship from `public/ISF/` only. Strip `.txt` files, `Untitled Shader.fs`, `gpt*`, `00-*`, and the `thumbnails/` folder unless it's needed at runtime.
