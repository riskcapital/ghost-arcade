import type { RendererCommand } from '$lib/api/native-renderer';
import { buildDriftWgsl } from '$lib/effects/ghostfx/scenes/drift.wgsl';
import {
  LIQUID_ADVECT_DYE_WGSL,
  LIQUID_ADVECT_VEL_WGSL,
  LIQUID_BUBBLE_RENDER_WGSL,
  LIQUID_BUBBLE_SIM_WGSL,
  LIQUID_DIVERGENCE_WGSL,
  LIQUID_JACOBI_WGSL,
  LIQUID_RENDER_WGSL,
  LIQUID_SPLAT_WGSL,
  LIQUID_SUBTRACT_WGSL,
} from '$lib/effects/ghostfx/scenes/liquid.wgsl';
import { buildRibbonsWgsl } from '$lib/effects/ghostfx/scenes/ribbons.wgsl';
import { buildSpheresWgsl } from '$lib/effects/ghostfx/scenes/spheres.wgsl';
import { POST_WGSL } from '$lib/effects/ghostfx/shaders/post.wgsl';
import type { SignalFrame } from '$lib/mediapipe/signals';
import { PERFORMER_WORLD_RENDER_WGSL } from '$lib/performer/nativeWorldRender.wgsl';

type NativePluginPrecompileCommand = Extract<RendererCommand, { type: 'precompile_shader' }>;

export const GHOSTFX_DRIFT_PARTICLES = 50_000;
export const GHOSTFX_DRIFT_TRAIL_LENGTH = 16;
export const GHOSTFX_RIBBON_COUNT = 4_096;
export const GHOSTFX_RIBBON_TRAIL_LENGTH = 48;
export const GHOSTFX_LIQUID_SIM_WIDTH = 384;
export const GHOSTFX_LIQUID_JACOBI_ITERATIONS = 30;
export const GHOSTFX_LIQUID_MAX_SPLATS = 32;
export const GHOSTFX_LIQUID_BUBBLE_COUNT = 384;
export const GHOSTFX_SPHERE_COUNT = 1536;
export const GHOSTFX_SPHERE_PUFF_COUNT = 320;
export const HAND_FX_PARTICLE_COUNT = 8_192;
const ANALYZER_FFT_BINS = 256;
const ANALYZER_WAVEFORM_SAMPLES = 512;
const ANALYZER_HISTORY_ROWS = 256;
export type NativePluginGraphState = {
  scene: string;
  prevFrameTime: number;
  historyHead: number;
  historyPhase?: number;
  handPoints?: number[];
  liquidVelIsA?: boolean;
  liquidDyeIsA?: boolean;
  liquidPrevBeatPulse?: number;
  liquidAmbientAcc?: number;
};

export type NativePluginGraphOptions = {
  kind: 'ghostfx' | 'handfx' | 'performer-world';
  sourceId: string;
  params: Record<string, any>;
  width: number;
  height: number;
  time: number;
  frameDelta: number;
  frameIndex: number;
  audio: {
    active: boolean;
    bass: number;
    mid: number;
    treble: number;
    energy: number;
    beatPhase: number;
    beatPulse: number;
    amplitude: number;
  };
  fftData?: Float32Array | null;
  waveformData?: Float32Array | null;
  handFrame?: SignalFrame | null;
  state?: NativePluginGraphState | null;
  reset?: boolean;
};

export type NativePluginGraphBuildResult = {
  config: Record<string, unknown>;
  state: NativePluginGraphState;
};

export type NativePluginBufferUpdate = {
  id: string;
  initialB64: string;
};

export type NativeHandInputUpdateResult = {
  buffers: NativePluginBufferUpdate[];
  state: NativePluginGraphState;
};

function nativeGhostFxRender(source: string, includesTrails: boolean): string {
  let result = source
    .replace('pad1: f32, pad2: f32,', 'bgAlpha: f32, trailIntensity: f32,')
    .replace(
      'return vec4<f32>(col, 1.0);',
      'return vec4<f32>(col * u.bgAlpha, u.bgAlpha);',
    );
  if (includesTrails) {
    result = result.replace(
      'let col = in.color * in.brightness * 0.6;\n  return vec4<f32>(col, in.brightness);',
      'let brightness = in.brightness * u.trailIntensity;\n  let col = in.color * brightness * 0.6;\n  return vec4<f32>(col, brightness);',
    );
  }
  return result;
}

const driftSource = buildDriftWgsl(GHOSTFX_DRIFT_PARTICLES, GHOSTFX_DRIFT_TRAIL_LENGTH);
const ribbonSource = buildRibbonsWgsl(GHOSTFX_RIBBON_COUNT, GHOSTFX_RIBBON_TRAIL_LENGTH);
const spheresSource = buildSpheresWgsl(GHOSTFX_SPHERE_COUNT, GHOSTFX_SPHERE_PUFF_COUNT);
const drift = { ...driftSource, render: nativeGhostFxRender(driftSource.render, true) };
const ribbons = { ...ribbonSource, render: nativeGhostFxRender(ribbonSource.render, false) };

const ANALYZER_COMPUTE_WGSL = /* wgsl */ `
struct U {
  resolution: vec2<f32>, time: f32, dt: f32,
  historyHead: u32, layoutMode: u32, orientation: u32, colorMap: u32,
  gain: f32, minDb: f32, maxDb: f32, scrollSpeed: f32,
  lineWidth: f32, chromaGlow: f32, bgAlpha: f32, beat: f32,
  chromaStyle: u32, waveStyle: u32, showLabels: u32, pad0: u32,
};
struct AudioInput { values: array<f32, 768> };
struct History { values: array<f32, 65536> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> audio: AudioInput;
@group(0) @binding(2) var<storage, read_write> history: History;

@compute @workgroup_size(64)
fn cs_update(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= 256u) { return; }
  let db = audio.values[gid.x];
  let level = clamp((db - u.minDb) / max(1.0, u.maxDb - u.minDb), 0.0, 1.0) * u.gain;
  history.values[(u.historyHead % 256u) * 256u + gid.x] = clamp(level, 0.0, 1.0);
}
`;

const ANALYZER_RENDER_WGSL = /* wgsl */ `
struct U {
  resolution: vec2<f32>, time: f32, dt: f32,
  historyHead: u32, layoutMode: u32, orientation: u32, colorMap: u32,
  gain: f32, minDb: f32, maxDb: f32, scrollSpeed: f32,
  lineWidth: f32, chromaGlow: f32, bgAlpha: f32, beat: f32,
  chromaStyle: u32, waveStyle: u32, showLabels: u32, pad0: u32,
};
struct AudioInput { values: array<f32, 768> };
struct History { values: array<f32, 65536> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> audio: AudioInput;
@group(0) @binding(2) var<storage, read> history: History;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
  var out: VOut; out.pos = vec4(p[i], 0.0, 1.0); out.uv = p[i] * 0.5 + 0.5; return out;
}
fn cmap(t0: f32) -> vec3<f32> {
  let t = clamp(t0, 0.0, 1.0);
  if (u.colorMap == 1u) { return vec3(0.18 + 0.72*t, 0.05 + 0.92*sqrt(t), 0.36 + 0.35*(1.0-t)); }
  if (u.colorMap == 2u) { return vec3(0.04 + 0.96*t, 0.01 + 0.38*t*t, 0.18 + 0.62*(1.0-t)); }
  if (u.colorMap == 3u) { return mix(vec3(0.05,0.12,0.16), vec3(1.0,0.32,0.26), t); }
  if (u.colorMap == 4u) { return mix(vec3(0.01,0.04,0.10), vec3(0.25,0.94,1.0), t); }
  if (u.colorMap == 5u) { return vec3(t); }
  return vec3(smoothstep(0.0,0.55,t), t*t, 0.12 + 0.68*(1.0-t));
}
fn fft(bin: u32) -> f32 {
  let db = audio.values[min(bin, 255u)];
  return clamp((db-u.minDb)/max(1.0,u.maxDb-u.minDb)*u.gain, 0.0, 1.0);
}
fn historyLevel(uv0: vec2<f32>) -> f32 {
  var binCoord = uv0.y;
  var ageCoord = 1.0 - uv0.x;
  if (u.orientation == 1u) {
    binCoord = uv0.x;
    ageCoord = uv0.y;
  } else if (u.orientation == 2u) {
    let p = uv0 * 2.0 - 1.0;
    binCoord = fract(atan2(p.y,p.x)/6.2831853+0.5);
    ageCoord = clamp(length(p),0.0,1.0);
  }
  let age = u32(clamp(ageCoord*255.0, 0.0, 255.0));
  let row = (u.historyHead + 255u - age) % 256u;
  let bin = u32(clamp(binCoord*255.0, 0.0, 255.0));
  return history.values[row*256u+bin];
}
fn spectrogram(uv: vec2<f32>) -> vec3<f32> {
  return cmap(historyLevel(uv));
}
fn chromagram(uv: vec2<f32>) -> vec3<f32> {
  var bandCoord = uv.x;
  var radialMask = 1.0;
  var heightCoord = uv.y;
  if (u.chromaStyle == 1u) {
    let p = uv * 2.0 - 1.0;
    bandCoord = fract(atan2(p.y,p.x)/6.2831853+0.5);
    heightCoord = clamp((length(p)-0.18)/0.72,0.0,1.0);
    radialMask = smoothstep(0.82,0.78,length(p))*smoothstep(0.12,0.18,length(p));
  }
  let band = u32(clamp(floor(bandCoord*12.0),0.0,11.0));
  var sum = 0.0;
  for (var k=0u; k<21u; k=k+1u) { sum += fft(min(255u, band*21u+k)); }
  let h = sum/21.0;
  let bar = smoothstep(h+0.01,h-0.01,heightCoord) * radialMask;
  return cmap(fract(f32(band)/12.0 + u.time*0.02)) * bar * (1.0+u.chromaGlow);
}
fn waveform(uv: vec2<f32>) -> vec3<f32> {
  let x = u32(clamp(uv.x*511.0,0.0,511.0));
  let sample = clamp(audio.values[256u+x],-1.0,1.0);
  let width = max(80.0,300.0/u.lineWidth);
  var shape = 0.0;
  if (u.waveStyle == 1u) {
    let magnitude = abs(sample)*0.42;
    shape = max(exp(-abs(uv.y-(0.5+magnitude))*width),exp(-abs(uv.y-(0.5-magnitude))*width));
  } else if (u.waveStyle == 2u) {
    let wave = sample*0.42+0.5;
    shape = select(step(wave,uv.y)*step(uv.y,0.5),step(0.5,uv.y)*step(uv.y,wave),wave>=0.5);
  } else {
    let wave = sample*0.42+0.5;
    shape = exp(-abs(uv.y-wave)*width);
  }
  return cmap(0.65+0.35*sin(u.time)) * shape;
}
fn guides(uv: vec2<f32>, panelCount: f32) -> vec3<f32> {
  if (u.showLabels == 0u) { return vec3(0.0); }
  let xTick = smoothstep(0.03,0.0,abs(fract(uv.x*8.0)-0.5));
  let yTick = smoothstep(0.03,0.0,abs(fract(uv.y*panelCount*4.0)-0.5));
  let edge = smoothstep(0.012,0.0,min(uv.x,1.0-uv.x));
  return vec3(0.08,0.11,0.14) * max(edge*yTick,xTick*0.04);
}
@fragment fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  var color = vec3(0.0);
  if (u.layoutMode == 0u) {
    if (in.uv.y > 0.6666667) {
      color = spectrogram(vec2(in.uv.x,(in.uv.y-0.6666667)*3.0));
    } else if (in.uv.y > 0.3333333) {
      color = chromagram(vec2(in.uv.x,(in.uv.y-0.3333333)*3.0));
    } else {
      color = waveform(vec2(in.uv.x,in.uv.y*3.0));
    }
    let separator = max(exp(-abs(in.uv.y-0.3333333)*700.0),exp(-abs(in.uv.y-0.6666667)*700.0));
    color += vec3(0.15,0.18,0.22)*separator + guides(in.uv,3.0);
  } else if (u.layoutMode == 1u) {
    color = spectrogram(in.uv) + guides(in.uv,1.0);
  } else if (u.layoutMode == 2u) {
    color = chromagram(in.uv) + guides(in.uv,1.0);
  } else if (u.layoutMode == 3u) {
    color = waveform(in.uv) + guides(in.uv,1.0);
  } else {
    color = spectrogram(vec2(in.uv.x,abs(in.uv.y-0.5)*2.0)) + guides(in.uv,1.0);
  }
  let beatRing = exp(-abs(length(in.uv*2.0-1.0)-0.72)*90.0) * u.beat;
  color += cmap(0.92)*beatRing*0.45 + vec3(u.beat*0.035);
  let alpha = max(u.bgAlpha, clamp(max(color.r,max(color.g,color.b)),0.0,1.0));
  return vec4(color, alpha);
}
`;

