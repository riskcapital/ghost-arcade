import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';

export const warpLoomParamSchema: ParamControl[] = [
  {
    kind: 'select',
    key: 'structure',
    label: 'Structure',
    group: 'Form',
    default: 'braid',
    options: [
      { value: 'braid', label: 'Braided Conduits' },
      { value: 'web', label: 'Web Membrane' },
      { value: 'current', label: 'Cross Current' },
    ],
  },
  { kind: 'slider', key: 'density', label: 'Conduit Density', group: 'Form', min: 2, max: 14, step: 1, default: 7 },
  { kind: 'slider', key: 'tubeWidth', label: 'Conduit Width', group: 'Form', min: 0.01, max: 0.16, step: 0.001, default: 0.055 },
  { kind: 'slider', key: 'depth', label: 'Layer Depth', group: 'Form', min: 0, max: 1.5, step: 0.01, default: 0.72 },
  { kind: 'slider', key: 'webMix', label: 'Web Mix', group: 'Web', min: 0, max: 1.5, step: 0.01, default: 0.62 },
  { kind: 'slider', key: 'webDensity', label: 'Web Density', group: 'Web', min: 2, max: 16, step: 0.1, default: 7.5 },
  { kind: 'slider', key: 'crosslinks', label: 'Crosslinks', group: 'Web', min: 0, max: 1, step: 0.01, default: 0.72 },
  { kind: 'slider', key: 'warpStrength', label: 'Spatial Warp', group: 'Warp & Turbulence', min: 0, max: 2.5, step: 0.01, default: 0.82 },
  { kind: 'slider', key: 'warpScale', label: 'Warp Scale', group: 'Warp & Turbulence', min: 0.25, max: 6, step: 0.01, default: 1.45 },
  { kind: 'slider', key: 'turbulence', label: 'Turbulence', group: 'Warp & Turbulence', min: 0, max: 2.5, step: 0.01, default: 0.76 },
  { kind: 'slider', key: 'turbulenceScale', label: 'Turbulence Scale', group: 'Warp & Turbulence', min: 0.5, max: 12, step: 0.05, default: 4.2 },
  { kind: 'slider', key: 'turbulenceSpeed', label: 'Turbulence Speed', group: 'Warp & Turbulence', min: -2, max: 2, step: 0.01, default: 0.24 },
  { kind: 'slider', key: 'bend', label: 'Horizontal Bend', group: 'Motion', min: -2, max: 2, step: 0.01, default: 0.28 },
  { kind: 'slider', key: 'twist', label: 'Braided Twist', group: 'Motion', min: -3, max: 3, step: 0.01, default: 0.72 },
  { kind: 'slider', key: 'flowSpeed', label: 'Flow Speed', group: 'Motion', min: -3, max: 3, step: 0.01, default: 0.38 },
  { kind: 'slider', key: 'pulse', label: 'Pulse', group: 'Motion', min: 0, max: 2, step: 0.01, default: 0.34 },
  { kind: 'slider', key: 'glow', label: 'Glow', group: 'Light', min: 0, max: 3, step: 0.01, default: 1.35 },
  { kind: 'slider', key: 'contrast', label: 'Contrast', group: 'Light', min: 0.5, max: 2.5, step: 0.01, default: 1.2 },
  { kind: 'slider', key: 'backgroundLevel', label: 'Background', group: 'Light', min: 0, max: 0.4, step: 0.005, default: 0.025 },
  { kind: 'color', key: 'colorA', label: 'Conduit A', group: 'Palette', default: [42, 235, 255] },
  { kind: 'color', key: 'colorB', label: 'Conduit B', group: 'Palette', default: [255, 48, 186] },
  { kind: 'color', key: 'colorC', label: 'Web Color', group: 'Palette', default: [132, 255, 176] },
  { kind: 'color', key: 'backgroundColor', label: 'Background Color', group: 'Palette', default: [2, 4, 12] },
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio', default: true },
  { kind: 'slider', key: 'audioWarp', label: 'Bass Warp', group: 'Audio', min: 0, max: 3, step: 0.01, default: 0.85, showWhen: { audioReactive: true } },
  { kind: 'slider', key: 'audioSpark', label: 'Treble Spark', group: 'Audio', min: 0, max: 3, step: 0.01, default: 1.1, showWhen: { audioReactive: true } },
];

export const warpLoomParamDefaults = deriveDefaults(warpLoomParamSchema);

