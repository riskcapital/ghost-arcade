// Desktop ISF catalog plus stable IDs for existing mobile sets. Device performance varies by shader.
export type MobileShaderCategory = 'audio' | 'room' | 'pattern' | 'fluid' | 'kinetic' | 'generator' | 'simulation' | 'visual' | 'other';

export interface MobileShader {
  id: string;
  /** Path relative to `public/` — fetch as `import.meta.env.BASE_URL + path`. */
  path: string;
  /** Display name for the UI — short, no prefix. */
  name: string;
  category: MobileShaderCategory;
  /** True if the .fs already references audio uniforms. */
  audioNative: boolean;
  defaults?: Record<string, number | boolean | number[]>;
  requiresImage?: boolean;
  /**
   * Audio-reactivity injection patches applied at load time when
   * `audioNative` is false. Each pattern matches a line in the .fs and
   * gets replaced with the patched version. Keep the matches tight so
   * they don't accidentally rewrite unrelated code.
   */
  audioInject?: { match: RegExp; replace: string }[];
}

export const MOBILE_SHADERS: MobileShader[] = [
  // Artist-selected launch-ready collection.
  {id:'featured-lumenstrata',path:'ISF/Featured-lumenstrata.fs',name:'Lumenstrata',category:'visual',audioNative:false},
  {id:'featured-lumenveil',path:'ISF/Featured-lumenveil.fs',name:'Lumenveil',category:'visual',audioNative:false},
  {id:'featured-murmur',path:'ISF/Featured-murmur.fs',name:'Murmur',category:'visual',audioNative:false},
  {id:'featured-prism',path:'ISF/Featured-prism.fs',name:'Prism',category:'visual',audioNative:false},
  {id:'featured-pulse',path:'ISF/Featured-pulse.fs',name:'Pulse',category:'visual',audioNative:false},
  {id:'featured-quantumchamber',path:'ISF/Featured-quantumchamber.fs',name:'Quantumchamber',category:'visual',audioNative:false},
  {id:'featured-sentinels',path:'ISF/Featured-sentinels.fs',name:'Sentinels',category:'visual',audioNative:false},
  {id:'featured-tendril',path:'ISF/Featured-tendril.fs',name:'Tendril',category:'visual',audioNative:false},
  {id:'featured-tide',path:'ISF/Featured-tide.fs',name:'Tide',category:'visual',audioNative:false},
  {id:'featured-chrysalis',path:'ISF/Featured-chrysalis.fs',name:'Chrysalis',category:'visual',audioNative:false},
  {id:'featured-crystallon',path:'ISF/Featured-crystallon.fs',name:'Crystallon',category:'visual',audioNative:false},
  {id:'featured-dispersion',path:'ISF/Featured-dispersion.fs',name:'Dispersion',category:'visual',audioNative:false},
  {id:'featured-drift',path:'ISF/Featured-drift.fs',name:'Drift',category:'visual',audioNative:false},
  {id:'featured-aurora',path:'ISF/Featured-aurora.fs',name:'Aurora',category:'visual',audioNative:false},
  {id:'featured-chladniplate',path:'ISF/Featured-chladniplate.fs',name:'Chladniplate',category:'visual',audioNative:false},
  {id:'ga-ghostfx',path:'ISF/GA-GhostFX.fs',name:'GhostFX',category:'audio',audioNative:true},
  // ── SHIP-AS-IS — already audio-reactive ────────────────────────────
  { id: 'ar-frequency-rings',     path: 'ISF/AR-FrequencyRings.fs',                 name: 'Frequency Rings',  category: 'audio', audioNative: true },
  { id: 'ar-cymatic-patterns',    path: 'ISF/AR-CymaticPatterns.fs',                name: 'Cymatic Patterns', category: 'audio', audioNative: true },
  { id: 'ar-spectral-aurora',     path: 'ISF/AR-SpectralAurora.fs',                 name: 'Spectral Aurora',  category: 'audio', audioNative: true },
  { id: 'ar-lissajous',           path: 'ISF/AR-Lissajous.fs',                      name: 'Lissajous',        category: 'audio', audioNative: true },
  { id: 'ar-waveform-helix',      path: 'ISF/AR-WaveformHelix.fs',                  name: 'Waveform Helix',   category: 'audio', audioNative: true },
  { id: 'ar-reaction-diffusion',  path: 'ISF/AR-ReactionDiffusion.fs',              name: 'Reaction Diffusion', category: 'audio', audioNative: true },
  { id: 'ar-crystal-growth',      path: 'ISF/AR-CrystalGrowth.fs',                  name: 'Crystal Growth',   category: 'audio', audioNative: true },
  { id: 'ar-harmonic-voronoi',    path: 'ISF/AR-HarmonicVoronoi.fs',                name: 'Harmonic Voronoi', category: 'audio', audioNative: true },
  { id: 'ar-topo-mesh',           path: 'ISF/AR-TopoMesh.fs',                       name: 'Topo Mesh',        category: 'audio', audioNative: true },
  { id: 'ar-wavelet-decomp',      path: 'ISF/AR-WaveletDecomp.fs',                  name: 'Wavelet Decomp',   category: 'audio', audioNative: true },
  { id: 'ar-strange-attractor',   path: 'ISF/AR-StrangeAttractor.fs',               name: 'Strange Attractor', category: 'audio', audioNative: true },
  { id: 'room-aurora-curtains',   path: 'ISF/cube shaders/ROOM_07_AuroraCurtains.fs', name: 'Aurora Curtains', category: 'room', audioNative: true },
  { id: 'room-ember-drift',       path: 'ISF/cube shaders/ROOM_01_EmberDrift.fs',     name: 'Ember Drift',     category: 'room', audioNative: true },
  { id: 'room-cosmic-nebula',     path: 'ISF/cube shaders/ROOM_19_CosmicNebula.fs',   name: 'Cosmic Nebula',   category: 'room', audioNative: true },
  { id: 'room-storm-cell',        path: 'ISF/cube shaders/ROOM_11_StormCell.fs',      name: 'Storm Cell',      category: 'room', audioNative: true },
  { id: 'room-crystal-rain',      path: 'ISF/cube shaders/ROOM_05_CrystalRain.fs',    name: 'Crystal Rain',    category: 'room', audioNative: true },
  { id: 'room-fog-cathedral',     path: 'ISF/cube shaders/ROOM_15_FogCathedral.fs',   name: 'Fog Cathedral',   category: 'room', audioNative: true },
  { id: 'room-jellyfish-float',   path: 'ISF/cube shaders/ROOM_10_JellyfishFloat.fs', name: 'Jellyfish Float', category: 'room', audioNative: true },
  { id: 'room-smoke-layers',      path: 'ISF/cube shaders/ROOM_02_SmokeLayers.fs',    name: 'Smoke Layers',    category: 'room', audioNative: true },
  { id: 'room-spore-cloud',       path: 'ISF/cube shaders/ROOM_17_SporeCloud.fs',     name: 'Spore Cloud',     category: 'room', audioNative: true },

  // ── AUGMENT — visually striking + GPU-cheap, audio reactivity auto-patched ────
  // ── AUGMENT (10) — visually striking + GPU-cheap, audio reactivity auto-patched ──
  //
  // Where a shader has a clearly-hookable INPUT param (`speed`,
  // `hueOffset`, `glowRadius`, `breathRate`, etc.) referenced from
  // a stable body line, we wire targeted `audioInject` patches that
  // modulate that param at its use-site — the shader's actual
  // motion/colour responds to the music rather than just its
  // brightness. Shaders without obvious hooks fall through to the
  // universal patch (a generic brightness/colour tilt at end-of-
  // main) so they still feel alive with audio.
  //
  // Patches are regex match/replace pairs against POST-parse GLSL.
  // `audioBass` etc. are now Milkdrop-smoothed (see standaloneAudio.ts)
  // so even multiplicative modulators read as elegant breath, not pulse.
  {
    id: 'dm-plasma-flow', path: 'ISF/DM-PlasmaFlow.fs',
    name: 'Plasma Flow', category: 'fluid', audioNative: false,
    audioInject: [
      // Speed swells smoothly with bass; hue shifts on beat accents.
      { match: /float t = TIME \* speed;/, replace: 'float t = TIME * speed * (1.0 + audioBass * 1.5);' },
      { match: /v \* hueRange \+ hueOffset \+ t/, replace: 'v * hueRange + (hueOffset + audioBeat * 0.1) + t' },
    ],
  },
  {
    id: 'dm-kaleidoscope', path: 'ISF/DM-Kaleidoscope.fs',
    name: 'Kaleidoscope', category: 'pattern', audioNative: false,
    audioInject: [
      // Rotation accelerates with mids (continuous smooth swell);
      // each beat adds a small rotational kick. Reads as "the
      // kaleidoscope is dancing with the music."
      { match: /a \+= TIME \* rotationSpeed;/, replace: 'a += TIME * rotationSpeed * (1.0 + audioMid * 2.0) + audioBeat * 0.3;' },
    ],
  },
  {
    id: 'dm-aurora-borealis', path: 'ISF/DM-AuroraBorealis.fs',
    name: 'Aurora Borealis', category: 'fluid', audioNative: false,
    audioInject: [
      // The amp seed at the top of the FBM noise loop is the aurora's
      // wave amplitude. Treble drives it — bright transients make the
      // ribbons surge while bass leaves them serene.
      { match: /float amp = 0\.5;/, replace: 'float amp = 0.5 * (1.0 + audioHigh * 1.5);' },
    ],
  },
  {
    id: 'dm-liquid-metal', path: 'ISF/DM-LiquidMetal.fs',
    name: 'Liquid Metal', category: 'fluid', audioNative: false,
    audioInject: [
      { match: /float t = TIME \* speed;/, replace: 'float t = TIME * speed * (1.0 + audioBass * 0.4);' },
      { match: /\(dx \+ dy\) \* 10\.0 \* reflectivity/, replace: '(dx + dy) * 10.0 * (reflectivity + audioHigh * 0.3)' },
    ],
  },
  {
    id: 'dm-tunnel', path: 'ISF/DM-Tunnel.fs',
    name: 'Tunnel', category: 'kinetic', audioNative: false,
    audioInject: [
      // Tunnel-rush speed — bass accelerates you through the tunnel.
      // Smoothed bass means it's a slow swell into the drop, not a
      // jagged stutter.
      { match: /float t = TIME \* speed;/, replace: 'float t = TIME * speed * (1.0 + audioBass * 2.0);' },
    ],
  },
  {
    id: 'dm-neon-lines', path: 'ISF/DM-NeonLines.fs',
    name: 'Neon Lines', category: 'pattern', audioNative: false,
    audioInject: [
      { match: /float t = TIME \* speed;/, replace: 'float t = TIME * speed * (1.0 + audioMid * 0.8);' },
      // Lines thicken on bright transients — feels like an EQ
      // sweep when treble rises.
      { match: /smoothstep\(lineWidth, lineWidth \* 0\.3, dist\)/, replace: 'smoothstep(lineWidth * (1.0 + audioHigh * 0.6), lineWidth * 0.3, dist)' },
    ],
  },
  {
    id: 'sm-fireflies', path: 'ISF/SM-Fireflies.fs',
    name: 'Fireflies', category: 'kinetic', audioNative: false,
    audioInject: [
      // Pulse rate jumps on every beat — fireflies "wink" with the
      // kick. Glow radius swells with bass.
      { match: /sin\(TIME \* pulseRate \+ pulsePhase\)/, replace: 'sin(TIME * pulseRate * (1.0 + audioBeat * 1.5) + pulsePhase)' },
      { match: /glowRadius \* pulse \/ \(dist \+ 0\.001\)/, replace: 'glowRadius * (1.0 + audioBass * 0.8) * pulse / (dist + 0.001)' },
    ],
  },
  {
    id: 'sm-lava-lamp-blobs', path: 'ISF/SM-LavaLampBlobs.fs',
    name: 'Lava Lamp', category: 'fluid', audioNative: false,
    audioInject: [
      // Blob influence (a metaballs-style mass field) swells with
      // bass. Slow continuous breathing of the lamp.
      { match: /float influence = blobSize \/ \(dist \* dist \+ 0\.01\);/, replace: 'float influence = (blobSize * (1.0 + audioBass * 0.4)) / (dist * dist + 0.01);' },
    ],
  },
  {
    id: 'sm-bouncing-balls', path: 'ISF/SM-BouncingBalls.fs',
    name: 'Bouncing Balls', category: 'kinetic', audioNative: false,
    audioInject: [
      // No gravity uniform to hook (the curation doc suggested it
      // but the shader uses a procedural bounce path). Closest
      // equivalent: bass accelerates `t * speed` so balls bounce
      // FASTER on the drops — visually equivalent to "stronger
      // gravity pulling them through the bounces."
      { match: /float t = TIME \* speed;/, replace: 'float t = TIME * speed * (1.0 + audioBass * 1.2);' },
    ],
  },
  {
    id: 'sm-breathing-membrane', path: 'ISF/SM-BreathingMembrane.fs',
    name: 'Breathing', category: 'fluid', audioNative: false,
    audioInject: [
      // Breath rate riding the beat — the membrane visibly inhales
      // when the kick hits. /g flag so both the breath sin() and the
      // sub-feature heartbeat pow(sin()) get the same modulator and
      // stay in sync.
      { match: /sin\(t \* breathRate \* 3\.14159\)/g, replace: 'sin(t * breathRate * (1.0 + audioBeat * 1.0) * 3.14159)' },
    ],
  },
];

