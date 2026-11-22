/**
 * Analog Synth's WGSL (see graph.ts for the passes).
 *
 *   cs_clock  moves the running phases on by one frame (compute)
 *   fs_synth  three raster oscillators, their modulation, the mixer, the
 *             picture controls and feedback from the last frame
 *   fs_keep   copies the new frame aside, for the next frame's feedback
 *   fs_out    the tube: scanlines, color bleed, roll and glow
 *
 * Bindings: 0 the patch (128 floats, see patch.ts), 1 the frame block the
 * core writes (time, audio), 2 the picture read, 3 the sampler, 4 the input
 * layer, 5 the running phases.
 *
 * Signal model (patch.ts MODEL_KEY): 2 reads its phases from the clock
 * buffer and works the oscillators out in the order the patch needs; 1 is
 * the first release's math, kept for patches saved with it.
 */
import { SCENE3D_FRAME_WGSL } from '../renderer/scene3dFrame';
import { SLOT_MODEL, SLOT_ORDER } from './patch';

/** Floats in the running-phase buffer: oscillators A–C, LFOs 1–3, roll, spare. */
export const CLOCK_FLOATS = 8;

/** What both modules read: the patch, its rates and the signal model. */
const COMMON_WGSL = /* wgsl */ `
${SCENE3D_FRAME_WGSL}
@group(0) @binding(0) var<uniform> controls: array<vec4f, 32>;
@group(0) @binding(1) var<uniform> frame: SceneFrame;

const TAU = 6.2831853;

fn prm(i: u32) -> f32 { return controls[i >> 2u][i & 3u]; }
fn model2() -> bool { return prm(${SLOT_MODEL}u) > 1.5; }

// Frequency: 15 Hz to the line rate, ten octaves on the knob, plus fine.
fn osc_freq(n: u32) -> f32 { let b = n * 12u; return 60.0 * pow(2.0, prm(b) * 10.0 - 2.0) + prm(b + 1u) * 2.0; }
// How fast an oscillator's pattern drifts: its frequency, less the part its
// sync locks to the picture (none from H on).
fn drift_rate(n: u32) -> f32 { return max(0.0, 1.0 - prm(n * 12u + 2u)) * osc_freq(n); }
// LFO: 0.002 Hz to 10 Hz on its knob.
fn lfo_rate(k: u32) -> f32 { return 0.002 * pow(5000.0, prm(48u + k * 2u)); }
// Roll: picture heights a second.
fn roll_rate() -> f32 { return prm(56u) * 0.35; }
`;

/**
 * The running phases, one frame on (signal model 2). Each phase moves by its
 * rate times the frame's step, from wherever it is, so turning a rate knob
 * changes the speed and never jumps the picture, however long the set has
 * run; and the phases stay within one turn, so they stay exact for days.
 * The buffer starts at zero and the core empties it when an export starts,
 * so two renders of a show step identically. The core gives each frame one
 * step (none for a repeated export frame).
 */
export const VIDEOSYNTH_CLOCK_WGSL = /* wgsl */ `
${COMMON_WGSL}
@group(0) @binding(2) var<storage, read_write> clock: array<f32, ${CLOCK_FLOATS}>;

@compute @workgroup_size(1)
fn cs_clock() {
  let dt = clamp(frame.delta, 0.0, 0.1);
  for (var n = 0u; n < 3u; n++) { clock[n] = fract(clock[n] + drift_rate(n) * dt); }
  for (var k = 0u; k < 3u; k++) { clock[3u + k] = fract(clock[3u + k] + lfo_rate(k) * dt); }
  clock[6] = fract(clock[6] + roll_rate() * dt);
}
`;