const HAND_COMPUTE_WGSL = /* wgsl */ `
struct U {
  resolution: vec2<f32>, time: f32, dt: f32,
  handCount: u32, mode: u32, colorMode: u32, pad0: u32,
  smoothing: f32, thickness: f32, intensity: f32, threshold: f32,
  fade: f32, flow: f32, bgAlpha: f32, seed: f32,
  panelColor: vec4<f32>, skeletonColor: vec4<f32>,
  velocityScale: f32, sparkDensity: f32, inkOpacity: f32, panelPadding: f32,
  panelRadius: f32, predictSeconds: f32, cameraOpacity: f32, pad1: f32,
};
struct LandmarkBuffer { values: array<vec4<f32>, 42> };
struct Particle { pos: vec2<f32>, vel: vec2<f32>, life: f32, seed: f32, hand: u32, pad: u32 };
struct ParticleBuffer { values: array<Particle> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> landmarks: LandmarkBuffer;
@group(0) @binding(2) var<storage, read_write> particles: ParticleBuffer;
fn hash(x: f32) -> f32 { return fract(sin(x*91.3458+17.13)*47453.5453); }
@compute @workgroup_size(64)
fn cs_update(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= 8192u) { return; }
  var p = particles.values[gid.x];
  if (u.handCount == 0u || u.mode >= 3u) { p.life = 0.0; particles.values[gid.x] = p; return; }
  let hand = (gid.x / 5u) % u.handCount;
  let tips = array<u32,5>(4u,8u,12u,16u,20u);
  let fingerSlot = gid.x % 5u;
  let base = hand*21u;
  let tip = landmarks.values[min(base+tips[fingerSlot],41u)];
  let palm = landmarks.values[min(base+9u,41u)];
  let thumb = landmarks.values[min(base+4u,41u)];
  let indexTip = landmarks.values[min(base+8u,41u)];
  let wrist = landmarks.values[min(base,41u)];
  var attractor = tip.xy;
  var emitterEnabled = tip.w > 0.5 && palm.w > 0.5;
  var burstStrength = 0.0;
  if (u.mode == 1u && fingerSlot == 0u) { attractor = palm.xy; }
  if (u.mode == 2u) {
    let handSize = max(0.04,distance(wrist.xy,palm.xy));
    let pinch = distance(thumb.xy,indexTip.xy)/(handSize*1.2);
    burstStrength = clamp(1.0-pinch/max(0.01,u.threshold),0.0,1.0);
    attractor = (thumb.xy+indexTip.xy)*0.5;
    emitterEnabled = emitterEnabled && burstStrength > 0.0;
  }
  let resetParticle = p.life <= 0.0 || p.pad != u.mode || distance(p.pos,attractor) > 0.45;
  if (resetParticle) {
    let a = hash(f32(gid.x)*1.37+u.time*0.1)*6.2831853;
    let randomSpeed = 0.0015+hash(f32(gid.x)*2.91)*0.012;
    p.pos = attractor;
    if (u.mode == 2u) {
      let away = normalize(attractor-palm.xy+vec2(0.0001,0.0));
      let tangent = vec2(-away.y,away.x);
      p.vel = (away+tangent*(hash(f32(gid.x)*7.1)-0.5)*0.9)*randomSpeed*(3.0+u.intensity*3.0)*burstStrength;
    } else if (u.mode == 1u) {
      p.vel = vec2(cos(a),sin(a)-0.35)*randomSpeed*max(0.1,u.flow);
    } else {
      p.vel = vec2(cos(a),sin(a))*randomSpeed*(0.5+u.velocityScale*0.35);
    }
    let density = select(clamp(0.12+u.sparkDensity*0.44,0.05,1.0),1.0,u.mode!=0u);
    p.life = select(0.0,0.45+hash(f32(gid.x)*4.11)*0.55,emitterEnabled && hash(f32(gid.x)*9.3)<=density);
    p.seed = hash(f32(gid.x)*4.7+f32(fingerSlot)*0.17);
    p.hand = hand;
    p.pad = u.mode;
  } else if (emitterEnabled) {
    if (u.mode == 0u) {
      let pull = (attractor-p.pos)*(3.5+u.flow*5.0);
      let curl = vec2(sin(p.pos.y*31.0+u.time),cos(p.pos.x*29.0-u.time))*u.flow*0.0006;
      p.vel = (p.vel+pull*u.dt+curl)*0.965;
    } else if (u.mode == 1u) {
      let curl = vec2(sin(p.pos.y*24.0+u.time*0.7),cos(p.pos.x*21.0-u.time*0.8))*u.flow*0.00045;
      p.vel = (p.vel+curl+vec2(0.0,0.00012*u.flow))*0.982;
    } else {
      p.vel = (p.vel+vec2(0.0,-0.00018))*0.994;
    }
    p.pos += p.vel;
    var decay = 0.55;
    if (u.mode == 1u) { decay = 0.32; }
    if (u.mode == 2u) { decay = 1.35; }
    p.life -= u.dt*decay*mix(1.8,0.35,clamp((u.fade-0.9)/0.099,0.0,1.0));
  } else {
    p.life = 0.0;
  }
  particles.values[gid.x] = p;
}
`;