const WARP_LOOM_WGSL = /* wgsl */ `
struct Globals {
  resolution_time: vec4<f32>,
  form: vec4<f32>,
  warp: vec4<f32>,
  motion: vec4<f32>,
  web_light: vec4<f32>,
  audio: vec4<f32>,
  color_a: vec4<f32>,
  color_b: vec4<f32>,
  color_c: vec4<f32>,
  background: vec4<f32>,
  tuning: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Globals;

struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_full(@builtin(vertex_index) vertex_index: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let pos = positions[vertex_index];
  var out: VertexOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = pos * 0.5 + 0.5;
  return out;
}

fn hash21(p: vec2<f32>) -> f32 {
  let q = fract(p * vec2<f32>(123.34, 456.21));
  return fract((q.x + q.y) * (q.x + q.y + 45.32));
}

fn value_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn fbm(p0: vec2<f32>) -> f32 {
  var p = p0;
  var total = 0.0;
  var amplitude = 0.5;
  for (var i = 0; i < 5; i = i + 1) {
    total += value_noise(p) * amplitude;
    p = vec2<f32>(p.y * 1.63 + p.x * 0.31, -p.x * 1.63 + p.y * 0.31) + 8.17;
    amplitude *= 0.5;
  }
  return total;
}

fn line_glow(distance: f32, width: f32, glow: f32) -> f32 {
  let core = 1.0 - smoothstep(width * 0.28, width, distance);
  let halo = exp(-distance / max(width * 2.7, 0.0001)) * glow;
  return core + halo * 0.42;
}

fn palette(t: f32) -> vec3<f32> {
  let first = mix(u.color_a.rgb, u.color_b.rgb, smoothstep(0.08, 0.52, t));
  return mix(first, u.color_c.rgb, smoothstep(0.48, 0.96, t) * 0.42);
}

fn web_field(p: vec2<f32>, time: f32) -> f32 {
  let density = u.web_light.y;
  let stretched = vec2<f32>(
    p.x * density * 0.42 + time * u.motion.x * 0.12,
    p.y * density * 1.35
  );
  let cell = fract(stretched) - 0.5;
  let horizontal = abs(cell.y);
  let diagonal_a = abs(fract(stretched.x + stretched.y * 0.62) - 0.5) * 0.72;
  let diagonal_b = abs(fract(stretched.x - stretched.y * 0.62) - 0.5) * 0.72;
  let cross = min(diagonal_a, diagonal_b);
  let links = mix(0.5, u.web_light.z, smoothstep(0.18, 0.48, abs(cell.x)));
  let distance = min(horizontal, mix(0.5, cross, links));
  let flicker = 0.68 + 0.32 * value_noise(floor(stretched) + time * 0.23);
  return (1.0 - smoothstep(0.018, 0.085, distance)) * flicker;
}

@fragment
fn fs_warp_loom(in: VertexOut) -> @location(0) vec4<f32> {
  let resolution = max(u.resolution_time.xy, vec2<f32>(1.0));
  let time = u.resolution_time.z;
  let aspect = resolution.x / resolution.y;
  var p = (in.uv * 2.0 - 1.0) * vec2<f32>(aspect, 1.0);

  let bass = u.audio.x * u.audio.w;
  let treble = u.audio.z * u.audio.w;
  let turbulence_time = time * u.warp.w;
  let large_noise = fbm(vec2<f32>(
    p.x * u.warp.y - turbulence_time,
    p.y * u.warp.y * 0.72 + turbulence_time * 0.47
  ));
  let curl_x = fbm(p * u.motion.w + vec2<f32>(turbulence_time * 0.61, 17.0));
  let curl_y = fbm(p.yx * u.motion.w + vec2<f32>(31.0, -turbulence_time * 0.83));
  let audio_warp = 1.0 + bass * u.audio.y;

  p.y += (large_noise - 0.5) * u.warp.x * 0.58 * audio_warp;
  p += (vec2<f32>(curl_y, curl_x) - 0.5) * u.warp.z * 0.22;
  p.y += u.motion.y * (p.x * p.x - aspect * aspect * 0.28) * 0.17;
  p.y += sin(p.x * 2.35 + time * u.motion.x * 0.72) * u.motion.z * 0.095;

  var conduits = vec3<f32>(0.0);
  var energy = 0.0;
  let strand_count = clamp(u.form.x, 2.0, 14.0);
  let width = u.form.y * (1.0 + bass * 0.24);
  let depth_amount = u.form.w;
  let structure = u.form.z;

  for (var i = 0; i < 14; i = i + 1) {
    let fi = f32(i);
    let enabled = 1.0 - step(strand_count, fi + 0.5);
    let layer = fi / max(strand_count - 1.0, 1.0);
    let phase = fi * 2.39996;
    let depth_scale = 1.0 + layer * depth_amount * 0.62;
    let axial = p.x / depth_scale + time * u.motion.x * (0.18 + layer * 0.12);
    var center = (layer - 0.5) * 1.42;
    center += sin(axial * (1.35 + layer * 0.76) + phase + time * u.motion.z * 0.18) * (0.12 + 0.09 * structure);
    center += cos(axial * 3.1 - phase * 0.63 - time * 0.17) * u.warp.z * 0.035;
    let distance = abs(p.y - center) / depth_scale;
    let strand = line_glow(distance, width * (0.78 + layer * 0.46), u.web_light.w) * enabled;
    let travelling = 0.72 + 0.28 * sin(axial * 6.0 - time * (1.0 + u.motion.x) + phase);
    let spark = pow(max(travelling, 0.0), 5.0) * treble;
    let shade = palette(fract(layer + time * 0.025 + large_noise * 0.18));
    conduits += shade * strand * (0.66 + 0.34 * travelling + spark);
    energy += strand;
  }

  let web = web_field(p + vec2<f32>((large_noise - 0.5) * 0.16, 0.0), time);
  let membrane = u.color_c.rgb * web * u.web_light.x * (0.42 + 0.36 * energy);
  let pulse = 1.0 + sin(time * 1.7 + p.x * 2.2) * u.tuning.y * 0.08;
  var color = u.background.rgb * u.background.a;
  color += (conduits + membrane) * pulse;
  color += u.color_c.rgb * web * treble * 0.24;

  let vignette_uv = in.uv * (1.0 - in.uv.yx);
  let vignette = pow(clamp(vignette_uv.x * vignette_uv.y * 18.0, 0.0, 1.0), 0.18);
  color *= mix(0.54, 1.0, vignette);
  color = 1.0 - exp(-color * u.web_light.w);
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / max(u.tuning.x, 0.5)));
  return vec4<f32>(color, 1.0);
}
`;

