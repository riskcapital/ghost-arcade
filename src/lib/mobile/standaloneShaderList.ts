// Curated mobile shader list — see docs/mobile-shader-curation.md for the
// audit that produced these picks. 36 shaders total: 20 ship-as-is (already
// audio-reactive at the GLSL level) + 16 augment (visually strong + cheap;
// audio reactivity will be patched in at load time).
//
// All shaders here are 2D / low-iteration. Raymarched and feedback shaders
// are explicitly excluded — phone GPUs can't sustain 60fps on those.

export type MobileShaderCategory = 'audio' | 'room' | 'pattern' | 'fluid' | 'kinetic';

export interface MobileShader {
  id: string;
  /** Path relative to `public/` — fetch as `import.meta.env.BASE_URL + path`. */
  path: string;
  /** Display name for the UI — short, no prefix. */
  name: string;
  category: MobileShaderCategory;
  /** True if the .fs already references audio uniforms. */
  audioNative: boolean;
  /**
   * Audio-reactivity injection patches applied at load time when
   * `audioNative` is false. Each pattern matches a line in the .fs and
   * gets replaced with the patched version. Keep the matches tight so
   * they don't accidentally rewrite unrelated code.
   */
  audioInject?: { match: RegExp; replace: string }[];
}

export const MOBILE_SHADERS: MobileShader[] = [
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

export const STARTING_SHADER_ID = 'room-ember-drift';

export function findShader(id: string): MobileShader | undefined {
  return MOBILE_SHADERS.find(s => s.id === id);
}