const HAND_RENDER_WGSL = /* wgsl */ `
struct U {
  resolution: vec2<f32>, time: f32, dt: f32,
  handCount: u32, mode: u32, colorMode: u32, pad0: u32,
  smoothing: f32, thickness: f32, intensity: f32, threshold: f32,
  fade: f32, flow: f32, bgAlpha: f32, seed: f32,
  panelColor: vec4<f32>, skeletonColor: vec4<f32>,
  velocityScale: f32, sparkDensity: f32, inkOpacity: f32, panelPadding: f32,
  panelRadius: f32, predictSeconds: f32, cameraOpacity: f32, pad1: f32,
};
struct LandmarkBuffer { values: array<vec4<f32>, 42> };
struct Particle { pos: vec2<f32>, vel: vec2<f32>, life: f32, seed: f32, hand: u32, pad: u32 };
struct ParticleBuffer { values: array<Particle> };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> landmarks: LandmarkBuffer;
@group(0) @binding(2) var<storage, read> particles: ParticleBuffer;
fn hsv(c: vec3<f32>) -> vec3<f32> { let p=abs(fract(c.xxx+vec3(1.0,0.6667,0.3333))*6.0-3.0); return c.z*mix(vec3(1.0),clamp(p-1.0,vec3(0.0),vec3(1.0)),c.y); }
fn palette(seed: f32) -> vec3<f32> {
  if (u.colorMode == 1u) { return vec3(1.0,0.42,0.42); }
  if (u.colorMode == 2u) { return vec3(0.18,0.92,1.0); }
  if (u.colorMode == 3u) { return vec3(1.0); }
  return hsv(vec3(fract(seed+u.time*0.04),0.82,1.0));
}
struct V { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32>, @location(1) color: vec4<f32> };
@vertex fn vs_bg(@builtin(vertex_index) i:u32)->V {
  var p=array<vec2<f32>,3>(vec2(-1.0,-1.0),vec2(3.0,-1.0),vec2(-1.0,3.0));
  var o:V; o.pos=vec4(p[i],0.0,1.0); o.uv=p[i]*0.5+0.5; o.color=vec4(0.0); return o;
}
@fragment fn fs_bg(in:V)->@location(0) vec4<f32> {
  var base = vec4(vec3(0.008,0.008,0.018)*u.bgAlpha,u.bgAlpha);
  if (u.mode != 4u || u.handCount < 2u) { return base; }
  let left = landmarks.values[9u];
  let right = landmarks.values[30u];
  if (left.w < 0.5 || right.w < 0.5) { return base; }
  let lo = max(vec2(0.0),min(left.xy,right.xy)-vec2(u.panelPadding));
  let hi = min(vec2(1.0),max(left.xy,right.xy)+vec2(u.panelPadding));
  let center = (lo+hi)*0.5;
  let halfSize = max((hi-lo)*0.5,vec2(0.002));
  let radius = min(u.panelRadius,min(halfSize.x,halfSize.y));
  let q = abs(in.uv-center)-halfSize+vec2(radius);
  let d = length(max(q,vec2(0.0)))+min(max(q.x,q.y),0.0)-radius;
  let a = smoothstep(0.004,-0.004,d)*u.panelColor.a;
  return vec4(mix(base.rgb,u.panelColor.rgb,a),max(base.a,a));
}
@vertex fn vs_particle(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V {
  let p=particles.values[ii];
  let corners=array<vec2<f32>,6>(vec2(-1.0,-1.0),vec2(1.0,-1.0),vec2(-1.0,1.0),vec2(-1.0,1.0),vec2(1.0,-1.0),vec2(1.0,1.0));
  var sizePx = u.thickness;
  if (u.mode == 0u) { sizePx += length(p.vel*u.resolution)*u.velocityScale*0.18; }
  if (u.mode == 1u) { sizePx *= 0.55+0.8*(1.0-p.life); }
  if (u.mode == 2u) { sizePx = 2.5+u.intensity*1.8; }
  let size = vec2(sizePx/max(1.0,u.resolution.x),sizePx/max(1.0,u.resolution.y))*2.0;
  var o:V; o.pos=vec4((p.pos*2.0-1.0)+corners[vi]*size,0.0,1.0); o.uv=corners[vi];
  let opacity = select(max(0.0,p.life),max(0.0,p.life)*u.inkOpacity,u.mode==1u);
  o.color=vec4(palette(p.seed),opacity); return o;
}
@fragment fn fs_particle(in:V)->@location(0) vec4<f32> {
  let softness = select(4.5,2.0,u.mode==1u);
  let a=exp(-dot(in.uv,in.uv)*softness)*in.color.a;
  return vec4(in.color.rgb*a,a);
}
@vertex fn vs_skeleton(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->V {
  let connections=array<vec2<u32>,20>(vec2(0u,1u),vec2(1u,2u),vec2(2u,3u),vec2(3u,4u),vec2(0u,5u),vec2(5u,6u),vec2(6u,7u),vec2(7u,8u),vec2(0u,9u),vec2(9u,10u),vec2(10u,11u),vec2(11u,12u),vec2(0u,13u),vec2(13u,14u),vec2(14u,15u),vec2(15u,16u),vec2(0u,17u),vec2(17u,18u),vec2(18u,19u),vec2(19u,20u));
  let corners=array<vec2<f32>,6>(vec2(0.0,-1.0),vec2(1.0,-1.0),vec2(0.0,1.0),vec2(0.0,1.0),vec2(1.0,-1.0),vec2(1.0,1.0));
  let hand=ii/20u; let c=connections[ii%20u];
  let aLm=landmarks.values[min(hand*21u+c.x,41u)];
  let bLm=landmarks.values[min(hand*21u+c.y,41u)];
  let a=aLm.xy*2.0-1.0; let b=bLm.xy*2.0-1.0;
  let dirPx=(b-a)*u.resolution;
  let safeLength=max(length(dirPx),0.0001);
  let normalPx=vec2(-dirPx.y,dirPx.x)/safeLength;
  let widthPx=1.5+max(0.0,u.skeletonColor.a)*1.5;
  let offset=normalPx*widthPx*2.0/max(u.resolution,vec2(1.0));
  let corner=corners[vi];
  let valid=min(aLm.w,bLm.w);
  var o:V;
  o.pos=vec4(mix(a,b,corner.x)+offset*corner.y,0.0,1.0);
  o.uv=corner;
  o.color=vec4(u.skeletonColor.rgb*max(0.0,u.skeletonColor.a),valid);
  return o;
}
@fragment fn fs_skeleton(in:V)->@location(0) vec4<f32>{return vec4(in.color.rgb*in.color.a,in.color.a);}
`;

export function buildNativePluginPrecompileCommands(): NativePluginPrecompileCommand[] {
  return [
    { type: 'precompile_shader', shader_id: 'ghostfx/drift-compute', stage: 'compute', source: drift.compute, entry: 'csAdvect' },
    { type: 'precompile_shader', shader_id: 'ghostfx/drift-render', stage: 'render', source: drift.render, entry: 'fsBg' },
    { type: 'precompile_shader', shader_id: 'ghostfx/ribbons-compute', stage: 'compute', source: ribbons.compute, entry: 'csAdvect' },
    { type: 'precompile_shader', shader_id: 'ghostfx/ribbons-render', stage: 'render', source: ribbons.render, entry: 'fsBg' },
    { type: 'precompile_shader', shader_id: 'ghostfx/spheres-compute', stage: 'compute', source: spheresSource.compute, entry: 'csFlow' },
    { type: 'precompile_shader', shader_id: 'ghostfx/spheres-render', stage: 'render', source: spheresSource.render, entry: 'fsSphere' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-splat', stage: 'compute', source: LIQUID_SPLAT_WGSL, entry: 'csSplat' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-advect-vel', stage: 'compute', source: LIQUID_ADVECT_VEL_WGSL, entry: 'csAdvectVel' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-divergence', stage: 'compute', source: LIQUID_DIVERGENCE_WGSL, entry: 'csDivergence' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-jacobi', stage: 'compute', source: LIQUID_JACOBI_WGSL, entry: 'csJacobi' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-subtract', stage: 'compute', source: LIQUID_SUBTRACT_WGSL, entry: 'csSubtractGradient' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-advect-dye', stage: 'compute', source: LIQUID_ADVECT_DYE_WGSL, entry: 'csAdvectDye' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-render', stage: 'render', source: LIQUID_RENDER_WGSL, entry: 'fsRender' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-bubbles-sim', stage: 'compute', source: LIQUID_BUBBLE_SIM_WGSL, entry: 'csBubbles' },
    { type: 'precompile_shader', shader_id: 'ghostfx/liquid-bubbles-render', stage: 'render', source: LIQUID_BUBBLE_RENDER_WGSL, entry: 'fsBubble' },
    { type: 'precompile_shader', shader_id: 'ghostfx/post', stage: 'render', source: POST_WGSL, entry: 'fsComposite' },
    { type: 'precompile_shader', shader_id: 'handfx/compute', stage: 'compute', source: HAND_COMPUTE_WGSL, entry: 'cs_update' },
    { type: 'precompile_shader', shader_id: 'handfx/render', stage: 'render', source: HAND_RENDER_WGSL, entry: 'fs_particle' },
    { type: 'precompile_shader', shader_id: 'performer-world/render', stage: 'render', source: PERFORMER_WORLD_RENDER_WGSL, entry: 'fs_main' },
  ];
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function safeId(value: string): string {
  return String(value || 'plugin').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 160);
}