MOBILE_SHADERS.push(...[
  {
    "id": "desktop:DM-SolidColor.fs",
    "path": "ISF/DM-SolidColor.fs",
    "name": "Solid Color",
    "category": "visual",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:DM-TestPattern.fs",
    "path": "ISF/DM-TestPattern.fs",
    "name": "Test Pattern",
    "category": "visual",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:DM-GridMatrix.fs",
    "path": "ISF/DM-GridMatrix.fs",
    "name": "Grid Matrix",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "gridSize": 4.8,
      "lineWidth": 0.09455
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-TestBars.fs",
    "path": "ISF/DM-TestBars.fs",
    "name": "Test Bars",
    "category": "visual",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:DM-UVGrid.fs",
    "path": "ISF/DM-UVGrid.fs",
    "name": "UVGrid",
    "category": "visual",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:DM-SafeArea.fs",
    "path": "ISF/DM-SafeArea.fs",
    "name": "Safe Area",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "lineWidth": 0.005205
    },
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-MinimalSurface.fs",
    "path": "ISF/GA2-MinimalSurface.fs",
    "name": "GA2-Minimal Surface",
    "category": "room",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-QuaternionJulia.fs",
    "path": "ISF/GA2-QuaternionJulia.fs",
    "name": "GA2-Quaternion Julia",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-Quasicrystal.fs",
    "path": "ISF/GA2-Quasicrystal.fs",
    "name": "GA2-Quasicrystal",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-HopfFibration.fs",
    "path": "ISF/GA2-HopfFibration.fs",
    "name": "GA2-Hopf Fibration",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-Apollonian.fs",
    "path": "ISF/GA2-Apollonian.fs",
    "name": "GA2-Apollonian",
    "category": "room",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-SphericalHarmonics.fs",
    "path": "ISF/GA2-SphericalHarmonics.fs",
    "name": "GA2-Spherical Harmonics",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-DeepDescent.fs",
    "path": "ISF/GA2-DeepDescent.fs",
    "name": "GA2-Deep Descent",
    "category": "room",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-DriftVeil.fs",
    "path": "ISF/GA2-DriftVeil.fs",
    "name": "GA2-Drift Veil",
    "category": "room",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:GA2-Cathedral.fs",
    "path": "ISF/GA2-Cathedral.fs",
    "name": "GA2-Cathedral",
    "category": "room",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:crystal-dimension.fs",
    "path": "ISF/crystal-dimension.fs",
    "name": "crystal-dimension",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "rotationSpeed": 0.9,
      "repetition": 2.18,
      "tunnelRadius": 1.7825,
      "objectScale": 0.4135
    },
    "requiresImage": false
  },
  {
    "id": "desktop:fractal-dimension-supreme.fs",
    "path": "ISF/fractal-dimension-supreme.fs",
    "name": "fractal-dimension-supreme",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "iterations": 3,
      "power": 10.12,
      "scale": 2.865,
      "morphAmount": 0.58,
      "foldAmount": 0.74,
      "cameraMode": 5,
      "cameraDistance": 2.295,
      "renderMode": 3.045
    },
    "requiresImage": false
  },
  {
    "id": "desktop:fractal-tunnel-cosmos.fs",
    "path": "ISF/fractal-tunnel-cosmos.fs",
    "name": "fractal-tunnel-cosmos",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "fractalType": 5.58,
      "fractalScale": 0.88,
      "fractalDetail": 10
    },
    "requiresImage": false
  },
  {
    "id": "desktop:mega-blob-fusion.fs",
    "path": "ISF/mega-blob-fusion.fs",
    "name": "mega-blob-fusion",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "blobMode": 5.07,
      "blobCount": 30,
      "blobSize": 0.2696,
      "blobMerge": 1.24625,
      "morphSpeed": 2.025,
      "flowSpeed": 1.08,
      "vortexStrength": 1.6,
      "explosionAmount": 1.76,
      "turbulence": 0.57,
      "gridIntensity": 1,
      "cameraDistance": 2.98,
      "colorVariation": 0.04,
      "neonGlow": 5,
      "rimPower": 1.9725,
      "pulseAmount": 0,
      "innerGlow": 0,
      "fogAmount": 0,
      "brightness": 0.5
    },
    "requiresImage": false
  },
  {
    "id": "desktop:organic-dimension.fs",
    "path": "ISF/organic-dimension.fs",
    "name": "organic-dimension",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "driftAmount": 1.84
    },
    "requiresImage": false
  },
  {
    "id": "desktop:organic-fluids.fs",
    "path": "ISF/organic-fluids.fs",
    "name": "organic-fluids",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "flowSpeed": 1.53,
      "turbulence": 0,
      "blobCount": 9.12,
      "blobSize": 0.05,
      "threshold": 1.5
    },
    "requiresImage": false
  },
  {
    "id": "desktop:psychedelic-noise-flow.fs",
    "path": "ISF/psychedelic-noise-flow.fs",
    "name": "psychedelic-noise-flow",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "noiseMode": 5.88,
      "scale": 2.675,
      "flowSpeed": 1.185,
      "flowAmount": 1.11,
      "octaves": 7.65,
      "turbulence": 0.84,
      "edgeThreshold": 0.225,
      "edgeThickness": 0.00850499999999992,
      "ditherLevels": 16,
      "ditherScale": 32,
      "contourLevels": 20,
      "contourThickness": 0.2,
      "warpAmount": 1,
      "posterize": 0.91,
      "posterizeLevels": 16
    },
    "requiresImage": false
  },
  {
    "id": "desktop:quantum-grids.fs",
    "path": "ISF/quantum-grids.fs",
    "name": "quantum-grids",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "visualType": 2.58,
      "scrollSpeed": 4.625,
      "colorShift": 0.02,
      "timeScale": 2.0575,
      "depth": 60,
      "spacing": 0.15,
      "lineCount": 100,
      "circleDensity": 35.5,
      "lineWeight": 0.00410999999999992,
      "glowIntensity": 1,
      "baseHue": 1,
      "colorCount": 6,
      "paletteType": 6,
      "bgGradient": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:StarDrift.fs",
    "path": "ISF/StarDrift.fs",
    "name": "Star Drift",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:TrippyMandala.fs",
    "path": "ISF/TrippyMandala.fs",
    "name": "Trippy Mandala",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "zoom_speed": 0.35,
      "symmetry": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:tron-organic-fusion.fs",
    "path": "ISF/tron-organic-fusion.fs",
    "name": "tron-organic-fusion",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "gridScale": 30,
      "blobCount": 6.075,
      "blobSize": 0.446
    },
    "requiresImage": false
  },
  {
    "id": "desktop:wireframe-mesh-3d.fs",
    "path": "ISF/wireframe-mesh-3d.fs",
    "name": "wireframe-mesh-3d",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "meshMode": 2.73,
      "gridResolution": 24.625,
      "deformAmount": 3,
      "deformFrequency": 0.5,
      "cameraDistance": 4.735,
      "lineThickness": 0.0003,
      "vertexSize": 0,
      "animationSpeed": 0.15,
      "depthFade": 1,
      "lineGlow": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:01_OrbitalWireframe.fs",
    "path": "ISF/01_OrbitalWireframe.fs",
    "name": "Orbital Wireframe",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:04_SacredGeometryGlow.fs",
    "path": "ISF/04_SacredGeometryGlow.fs",
    "name": "Sacred Geometry Glow",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.85,
      "glowIntensity": 1.185,
      "complexity": 11.45
    },
    "requiresImage": false
  },
  {
    "id": "desktop:11_RadialShards.fs",
    "path": "ISF/11_RadialShards.fs",
    "name": "Radial Shards",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "shardCount": 48,
      "explosionForce": 3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:14_PentagonGeometry.fs",
    "path": "ISF/14_PentagonGeometry.fs",
    "name": "Pentagon Geometry",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "layers": 6,
      "glow": 0.33
    },
    "requiresImage": false
  },
  {
    "id": "desktop:15_NeuralNetwork.fs",
    "path": "ISF/15_NeuralNetwork.fs",
    "name": "Neural Network",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "nodes": 19.625,
      "threshold": 0.8
    },
    "requiresImage": false
  },
  {
    "id": "desktop:16_AtomicOrbital.fs",
    "path": "ISF/16_AtomicOrbital.fs",
    "name": "Atomic Orbital",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.89,
      "orbits": 6,
      "electronSize": 0.036275
    },
    "requiresImage": false
  },
  {
    "id": "desktop:17_IridescentPebbles.fs",
    "path": "ISF/17_IridescentPebbles.fs",
    "name": "Iridescent Pebbles",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "scale": 5.14,
      "iridescence": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:22_FractalAtomicFlower.fs",
    "path": "ISF/22_FractalAtomicFlower.fs",
    "name": "Fractal Atomic Flower",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "foldSymmetry": 6.42,
      "iterations": 8
    },
    "requiresImage": false
  },
  {
    "id": "desktop:23_StarCluster.fs",
    "path": "ISF/23_StarCluster.fs",
    "name": "Star Cluster",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "density": 0.893,
      "clusterTightness": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:24_KineticSculpture.fs",
    "path": "ISF/24_KineticSculpture.fs",
    "name": "Kinetic Sculpture",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "rodCount": 20,
      "perspective": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:25_PlasmaTendrils.fs",
    "path": "ISF/25_PlasmaTendrils.fs",
    "name": "Plasma Tendrils",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.815,
      "tendrils": 12,
      "intensity": 3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:26_DNAHelix.fs",
    "path": "ISF/26_DNAHelix.fs",
    "name": "DNAHelix",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.19,
      "helixTwist": 1.91,
      "nodeSize": 0.01525
    },
    "requiresImage": false
  },
  {
    "id": "desktop:27_RadarHUD.fs",
    "path": "ISF/27_RadarHUD.fs",
    "name": "Radar HUD",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.38,
      "rings": 20,
      "scanSpeed": 3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:31_QuantumField.fs",
    "path": "ISF/31_QuantumField.fs",
    "name": "Quantum Field",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.58,
      "shellCount": 8,
      "probabilitySpread": 1,
      "quantumNoise": 1,
      "shellOpacity": 0.895,
      "electronCount": 16,
      "colorTemp": 0.085,
      "nucleusGlow": 0,
      "uncertainty": 1,
      "zoom": 1.218
    },
    "requiresImage": false
  },
  {
    "id": "desktop:33_SignalPropagation.fs",
    "path": "ISF/33_SignalPropagation.fs",
    "name": "Signal Propagation",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "emitterCount": 5.2,
      "wavelength": 0.1171,
      "decay": 2.6725,
      "emitterSpread": 0.26375,
      "lineThickness": 1,
      "emitterGlow": 0.45,
      "interference": 2,
      "rotation": 3.8622
    },
    "requiresImage": false
  },
  {
    "id": "desktop:35_WormholeTunnel.fs",
    "path": "ISF/35_WormholeTunnel.fs",
    "name": "Wormhole Tunnel",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "tunnelRadius": 0.8,
      "ringCount": 19.86,
      "gridLines": 31.02,
      "convergence": 1,
      "edgeGlow": 1.74
    },
    "requiresImage": false
  },
  {
    "id": "desktop:36_ConstellationMap.fs",
    "path": "ISF/36_ConstellationMap.fs",
    "name": "Constellation Map",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "constellationCount": 8,
      "starsPerGroup": 9.405,
      "bgStarDensity": 0.705,
      "starBrightness": 0.2,
      "gridOverlay": 0.5,
      "drift": 1,
      "colorVariation": 0.82,
      "haloSize": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:37_TorusKnot.fs",
    "path": "ISF/37_TorusKnot.fs",
    "name": "Torus Knot",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.54,
      "knotP": 5.74,
      "knotQ": 5.53,
      "majorRadius": 0.324,
      "minorRadius": 0.15,
      "lineWeight": 0.008785,
      "rotX": 0.985,
      "rotY": 0.995,
      "depthFade": 0.88,
      "trailGlow": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:38_ParticleCollider.fs",
    "path": "ISF/38_ParticleCollider.fs",
    "name": "Particle Collider",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "trackCount": 35.275,
      "curvature": 1,
      "detectorRings": 8,
      "trackBrightness": 3,
      "collisionEnergy": 3,
      "detectorOpacity": 1,
      "decayVertices": 0.125,
      "eventRate": 0.442
    },
    "requiresImage": false
  },
  {
    "id": "desktop:39_TensorField.fs",
    "path": "ISF/39_TensorField.fs",
    "name": "Tensor Field",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "fieldScale": 8,
      "lineLength": 36.95,
      "lineDensity": 30,
      "lineOpacity": 0.77,
      "singularityCount": 6,
      "fieldType": 1,
      "noiseInfluence": 1,
      "arrowheads": 1,
      "colorByMagnitude": 0.775
    },
    "requiresImage": false
  },
  {
    "id": "desktop:40_HolographicMoire.fs",
    "path": "ISF/40_HolographicMoire.fs",
    "name": "Holographic Moire",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.53,
      "gridLayers": 2.56,
      "gridFrequency": 33.45,
      "rotationOffset": 0.5,
      "warp": 1,
      "contrast": 2.5815,
      "colorSeparation": 1,
      "centerPull": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:42_GyroscopicRings.fs",
    "path": "ISF/42_GyroscopicRings.fs",
    "name": "Gyroscopic Rings",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "ringPairs": 6,
      "ringRadius": 0.5,
      "ringWidth": 0.02,
      "tiltRange": 0.1,
      "precessionSpeed": 0.705,
      "depthShading": 0.435,
      "coreGlow": 0.66,
      "colorSpread": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:43_CosmicWeb.fs",
    "path": "ISF/43_CosmicWeb.fs",
    "name": "Cosmic Web",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "webScale": 2.75,
      "filamentBrightness": 1.04,
      "nodeGlow": 4,
      "voidDarkness": 0.885,
      "turbulence": 1,
      "colorTemp": 0.85,
      "depth": 2,
      "filamentWidth": 0.415,
      "clusterSize": 0.7345
    },
    "requiresImage": false
  },
  {
    "id": "desktop:44_Oscilloscope.fs",
    "path": "ISF/44_Oscilloscope.fs",
    "name": "Oscilloscope",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.26,
      "freqX": 10.46,
      "freqY": 6.17,
      "phaseShift": 2.4178,
      "amplitude": 0.382,
      "traceWidth": 0.01,
      "persistence": 1,
      "gridBrightness": 0.5,
      "phosphorColor": 0.425
    },
    "requiresImage": false
  },
  {
    "id": "desktop:47_FractalDimension.fs",
    "path": "ISF/47_FractalDimension.fs",
    "name": "Fractal Dimension",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "iterations": 10,
      "rotationPer": 0.235,
      "lineWeight": 2,
      "fillMode": 0.62,
      "colorByDepth": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:48_PlasmaContainment.fs",
    "path": "ISF/48_PlasmaContainment.fs",
    "name": "Plasma Containment",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "torusMajor": 0.298,
      "torusMinor": 0.15,
      "plasmaTemp": 0.298,
      "magneticCoils": 9,
      "coilVisibility": 0.58,
      "instability": 0.43,
      "viewAngle": 0,
      "particleDensity": 80,
      "containmentField": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:51_SacredGeometryCathedral.fs",
    "path": "ISF/51_SacredGeometryCathedral.fs",
    "name": "Sacred Geometry Cathedral",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "complexity": 2,
      "seedOfLifeRadius": 0.25,
      "outerEllipseCount": 1.98,
      "ellipseEccentricity": 0.8,
      "cubeSize": 0.0834,
      "cubeRotSpeed": 0.93,
      "lineGlow": 2.93,
      "concentricRings": 24,
      "flowerPetals": 6.8,
      "innerRotation": 0.14
    },
    "requiresImage": false
  },
  {
    "id": "desktop:52_ChaoticOrbitalMesh.fs",
    "path": "ISF/52_ChaoticOrbitalMesh.fs",
    "name": "Chaotic Orbital Mesh",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "orbitCount": 30,
      "meshDensity": 2,
      "geodesicDetail": 20,
      "tiltChaos": 1.2675,
      "particleCount": 17.65,
      "coreRadius": 0.35,
      "outerRadius": 0.5,
      "lineWeight": 2.9865,
      "tangledOverlap": 1,
      "verticalStretch": 1,
      "glowFalloff": 1.4625
    },
    "requiresImage": false
  },
  {
    "id": "desktop:54_ShatteredLattice.fs",
    "path": "ISF/54_ShatteredLattice.fs",
    "name": "Shattered Lattice",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "recursionDepth": 10,
      "baseSize": 0.5,
      "rotationPerLevel": 0,
      "shrinkRatio": 0.818,
      "shardCount": 5,
      "shardSpread": 1,
      "particleDensity": 29.35,
      "lineGlow": 2.811,
      "diagonals": 1,
      "shardRotation": 1,
      "connectLines": 0.76
    },
    "requiresImage": false
  },
  {
    "id": "desktop:56_ConnectedCubes.fs",
    "path": "ISF/56_ConnectedCubes.fs",
    "name": "Connected Cubes",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "cubeCount": 40,
      "cubeMinSize": 0.03,
      "cubeMaxSize": 0.12,
      "centralCubeSize": 0.15,
      "signalWaves": 8,
      "signalAmplitude": 0.08,
      "signalFreq": 16.94,
      "connectionRange": 0.6,
      "fillOpacity": 0.5,
      "blueIntensity": 1,
      "rotationSpeed": 0.46
    },
    "requiresImage": false
  },
  {
    "id": "desktop:70_LiquidMetal.fs",
    "path": "ISF/70_LiquidMetal.fs",
    "name": "Liquid Metal",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "blobCount": 6.62,
      "smoothness": 0.125
    },
    "requiresImage": false
  },
  {
    "id": "desktop:61_SingularityCollapse.fs",
    "path": "ISF/61_SingularityCollapse.fs",
    "name": "Singularity Collapse",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.5,
      "collapsePhase": 0,
      "distortionPower": 1.905,
      "accretionColor": [
        0,
        0.5,
        1,
        1
      ],
      "ringCount": 12,
      "jetIntensity": 3,
      "noiseDetail": 2,
      "eventHorizon": 0.03,
      "cameraDistance": 3.9075
    },
    "requiresImage": false
  },
  {
    "id": "desktop:62_HypercubeTesseract.fs",
    "path": "ISF/62_HypercubeTesseract.fs",
    "name": "Hypercube Tesseract",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "rotXW": 0.62,
      "rotYZ": 1.09,
      "innerScale": 0.2,
      "lineWeight": 2.9865,
      "glowHue": 0.69,
      "trailLength": 0.455,
      "vertexGlow": 2.12,
      "perspective4D": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:67_ParticleSupernova.fs",
    "path": "ISF/67_ParticleSupernova.fs",
    "name": "Particle Supernova",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "explosionPhase": 0.655,
      "particleCount": 120,
      "shockwaveRadius": 0.8,
      "debrisTrails": 1.5,
      "cameraDistance": 3.9525,
      "bloomIntensity": 2.84,
      "turbulence": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:68_MoebiusPortal.fs",
    "path": "ISF/68_MoebiusPortal.fs",
    "name": "Moebius Portal",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "ringRadius": 0.5,
      "tubeRadius": 0.1,
      "twists": 2.145,
      "vortexIntensity": 0,
      "cameraOrbit": 0.55,
      "energyPulse": 0.225,
      "distortion": 1.47
    },
    "requiresImage": false
  },
  {
    "id": "desktop:71_CosmicSpine.fs",
    "path": "ISF/71_CosmicSpine.fs",
    "name": "Cosmic Spine",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "vertebrae": 40,
      "spineRadius": 0.1,
      "discSpacing": 0.19,
      "curvature": 0.9375,
      "pulseSpeed": 5,
      "ribCount": 4.88
    },
    "requiresImage": false
  },
  {
    "id": "desktop:72_ShatteredReality.fs",
    "path": "ISF/72_ShatteredReality.fs",
    "name": "Shattered Reality",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "shardCount": 25,
      "shardSize": 0.6,
      "reflectivity": 1,
      "scatter": 0.3,
      "edgeGlow": 3.54
    },
    "requiresImage": false
  },
  {
    "id": "desktop:74_QuantumTunnel.fs",
    "path": "ISF/74_QuantumTunnel.fs",
    "name": "Quantum Tunnel",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "tunnelRadius": 0.371,
      "waveFreq": 15.59,
      "waveAmplitude": 0.585,
      "flySpeed": 0.5,
      "interference": 1.02,
      "depthRings": 2,
      "probabilityGlow": 3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:78_PlasmaVortex.fs",
    "path": "ISF/78_PlasmaVortex.fs",
    "name": "Plasma Vortex",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.35,
      "vortexHeight": 3.16,
      "vortexRadius": 1,
      "spiralArms": 6,
      "coreColor": [
        0,
        0.8,
        0.4,
        1
      ],
      "outerColor": [
        0.55,
        0.2,
        0.8,
        1
      ],
      "particleCount": 100,
      "turbulence": 1.5,
      "cameraDistance": 3.165,
      "bloomIntensity": 2.46
    },
    "requiresImage": false
  },
  {
    "id": "desktop:84_ImageReliefTerrain.fs",
    "path": "ISF/84_ImageReliefTerrain.fs",
    "name": "Image Relief Terrain",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "cameraAngleX": -18.45,
      "depthScale": 0.465,
      "heightChannel": 2.415,
      "edgeLight": 1,
      "shadowStrength": 1,
      "animateAngle": 0.785,
      "animateSpeed": 2
    },
    "requiresImage": true
  },
  {
    "id": "desktop:85_ImageDepthLayers.fs",
    "path": "ISF/85_ImageDepthLayers.fs",
    "name": "Image Depth Layers",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": true
  },
  {
    "id": "desktop:86_ImageLitSurface.fs",
    "path": "ISF/86_ImageLitSurface.fs",
    "name": "Image Lit Surface",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": true
  },
  {
    "id": "desktop:87_ImageTileExtrude.fs",
    "path": "ISF/87_ImageTileExtrude.fs",
    "name": "Image Tile Extrude",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": true
  },
  {
    "id": "desktop:88_ImageDepthRipple.fs",
    "path": "ISF/88_ImageDepthRipple.fs",
    "name": "Image Depth Ripple",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": true
  },
  {
    "id": "desktop:DM-GradientWave.fs",
    "path": "ISF/DM-GradientWave.fs",
    "name": "Gradient Wave",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "waveScale": 10,
      "colorShift": 0.355,
      "saturation": 0.84,
      "brightness": 1.0255,
      "waveDirection": 4.71
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-RadialPulse.fs",
    "path": "ISF/DM-RadialPulse.fs",
    "name": "Radial Pulse",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "pulseSpeed": 0.59,
      "ringCount": 4.895
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-ColorBreath.fs",
    "path": "ISF/DM-ColorBreath.fs",
    "name": "Color Breath",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "breathSpeed": 1.354,
      "vignetteAmount": 0.82
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-HexGrid.fs",
    "path": "ISF/DM-HexGrid.fs",
    "name": "Hex Grid",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "scale": 11.45,
      "speed": 0.615,
      "fillAmount": 1,
      "edgeGlow": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-SacredGeometry.fs",
    "path": "ISF/DM-SacredGeometry.fs",
    "name": "Sacred Geometry",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "pattern": 1.365,
      "scale": 0.8825,
      "lineWidth": 0.02395,
      "glowAmount": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-Starfield.fs",
    "path": "ISF/DM-Starfield.fs",
    "name": "Starfield",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "speed": 0.4335,
      "starCount": 400,
      "trailLength": 1,
      "brightness": 2,
      "colorShift": 0.82
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-NoiseCloud.fs",
    "path": "ISF/DM-NoiseCloud.fs",
    "name": "Noise Cloud",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "scale": 3.88,
      "octaves": 3.275,
      "contrast": 0.5
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-GlitchBlocks.fs",
    "path": "ISF/DM-GlitchBlocks.fs",
    "name": "Glitch Blocks",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "blockSize": 21.78,
      "glitchRate": 6.035,
      "intensity": 0.795,
      "colorShift": 0.565
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-FireParticles.fs",
    "path": "ISF/DM-FireParticles.fs",
    "name": "Fire Particles",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "speed": 0.5,
      "density": 50,
      "turbulence": 0.3,
      "particleSize": 2.2875,
      "baseY": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-VoronoiFlow.fs",
    "path": "ISF/DM-VoronoiFlow.fs",
    "name": "Voronoi Flow",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "speed": 0.72,
      "edgeWidth": 0.0495,
      "edgeGlow": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-DigitalRain.fs",
    "path": "ISF/DM-DigitalRain.fs",
    "name": "Digital Rain",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "speed": 0.95,
      "density": 49.1,
      "charSize": 2,
      "trailLength": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-WaterRipple.fs",
    "path": "ISF/DM-WaterRipple.fs",
    "name": "Water Ripple",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "rippleSpeed": 3.5825,
      "rippleCount": 4.82,
      "frequency": 22.55,
      "amplitude": 0.029,
      "decay": 0.5
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-Oscilloscope.fs",
    "path": "ISF/DM-Oscilloscope.fs",
    "name": "Oscilloscope",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "waveCount": 5,
      "amplitude": 0.41,
      "frequency": 6.445,
      "lineWidth": 0.03875,
      "glowAmount": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-EnergyField.fs",
    "path": "ISF/DM-EnergyField.fs",
    "name": "Energy Field",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "pulseSpeed": 0.7025,
      "fieldIntensity": 2,
      "distortionAmount": 1,
      "arcFrequency": 0.06
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-SmokeWisp.fs",
    "path": "ISF/DM-SmokeWisp.fs",
    "name": "Smoke Wisp",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "density": 1.4,
      "turbulence": 0.56,
      "wispSize": 1.7625
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-CenterCrosshair.fs",
    "path": "ISF/DM-CenterCrosshair.fs",
    "name": "Center Crosshair",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "rings": 6.41,
      "lineWidth": 0.00564
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-CornerPins.fs",
    "path": "ISF/DM-CornerPins.fs",
    "name": "Corner Pins",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "markerSize": 0.12,
      "lineWidth": 0.00726999999999993
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-Strobe.fs",
    "path": "ISF/DM-Strobe.fs",
    "name": "Strobe",
    "category": "visual",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:DM-EdgeGlow.fs",
    "path": "ISF/DM-EdgeGlow.fs",
    "name": "Edge Glow",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "glowWidth": 0.3,
      "glowIntensity": 2,
      "pulseSpeed": 0.93
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-Spotlight.fs",
    "path": "ISF/DM-Spotlight.fs",
    "name": "Spotlight",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "spotSize": 0.239,
      "softness": 0.4118
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-NodeNetwork.fs",
    "path": "ISF/DM-NodeNetwork.fs",
    "name": "Node Network",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "nodeCount": 30,
      "connectionDist": 0.5,
      "nodeSize": 0.03,
      "lineWidth": 0.01,
      "hue": 0.48,
      "pulseAmount": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-FractalZoom.fs",
    "path": "ISF/DM-FractalZoom.fs",
    "name": "Fractal Zoom",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "zoomSpeed": 0.1665,
      "iterations": 12,
      "complexity": 5,
      "colorSpeed": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-ParticleVortex.fs",
    "path": "ISF/DM-ParticleVortex.fs",
    "name": "Particle Vortex",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "particleCount": 500,
      "vortexStrength": 0.5,
      "particleSize": 0.02,
      "trailLength": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-MandelbrotPulse.fs",
    "path": "ISF/DM-MandelbrotPulse.fs",
    "name": "Mandelbrot Pulse",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "iterations": 100
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-ElectricStorm.fs",
    "path": "ISF/DM-ElectricStorm.fs",
    "name": "Electric Storm",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "intensity": 1.625,
      "boltCount": 8,
      "speed": 3.56,
      "branches": 1,
      "thickness": 0.0766
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-WaveformBars.fs",
    "path": "ISF/DM-WaveformBars.fs",
    "name": "Waveform Bars",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "barCount": 64
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-CellularNoise.fs",
    "path": "ISF/DM-CellularNoise.fs",
    "name": "Cellular Noise",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "scale": 4.285,
      "speed": 0.25,
      "edgeWidth": 0.21,
      "cellStyle": 1.55
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-InfiniteZoom.fs",
    "path": "ISF/DM-InfiniteZoom.fs",
    "name": "Infinite Zoom",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "zoomSpeed": 0.216,
      "rotateSpeed": 2,
      "layers": 12,
      "thickness": 0.2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-LaserBeams.fs",
    "path": "ISF/DM-LaserBeams.fs",
    "name": "Laser Beams",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "beamCount": 16,
      "glowAmount": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-FluidSimulation.fs",
    "path": "ISF/DM-FluidSimulation.fs",
    "name": "Fluid Simulation",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "scale": 2.4,
      "speed": 0.404,
      "complexity": 6,
      "contrast": 1.45
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-Spirograph.fs",
    "path": "ISF/DM-Spirograph.fs",
    "name": "Spirograph",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "innerRadius": 0.36,
      "penOffset": 0.5275,
      "speed": 1.1545,
      "lineWidth": 0.00821,
      "glowSize": 0.097,
      "trailLength": 2000
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-RetroSun.fs",
    "path": "ISF/DM-RetroSun.fs",
    "name": "Retro Sun",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "sunSize": 0.372,
      "sunY": 0.48,
      "gridSpeed": 1.155,
      "gridDensity": 11.125,
      "stripeCount": 2.25
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-PixelRain.fs",
    "path": "ISF/DM-PixelRain.fs",
    "name": "Pixel Rain",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "pixelSize": 6.32,
      "fallSpeed": 0.545,
      "density": 0.9,
      "trailLength": 10,
      "colorVariation": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-PrismLight.fs",
    "path": "ISF/DM-PrismLight.fs",
    "name": "Prism Light",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "spread": 0.982,
      "angle": 5.495,
      "bands": 3.945,
      "softness": 0.165,
      "intensity": 2,
      "centerX": 0.475,
      "centerY": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-CircuitBoard.fs",
    "path": "ISF/DM-CircuitBoard.fs",
    "name": "Circuit Board",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "gridSize": 17.125,
      "flowSpeed": 0.99,
      "traceWidth": 0.337,
      "pulseIntensity": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-MorphingShapes.fs",
    "path": "ISF/DM-MorphingShapes.fs",
    "name": "Morphing Shapes",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "morphSpeed": 0.2995,
      "shapeSize": 0.5,
      "rotateSpeed": 2,
      "edgeWidth": 0.1,
      "glowAmount": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-GeometricPulse.fs",
    "path": "ISF/DM-GeometricPulse.fs",
    "name": "Geometric Pulse",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "pulseSpeed": 0.9375,
      "shapeType": 3.22,
      "ringCount": 7.52,
      "thickness": 0.1,
      "rotateSpeed": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-WormholeTravel.fs",
    "path": "ISF/DM-WormholeTravel.fs",
    "name": "Wormhole Travel",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "speed": 0.5,
      "twist": 0.615,
      "segments": 8.8,
      "colorSpeed": 1.4
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-DNAHelix.fs",
    "path": "ISF/DM-DNAHelix.fs",
    "name": "DNAHelix",
    "category": "visual",
    "audioNative": true,
    "defaults": {
      "rotateSpeed": 0.1,
      "verticalSpeed": 2,
      "helixWidth": 0.5,
      "baseSize": 0.05,
      "basePairs": 20
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DM-SpectrumWaves.fs",
    "path": "ISF/DM-SpectrumWaves.fs",
    "name": "Spectrum Waves",
    "category": "visual",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:HexGrid.fs",
    "path": "ISF/HexGrid.fs",
    "name": "Hex Grid",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "scale": 12.685,
      "lineWidth": 0.2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SacredGeometry.fs",
    "path": "ISF/SacredGeometry.fs",
    "name": "Sacred Geometry",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "rings": 8,
      "rotation": 0.06,
      "pulseSpeed": 0.27,
      "lineThickness": 0.005,
      "colorCycle": 0.065
    },
    "requiresImage": false
  },
  {
    "id": "desktop:VoronoiPulse.fs",
    "path": "ISF/VoronoiPulse.fs",
    "name": "Voronoi Pulse",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:TriangleMesh.fs",
    "path": "ISF/TriangleMesh.fs",
    "name": "Triangle Mesh",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:RadialBurst.fs",
    "path": "ISF/RadialBurst.fs",
    "name": "Radial Burst",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "rayCount": 47.2,
      "rotSpeed": -0.78,
      "pulseSpeed": 0.165,
      "rayWidth": 0.9,
      "centerGlow": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:WarpTunnel.fs",
    "path": "ISF/WarpTunnel.fs",
    "name": "Warp Tunnel",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:CircuitBoard.fs",
    "path": "ISF/CircuitBoard.fs",
    "name": "Circuit Board",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "gridScale": 9.2,
      "flowSpeed": 0.27,
      "nodeGlow": 3,
      "lineWidth": 0.05455,
      "colorMode": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ConcentricRings.fs",
    "path": "ISF/ConcentricRings.fs",
    "name": "Concentric Rings",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "ringFreq": 14.45,
      "expandSpeed": 1.92,
      "thickness": 0.1,
      "wobble": 1,
      "colorSpread": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SpiralVortex.fs",
    "path": "ISF/SpiralVortex.fs",
    "name": "Spiral Vortex",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:WaterRipples.fs",
    "path": "ISF/WaterRipples.fs",
    "name": "Water Ripples",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "rippleSpeed": 0.5,
      "rippleCount": 10,
      "amplitude": 0.2,
      "decay": 1.315
    },
    "requiresImage": false
  },
  {
    "id": "desktop:FireEmber.fs",
    "path": "ISF/FireEmber.fs",
    "name": "Fire Ember",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "emberCount": 164,
      "riseSpeed": 0.271,
      "emberSize": 0.01721,
      "flickerSpeed": 5,
      "spreadX": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:CloudFlow.fs",
    "path": "ISF/CloudFlow.fs",
    "name": "Cloud Flow",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "cloudSpeed": 0.505,
      "cloudDensity": 0.442,
      "cloudScale": 3.835,
      "turbulence": 0.75,
      "brightness": 0.9125
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AuroraWaves.fs",
    "path": "ISF/AuroraWaves.fs",
    "name": "Aurora Waves",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "waveSpeed": 1.0025,
      "waveCount": 8,
      "intensity": 2.2625,
      "verticalPos": 0.37
    },
    "requiresImage": false
  },
  {
    "id": "desktop:LiquidMetal.fs",
    "path": "ISF/LiquidMetal.fs",
    "name": "Liquid Metal",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "flowSpeed": 0.575,
      "blobScale": 10,
      "reflectivity": 1,
      "metalTint": 0.97,
      "surfaceTension": 0.1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ElectricStorm.fs",
    "path": "ISF/ElectricStorm.fs",
    "name": "Electric Storm",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "boltFrequency": 5,
      "branchCount": 7.195,
      "boltThickness": 0.0184799999999998,
      "glowIntensity": 2.3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:OceanWaves.fs",
    "path": "ISF/OceanWaves.fs",
    "name": "Ocean Waves",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "waveSpeed": 1.4395,
      "waveHeight": 0.3,
      "waveCount": 7.8,
      "foamAmount": 0,
      "depthFade": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:TreeRings.fs",
    "path": "ISF/TreeRings.fs",
    "name": "Tree Rings",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:NeonPulse.fs",
    "path": "ISF/NeonPulse.fs",
    "name": "Neon Pulse",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "barCount": 20,
      "pulseSpeed": 1.4225,
      "glowAmount": 3,
      "barWidth": 0.28
    },
    "requiresImage": false
  },
  {
    "id": "desktop:StrobeFlash.fs",
    "path": "ISF/StrobeFlash.fs",
    "name": "Strobe Flash",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:FractalZoom.fs",
    "path": "ISF/FractalZoom.fs",
    "name": "Fractal Zoom",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "zoomSpeed": 0.157,
      "complexity": 6.26,
      "colorSpeed": 0.145,
      "brightness": 1.3175
    },
    "requiresImage": false
  },
  {
    "id": "desktop:LaserBeams.fs",
    "path": "ISF/LaserBeams.fs",
    "name": "Laser Beams",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "beamCount": 10.13,
      "scanSpeed": 0.1435,
      "beamWidth": 0.017905,
      "glowSize": 0.1411,
      "hueShift": 0.205
    },
    "requiresImage": false
  },
  {
    "id": "desktop:WaveformScope.fs",
    "path": "ISF/WaveformScope.fs",
    "name": "Waveform Scope",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "amplitude": 0.402
    },
    "requiresImage": false
  },
  {
    "id": "desktop:GlitchBlocks.fs",
    "path": "ISF/GlitchBlocks.fs",
    "name": "Glitch Blocks",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "blockSize": 8.48,
      "colorGlitch": 0.675,
      "intensity": 0.55,
      "rgbSplit": 0.069
    },
    "requiresImage": false
  },
  {
    "id": "desktop:RetroSun.fs",
    "path": "ISF/RetroSun.fs",
    "name": "Retro Sun",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "sunSize": 0.288,
      "gridSpeed": 1.99,
      "lineCount": 20,
      "glowAmount": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ParticleField.fs",
    "path": "ISF/ParticleField.fs",
    "name": "Particle Field",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "particleCount": 200,
      "flySpeed": 0.1,
      "particleSize": 0.02,
      "trailLength": 0.28,
      "colorVariation": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:MoirePattern.fs",
    "path": "ISF/MoirePattern.fs",
    "name": "Moire Pattern",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "lineFreq": 10,
      "rotateSpeed": 0.275,
      "offset": 0.1125,
      "lineWidth": 0.264,
      "layers": 4.54
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ColorCycle.fs",
    "path": "ISF/ColorCycle.fs",
    "name": "Color Cycle",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "cycleSpeed": 0.2805
    },
    "requiresImage": false
  },
  {
    "id": "desktop:MeltingBlobs.fs",
    "path": "ISF/MeltingBlobs.fs",
    "name": "Melting Blobs",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.271,
      "scale": 3.87,
      "meltiness": 0.88,
      "colorShift": 0.41,
      "metallic": 0.785
    },
    "requiresImage": false
  },
  {
    "id": "desktop:MorphingLava.fs",
    "path": "ISF/MorphingLava.fs",
    "name": "Morphing Lava",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "flowSpeed": 1.601,
      "cellScale": 6.42,
      "heatIntensity": 0.455,
      "morphAmount": 0.795,
      "colorTemp": 0.59
    },
    "requiresImage": false
  },
  {
    "id": "desktop:FluidMorph.fs",
    "path": "ISF/FluidMorph.fs",
    "name": "Fluid Morph",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "complexity": 3.625,
      "smoothness": 0.8875
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ChromeFlow.fs",
    "path": "ISF/ChromeFlow.fs",
    "name": "Chrome Flow",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "flowSpeed": 1.259,
      "waveScale": 4.24,
      "iridescence": 0.885,
      "reflectivity": 1,
      "warpAmount": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:BlobbyMetal.fs",
    "path": "ISF/BlobbyMetal.fs",
    "name": "Blobby Metal",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.05,
      "blobCount": 11.595,
      "blobSize": 0.5815,
      "metalness": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:MercuryPool.fs",
    "path": "ISF/MercuryPool.fs",
    "name": "Mercury Pool",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "rippleSpeed": 0.6795,
      "turbulence": 0.385,
      "reflectionSharp": 0.545
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DeepMetalBlobs.fs",
    "path": "ISF/DeepMetalBlobs.fs",
    "name": "Deep Metal Blobs",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.1355,
      "blobCount": 10,
      "depth": 0.425,
      "fluidAmount": 1,
      "metalness": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:LiquidDepth.fs",
    "path": "ISF/LiquidDepth.fs",
    "name": "Liquid Depth",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.0215,
      "layers": 5,
      "parallax": 0,
      "fluidity": 0.86
    },
    "requiresImage": false
  },
  {
    "id": "desktop:OrganicMetal.fs",
    "path": "ISF/OrganicMetal.fs",
    "name": "Organic Metal",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:TitaniumRipple.fs",
    "path": "ISF/TitaniumRipple.fs",
    "name": "Titanium Ripple",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "rippleScale": 5.725,
      "roughness": 0,
      "anisotropy": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:CopperPatina.fs",
    "path": "ISF/CopperPatina.fs",
    "name": "Copper Patina",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "patinaAmount": 0.465,
      "detail": 1.02,
      "copperTone": 1,
      "shimmer": 0.795
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ParticleSwarm.fs",
    "path": "ISF/ParticleSwarm.fs",
    "name": "Particle Swarm",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "particleCount": 100,
      "trailLength": 1,
      "glow": 0.805
    },
    "requiresImage": false
  },
  {
    "id": "desktop:EmberCloud.fs",
    "path": "ISF/EmberCloud.fs",
    "name": "Ember Cloud",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "emberCount": 144.6,
      "emberSize": 1.6625,
      "heatGlow": 0.93
    },
    "requiresImage": false
  },
  {
    "id": "desktop:MetalParticles.fs",
    "path": "ISF/MetalParticles.fs",
    "name": "Metal Particles",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.115,
      "particleCount": 80,
      "particleSize": 2,
      "metalDepth": 1,
      "hue": 0.6,
      "reflectionStrength": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DataStream.fs",
    "path": "ISF/DataStream.fs",
    "name": "Data Stream",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "streamCount": 30,
      "dataIntensity": 1,
      "hue": 0.61,
      "waveAmplitude": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:WaveMatrix.fs",
    "path": "ISF/WaveMatrix.fs",
    "name": "Wave Matrix",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.24,
      "waveFrequency": 2.215,
      "gridSize": 9.75,
      "perspective": 0,
      "hue": 0.58,
      "waveHeight": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DataPulse.fs",
    "path": "ISF/DataPulse.fs",
    "name": "Data Pulse",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "waveCount": 8,
      "amplitude": 1,
      "complexity": 5,
      "pulseSpeed": 2.13
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SolLeWittCubes.fs",
    "path": "ISF/SolLeWittCubes.fs",
    "name": "Sol Le Witt Cubes",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "cubeCount": 16,
      "lineWidth": 1.7125
    },
    "requiresImage": false
  },
  {
    "id": "desktop:LeWittPyramid.fs",
    "path": "ISF/LeWittPyramid.fs",
    "name": "Le Witt Pyramid",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "pyramidCount": 11.45,
      "lineWeight": 2.1125,
      "zoom": 1.0965,
      "rotateStyle": 1.18,
      "divisions": 2.95,
      "colorMode": 0.035
    },
    "requiresImage": false
  },
  {
    "id": "desktop:GeometricWall.fs",
    "path": "ISF/GeometricWall.fs",
    "name": "Geometric Wall",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "pattern": 4,
      "density": 21.45,
      "strokeWeight": 3,
      "colorCount": 4
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ModularGrid.fs",
    "path": "ISF/ModularGrid.fs",
    "name": "Modular Grid",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.115,
      "gridSize": 6.71,
      "variation": 0.625,
      "strokeWeight": 1.4,
      "depth": 0.04
    },
    "requiresImage": false
  },
  {
    "id": "desktop:NestedCubes.fs",
    "path": "ISF/NestedCubes.fs",
    "name": "Nested Cubes",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "cubeCount": 20,
      "lineWeight": 1.758,
      "zoom": 2.379,
      "colorGradient": 1,
      "spacing": 0.0512
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-LiquidFill.fs",
    "path": "ISF/SM-LiquidFill.fs",
    "name": "Liquid Fill",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "waveAmplitude": 0.2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-GravityDropBalls.fs",
    "path": "ISF/SM-GravityDropBalls.fs",
    "name": "Gravity Drop Balls",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "ballCount": 20,
      "gravity": 1.1545,
      "bounceDamping": 0.95,
      "colorMode": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-ParticleNodes.fs",
    "path": "ISF/SM-ParticleNodes.fs",
    "name": "Particle Nodes",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "nodeCount": 30,
      "nodeSize": 0.025,
      "lineThickness": 0.01,
      "speed": 1.0975,
      "depthLayers": 3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-ConcentricEcho.fs",
    "path": "ISF/SM-ConcentricEcho.fs",
    "name": "Concentric Echo",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "layerCount": 30,
      "lineWidth": 0.01143,
      "animSpeed": 0.825,
      "rotationSpeed": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-EdgePlasma.fs",
    "path": "ISF/SM-EdgePlasma.fs",
    "name": "Edge Plasma",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "intensity": 1.8375,
      "edgeWidth": 0.3,
      "speed": 0.216,
      "complexity": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-RippleTank.fs",
    "path": "ISF/SM-RippleTank.fs",
    "name": "Ripple Tank",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-RicochetLaser.fs",
    "path": "ISF/SM-RicochetLaser.fs",
    "name": "Ricochet Laser",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-RainDrops.fs",
    "path": "ISF/SM-RainDrops.fs",
    "name": "Rain Drops",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "rainDensity": 40,
      "fallSpeed": 0.92,
      "dropLength": 0.02,
      "splashSize": 0.08,
      "puddleHeight": 0.15,
      "windAngle": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-ElectricFence.fs",
    "path": "ISF/SM-ElectricFence.fs",
    "name": "Electric Fence",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-BubbleRise.fs",
    "path": "ISF/SM-BubbleRise.fs",
    "name": "Bubble Rise",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "bubbleCount": 30,
      "maxSize": 0.1,
      "riseSpeed": 0.252,
      "wobble": 0.0675,
      "iridescence": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-PongArena.fs",
    "path": "ISF/SM-PongArena.fs",
    "name": "Pong Arena",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "ballCount": 30,
      "ballSpeed": 1.446,
      "trailLength": 1,
      "ballGlow": 4,
      "edgeReact": 1,
      "sizeVariation": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-VineCrawl.fs",
    "path": "ISF/SM-VineCrawl.fs",
    "name": "Vine Crawl",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-WaveformWalls.fs",
    "path": "ISF/SM-WaveformWalls.fs",
    "name": "Waveform Walls",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-DigitalRain.fs",
    "path": "ISF/SM-DigitalRain.fs",
    "name": "Digital Rain",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "trailLength": 0.6,
      "brightness": 1.8275
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-GyroscopeRings.fs",
    "path": "ISF/SM-GyroscopeRings.fs",
    "name": "Gyroscope Rings",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "ringCount": 8,
      "ringWidth": 0.02,
      "rotSpeed": 0.4625
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-TunnelDepth.fs",
    "path": "ISF/SM-TunnelDepth.fs",
    "name": "Tunnel Depth",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-FacadeCrack.fs",
    "path": "ISF/SM-FacadeCrack.fs",
    "name": "Facade Crack",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "crackProgress": 0.09
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-AsymmetricLightning.fs",
    "path": "ISF/SM-AsymmetricLightning.fs",
    "name": "Asymmetric Lightning",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "branchDepth": 0.2748,
      "arcWidth": 0.008
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-BrickCollapse.fs",
    "path": "ISF/SM-BrickCollapse.fs",
    "name": "Brick Collapse",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "collapseProgress": 0.535
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-GeometricAbyss.fs",
    "path": "ISF/SM-GeometricAbyss.fs",
    "name": "Geometric Abyss",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "tileScale": 9.66
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-SurfaceShatter.fs",
    "path": "ISF/SM-SurfaceShatter.fs",
    "name": "Surface Shatter",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-WireframeCorridor.fs",
    "path": "ISF/SM-WireframeCorridor.fs",
    "name": "Wireframe Corridor",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-ShatterGlass.fs",
    "path": "ISF/SM-ShatterGlass.fs",
    "name": "Shatter Glass",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-MagneticFilings.fs",
    "path": "ISF/SM-MagneticFilings.fs",
    "name": "Magnetic Filings",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "fieldStrength": 2.884,
      "filingDensity": 80,
      "filingLength": 1,
      "poleCount": 8
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-ErosionGrowth.fs",
    "path": "ISF/SM-ErosionGrowth.fs",
    "name": "Erosion Growth",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 0.955,
      "growthRate": 1,
      "crystalScale": 2,
      "symmetry": 12
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-GravitationalLensing.fs",
    "path": "ISF/SM-GravitationalLensing.fs",
    "name": "Gravitational Lensing",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "lensStrength": 3,
      "starDensity": 293,
      "accretionDisk": 1,
      "eventHorizon": 0.01
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-PressureMap.fs",
    "path": "ISF/SM-PressureMap.fs",
    "name": "Pressure Map",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "sensitivity": 0.1,
      "stressWave": 1,
      "noiseAmount": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-TidalPool.fs",
    "path": "ISF/SM-TidalPool.fs",
    "name": "Tidal Pool",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 1.26
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-SwarmIntelligence.fs",
    "path": "ISF/SM-SwarmIntelligence.fs",
    "name": "Swarm Intelligence",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "boidCount": 100,
      "boidSize": 1,
      "trailLength": 1,
      "cohesion": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-SeismicPulse.fs",
    "path": "ISF/SM-SeismicPulse.fs",
    "name": "Seismic Pulse",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 0.31,
      "pulseRate": 2.42,
      "decayRate": 0.946
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-MoltenCore.fs",
    "path": "ISF/SM-MoltenCore.fs",
    "name": "Molten Core",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "coreTemp": 0.3,
      "crustThickness": 0.345,
      "crackDensity": 16,
      "crackWidth": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-SmokeChamber.fs",
    "path": "ISF/SM-SmokeChamber.fs",
    "name": "Smoke Chamber",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 0.6675,
      "smokeDensity": 1,
      "turbulence": 0,
      "riseSpeed": 0.29,
      "curlStrength": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-SpiderWeb.fs",
    "path": "ISF/SM-SpiderWeb.fs",
    "name": "Spider Web",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "radialStrands": 16.2,
      "spiralDensity": 40,
      "strandWidth": 1,
      "dewDrops": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-AuroraCurtain.fs",
    "path": "ISF/SM-AuroraCurtain.fs",
    "name": "Aurora Curtain",
    "category": "simulation",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:SM-CellularMitosis.fs",
    "path": "ISF/SM-CellularMitosis.fs",
    "name": "Cellular Mitosis",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "cellScale": 7.005,
      "nucleusSize": 0.6,
      "divisionRate": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-RadarSweep.fs",
    "path": "ISF/SM-RadarSweep.fs",
    "name": "Radar Sweep",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 0.24,
      "sweepWidth": 0.8,
      "blipSize": 1,
      "fadeTrail": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:SM-TopographicFlood.fs",
    "path": "ISF/SM-TopographicFlood.fs",
    "name": "Topographic Flood",
    "category": "simulation",
    "audioNative": true,
    "defaults": {
      "speed": 1,
      "contourCount": 40,
      "lineWidth": 0.1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AR-SDFMorph.fs",
    "path": "ISF/AR-SDFMorph.fs",
    "name": "SDFMorph",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "morphSpeed": 1.21,
      "scale": 1.775,
      "emission": 3.685,
      "waveDisplace": 0.2205
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AR-DisplacementSphere.fs",
    "path": "ISF/AR-DisplacementSphere.fs",
    "name": "Displacement Sphere",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "sphereRadius": 1.46,
      "displaceAmount": 1,
      "waveDetail": 0.3075,
      "iridescence": 2.91,
      "brightness": 3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AR-SmokeTendrils.fs",
    "path": "ISF/AR-SmokeTendrils.fs",
    "name": "Smoke Tendrils",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "tendrilCount": 8.38,
      "curlStrength": 2.4425,
      "smokeDensity": 4,
      "colorRichness": 1.37,
      "turbulence": 2,
      "breathRate": 0.56
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AR-Ferrofluid.fs",
    "path": "ISF/AR-Ferrofluid.fs",
    "name": "Ferrofluid",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "spikeHeight": 0.9415,
      "spikeCount": 11.36,
      "metallic": 0.972,
      "surfaceTension": 0.3545,
      "baseRadius": 1.405
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AR-FrequencyTerrain.fs",
    "path": "ISF/AR-FrequencyTerrain.fs",
    "name": "Frequency Terrain",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "terrainHeight": 2.7925,
      "flySpeed": 0.244,
      "fogDensity": 0.02,
      "erosion": 2,
      "gridGlow": 0.13,
      "colorIntensity": 2.35
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AR-SpectralFluid.fs",
    "path": "ISF/AR-SpectralFluid.fs",
    "name": "Spectral Fluid",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "vortexScale": 1.65,
      "colorCycleRate": 0.078,
      "filamentSharp": 1.4875,
      "fluidSpeed": 1.91,
      "density": 1.425,
      "beatPulse": 1.14
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AR-GeodesicBloom.fs",
    "path": "ISF/AR-GeodesicBloom.fs",
    "name": "Geodesic Bloom",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "domeRadius": 0.8
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AR-MobiusStrip.fs",
    "path": "ISF/AR-MobiusStrip.fs",
    "name": "Mobius Strip",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "stripWidth": 0.304
    },
    "requiresImage": false
  },
  {
    "id": "desktop:90_CircuitTrace.fs",
    "path": "ISF/90_CircuitTrace.fs",
    "name": "Circuit Trace",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "traceScale": 10.32,
      "glowWidth": 3.965,
      "pulseSpeed": 4.0325,
      "colorTemp": 0.96
    },
    "requiresImage": false
  },
  {
    "id": "desktop:91_StainedGlass.fs",
    "path": "ISF/91_StainedGlass.fs",
    "name": "Stained Glass",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.29,
      "cellCount": 7.93,
      "edgeWidth": 0.01,
      "saturation": 1,
      "lightAngle": 3.768
    },
    "requiresImage": false
  },
  {
    "id": "desktop:92_WovenFabric.fs",
    "path": "ISF/92_WovenFabric.fs",
    "name": "Woven Fabric",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.5,
      "weaveScale": 5.86,
      "threadWidth": 0.81675,
      "colorMix": 0.325,
      "depth": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:93_MosaicTiles.fs",
    "path": "ISF/93_MosaicTiles.fs",
    "name": "Mosaic Tiles",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "tileCount": 11.075,
      "gapWidth": 0.0456999999999999,
      "rotateAmount": 0,
      "colorVariety": 2.94
    },
    "requiresImage": false
  },
  {
    "id": "desktop:94_NeonOutline.fs",
    "path": "ISF/94_NeonOutline.fs",
    "name": "Neon Outline",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "shapeCount": 10,
      "glowIntensity": 1.3915,
      "lineWidth": 0.0237
    },
    "requiresImage": false
  },
  {
    "id": "desktop:95_PixelSort.fs",
    "path": "ISF/95_PixelSort.fs",
    "name": "Pixel Sort",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "speed": 1.66,
      "streakLength": 1,
      "noiseScale": 5.815,
      "sortDirection": 0.85,
      "colorIntensity": 1.208
    },
    "requiresImage": false
  },
  {
    "id": "desktop:96_LinocutPrint.fs",
    "path": "ISF/96_LinocutPrint.fs",
    "name": "Linocut Print",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.5,
      "hatchDensity": 57.95,
      "hatchAngle": 1.6171,
      "contrast": 1.0625
    },
    "requiresImage": false
  },
  {
    "id": "desktop:97_TopoContour.fs",
    "path": "ISF/97_TopoContour.fs",
    "name": "Topo Contour",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "contourCount": 16.375,
      "terrainScale": 2.015,
      "lineSharp": 2.9865,
      "colorMode": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:98_LEDMatrix.fs",
    "path": "ISF/98_LEDMatrix.fs",
    "name": "LEDMatrix",
    "category": "audio",
    "audioNative": true,
    "defaults": {
      "pixelCount": 12.48,
      "pixelGap": 0.05
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_03_LavaLampDepth.fs",
    "path": "ISF/cube shaders/ROOM_03_LavaLampDepth.fs",
    "name": "Lava Lamp Depth",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 1.488,
      "depth": 0.64,
      "blobSize": 1.455,
      "blobCount": 5.725
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_04_FireflyGarden.fs",
    "path": "ISF/cube shaders/ROOM_04_FireflyGarden.fs",
    "name": "Firefly Garden",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 3.142,
      "intensity": 3,
      "depth": 0.4955,
      "wanderRadius": 1.793
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_06_NeonGrid.fs",
    "path": "ISF/cube shaders/ROOM_06_NeonGrid.fs",
    "name": "Neon Grid",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 1.7965,
      "intensity": 3,
      "depth": 1.0565,
      "colorShift": 2.2294,
      "gridDensity": 3.935,
      "glowWidth": 0.813
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_08_ElectricTendrils.fs",
    "path": "ISF/cube shaders/ROOM_08_ElectricTendrils.fs",
    "name": "Electric Tendrils",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 1.4455,
      "intensity": 2.636,
      "depth": 0.7675,
      "colorShift": 6.2486,
      "branchCount": 6,
      "jitterAmount": 3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_09_LiquidChrome.fs",
    "path": "ISF/cube shaders/ROOM_09_LiquidChrome.fs",
    "name": "Liquid Chrome",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 1.754,
      "depth": 1.643,
      "flowSpeed": 0.332,
      "iridescence": 1.5
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_13_PortalVortex.fs",
    "path": "ISF/cube shaders/ROOM_13_PortalVortex.fs",
    "name": "Portal Vortex",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 0.6655,
      "intensity": 2.706,
      "depth": 1.0055,
      "spiralTightness": 6.6,
      "armCount": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_14_PlasmaWalls.fs",
    "path": "ISF/cube shaders/ROOM_14_PlasmaWalls.fs",
    "name": "Plasma Walls",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 0.3925,
      "depth": 0.3,
      "colorShift": 0.7222,
      "plasmaScale": 0.3,
      "edgeWidth": 0.6
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_16_CascadePour.fs",
    "path": "ISF/cube shaders/ROOM_16_CascadePour.fs",
    "name": "Cascade Pour",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 0.451,
      "intensity": 1.628,
      "depth": 0.827,
      "colorShift": 6.2172,
      "flowRate": 1.978,
      "viscosity": 0.872
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_18_GlitchDepth.fs",
    "path": "ISF/cube shaders/ROOM_18_GlitchDepth.fs",
    "name": "Glitch Depth",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 0.8605,
      "intensity": 3,
      "depth": 2,
      "glitchRate": 0.485,
      "corruption": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/ROOM_20_MoltenCore.fs",
    "path": "ISF/cube shaders/ROOM_20_MoltenCore.fs",
    "name": "Molten Core",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 0.841,
      "intensity": 1.418,
      "depth": 0.8525,
      "colorShift": 2.669,
      "coreSize": 1.543,
      "heatWarp": 2.7
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_01_SphereCluster.fs",
    "path": "ISF/cube shaders/3D_01_SphereCluster.fs",
    "name": "3D 01 Sphere Cluster",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 1.012,
      "camDist": 6.5,
      "sphereSize": 0.281,
      "density": 1.1125
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_02_ChromeSpheres.fs",
    "path": "ISF/cube shaders/3D_02_ChromeSpheres.fs",
    "name": "3D 02 Chrome Spheres",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 1.38,
      "intensity": 1.348,
      "camDist": 4.55,
      "reflectivity": 1,
      "sphereCount": 7
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_03_WireframeGeo.fs",
    "path": "ISF/cube shaders/3D_03_WireframeGeo.fs",
    "name": "3D 03 Wireframe Geo",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 2.04,
      "intensity": 1.124,
      "camDist": 6.35,
      "colorShift": 1.727,
      "wireThickness": 0.0185,
      "meshDensity": 2.9
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_04_CubeField.fs",
    "path": "ISF/cube shaders/3D_04_CubeField.fs",
    "name": "3D 04 Cube Field",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 3,
      "colorShift": 0.8792,
      "objectSize": 0.32,
      "spacing": 1.81
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_05_NeonCubes.fs",
    "path": "ISF/cube shaders/3D_05_NeonCubes.fs",
    "name": "3D 05 Neon Cubes",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 1.29,
      "intensity": 2.841,
      "camDist": 6.1,
      "glowRadius": 0.5,
      "cubeScale": 1.991
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_06_MetaballBlob.fs",
    "path": "ISF/cube shaders/3D_06_MetaballBlob.fs",
    "name": "3D 06 Metaball Blob",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 2.958,
      "smoothness": 0.6605,
      "blobScale": 0.674
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_08_OrganicSculpt.fs",
    "path": "ISF/cube shaders/3D_08_OrganicSculpt.fs",
    "name": "3D 08 Organic Sculpt",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 2.328,
      "deformation": 2,
      "complexity": 3.475
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_10_ShatteredCube.fs",
    "path": "ISF/cube shaders/3D_10_ShatteredCube.fs",
    "name": "3D 10 Shattered Cube",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 3,
      "camDist": 2,
      "colorShift": 3.6424,
      "shatter": 2,
      "fragmentCount": 12
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_11_InfiniteHall.fs",
    "path": "ISF/cube shaders/3D_11_InfiniteHall.fs",
    "name": "3D 11 Infinite Hall",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 0.855,
      "intensity": 0.2,
      "camDist": 0.175,
      "colorShift": 0.7222,
      "hallWidth": 5,
      "repeatDist": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_12_PlasmaSphere.fs",
    "path": "ISF/cube shaders/3D_12_PlasmaSphere.fs",
    "name": "3D 12 Plasma Sphere",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 0.428,
      "camDist": 4.37,
      "plasmaSize": 1.6,
      "tendrilLength": 3
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_13_TorusKnot.fs",
    "path": "ISF/cube shaders/3D_13_TorusKnot.fs",
    "name": "3D 13 Torus Knot",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "tubeRadius": 0.41675,
      "twistAmount": 8
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_14_NebulaCloud.fs",
    "path": "ISF/cube shaders/3D_14_NebulaCloud.fs",
    "name": "3D 14 Nebula Cloud",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "speed": 1.18,
      "intensity": 0.922,
      "camDist": 5.41,
      "colorShift": 6.2486,
      "cloudDensity": 1.418,
      "starDensity": 2
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_15_MorphCube.fs",
    "path": "ISF/cube shaders/3D_15_MorphCube.fs",
    "name": "3D 15 Morph Cube",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 1.096,
      "camDist": 3.59,
      "morphSpeed": 0.8995,
      "surfaceRoughness": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_16_VoxelTerrain.fs",
    "path": "ISF/cube shaders/3D_16_VoxelTerrain.fs",
    "name": "3D 16 Voxel Terrain",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 1.46,
      "camDist": 5.51,
      "colorShift": 5.809,
      "terrainHeight": 5,
      "voxelSize": 0.1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_17_BubbleMass.fs",
    "path": "ISF/cube shaders/3D_17_BubbleMass.fs",
    "name": "3D 17 Bubble Mass",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 2.496,
      "camDist": 3.95,
      "bubbleSize": 1.5,
      "transparency": 0.8695
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_18_LatticeWorld.fs",
    "path": "ISF/cube shaders/3D_18_LatticeWorld.fs",
    "name": "3D 18 Lattice World",
    "category": "room",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_19_AbstractPillars.fs",
    "path": "ISF/cube shaders/3D_19_AbstractPillars.fs",
    "name": "3D 19 Abstract Pillars",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 1.516,
      "pillarHeight": 6,
      "pillarDensity": 3.425
    },
    "requiresImage": false
  },
  {
    "id": "desktop:cube shaders/3D_20_MoltenCore.fs",
    "path": "ISF/cube shaders/3D_20_MoltenCore.fs",
    "name": "3D 20 Molten Core",
    "category": "room",
    "audioNative": true,
    "defaults": {
      "intensity": 0.941,
      "camDist": 4.16,
      "lavaIntensity": 1.4195,
      "deformation": 0.8475
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ThreeBody.fs",
    "path": "ISF/ThreeBody.fs",
    "name": "Three Body",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:AbyssalHelix.fs",
    "path": "ISF/AbyssalHelix.fs",
    "name": "Abyssal Helix",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "spiralArms": 4.025,
      "helixTightness": 0.1,
      "biolumColor": 0.8,
      "depthPressure": 1,
      "tentacleLength": 0.996,
      "chromatophores": 0.275,
      "rotateView": -0.157,
      "swimSpeed": 0.425,
      "nervePulseWidth": 0.1,
      "abyssalFog": 0.175
    },
    "requiresImage": false
  },
  {
    "id": "desktop:AstralCrystal.fs",
    "path": "ISF/AstralCrystal.fs",
    "name": "Astral Crystal",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "rotSpeed": 0.155,
      "zoom": 1.055,
      "noiseAmt": 1,
      "noiseScale": 2.61,
      "colorBase": 0.77,
      "prismSpread": 0.7,
      "brightness": 1.7705
    },
    "requiresImage": false
  },
  {
    "id": "desktop:CosmicVoronoiTunnel.fs",
    "path": "ISF/CosmicVoronoiTunnel.fs",
    "name": "Cosmic Voronoi Tunnel",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "wireGlow": 2.811,
      "cellDim": 0.099,
      "dustAmount": 0.42
    },
    "requiresImage": false
  },
  {
    "id": "desktop:DimensionalRift.fs",
    "path": "ISF/DimensionalRift.fs",
    "name": "Dimensional Rift",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "riftWidth": 1,
      "foldDepth": 4.04,
      "dimensionBleed": 0.135,
      "voronoiDensity": 5.165,
      "extrudeRift": 0,
      "energyColor": 0.475,
      "volumetricDensity": 1
    },
    "requiresImage": false
  },
  {
    "id": "desktop:InfiniteOrigami.fs",
    "path": "ISF/InfiniteOrigami.fs",
    "name": "Infinite Origami",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "foldLayers": 1,
      "creaseSharpness": 0.505,
      "paperColor": 0.24,
      "metallicInk": 1,
      "rotateX": -0.18
    },
    "requiresImage": false
  },
  {
    "id": "desktop:MirrorRealm.fs",
    "path": "ISF/MirrorRealm.fs",
    "name": "Mirror Realm",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "horizonRadius": 0.944,
      "realityShards": 7.65,
      "timeDistortion": 0.3225,
      "mirrorDepth": 80,
      "hawkingRate": 0.03,
      "gravityWell": 0,
      "shardExtrude": 1,
      "parallelWorlds": 1,
      "viewRotate": 0.1256,
      "colorRealm": 0.33,
      "entropyRate": 0.575,
      "singularityGlow": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:MyceliumNetwork.fs",
    "path": "ISF/MyceliumNetwork.fs",
    "name": "Mycelium Network",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "growthRate": 0.9375,
      "networkDensity": 0.712,
      "soilLayers": 1.472,
      "sporulation": 0.82,
      "hyphaeWidth": 0.379,
      "fruitingBodies": 1,
      "biolumGlow": 1.5,
      "rotateView": 0.09,
      "tiltView": -0.21,
      "signalColor": 0.62,
      "decomposition": 0.81
    },
    "requiresImage": false
  },
  {
    "id": "desktop:NeuralVoronoiMatrix.fs",
    "path": "ISF/NeuralVoronoiMatrix.fs",
    "name": "Neural Voronoi Matrix",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "cellScale": 3.43,
      "bioLuminance": 1.08
    },
    "requiresImage": false
  },
  {
    "id": "desktop:OssiferousRadiolaria.fs",
    "path": "ISF/OssiferousRadiolaria.fs",
    "name": "Ossiferous Radiolaria",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "shells": 4.64,
      "spineThickness": 0.08,
      "axopodLength": 2,
      "axopodCount": 10.8,
      "diffractionStrength": 1.5,
      "silicaClarity": 1,
      "zoom": 1.2855
    },
    "requiresImage": false
  },
  {
    "id": "desktop:PlasmaCalligraphy.fs",
    "path": "ISF/PlasmaCalligraphy.fs",
    "name": "Plasma Calligraphy",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "brushLayers": 14.675,
      "inkViscosity": 1,
      "strokeWidth": 1,
      "writingSpeed": 0.1725,
      "inkColor": 0.52,
      "poolingGlow": 2,
      "evaporation": 0.885,
      "paperTexture": 0.61,
      "trailFade": 1,
      "rotationBias": 12
    },
    "requiresImage": false
  },
  {
    "id": "desktop:PrismaticVoid.fs",
    "path": "ISF/PrismaticVoid.fs",
    "name": "Prismatic Void",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "foldIterations": 9,
      "zoom": 0.65,
      "voronoiScale": 8,
      "extrudeAmt": 1,
      "brightness": 1.1925,
      "colorBase": 0,
      "reflections": 0
    },
    "requiresImage": false
  },
  {
    "id": "desktop:QuantumLattice.fs",
    "path": "ISF/QuantumLattice.fs",
    "name": "Quantum Lattice",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "morphState": 0.59,
      "speed": 0.125,
      "voronoiScale": 1,
      "rotateX": -2.7946
    },
    "requiresImage": false
  },
  {
    "id": "desktop:StellarNursery.fs",
    "path": "ISF/StellarNursery.fs",
    "name": "Stellar Nursery",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 0.42,
      "hue": 0.225,
      "marchStep": 0.334,
      "density": 0.8,
      "cameraX": 0.72,
      "cameraY": 0.34,
      "zoom": 0.967
    },
    "requiresImage": false
  },
  {
    "id": "desktop:VoronoiTerrainFlyover.fs",
    "path": "ISF/VoronoiTerrainFlyover.fs",
    "name": "Voronoi Terrain Flyover",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "waveSpeed": 1.425,
      "rotAngle": 3.7052,
      "expFalloff": 1,
      "hue": 0.755,
      "satScale": 0.1925,
      "terrainBlend": 0.8695,
      "edgeSharp": 18650,
      "waveHeight": 0.675,
      "cameraHeight": 1.9525,
      "cameraTilt": 1.002
    },
    "requiresImage": false
  },
  {
    "id": "desktop:VoronoiWarpDrive.fs",
    "path": "ISF/VoronoiWarpDrive.fs",
    "name": "Voronoi Warp Drive",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:00-flowerz.fs",
    "path": "ISF/00-flowerz.fs",
    "name": "flowerz",
    "category": "other",
    "audioNative": true,
    "defaults": {
      "fractalDepth": 3.875,
      "fractalChaos": 3.181
    },
    "requiresImage": true
  },
  {
    "id": "desktop:08_ArmillarySphere.fs",
    "path": "ISF/08_ArmillarySphere.fs",
    "name": "Armillary Sphere",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 1.85,
      "ringCount": 8,
      "tilt": 0.25
    },
    "requiresImage": false
  },
  {
    "id": "desktop:18_SpiralGalaxy.fs",
    "path": "ISF/18_SpiralGalaxy.fs",
    "name": "Spiral Galaxy",
    "category": "generator",
    "audioNative": true,
    "defaults": {
      "speed": 2,
      "arms": 6,
      "twist": 5.7125
    },
    "requiresImage": false
  },
  {
    "id": "desktop:00-refikky.fs",
    "path": "ISF/00-refikky.fs",
    "name": "refikky",
    "category": "other",
    "audioNative": true,
    "defaults": {
      "fractalDepth": 2.025,
      "fractalChaos": 1.621,
      "flowSpeed": 1.183,
      "zDepthScale": 3,
      "warpIntensity": 1,
      "plasticGloss": 2,
      "posX": -0.06,
      "posY": -0.46
    },
    "requiresImage": true
  },
  {
    "id": "desktop:AnotherGridThingy.fs",
    "path": "ISF/AnotherGridThingy.fs",
    "name": "Another Grid Thingy",
    "category": "other",
    "audioNative": true,
    "defaults": {
      "grid_size": [
        0.57,
        1
      ],
      "bright": 0.212,
      "glow_size": 20,
      "rate": 0.74,
      "rndseed": [
        0,
        0.29
      ]
    },
    "requiresImage": false
  },
  {
    "id": "desktop:gpt.fs",
    "path": "ISF/gpt.fs",
    "name": "gpt",
    "category": "other",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:grigM_gs61327.fs",
    "path": "ISF/grigM_gs61327.fs",
    "name": "grig M gs61327",
    "category": "other",
    "audioNative": true,
    "defaults": {
      "speed": 1.44,
      "r_par": 18.25,
      "zoom": 0.97,
      "par_2": 0.01
    },
    "requiresImage": false
  },
  {
    "id": "desktop:InfiniteGrid.fs",
    "path": "ISF/InfiniteGrid.fs",
    "name": "Infinite Grid",
    "category": "other",
    "audioNative": true,
    "defaults": {
      "gridLayers": 15,
      "gridIntensity": 2,
      "orangeLineIntensity": 2,
      "pillarIntensity": 2,
      "coreIntensity": 2,
      "dustAmount": 2,
      "beamIntensity": 0.94,
      "cameraHeight": 1,
      "zoom": 0.725
    },
    "requiresImage": false
  },
  {
    "id": "desktop:ThreeBody-ButterflyI.fs",
    "path": "ISF/ThreeBody-ButterflyI.fs",
    "name": "Three Body-Butterfly I",
    "category": "other",
    "audioNative": true,
    "defaults": {
      "effectStyle": 2,
      "zoom": 1.5285
    },
    "requiresImage": false
  },
  {
    "id": "desktop:Trippy Mandala.fs",
    "path": "ISF/Trippy Mandala.fs",
    "name": "Trippy Mandala",
    "category": "other",
    "audioNative": true,
    "defaults": {
      "zoom_speed": 0.075,
      "color_speed": 1.275,
      "chaos_factor": 1.32,
      "symmetry": 4.515
    },
    "requiresImage": false
  },
  {
    "id": "desktop:Untitled Shader.fs",
    "path": "ISF/Untitled Shader.fs",
    "name": "Untitled Shader",
    "category": "other",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:AstralJellyfish.fs",
    "path": "ISF/AstralJellyfish.fs",
    "name": "Astral Jellyfish",
    "category": "other",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:LIVE-NebulaCathedral.fs",
    "path": "ISF/LIVE-NebulaCathedral.fs",
    "name": "LIVE-Nebula Cathedral",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:LIVE-LaserLattice.fs",
    "path": "ISF/LIVE-LaserLattice.fs",
    "name": "LIVE-Laser Lattice",
    "category": "room",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:LIVE-ObsidianFlow.fs",
    "path": "ISF/LIVE-ObsidianFlow.fs",
    "name": "LIVE-Obsidian Flow",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:LIVE-AuroraSpectrum.fs",
    "path": "ISF/LIVE-AuroraSpectrum.fs",
    "name": "LIVE-Aurora Spectrum",
    "category": "audio",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:LIVE-FractalBloom.fs",
    "path": "ISF/LIVE-FractalBloom.fs",
    "name": "LIVE-Fractal Bloom",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:LIVE-PulseHalo.fs",
    "path": "ISF/LIVE-PulseHalo.fs",
    "name": "LIVE-Pulse Halo",
    "category": "audio",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:LIVE-PrismStorm.fs",
    "path": "ISF/LIVE-PrismStorm.fs",
    "name": "LIVE-Prism Storm",
    "category": "room",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:LIVE-TheWitness.fs",
    "path": "ISF/LIVE-TheWitness.fs",
    "name": "LIVE-The Witness",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  },
  {
    "id": "desktop:Quotron.fs",
    "path": "ISF/Quotron.fs",
    "name": "Quotron",
    "category": "generator",
    "audioNative": true,
    "defaults": {},
    "requiresImage": false
  }
] as MobileShader[]);

export const STARTING_SHADER_ID = 'room-ember-drift';

export function findShader(id: string): MobileShader | undefined {
  return MOBILE_SHADERS.find(s => s.id === id);
}