const STRUCTURE_IDS: Record<string, number> = {
  braid: 0,
  web: 1,
  current: 2,
};

export class WebGPUWarpLoom implements GpuShaderImpl {
  private readonly device: any;
  private readonly uniformBuffer: any;
  private readonly bindGroupLayout: any;
  private readonly bindGroup: any;
  private readonly pipelines = new Map<string, any>();
  private params: Record<string, any> = { ...warpLoomParamDefaults };
  private bands = { bass: 0, mid: 0, treble: 0 };
  private startTime = performance.now();

  constructor(device: any, _presentFormat: any) {
    this.device = device;
    this.uniformBuffer = device.createBuffer({
      size: 176,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.bindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    this.bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  setBands(bass: number, mid: number, treble: number): void {
    this.bands = { bass, mid, treble };
  }

  setParams(params: Record<string, any>): void {
    this.params = { ...warpLoomParamDefaults, ...params };
  }

  private pipeline(format: any): any {
    const key = String(format);
    const existing = this.pipelines.get(key);
    if (existing) return existing;
    const module = this.device.createShaderModule({ code: WARP_LOOM_WGSL });
    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.bindGroupLayout] }),
      vertex: { module, entryPoint: 'vs_full' },
      fragment: {
        module,
        entryPoint: 'fs_warp_loom',
        targets: [{
          format,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.pipelines.set(key, pipeline);
    return pipeline;
  }

  encodeFrame(
    encoder: any,
    targetView: any,
    targetFormat: any,
    width: number,
    height: number,
    dt: number,
    time?: number,
  ): void {
    const p = this.params;
    const now = performance.now();
    const clock = typeof time === 'number' && Number.isFinite(time)
      ? Math.max(0, time)
      : (now - this.startTime) / 1000;
    const reactive = p.audioReactive ? 1 : 0;
    const floats = new Float32Array(44);
    floats.set([width, height, clock, Math.max(0, Math.min(dt, 0.1))], 0);
    floats.set([
      p.density,
      p.tubeWidth,
      STRUCTURE_IDS[String(p.structure)] ?? 0,
      p.depth,
    ], 4);
    floats.set([p.warpStrength, p.warpScale, p.turbulence, p.turbulenceSpeed], 8);
    floats.set([p.flowSpeed, p.bend, p.twist, p.turbulenceScale], 12);
    floats.set([p.webMix, p.webDensity, p.crosslinks, p.glow], 16);
    floats.set([
      this.bands.bass,
      p.audioWarp,
      this.bands.treble * p.audioSpark,
      reactive,
    ], 20);
    this.writeColor(floats, 24, p.colorA);
    this.writeColor(floats, 28, p.colorB);
    this.writeColor(floats, 32, p.colorC);
    this.writeColor(floats, 36, p.backgroundColor, p.backgroundLevel);
    floats.set([p.contrast, p.pulse, 0, 0], 40);
    this.device.queue.writeBuffer(this.uniformBuffer, 0, floats);

    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.pipeline(targetFormat));
    pass.setBindGroup(0, this.bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  }

  private writeColor(target: Float32Array, offset: number, value: unknown, alpha = 1): void {
    const rgb = Array.isArray(value) ? value : [255, 255, 255];
    target[offset] = Number(rgb[0] ?? 255) / 255;
    target[offset + 1] = Number(rgb[1] ?? 255) / 255;
    target[offset + 2] = Number(rgb[2] ?? 255) / 255;
    target[offset + 3] = alpha;
  }

  dispose(): void {
    try { this.uniformBuffer.destroy?.(); } catch { /* no-op */ }
    this.pipelines.clear();
  }
}