function hexRgb(value: unknown, fallback: [number, number, number]): [number, number, number] {
  const raw = String(value ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return fallback;
  return [
    Number.parseInt(raw.slice(0, 2), 16) / 255,
    Number.parseInt(raw.slice(2, 4), 16) / 255,
    Number.parseInt(raw.slice(4, 6), 16) / 255,
  ];
}

function pluginState(options: NativePluginGraphOptions, scene: string): NativePluginGraphState {
  const previous = options.state;
  return {
    scene,
    prevFrameTime: options.time,
    historyHead: previous?.historyHead ?? 0,
    historyPhase: previous?.historyPhase,
    handPoints: previous?.handPoints,
    liquidVelIsA: previous?.liquidVelIsA,
    liquidDyeIsA: previous?.liquidDyeIsA,
    liquidPrevBeatPulse: previous?.liquidPrevBeatPulse,
    liquidAmbientAcc: previous?.liquidAmbientAcc,
  };
}

function ghostFxUniform(options: NativePluginGraphOptions, state: NativePluginGraphState): string {
  const params = options.params;
  const sensitivity = clamp(params.ghostfxSensitivity, 0.25, 4, 1.4);
  const hueSpeed = clamp(params.ghostfxHueDriftSpeed, 0, 2, 0.15);
  const azimuth = clamp(params.ghostfxLightAzimuth, 0, 360, 35) * Math.PI / 180;
  const elevation = clamp(params.ghostfxLightElevation, -90, 90, 55) * Math.PI / 180;
  const buffer = new ArrayBuffer(112);
  const f = new Float32Array(buffer);
  f[0] = Math.max(1, options.width);
  f[1] = Math.max(1, options.height);
  f[2] = options.time;
  f[3] = Math.min(1 / 15, Math.max(0, options.frameDelta));
  f[4] = options.audio.bass * sensitivity;
  f[5] = options.audio.mid * sensitivity;
  f[6] = options.audio.treble * sensitivity;
  f[7] = options.audio.bass * sensitivity;
  f[8] = options.audio.mid * sensitivity;
  f[9] = options.audio.treble * sensitivity;
  f[10] = options.audio.energy * sensitivity;
  f[11] = options.audio.beatPhase;
  f[12] = options.audio.beatPulse;
  f[13] = options.audio.amplitude * sensitivity;
  f[14] = (options.time * hueSpeed) % 1;
  f[15] = clamp(params.ghostfxExposure, -1, 1, 0.1);
  const scenePreset = String(params.ghostfxScenePreset ?? 'drift').trim().toLowerCase();
  if (scenePreset === 'ribbons') {
    // Ribbons repurposes the drift-only slots for its cinematic controls.
    f[16] = clamp(params.ghostfxRibbonColorAmount, 0, 1, 0.25);
    f[17] = clamp(params.ghostfxRibbonDof, 0, 1, 0.55);
  } else if (scenePreset === 'spheres') {
    f[16] = clamp(params.ghostfxSpheresFlow, 0.2, 3, 1);
    f[17] = clamp(params.ghostfxSpheresSize, 0.4, 2.2, 1);
  } else {
    f[16] = clamp(params.ghostfxLatticeThreshold, 0, 6, 2.5) * (0.6 + options.audio.energy * 0.8);
    f[17] = clamp(params.ghostfxVortexStrength, 0, 6, 2);
  }
  if (scenePreset === 'spheres') {
    f[18] = clamp(params.ghostfxSpheresPuffs, 0, 2, 1);
    f[19] = clamp(params.ghostfxSpheresPalette, 0, 2, 0);
  } else {
    f[18] = clamp(params.ghostfxRibbonWidth, 0.02, 0.3, 0.1);
    f[19] = clamp(params.ghostfxRibbonTranslucency, 0, 1, 0.35);
  }
  f[20] = Math.cos(elevation) * Math.sin(azimuth);
  f[21] = Math.sin(elevation);
  f[22] = Math.cos(elevation) * Math.cos(azimuth);
  f[23] = clamp(params.ghostfxLightStrength, 0, 2, 0.9);
  f[24] = clamp(params.ghostfxAmbient, 0, 1, 0.3);
  f[25] = clamp(params.ghostfxRibbonSpawn, 0.2, 3, 1);
  f[26] = clamp(params.ghostfxBgAlpha, 0, 1, 0);
  f[27] = clamp(params.ghostfxTrailIntensity, 0, 2, 1);
  return bufferToBase64(buffer);
}

function ghostFxPostUniform(options: NativePluginGraphOptions): string {
  const params = options.params;
  const buffer = new ArrayBuffer(32);
  const f = new Float32Array(buffer);
  f[0] = Math.max(1, options.width);
  f[1] = Math.max(1, options.height);
  f[2] = clamp(params.ghostfxBloomThreshold, 0, 2, 0.45);
  f[3] = clamp(params.ghostfxBloomIntensity, 0, 3, 1.4);
  f[4] = clamp(params.ghostfxExposure, -1, 1, 0.1);
  f[5] = clamp(params.ghostfxVignette, 0, 1, 0.15);
  f[6] = clamp(params.ghostfxFeedbackAmount, 0, 0.97, 0);
  f[7] = clamp(params.ghostfxFeedbackZoom, 0.97, 1.03, 1);
  return bufferToBase64(buffer);
}

function seededRandom(seed: number): () => number {
  let value = seed >>> 0 || 0x9e3779b9;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

function stringSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hsvRgb(hue: number, saturation: number, value: number): [number, number, number] {
  const sector = Math.floor(hue * 6);
  const fraction = hue * 6 - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);
  switch (sector % 6) {
    case 0: return [value, t, p];
    case 1: return [q, value, p];
    case 2: return [p, value, t];
    case 3: return [p, q, value];
    case 4: return [t, p, value];
    default: return [value, p, q];
  }
}

function buildGhostFxLiquidGraph(options: NativePluginGraphOptions): NativePluginGraphBuildResult {
  const params = options.params;
  const state = pluginState(options, 'liquid');
  const reset = !!options.reset || options.state?.scene !== 'liquid';
  let velIsA = reset ? true : (options.state?.liquidVelIsA ?? true);
  let dyeIsA = reset ? true : (options.state?.liquidDyeIsA ?? true);
  const previousBeatPulse = reset ? 0 : (options.state?.liquidPrevBeatPulse ?? 0);
  let ambientAccumulator = reset ? 0 : (options.state?.liquidAmbientAcc ?? 0);
  const prefix = `ghostfx:${safeId(options.sourceId)}:liquid`;
  const id = (name: string) => `${prefix}:${name}`;
  const simulationWidth = GHOSTFX_LIQUID_SIM_WIDTH;
  const simulationHeight = Math.max(
    8,
    Math.round(simulationWidth * Math.max(1, options.height) / Math.max(1, options.width)),
  );
  const dispatch = [Math.ceil(simulationWidth / 8), Math.ceil(simulationHeight / 8), 1];
  const hueSpeed = clamp(params.ghostfxHueDriftSpeed, 0, 2, 0.15);
  const hue = (options.time * hueSpeed) % 1;
  const sensitivity = clamp(params.ghostfxSensitivity, 0.25, 4, 1.4);
  const bass = options.audio.bass * sensitivity;
  const mid = options.audio.mid * sensitivity;
  const treble = options.audio.treble * sensitivity;
  const energy = options.audio.energy * sensitivity;
  const splatRadius = clamp(params.ghostfxLiquidSplatRadius, 0.01, 0.2, 0.08);
  const splats = new Float32Array(GHOSTFX_LIQUID_MAX_SPLATS * 8);
  const random = seededRandom(stringSeed(`${options.sourceId}:${options.frameIndex}`));
  let splatCount = 0;
  const addSplat = (
    x: number,
    y: number,
    velocityX: number,
    velocityY: number,
    color: [number, number, number],
    radius: number,
  ) => {
    if (splatCount >= GHOSTFX_LIQUID_MAX_SPLATS) return;
    const offset = splatCount * 8;
    splats[offset] = x;
    splats[offset + 1] = y;
    splats[offset + 2] = velocityX;
    splats[offset + 3] = velocityY;
    splats[offset + 4] = color[0];
    splats[offset + 5] = color[1];
    splats[offset + 6] = color[2];
    splats[offset + 7] = radius;
    splatCount += 1;
  };
  // ── Continuous orbiting emitters ──────────────────────────────────
  // Three Lissajous emitters keep the pool ALIVE even in silence —
  // injection starvation was the "barely shows anything" defect. Each
  // emitter pushes dye along its direction of travel plus a tangential
  // swirl component so the sim always has vortices to confine.
  const emitterCount = 3;
  for (let index = 0; index < emitterCount; index += 1) {
    if (splatCount >= GHOSTFX_LIQUID_MAX_SPLATS) break;
    const phase = (index / emitterCount) * Math.PI * 2;
    const ax = 0.83 + index * 0.11;
    const ay = 0.67 + index * 0.13;
    const t = options.time * (0.35 + mid * 0.5);
    const x = 0.5 + 0.36 * Math.cos(t * ax + phase);
    const y = 0.5 + 0.33 * Math.sin(t * ay + phase * 1.7);
    // Direction of travel (analytic derivative of the orbit).
    const dxdt = -0.36 * ax * Math.sin(t * ax + phase);
    const dydt = 0.33 * ay * Math.cos(t * ay + phase * 1.7);
    const dirLen = Math.hypot(dxdt, dydt) || 1;
    const fx = dxdt / dirLen;
    const fy = dydt / dirLen;
    const speed = 0.55 + energy * 1.1;
    const swirlSign = index % 2 === 0 ? 1 : -1;
    addSplat(
      x,
      y,
      (fx * 0.7 + -fy * 0.7 * swirlSign) * speed,
      (fy * 0.7 + fx * 0.7 * swirlSign) * speed,
      hsvRgb((hue + index * 0.31) % 1, 0.88, 1),
      splatRadius * (0.55 + energy * 0.35),
    );
  }

  // ── Beat: vortex-ring burst ───────────────────────────────────────
  // A ring of outward splats with a shared tangential twist reads as a
  // liquid impact — much stronger than the old single random puff.
  if (options.audio.beatPulse > 0.5 && previousBeatPulse < 0.3) {
    const cx = 0.28 + random() * 0.44;
    const cy = 0.28 + random() * 0.44;
    const ringCount = energy > 0.5 ? 8 : 6;
    const ringSpeed = 1.0 + energy * 1.6;
    const twist = random() < 0.5 ? 0.8 : -0.8;
    const ringHue = (hue + random() * 0.25) % 1;
    for (let index = 0; index < ringCount; index += 1) {
      const angle = (index / ringCount) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      addSplat(
        cx + dx * splatRadius * 1.6,
        cy + dy * splatRadius * 1.6,
        (dx + -dy * twist) * ringSpeed,
        (dy + dx * twist) * ringSpeed,
        hsvRgb((ringHue + index * 0.015) % 1, 0.92, 1),
        splatRadius * 1.25,
      );
    }
  }
  ambientAccumulator += Math.max(0, options.frameDelta) * (2.0 + bass * 14)
    * clamp(params.ghostfxLiquidBassRate, 0, 2, 1);
  while (ambientAccumulator > 1 && splatCount < GHOSTFX_LIQUID_MAX_SPLATS) {
    ambientAccumulator -= 1;
    const angle = random() * Math.PI * 2;
    const speed = 0.25 + energy * 0.5;
    addSplat(
      random(),
      random(),
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      hsvRgb((hue + random() * 0.6) % 1, 0.75, 0.95),
      splatRadius * (0.5 + random() * 0.5),
    );
  }

  // Key light for the liquid-surface shading (shared with Ribbons's
  // light params). Screen-space: azimuth walks around the frame,
  // elevation lifts the light toward the viewer.
  const azimuth = (clamp(params.ghostfxLightAzimuth, 0, 360, 35) * Math.PI) / 180;
  const elevation = (clamp(params.ghostfxLightElevation, -90, 90, 55) * Math.PI) / 180;
  const lightX = Math.cos(elevation) * Math.cos(azimuth);
  const lightY = Math.cos(elevation) * Math.sin(azimuth);
  const lightZ = Math.max(0.08, Math.sin(elevation));

  // 128 bytes — deliberately unique per GhostFX scene: the core's per-frame
  // template updater (native_plugin_graph_frame_job) keys the uniform layout
  // off this byte length (112 = drift/ribbons, 128 = liquid).
  const uniform = new ArrayBuffer(128);
  const f = new Float32Array(uniform);
  const u = new Uint32Array(uniform);
  f[0] = simulationWidth; f[1] = simulationHeight;
  f[2] = Math.max(1, options.width); f[3] = Math.max(1, options.height);
  f[4] = options.time; f[5] = Math.min(1 / 15, Math.max(0, options.frameDelta));
  f[6] = bass; f[7] = mid; f[8] = treble; f[9] = energy;
  f[10] = options.audio.beatPhase; f[11] = options.audio.beatPulse; f[12] = hue;
  f[13] = clamp(params.ghostfxExposure, -1, 1, 0.1);
  f[14] = clamp(params.ghostfxLiquidSplatForce, 0.2, 3, 1);
  f[15] = splatRadius;
  f[16] = clamp(params.ghostfxLiquidDyeDecay, 0.985, 1, 0.995);
  f[17] = clamp(params.ghostfxLiquidVelDecay, 0.95, 1, 0.996);
  u[18] = splatCount;
  f[19] = clamp(params.ghostfxLiquidVorticity, 0, 3, 1.3);
  f[20] = clamp(params.ghostfxLiquidGloss, 0, 1, 0.7);
  f[21] = clamp(params.ghostfxAmbient, 0, 1, 0.3);
  f[22] = clamp(params.ghostfxLiquidDepth, 0.02, 1, 0.35);
  f[23] = clamp(params.ghostfxLiquidBubbles, 0, 2, 1);
  f[24] = lightX; f[25] = lightY; f[26] = lightZ;
  f[27] = clamp(params.ghostfxLightStrength, 0, 2, 0.9);

  // Field storage: persistent named STORAGE BUFFERS (the same mechanism the
  // 3D Smoke instrument uses). The core has no graph-internal texture
  // concept — the original texture-based liquid could never build a pipeline
  // under the native template path (bindings degraded to buffers and failed
  // validation). Strides match the WGSL declarations in liquid.wgsl.ts.
  const cellCount = simulationWidth * simulationHeight;
  const fieldBuffer = (name: string, bytesPerCell: number) => ({
    id: id(name),
    kind: 'storage',
    byte_length: cellCount * bytesPerCell,
    persistent: true,
    clear: reset,
  });
  const readBuf = (binding: number, resource: string) => ({
    binding,
    resource,
    kind: 'read-only-storage',
  });
  const writeBuf = (binding: number, resource: string) => ({
    binding,
    resource,
    kind: 'storage',
  });
  const computePasses: Record<string, unknown>[] = [];
  const uniformBinding = { binding: 0, resource: id('uniform'), kind: 'uniform' };
  {
    const velocityInput = id(velIsA ? 'velocity-a' : 'velocity-b');
    const velocityOutput = id(velIsA ? 'velocity-b' : 'velocity-a');
    const dyeInput = id(dyeIsA ? 'dye-a' : 'dye-b');
    const dyeOutput = id(dyeIsA ? 'dye-b' : 'dye-a');
    computePasses.push({
      name: 'ghostfx-liquid-splat', shader_id: 'ghostfx/liquid-splat', entry: 'csSplat', dispatch,
      bindings: [
        uniformBinding,
        { binding: 1, resource: id('splats'), kind: 'read-only-storage' },
        readBuf(2, velocityInput), readBuf(3, dyeInput),
        writeBuf(4, velocityOutput), writeBuf(5, dyeOutput),
      ],
    });
    velIsA = !velIsA;
    dyeIsA = !dyeIsA;
  }

  const velocityBeforeAdvection = id(velIsA ? 'velocity-a' : 'velocity-b');
  const velocityAfterAdvection = id(velIsA ? 'velocity-b' : 'velocity-a');
  computePasses.push({
    name: 'ghostfx-liquid-advect-velocity', shader_id: 'ghostfx/liquid-advect-vel', entry: 'csAdvectVel', dispatch,
    bindings: [uniformBinding, readBuf(1, velocityBeforeAdvection), writeBuf(2, velocityAfterAdvection)],
  });
  velIsA = !velIsA;
  computePasses.push({
    name: 'ghostfx-liquid-divergence', shader_id: 'ghostfx/liquid-divergence', entry: 'csDivergence', dispatch,
    bindings: [uniformBinding, readBuf(1, id(velIsA ? 'velocity-a' : 'velocity-b')), writeBuf(2, id('divergence'))],
  });
  for (let iteration = 0; iteration < GHOSTFX_LIQUID_JACOBI_ITERATIONS; iteration += 1) {
    const pressureInput = id(iteration % 2 === 0 ? 'pressure-a' : 'pressure-b');
    const pressureOutput = id(iteration % 2 === 0 ? 'pressure-b' : 'pressure-a');
    computePasses.push({
      name: `ghostfx-liquid-jacobi-${iteration}`, shader_id: 'ghostfx/liquid-jacobi', entry: 'csJacobi', dispatch,
      bindings: [uniformBinding, readBuf(1, pressureInput), readBuf(2, id('divergence')), writeBuf(3, pressureOutput)],
    });
  }
  const velocityBeforeProjection = id(velIsA ? 'velocity-a' : 'velocity-b');
  const velocityAfterProjection = id(velIsA ? 'velocity-b' : 'velocity-a');
  computePasses.push({
    name: 'ghostfx-liquid-subtract-gradient', shader_id: 'ghostfx/liquid-subtract', entry: 'csSubtractGradient', dispatch,
    bindings: [uniformBinding, readBuf(1, velocityBeforeProjection), readBuf(2, id('pressure-a')), writeBuf(3, velocityAfterProjection)],
  });
  velIsA = !velIsA;
  const dyeBeforeAdvection = id(dyeIsA ? 'dye-a' : 'dye-b');
  const dyeAfterAdvection = id(dyeIsA ? 'dye-b' : 'dye-a');
  computePasses.push({
    name: 'ghostfx-liquid-advect-dye', shader_id: 'ghostfx/liquid-advect-dye', entry: 'csAdvectDye', dispatch,
    bindings: [
      uniformBinding,
      readBuf(1, dyeBeforeAdvection),
      readBuf(2, id(velIsA ? 'velocity-a' : 'velocity-b')),
      writeBuf(3, dyeAfterAdvection),
    ],
  });
  dyeIsA = !dyeIsA;

  // Bubble/droplet splash layer: ballistic particles spawned from fast fluid.
  computePasses.push({
    name: 'ghostfx-liquid-bubbles', shader_id: 'ghostfx/liquid-bubbles-sim', entry: 'csBubbles',
    dispatch: [Math.ceil(GHOSTFX_LIQUID_BUBBLE_COUNT / 64), 1, 1],
    bindings: [
      uniformBinding,
      writeBuf(1, id('bubbles')),
      readBuf(2, id(velIsA ? 'velocity-a' : 'velocity-b')),
      readBuf(3, id(dyeIsA ? 'dye-a' : 'dye-b')),
    ],
  });

  // Intermediate frame ids are SCENE-INDEPENDENT on purpose: the core has
  // only MAX_SOURCE_FRAME_SLOTS (8) source-frame slots, and per-scene ids
  // leak 3 slots on every scene switch until the pool is exhausted — at
  // which point the next template install cannibalizes its own targets and
  // fails, freezing the layer.
  const framePrefix = `ghostfx:${safeId(options.sourceId)}:frame`;
  const sceneSourceId = `${framePrefix}:scene`;
  const bloomASourceId = `${framePrefix}:bloom-a`;
  const bloomBSourceId = `${framePrefix}:bloom-b`;
  const postBindings = (sceneId: string, bloomId: string) => [
    { binding: 0, resource: id('post-uniform'), kind: 'uniform' },
    { binding: 1, kind: 'source-frame-sampler' },
    { binding: 2, kind: 'source-frame-texture', source_id: sceneId },
    { binding: 3, kind: 'source-frame-texture', source_id: bloomId },
  ];
  const renderPasses: Record<string, unknown>[] = [
    {
      name: 'ghostfx-liquid-render', shader_id: 'ghostfx/liquid-render',
      vertex_entry: 'vsRender', fragment_entry: 'fsRender', target: 'source_frame',
      source_id: sceneSourceId, seq: options.frameIndex, clear: true, generate_mips: false,
      blend: 'replace', vertex_count: 3, instance_count: 1,
      bindings: [
        uniformBinding,
        readBuf(1, id(dyeIsA ? 'dye-a' : 'dye-b')),
      ],
    },
    {
      name: 'ghostfx-liquid-bubbles-draw', shader_id: 'ghostfx/liquid-bubbles-render',
      vertex_entry: 'vsBubble', fragment_entry: 'fsBubble', target: 'source_frame',
      source_id: sceneSourceId, seq: options.frameIndex, clear: false, generate_mips: false,
      blend: 'add', vertex_count: 6, instance_count: GHOSTFX_LIQUID_BUBBLE_COUNT,
      bindings: [uniformBinding, readBuf(1, id('bubbles'))],
    },
    {
      name: 'ghostfx-bloom-horizontal', shader_id: 'ghostfx/post',
      vertex_entry: 'vsMain', fragment_entry: 'fsExtractHBlur', target: 'source_frame',
      source_id: bloomASourceId, seq: options.frameIndex, clear: true, generate_mips: false,
      blend: 'replace', vertex_count: 3, instance_count: 1,
      bindings: postBindings(sceneSourceId, sceneSourceId),
    },
    {
      name: 'ghostfx-bloom-vertical', shader_id: 'ghostfx/post',
      vertex_entry: 'vsMain', fragment_entry: 'fsVBlur', target: 'source_frame',
      source_id: bloomBSourceId, seq: options.frameIndex, clear: true, generate_mips: false,
      blend: 'replace', vertex_count: 3, instance_count: 1,
      bindings: postBindings(bloomASourceId, bloomASourceId),
    },
    {
      name: 'ghostfx-composite', shader_id: 'ghostfx/post',
      vertex_entry: 'vsMain', fragment_entry: 'fsComposite', target: 'source_frame',
      source_id: options.sourceId, seq: options.frameIndex, clear: true, generate_mips: false,
      blend: 'replace', vertex_count: 3, instance_count: 1,
      bindings: postBindings(sceneSourceId, bloomBSourceId),
    },
  ];
  state.liquidVelIsA = velIsA;
  state.liquidDyeIsA = dyeIsA;
  state.liquidPrevBeatPulse = options.audio.beatPulse;
  state.liquidAmbientAcc = ambientAccumulator;
  return {
    state,
    config: {
      buffers: [
        { id: id('uniform'), kind: 'uniform', byte_length: 128, initial_b64: bufferToBase64(uniform) },
        { id: id('post-uniform'), kind: 'uniform', byte_length: 32, initial_b64: ghostFxPostUniform(options) },
        { id: id('splats'), kind: 'storage', byte_length: splats.byteLength, initial_b64: bufferToBase64(splats.buffer) },
        // vec2<f32> velocity, vec4<f32> dye, f32 pressure/divergence.
        fieldBuffer('velocity-a', 8), fieldBuffer('velocity-b', 8),
        fieldBuffer('dye-a', 16), fieldBuffer('dye-b', 16),
        fieldBuffer('pressure-a', 4), fieldBuffer('pressure-b', 4),
        fieldBuffer('divergence', 4),
        // Bubble particles: 8 f32 each, persistent so arcs continue across frames.
        { id: id('bubbles'), kind: 'storage', byte_length: GHOSTFX_LIQUID_BUBBLE_COUNT * 32, persistent: true, clear: reset },
      ],
      passes: computePasses,
      render_passes: renderPasses,
      readbacks: [],
    },
  };
}

function buildGhostFxSpheresGraph(options: NativePluginGraphOptions): NativePluginGraphBuildResult {
  const state = pluginState(options, 'spheres');
  const prefix = `ghostfx:${safeId(options.sourceId)}:spheres`;
  const id = (name: string) => `${prefix}:${name}`;
  const totalCount = GHOSTFX_SPHERE_COUNT + GHOSTFX_SPHERE_PUFF_COUNT;
  const reset = !!options.reset || options.state?.scene !== 'spheres';
  // Scene-independent frame ids — see the slot-exhaustion note in the
  // liquid builder.
  const framePrefix = `ghostfx:${safeId(options.sourceId)}:frame`;
  const sceneSourceId = `${framePrefix}:scene`;
  const bloomASourceId = `${framePrefix}:bloom-a`;
  const bloomBSourceId = `${framePrefix}:bloom-b`;
  const bindings = [
    { binding: 0, resource: id('uniform'), kind: 'uniform' },
    { binding: 1, resource: id('particles'), kind: 'read-only-storage' },
  ];
  const postBindings = (sceneId: string, bloomId: string) => [
    { binding: 0, resource: id('post-uniform'), kind: 'uniform' },
    { binding: 1, kind: 'source-frame-sampler' },
    { binding: 2, kind: 'source-frame-texture', source_id: sceneId },
    { binding: 3, kind: 'source-frame-texture', source_id: bloomId },
  ];
  return {
    state,
    config: {
      buffers: [
        { id: id('uniform'), kind: 'uniform', byte_length: 112, initial_b64: ghostFxUniform(options, state) },
        { id: id('post-uniform'), kind: 'uniform', byte_length: 32, initial_b64: ghostFxPostUniform(options) },
        // Spheres + puffs share one pool; puffs are the tail indices.
        // Zero-init on reset lets csFlow self-scatter (seed==0 sentinel).
        { id: id('particles'), kind: 'storage', byte_length: totalCount * 32, persistent: true, clear: reset },
      ],
      passes: [
        {
          name: 'ghostfx-spheres-flow', shader_id: 'ghostfx/spheres-compute', entry: 'csFlow',
          dispatch: [Math.ceil(totalCount / 64), 1, 1],
          bindings: [
            { binding: 0, resource: id('uniform'), kind: 'uniform' },
            { binding: 1, resource: id('particles'), kind: 'storage' },
          ],
        },
      ],
      render_passes: [
        {
          name: 'ghostfx-spheres-bg', shader_id: 'ghostfx/spheres-render',
          vertex_entry: 'vsBg', fragment_entry: 'fsBg', target: 'source_frame',
          source_id: sceneSourceId, seq: options.frameIndex, clear: true,
          blend: 'alpha', vertex_count: 3, instance_count: 1, bindings,
        },
        {
          name: 'ghostfx-spheres-puffs', shader_id: 'ghostfx/spheres-render',
          vertex_entry: 'vsPuff', fragment_entry: 'fsPuff', target: 'source_frame',
          source_id: sceneSourceId, seq: options.frameIndex, clear: false,
          blend: 'alpha', vertex_count: 6, instance_count: GHOSTFX_SPHERE_PUFF_COUNT, bindings,
        },
        {
          name: 'ghostfx-spheres-orbs', shader_id: 'ghostfx/spheres-render',
          vertex_entry: 'vsSphere', fragment_entry: 'fsSphere', target: 'source_frame',
          source_id: sceneSourceId, seq: options.frameIndex, clear: false,
          blend: 'alpha', vertex_count: 6, instance_count: GHOSTFX_SPHERE_COUNT, bindings,
        },
        {
          name: 'ghostfx-bloom-horizontal', shader_id: 'ghostfx/post',
          vertex_entry: 'vsMain', fragment_entry: 'fsExtractHBlur', target: 'source_frame',
          source_id: bloomASourceId, seq: options.frameIndex, clear: true, generate_mips: false,
          blend: 'replace', vertex_count: 3, instance_count: 1,
          bindings: postBindings(sceneSourceId, sceneSourceId),
        },
        {
          name: 'ghostfx-bloom-vertical', shader_id: 'ghostfx/post',
          vertex_entry: 'vsMain', fragment_entry: 'fsVBlur', target: 'source_frame',
          source_id: bloomBSourceId, seq: options.frameIndex, clear: true, generate_mips: false,
          blend: 'replace', vertex_count: 3, instance_count: 1,
          bindings: postBindings(bloomASourceId, bloomASourceId),
        },
        {
          name: 'ghostfx-composite', shader_id: 'ghostfx/post',
          vertex_entry: 'vsMain', fragment_entry: 'fsComposite', target: 'source_frame',
          source_id: options.sourceId, seq: options.frameIndex, clear: true, generate_mips: false,
          blend: 'replace', vertex_count: 3, instance_count: 1,
          bindings: postBindings(sceneSourceId, bloomBSourceId),
        },
      ],
      readbacks: [],
    },
  };
}

function buildGhostFxGraph(options: NativePluginGraphOptions): NativePluginGraphBuildResult {
  const scene = String(options.params.ghostfxScenePreset ?? 'drift').trim().toLowerCase();
  if (scene === 'liquid') {
    return buildGhostFxLiquidGraph(options);
  }
  if (scene === 'spheres') {
    return buildGhostFxSpheresGraph(options);
  }
  const selected = scene === 'ribbons' ? 'ribbons' : 'drift';
  const state = pluginState(options, selected);
  const prefix = `ghostfx:${safeId(options.sourceId)}:${selected}`;
  const id = (name: string) => `${prefix}:${name}`;
  const particleCount = selected === 'ribbons' ? GHOSTFX_RIBBON_COUNT : GHOSTFX_DRIFT_PARTICLES;
  const trailLength = selected === 'ribbons' ? GHOSTFX_RIBBON_TRAIL_LENGTH : GHOSTFX_DRIFT_TRAIL_LENGTH;
  const renderShader = `ghostfx/${selected}-render`;
  // Scene-independent frame ids — see the slot-exhaustion note in the
  // liquid builder.
  const framePrefix = `ghostfx:${safeId(options.sourceId)}:frame`;
  const sceneSourceId = `${framePrefix}:scene`;
  const bloomASourceId = `${framePrefix}:bloom-a`;
  const bloomBSourceId = `${framePrefix}:bloom-b`;
  const buffers = [
    { id: id('uniform'), kind: 'uniform', byte_length: 112, initial_b64: ghostFxUniform(options, state) },
    { id: id('post-uniform'), kind: 'uniform', byte_length: 32, initial_b64: ghostFxPostUniform(options) },
    { id: id('particles'), kind: 'storage', byte_length: particleCount * 32, persistent: true, clear: !!options.reset || options.state?.scene !== selected },
    { id: id('trails'), kind: 'storage', byte_length: particleCount * trailLength * 16, persistent: true, clear: !!options.reset || options.state?.scene !== selected },
  ];
  const bindings = [
    { binding: 0, resource: id('uniform'), kind: 'uniform' },
    { binding: 1, resource: id('particles'), kind: 'read-only-storage' },
    { binding: 2, resource: id('trails'), kind: 'read-only-storage' },
  ];
  const renderPasses: Record<string, unknown>[] = [
    {
      name: 'ghostfx-background', shader_id: renderShader,
      vertex_entry: 'vsBg', fragment_entry: 'fsBg', target: 'source_frame',
      source_id: sceneSourceId, seq: options.frameIndex, clear: true,
      blend: 'alpha', vertex_count: 3, instance_count: 1,
      bindings,
    },
  ];
  if (selected === 'ribbons') {
    renderPasses.push({
      name: 'ghostfx-ribbons', shader_id: renderShader,
      vertex_entry: 'vsRibbon', fragment_entry: 'fsRibbon', target: 'source_frame',
      source_id: sceneSourceId, seq: options.frameIndex, clear: false,
      blend: String(options.params.ghostfxRibbonBlend ?? 'additive') === 'glass'
        ? 'alpha'
        : String(options.params.ghostfxRibbonBlend ?? 'additive') === 'lighten'
          ? 'lighten'
          : 'add',
      vertex_count: GHOSTFX_RIBBON_COUNT * (GHOSTFX_RIBBON_TRAIL_LENGTH - 1) * 6,
      instance_count: 1, bindings,
    });
  } else {
    renderPasses.push(
      {
        name: 'ghostfx-trails', shader_id: renderShader,
        vertex_entry: 'vsTrail', fragment_entry: 'fsTrail', target: 'source_frame',
        source_id: sceneSourceId, seq: options.frameIndex, clear: false,
        blend: 'add', primitive: 'line-list',
        vertex_count: GHOSTFX_DRIFT_PARTICLES * (GHOSTFX_DRIFT_TRAIL_LENGTH - 1) * 2,
        instance_count: 1, bindings,
      },
      {
        name: 'ghostfx-particles', shader_id: renderShader,
        vertex_entry: 'vsParticle', fragment_entry: 'fsParticle', target: 'source_frame',
        source_id: sceneSourceId, seq: options.frameIndex, clear: false,
        blend: 'add', vertex_count: 6, instance_count: GHOSTFX_DRIFT_PARTICLES, bindings,
      },
      {
        name: 'ghostfx-lattice', shader_id: renderShader,
        vertex_entry: 'vsLattice', fragment_entry: 'fsLattice', target: 'source_frame',
        source_id: sceneSourceId, seq: options.frameIndex, clear: false,
        blend: 'add', primitive: 'line-list',
        vertex_count: GHOSTFX_DRIFT_PARTICLES * 2, instance_count: 1, bindings,
      },
    );
  }
  const postBindings = (sceneId: string, bloomId: string) => [
    { binding: 0, resource: id('post-uniform'), kind: 'uniform' },
    { binding: 1, kind: 'source-frame-sampler' },
    { binding: 2, kind: 'source-frame-texture', source_id: sceneId },
    { binding: 3, kind: 'source-frame-texture', source_id: bloomId },
  ];
  renderPasses.push(
    {
      name: 'ghostfx-bloom-horizontal', shader_id: 'ghostfx/post',
      vertex_entry: 'vsMain', fragment_entry: 'fsExtractHBlur', target: 'source_frame',
      source_id: bloomASourceId, seq: options.frameIndex, clear: true, generate_mips: false,
      blend: 'replace', vertex_count: 3, instance_count: 1,
      bindings: postBindings(sceneSourceId, sceneSourceId),
    },
    {
      name: 'ghostfx-bloom-vertical', shader_id: 'ghostfx/post',
      vertex_entry: 'vsMain', fragment_entry: 'fsVBlur', target: 'source_frame',
      source_id: bloomBSourceId, seq: options.frameIndex, clear: true, generate_mips: false,
      blend: 'replace', vertex_count: 3, instance_count: 1,
      bindings: postBindings(bloomASourceId, bloomASourceId),
    },
    {
      name: 'ghostfx-composite', shader_id: 'ghostfx/post',
      vertex_entry: 'vsMain', fragment_entry: 'fsComposite', target: 'source_frame',
      source_id: options.sourceId, seq: options.frameIndex, clear: true, generate_mips: false,
      blend: 'replace', vertex_count: 3, instance_count: 1,
      bindings: postBindings(sceneSourceId, bloomBSourceId),
    },
  );
  return {
    state,
    config: {
      buffers,
      passes: [{
        name: `ghostfx-${selected}-compute`, shader_id: `ghostfx/${selected}-compute`,
        entry: 'csAdvect', dispatch: [Math.ceil(particleCount / 64), 1, 1],
        bindings: [
          { binding: 0, resource: id('uniform'), kind: 'uniform' },
          { binding: 1, resource: id('particles'), kind: 'storage' },
          { binding: 2, resource: id('trails'), kind: 'storage' },
        ],
      }],
      render_passes: renderPasses,
      readbacks: [],
    },
  };
}

function resample(source: Float32Array | null | undefined, count: number, fallback: number): Float32Array {
  const output = new Float32Array(count);
  if (!source?.length) {
    output.fill(fallback);
    return output;
  }
  for (let index = 0; index < count; index += 1) {
    output[index] = source[Math.min(source.length - 1, Math.floor(index * source.length / count))];
  }
  return output;
}

function buildAnalyzerGraph(options: NativePluginGraphOptions): NativePluginGraphBuildResult {
  const params = options.params;
  const state = pluginState(options, 'analyzerlab');
  const scrollSpeed = clamp(params.analyzerLabScrollSpeed, 0.25, 4, 1);
  state.historyPhase = (options.state?.historyPhase ?? options.state?.historyHead ?? 0) + scrollSpeed;
  state.historyHead = Math.floor(state.historyPhase) % ANALYZER_HISTORY_ROWS;
  const prefix = `analyzerlab:${safeId(options.sourceId)}`;
  const id = (name: string) => `${prefix}:${name}`;
  const audio = new Float32Array(ANALYZER_FFT_BINS + ANALYZER_WAVEFORM_SAMPLES);
  audio.set(resample(options.fftData, ANALYZER_FFT_BINS, -100), 0);
  audio.set(resample(options.waveformData, ANALYZER_WAVEFORM_SAMPLES, 0), ANALYZER_FFT_BINS);
  const uniform = new ArrayBuffer(80);
  const f = new Float32Array(uniform);
  const u = new Uint32Array(uniform);
  f[0] = Math.max(1, options.width); f[1] = Math.max(1, options.height); f[2] = options.time; f[3] = options.frameDelta;
  u[4] = state.historyHead;
  u[5] = ['stack', 'spectrogram', 'chromagram', 'waveform', 'mirror'].indexOf(String(params.analyzerLabLayout ?? 'stack'));
  u[6] = Math.max(0, ['horizontal', 'vertical', 'radial'].indexOf(String(params.analyzerLabSpectroOrientation ?? 'horizontal')));
  u[7] = Math.max(0, ['inferno', 'viridis', 'magma', 'coral', 'ice', 'mono'].indexOf(String(params.analyzerLabColormap ?? 'inferno')));
  f[8] = clamp(params.analyzerLabSpectroGain, 0, 2, 1); f[9] = clamp(params.analyzerLabSpectroMinDb, -110, -40, -85);
  f[10] = clamp(params.analyzerLabSpectroMaxDb, -40, 0, -25); f[11] = scrollSpeed;
  f[12] = clamp(params.analyzerLabWaveLineWidth, 1, 4, 1.5); f[13] = clamp(params.analyzerLabChromaGlow, 0, 1, 0.5);
  f[14] = clamp(params.analyzerLabBgAlpha, 0, 1, 1); f[15] = params.analyzerLabShowBeats === false ? 0 : options.audio.beatPulse;
  u[16] = String(params.analyzerLabChromaStyle ?? 'bars') === 'radial' ? 1 : 0;
  u[17] = Math.max(0, ['line', 'mirror', 'filled'].indexOf(String(params.analyzerLabWaveStyle ?? 'line')));
  u[18] = params.analyzerLabShowLabels === false ? 0 : 1;
  return {
    state,
    config: {
      buffers: [
        { id: id('uniform'), kind: 'uniform', byte_length: 80, initial_b64: bufferToBase64(uniform) },
        { id: id('audio'), kind: 'storage', byte_length: audio.byteLength, initial_b64: bufferToBase64(audio.buffer) },
        { id: id('history'), kind: 'storage', byte_length: ANALYZER_FFT_BINS * ANALYZER_HISTORY_ROWS * 4, persistent: true, clear: !!options.reset },
      ],
      passes: [{
        name: 'analyzerlab-history', shader_id: 'analyzerlab/compute', entry: 'cs_update', dispatch: [4, 1, 1],
        bindings: [
          { binding: 0, resource: id('uniform'), kind: 'uniform' },
          { binding: 1, resource: id('audio'), kind: 'read-only-storage' },
          { binding: 2, resource: id('history'), kind: 'storage' },
        ],
      }],
      render_passes: [{
        name: 'analyzerlab-render', shader_id: 'analyzerlab/render', vertex_entry: 'vs_main', fragment_entry: 'fs_main',
        target: 'source_frame', source_id: options.sourceId, seq: options.frameIndex, clear: true, blend: 'alpha',
        vertex_count: 3, instance_count: 1,
        bindings: [
          { binding: 0, resource: id('uniform'), kind: 'uniform' },
          { binding: 1, resource: id('audio'), kind: 'read-only-storage' },
          { binding: 2, resource: id('history'), kind: 'read-only-storage' },
        ],
      }],
      readbacks: [],
    },
  };
}

function buildHandGraph(options: NativePluginGraphOptions): NativePluginGraphBuildResult {
  const params = options.params;
  const state = pluginState(options, 'handfx');
  const prefix = `handfx:${safeId(options.sourceId)}`;
  const id = (name: string) => `${prefix}:${name}`;
  const hands = [...(options.handFrame?.hands?.slice(0, 2) ?? [])]
    .sort((left, right) => (left.handedness === 'Left' ? 0 : 1) - (right.handedness === 'Left' ? 0 : 1));
  const landmarks = new Float32Array(42 * 4);
  const nextHandPoints = new Array<number>(42 * 4).fill(0);
  const previousHandPoints = state.handPoints ?? [];
  const smoothing = clamp(params.handfxSmoothing, 0, 1, 0.15);
  const predictSeconds = clamp(params.handfxPredictMs, 0, 40, 18) / 1000;
  const dt = Math.max(1 / 240, Math.min(1 / 15, options.frameDelta || 1 / 60));
  hands.forEach((hand, handIndex) => {
    hand.landmarks.slice(0, 21).forEach((point, pointIndex) => {
      const offset = (handIndex * 21 + pointIndex) * 4;
      const rawX = point.x;
      const rawY = 1 - point.y;
      const previousValid = previousHandPoints[offset + 3] > 0.5;
      const previousX = previousValid ? previousHandPoints[offset] : rawX;
      const previousY = previousValid ? previousHandPoints[offset + 1] : rawY;
      const previousZ = previousValid ? previousHandPoints[offset + 2] : point.z;
      const deltaX = rawX - previousX;
      const deltaY = rawY - previousY;
      const motion = Math.hypot(deltaX, deltaY);
      const alpha = Math.min(1, (1 - smoothing) + motion * 30);
      const smoothX = previousX + deltaX * alpha;
      const smoothY = previousY + deltaY * alpha;
      const smoothZ = previousZ + (point.z - previousZ) * alpha;
      const stepX = (deltaX / dt) * predictSeconds;
      const stepY = (deltaY / dt) * predictSeconds;
      const stepLength = Math.hypot(stepX, stepY) || 1;
      const predictionScale = Math.min(1, Math.max(0.002, motion * 1.5) / stepLength);
      landmarks[offset] = Math.min(1, Math.max(0, smoothX + stepX * predictionScale));
      landmarks[offset + 1] = Math.min(1, Math.max(0, smoothY + stepY * predictionScale));
      landmarks[offset + 2] = smoothZ;
      landmarks[offset + 3] = 1;
      nextHandPoints[offset] = smoothX;
      nextHandPoints[offset + 1] = smoothY;
      nextHandPoints[offset + 2] = smoothZ;
      nextHandPoints[offset + 3] = 1;
    });
  });
  state.handPoints = nextHandPoints;
  const modeLabel = String(params.handfxMode ?? 'trails');
  const mode = Math.max(0, ['trails', 'aurora', 'bursts', 'skeleton', 'panel'].indexOf(modeLabel));
  const panelColor = hexRgb(params.handfxPanelColor, [1, 1, 1]);
  const skeletonColor = hexRgb(params.handfxSkeletonColor, [1, 0.42, 0.42]);
  const colorModeLabel = String(mode === 1
    ? params.handfxInkColorMode ?? 'coral'
    : mode === 2
      ? params.handfxSprayColorMode ?? 'rainbow'
      : params.handfxTrailColorMode ?? 'rainbow');
  const colorMode = Math.max(0, ['rainbow', 'coral', 'cyan', 'white'].indexOf(colorModeLabel));
  const uniform = new ArrayBuffer(128);
  const f = new Float32Array(uniform);
  const u = new Uint32Array(uniform);
  f[0] = Math.max(1, options.width); f[1] = Math.max(1, options.height); f[2] = options.time; f[3] = options.frameDelta;
  u[4] = hands.length; u[5] = mode; u[6] = colorMode;
  f[8] = smoothing;
  f[9] = mode === 1 ? clamp(params.handfxInkSize, 10, 120, 55) : clamp(params.handfxTrailThickness, 1, 8, 3);
  f[10] = mode === 2 ? clamp(params.handfxSprayIntensity, 0.1, 3, 1.5) : 1;
  f[11] = clamp(params.handfxSprayThreshold, 0.05, 0.5, 0.25);
  f[12] = clamp(params.handfxTrailFade, 0.9, 0.999, 0.985);
  f[13] = mode === 1 ? clamp(params.handfxInkDrift, 0, 3, 1) : clamp(params.handfxTrailFlowStrength, 0, 2, 0.7);
  f[14] = clamp(params.handfxBgAlpha, 0, 1, 0); f[15] = options.time % 1024;
  f[16] = panelColor[0]; f[17] = panelColor[1]; f[18] = panelColor[2]; f[19] = clamp(params.handfxPanelOpacity, 0, 1, 1);
  f[20] = skeletonColor[0]; f[21] = skeletonColor[1]; f[22] = skeletonColor[2]; f[23] = clamp(params.handfxSkeletonGlow, 0, 3, 1.5);
  f[24] = clamp(params.handfxTrailVelocityScale, 0, 3, 1.5);
  f[25] = clamp(params.handfxTrailSparkDensity, 0, 2, 0.5);
  f[26] = clamp(params.handfxInkOpacity, 0, 1, 0.28);
  f[27] = clamp(params.handfxPanelPadding, 0, 0.2, 0.04);
  f[28] = clamp(params.handfxPanelCornerRadius, 0, 0.1, 0.02);
  f[29] = predictSeconds;
  f[30] = clamp(params.handfxCameraOpacity, 0, 1, 0.5);
  const bindings = [
    { binding: 0, resource: id('uniform'), kind: 'uniform' },
    { binding: 1, resource: id('landmarks'), kind: 'read-only-storage' },
    { binding: 2, resource: id('particles'), kind: 'read-only-storage' },
  ];
  return {
    state,
    config: {
      buffers: [
        { id: id('uniform'), kind: 'uniform', byte_length: 128, initial_b64: bufferToBase64(uniform) },
        { id: id('landmarks'), kind: 'storage', byte_length: landmarks.byteLength, initial_b64: bufferToBase64(landmarks.buffer) },
        { id: id('particles'), kind: 'storage', byte_length: HAND_FX_PARTICLE_COUNT * 32, persistent: true, clear: !!options.reset },
      ],
      passes: [{
        name: 'handfx-particles', shader_id: 'handfx/compute', entry: 'cs_update', dispatch: [Math.ceil(HAND_FX_PARTICLE_COUNT / 64), 1, 1],
        bindings: [
          { binding: 0, resource: id('uniform'), kind: 'uniform' },
          { binding: 1, resource: id('landmarks'), kind: 'read-only-storage' },
          { binding: 2, resource: id('particles'), kind: 'storage' },
        ],
      }],
      render_passes: [
        {
          name: 'handfx-background', shader_id: 'handfx/render', vertex_entry: 'vs_bg', fragment_entry: 'fs_bg',
          target: 'source_frame', source_id: options.sourceId, seq: options.frameIndex, clear: true, blend: 'alpha',
          vertex_count: 3, instance_count: 1, bindings,
        },
        ...(mode >= 3 ? [] : [{
          name: 'handfx-particles', shader_id: 'handfx/render', vertex_entry: 'vs_particle', fragment_entry: 'fs_particle',
          target: 'source_frame', source_id: options.sourceId, seq: options.frameIndex, clear: false, blend: 'add',
          vertex_count: 6, instance_count: HAND_FX_PARTICLE_COUNT, bindings,
        }]),
        ...(mode === 3 ? [{
          name: 'handfx-skeleton', shader_id: 'handfx/render', vertex_entry: 'vs_skeleton', fragment_entry: 'fs_skeleton',
          target: 'source_frame', source_id: options.sourceId, seq: options.frameIndex, clear: false, blend: 'add',
          vertex_count: 6, instance_count: 40, bindings,
        }] : []),
      ],
      readbacks: [],
    },
  };
}

function buildPerformerWorldGraph(options: NativePluginGraphOptions): NativePluginGraphBuildResult {
  const params = options.params;
  const state = pluginState(options, 'performer-world');
  const prefix = `performer-world:${safeId(options.sourceId)}`;
  const id = (name: string) => `${prefix}:${name}`;
  const uniform = new ArrayBuffer(80);
  const floats = new Float32Array(uniform);
  const uints = new Uint32Array(uniform);
  const worldParams = Array.isArray(params.performerWorldParams)
    ? params.performerWorldParams
    : [];

  floats[0] = Math.max(1, options.width);
  floats[1] = Math.max(1, options.height);
  floats[2] = options.time;
  floats[3] = options.frameDelta;
  uints[4] = Math.max(0, Math.min(13, Math.round(Number(params.performerWorldIndex) || 0)));
  uints[5] = Math.max(0, Math.min(5, Math.round(Number(params.performerWorldSpace) || 0)));
  uints[6] = params.performerWorldPointerDown ? 1 : 0;
  uints[7] = 0;
  floats[8] = clamp(params.performerWorldX, 0, 1, 0.5);
  floats[9] = clamp(params.performerWorldY, 0, 1, 0.5);
  floats[10] = options.audio.active ? clamp(options.audio.energy, 0, 4, 0) : 0;
  floats[11] = clamp(params.performerWorldPump, 0, 4, 0);
  for (let index = 0; index < 6; index += 1) {
    floats[12 + index] = clamp(worldParams[index], -8, 8, 0.5);
  }
  floats[18] = 0;
  floats[19] = 0;

  const bindings = [{ binding: 0, resource: id('uniform'), kind: 'uniform' }];
  return {
    state,
    config: {
      buffers: [{
        id: id('uniform'),
        kind: 'uniform',
        byte_length: uniform.byteLength,
        initial_b64: bufferToBase64(uniform),
      }],
      passes: [],
      render_passes: [{
        name: 'performer-world',
        shader_id: 'performer-world/render',
        vertex_entry: 'vs_main',
        fragment_entry: 'fs_main',
        target: 'source_frame',
        source_id: options.sourceId,
        seq: options.frameIndex,
        clear: true,
        blend: 'alpha',
        vertex_count: 3,
        instance_count: 1,
        bindings,
      }],
      readbacks: [],
    },
  };
}

export function buildNativePluginGraph(options: NativePluginGraphOptions): NativePluginGraphBuildResult {
  if (options.kind === 'ghostfx') return buildGhostFxGraph(options);
  if (options.kind === 'performer-world') return buildPerformerWorldGraph(options);
  return buildHandGraph(options);
}

export function buildNativeHandInputUpdate(
  options: Omit<NativePluginGraphOptions, 'kind'>,
): NativeHandInputUpdateResult {
  const result = buildHandGraph({ ...options, kind: 'handfx' });
  const buffers = Array.isArray((result.config as any).buffers)
    ? (result.config as any).buffers
        .filter((buffer: any) =>
          (String(buffer?.id ?? '').endsWith(':uniform') ||
            String(buffer?.id ?? '').endsWith(':landmarks')) &&
          typeof buffer?.initial_b64 === 'string',
        )
        .map((buffer: any) => ({
          id: String(buffer.id),
          initialB64: String(buffer.initial_b64),
        }))
    : [];
  return { buffers, state: result.state };
}
