/**
 * Analog Synth's WGSL (see graph.ts for the passes).
 *
 *   fs_synth  three raster oscillators, their modulation, the mixer, the
 *             picture controls and feedback from the last frame
 *   fs_keep   copies the new frame aside, for the next frame's feedback
 *   fs_out    the tube: scanlines, colour bleed, roll and glow
 *
 * Bindings: 0 the patch (64 floats, see patch.ts), 1 the frame block the
 * core writes (time, audio), 2 the picture read, 3 the sampler.
 */
import { SCENE3D_FRAME_WGSL } from '../renderer/scene3dFrame';

export const VIDEOSYNTH_WGSL = /* wgsl */ `
${SCENE3D_FRAME_WGSL}
@group(0) @binding(0) var<uniform> controls: array<vec4f, 16>;
@group(0) @binding(1) var<uniform> frame: SceneFrame;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var input_tex: texture_2d<f32>;

const TAU = 6.2831853;

fn prm(i: u32) -> f32 { return controls[i >> 2u][i & 3u]; }

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

// LFO: 0.002 Hz to 10 Hz on its knob; shape from rising saw through triangle to falling saw.
fn lfo(k: u32) -> f32 {
  let rate = 0.002 * pow(5000.0, prm(48u + k * 2u));
  let skew = clamp(prm(49u + k * 2u), 0.001, 0.999);
  let p = fract(frame.time * rate + f32(k) * 0.37);
  return select((1.0 - p) / (1.0 - skew), p / skew, p < skew);
}

// The beam: one waveform drawn across the picture. Frequency is against the
// picture rate: whole multiples of 60 stand still as horizontal bands;
// near the line rate they turn into vertical stripes. Sync blends free
// running (drifting) into still horizontal (H) and then still vertical (V).
fn osc_phase(freq: f32, sync: f32, uv: vec2f) -> f32 {
  let lines = prm(60u);
  let free = freq * (frame.time + (uv.y + uv.x / lines) / 60.0);
  let h = freq / 60.0 * uv.y;
  let v = freq / 60.0 * uv.x * prm(59u);
  if (sync < 1.0) { return mix(free, h, sync); }
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
var<private> input_luma: f32;
var<private> input_rgb: vec3f;

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

fn oscillator(n: u32, uv: vec2f) -> vec4f {
  let b = n * 12u;
  let react = prm(58u);
  // Frequency: 15 Hz to the line rate, ten octaves on the knob, plus fine.
  var freq = 60.0 * pow(2.0, prm(b) * 10.0 - 2.0) + prm(b + 1u) * 2.0;
  let fm = prm(b + 7u) + react * frame.bass * 0.25;
  freq *= 1.0 + (source(prm(b + 8u)) * 2.0 - 1.0) * fm;
  var phase = osc_phase(freq, prm(b + 2u), uv);
  let mode = u32(prm(b + 4u) + 0.5);
  let m = source(prm(b + 6u)) * prm(b + 5u);
  var hue = prm(b + 9u) + react * frame.treble * 0.08;
  if (mode == 0u) { phase += m * 2.0; }
  var v = wave(phase, prm(b + 3u));
  // Drawing the input: its brightness is the signal, its colour tinted by the oscillator's.
  let draws_input = prm(61u + n) > 0.5;
  if (draws_input) { v = input_luma; }
  if (mode == 1u) {
    // Key: the wave shape sets the threshold; the source pushes past it.
    let th = 0.5;
    v = smoothstep(th - 0.01, th + 0.01, v + (m - prm(b + 5u) * 0.5));
  } else if (mode == 2u) {
    hue += m;
  }
  var rgb = hsv(hue, prm(b + 10u), v * prm(b + 11u));
  if (draws_input && mode != 1u) { rgb = mix(input_rgb, hsv(hue, 1.0, v), prm(b + 10u)) * prm(b + 11u); }
  return vec4f(rgb, v);
}

// Turn a colour about the grey axis.
fn hue_rotate(c: vec3f, a: f32) -> vec3f {
  let k = vec3f(0.57735);
  let ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
}
fn rotate(p: vec2f, a: f32) -> vec2f { let c = cos(a); let s = sin(a); return vec2f(c * p.x - s * p.y, s * p.x + c * p.y); }

@fragment
fn fs_synth(in: VsOut) -> @location(0) vec4f {
  let aspect = prm(59u);
  let react = prm(58u);
  // Feedback: last frame, zoomed, turned and drifted about the centre.
  var f = (in.uv - 0.5) * vec2f(aspect, 1.0);
  let zoom = prm(43u) + react * frame.kick * 0.02;
  f = rotate(f / zoom, prm(44u) * 0.1) / vec2f(aspect, 1.0) + 0.5 - vec2f(prm(45u), prm(46u));
  var last = textureSampleLevel(src, samp, f, 0.0).rgb;
  if (any(f < vec2f(0.0)) || any(f > vec2f(1.0))) { last = vec3f(0.0); }
  feedback_luma = luma(last);

  // The picture's own move, turn, scale and mirror, applied to where the beam draws.
  var p = (in.uv - 0.5 - vec2f(prm(37u), -prm(38u)) * 0.5) * vec2f(aspect, 1.0);
  p = rotate(p, -prm(39u)) / max(prm(40u), 0.01);
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

  // A, then B, then C: each can listen to the ones before it.
  osc_values = vec3f(0.0);
  let a = oscillator(0u, uv); osc_values.x = a.w;
  let b = oscillator(1u, uv); osc_values.y = b.w;
  let c = oscillator(2u, uv); osc_values.z = c.w;

  var col = vec3f(0.0);
  let mixer = u32(prm(36u) + 0.5);
  if (mixer == 0u) { col = max(a.rgb, max(b.rgb, c.rgb)); }
  else if (mixer == 1u) {
    // Layer: each above cuts out the dark of the one below.
    col = mix(a.rgb, b.rgb, smoothstep(0.15, 0.3, luma(b.rgb)));
    col = mix(col, c.rgb, smoothstep(0.15, 0.3, luma(c.rgb)));
  } else {
    // YUV: A is brightness, B and C the colour.
    let y = a.w * prm(11u);
    let u = (b.w - 0.5) * prm(23u) * 0.9;
    let vv = (c.w - 0.5) * prm(35u) * 0.9;
    col = vec3f(y + 1.14 * vv, y - 0.395 * u - 0.581 * vv, y + 2.032 * u);
  }
  // Trails keep the brighter of now and the fed-back last frame.
  // The fed-back picture turns its colour a little each frame.
  let fed = hue_rotate(last, prm(47u) * TAU * 0.1);
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
  // Roll: the picture slips vertically, more on a hit.
  let roll = prm(56u) + prm(58u) * frame.kick * 0.15;
  uv.y = fract(uv.y + roll * frame.time * 0.35);
  // Colour bleed: red and blue spread sideways, as a tube's colour carrier did.
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
export const videosynthPrecompileCommands = () => [
  { type: 'precompile_shader' as const, shader_id: VIDEOSYNTH_SHADER_ID, stage: 'render' as const, entry: 'fs_synth', source: VIDEOSYNTH_WGSL },
];