export const VIDEOSYNTH_WGSL = /* wgsl */ `
${COMMON_WGSL}
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var input_tex: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> clock: array<f32, ${CLOCK_FLOATS}>;

struct VsOut { @builtin(position) clip: vec4f, @location(0) uv: vec2f }

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var out: VsOut;
  out.clip = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2f(p.x, 1.0 - p.y);
  return out;
}

fn hsv(h: f32, s: f32, v: f32) -> vec3f {
  let k = fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0));
  let c = clamp(abs(k * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
  return v * mix(vec3f(1.0), c, s);
}
fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

// LFO: shape from rising saw through triangle to falling saw.
fn lfo(k: u32) -> f32 {
  let skew = clamp(prm(49u + k * 2u), 0.001, 0.999);
  var p = fract(frame.time * lfo_rate(k) + f32(k) * 0.37);
  if (model2()) { p = fract(clock[3u + k] + f32(k) * 0.37); }
  return select((1.0 - p) / (1.0 - skew), p / skew, p < skew);
}

// The beam: one waveform drawn across the picture. Frequency is against the
// picture rate: whole multiples of 60 stand still as horizontal bands;
// near the line rate they turn into vertical stripes. Sync blends free
// running (drifting) into still horizontal (H) and then still vertical (V).
// Model 2: the drift is oscillator n's running phase (cs_clock), and the
// frequency as modulated (FM) only shapes the pattern across the raster.
// Model 1: the drift is frequency × clock, FM included.
fn osc_phase(freq: f32, sync: f32, uv: vec2f, n: u32) -> f32 {
  let lines = prm(60u);
  let raster = (uv.y + uv.x / lines) / 60.0;
  let h = freq / 60.0 * uv.y;
  let v = freq / 60.0 * uv.x * prm(59u);
  if (sync < 1.0) {
    if (model2()) { return clock[n] + mix(freq * raster, h, sync); }
    return mix(freq * (frame.time + raster), h, sync);
  }
  return mix(h, v, sync - 1.0);
}
fn wave(phase: f32, shape: f32) -> f32 {
  let p = fract(phase);
  let saw = p;
  let tri = 1.0 - abs(2.0 * p - 1.0);
  let sine = 0.5 - 0.5 * cos(TAU * p);
  return select(mix(tri, sine, shape * 2.0 - 1.0), mix(saw, tri, shape * 2.0), shape < 0.5);
}

// Picture-wide state the sources read.
var<private> feedback_luma: f32;
var<private> osc_values: vec3f;
// Each oscillator's level as drawn: its knob plus its patched level input.
var<private> osc_levels: vec3f;
var<private> input_luma: f32;
var<private> input_rgb: vec3f;

/** Whether an input has a source at all (Off, or anything out of range, is none). */
fn plugged(k: f32) -> bool { let i = u32(k + 0.5); return i >= 1u && i <= 13u; }

fn source(k: f32) -> f32 {
  let i = u32(k + 0.5);
  switch i {
    case 1u: { return feedback_luma; }
    case 2u: { return osc_values.x; }
    case 3u: { return osc_values.y; }
    case 4u: { return osc_values.z; }
    case 5u: { return lfo(0u); }
    case 6u: { return lfo(1u); }
    case 7u: { return lfo(2u); }
    case 8u: { return frame.bass; }
    case 9u: { return frame.mid; }
    case 10u: { return frame.treble; }
    case 11u: { return frame.energy; }
    case 12u: { return frame.kick; }
    case 13u: { return input_luma; }
    default: { return 0.0; }
  }
}

/** An oscillator's wave from its knobs alone, before any modulation. */
fn bare_wave(n: u32, uv: vec2f) -> f32 {
  let b = n * 12u;
  return wave(osc_phase(osc_freq(n), prm(b + 2u), uv, n), prm(b + 3u));
}

fn oscillator(n: u32, uv: vec2f) -> vec4f {
  let b = n * 12u;
  let react = prm(58u);
  let m2 = model2();
  var freq = osc_freq(n);
  // FM swings the frequency both ways about the knob; with no source there is
  // nothing to swing it (the music only deepens FM that has a source).
  // Model 1 swung it with no source too, down by the FM amount.
  if (plugged(prm(b + 8u)) || !m2) {
    let fm = prm(b + 7u) + react * frame.bass * 0.25;
    freq *= 1.0 + (source(prm(b + 8u)) * 2.0 - 1.0) * fm;
  }
  var phase = osc_phase(freq, prm(b + 2u), uv, n);
  let mode = u32(prm(b + 4u) + 0.5);
  let m = source(prm(b + 6u)) * prm(b + 5u);
  var hue = prm(b + 9u) + react * frame.treble * 0.08;
  if (mode == 0u) { phase += m * 2.0; }
  var v = wave(phase, prm(b + 3u));
  // Drawing the input: its brightness is the signal, its color tinted by the oscillator's.
  let draws_input = prm(61u + n) > 0.5;
  if (draws_input) { v = input_luma; }
  if (mode == 1u) {
    // Key: the wave shape sets the threshold; the source pushes past it,
    // either way about its middle. With no source the threshold stays put
    // (model 1 moved it down by half the Mod amount).
    let th = 0.5;
    let push = select(0.0, m - prm(b + 5u) * 0.5, plugged(prm(b + 6u)) || !m2);
    v = smoothstep(th - 0.01, th + 0.01, v + push);
  } else if (mode == 2u) {
    hue += m;
  }
  // Level, plus whatever is patched into this oscillator's level input.
  var level = prm(b + 11u);
  if (prm(64u + n * 2u) > 0.5) { level = clamp(level + source(prm(64u + n * 2u)) * prm(65u + n * 2u), 0.0, 1.0); }
  osc_levels[n] = level;
  var rgb = hsv(hue, prm(b + 10u), v * level);
  if (draws_input && mode != 1u) { rgb = mix(input_rgb, hsv(hue, 1.0, v), prm(b + 10u)) * level; }
  return vec4f(rgb, v);
}

// Turn a color about the gray axis.
fn hue_rotate(c: vec3f, a: f32) -> vec3f {
  let k = vec3f(0.57735);
  let ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
// A source read straight at a point, before the picture is moved: the picture
// (the last frame, or the frame being finished), an oscillator's bare wave,
// an LFO, the music, or the input. Cables into the picture and feedback
// read sources this way, since those decide where the oscillators draw.
fn raw_source(k: f32, uv: vec2f) -> f32 {
  let i = u32(k + 0.5);
  if (i == 1u) { return luma(textureSampleLevel(src, samp, uv, 0.0).rgb); }
  if (i >= 2u && i <= 4u) { return bare_wave(i - 2u, uv); }
  if (i == 13u) { return luma(textureSampleLevel(input_tex, samp, uv, 0.0).rgb); }
  return source(k);
}
/** A patch-bay input: its cable's source times its amount (nothing when unpatched). */
fn jack(slot: u32, uv: vec2f) -> f32 {
  if (prm(slot) < 0.5) { return 0.0; }
  return raw_source(prm(slot), uv) * prm(slot + 1u);
}

fn rotate(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * p.x - s * p.y, s * p.x + c * p.y); }

@fragment
fn fs_synth(in: VsOut) -> @location(0) vec4f {
  let aspect = prm(59u);
  let react = prm(58u);
  // Feedback: last frame, zoomed, turned and drifted about the center.
  var f = (in.uv - 0.5) * vec2f(aspect, 1.0);
  let zoom = max(prm(43u) + react * frame.kick * 0.02 + jack(70u, in.uv) * 0.06, 0.5);
  f = rotate(f / zoom, prm(44u) * 0.1 + jack(72u, in.uv) * 0.05) / vec2f(aspect, 1.0) + 0.5 - vec2f(prm(45u), prm(46u));
  var last = textureSampleLevel(src, samp, f, 0.0).rgb;
  if (any(f < vec2f(0.0)) || any(f > vec2f(1.0))) { last = vec3f(0.0); }
  feedback_luma = luma(last);

  // The picture's own move, turn, scale and mirror, applied to where the beam draws.
  let shift = vec2f(prm(37u) + jack(80u, in.uv), -(prm(38u) + jack(82u, in.uv)));
  var p = (in.uv - 0.5 - shift * 0.5) * vec2f(aspect, 1.0);
  p = rotate(p, -(prm(39u) + jack(76u, in.uv) * 3.14159)) / max(prm(40u) * (1.0 + jack(78u, in.uv)), 0.01);
  let segments = prm(41u);
  if (segments >= 1.0) {
    let wedge = TAU / (segments * 2.0);
    var a = atan2(p.y, p.x);
    a = abs(fract(a / (wedge * 2.0)) * 2.0 - 1.0) * wedge;
    p = vec2f(cos(a), sin(a)) * length(p);
  }
  let uv = p / vec2f(aspect, 1.0) + 0.5;
  input_rgb = textureSampleLevel(input_tex, samp, uv, 0.0).rgb;
  input_luma = luma(input_rgb);

  var outs: array<vec4f, 3>;
  if (model2()) {
    // In the order the patch needs (patch.ts oscillatorOrder), so each one
    // hears the ones it listens to as drawn. One not worked out yet (in a
    // ring of cables, or itself) is heard as its bare wave: one step of
    // delay, the same everywhere and every frame.
    osc_values = vec3f(bare_wave(0u, uv), bare_wave(1u, uv), bare_wave(2u, uv));
    for (var i = 0u; i < 3u; i++) {
      let n = min(u32(prm(${SLOT_ORDER}u + i) + 0.5), 2u);
      outs[n] = oscillator(n, uv);
      osc_values[n] = outs[n].w;
    }
  } else {
    // Model 1: A, then B, then C; each hears only the ones before it.
    osc_values = vec3f(0.0);
    outs[0] = oscillator(0u, uv); osc_values.x = outs[0].w;
    outs[1] = oscillator(1u, uv); osc_values.y = outs[1].w;
    outs[2] = oscillator(2u, uv); osc_values.z = outs[2].w;
  }
  let a = outs[0];
  let b = outs[1];
  let c = outs[2];

  var col = vec3f(0.0);
  let mixer = u32(prm(36u) + 0.5);
  if (mixer == 0u) { col = max(a.rgb, max(b.rgb, c.rgb)); }
  else if (mixer == 1u) {
    // Layer: each above cuts out the dark of the one below.
    col = mix(a.rgb, b.rgb, smoothstep(0.15, 0.3, luma(b.rgb)));
    col = mix(col, c.rgb, smoothstep(0.15, 0.3, luma(c.rgb)));
  } else {
    // YUV: A is brightness, B and C the color, each at its level as drawn
    // (knob plus patched level input).
    let y = a.w * osc_levels.x;
    let u = (b.w - 0.5) * osc_levels.y * 0.9;
    let vv = (c.w - 0.5) * osc_levels.z * 0.9;
    col = vec3f(y + 1.14 * vv, y - 0.395 * u - 0.581 * vv, y + 2.032 * u);
  }
  // Trails keep the brighter of now and the fed-back last frame.
  // The fed-back picture turns its color a little each frame.
  let fed = hue_rotate(last, prm(47u) * TAU * 0.1 + jack(74u, in.uv) * 0.5);
  col = max(clamp(col, vec3f(0.0), vec3f(1.0)), fed * prm(42u) * 0.985);
  return vec4f(col, 1.0);
}

@fragment
fn fs_keep(in: VsOut) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(src, samp, in.uv, 0.0).rgb, 1.0);
}

fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453); }

@fragment
fn fs_out(in: VsOut) -> @location(0) vec4f {
  let dims = vec2f(textureDimensions(src));
  var uv = in.uv;
  // Roll: the picture slips vertically, nudged on a hit. Model 2 rolls by its
  // running phase; model 1 by knob × clock, where a hit's nudge grew with
  // how long the set had run.
  var roll = (prm(56u) + prm(58u) * frame.kick * 0.15) * frame.time * 0.35;
  if (model2()) { roll = clock[6] + prm(58u) * frame.kick * 0.05; }
  uv.y = fract(uv.y + roll + jack(84u, in.uv) * 0.25);
  // Color bleed: red and blue spread sideways, as a tube's color carrier did.
  let bleed = prm(55u) * 4.0 / dims.x;
  var col = vec3f(
    textureSampleLevel(src, samp, uv - vec2f(bleed, 0.0), 0.0).r,
    textureSampleLevel(src, samp, uv, 0.0).g,
    textureSampleLevel(src, samp, uv + vec2f(bleed, 0.0), 0.0).b,
  );
  // Glow: a soft halo round the bright parts.
  let g = prm(57u);
  if (g > 0.0) {
    var halo = vec3f(0.0);
    for (var i = 0; i < 8; i++) {
      let a = f32(i) * TAU / 8.0;
      halo += textureSampleLevel(src, samp, uv + vec2f(cos(a), sin(a)) * 6.0 / dims, 0.0).rgb;
    }
    col += max(halo / 8.0 - 0.35, vec3f(0.0)) * g * 1.5;
  }
  // Scanlines: the dark between the beam's lines.
  let line = 0.5 + 0.5 * cos(in.uv.y * prm(60u) * TAU);
  col *= 1.0 - prm(54u) * (1.0 - line) * 0.7;
  col += (hash(in.clip.xy + vec2f(frame.time * 60.0)) - 0.5) * 0.02;
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

export const VIDEOSYNTH_SHADER_ID = 'videosynth/analog-synth';
export const VIDEOSYNTH_CLOCK_SHADER_ID = 'videosynth/clock';
export const videosynthPrecompileCommands = () => [
  { type: 'precompile_shader' as const, shader_id: VIDEOSYNTH_CLOCK_SHADER_ID, stage: 'compute' as const, entry: 'cs_clock', source: VIDEOSYNTH_CLOCK_WGSL },
  { type: 'precompile_shader' as const, shader_id: VIDEOSYNTH_SHADER_ID, stage: 'render' as const, entry: 'fs_synth', source: VIDEOSYNTH_WGSL },
];
