// Native Lines layer — renders the whole LinesContent as a single WGSL pass
// on the render core. Geometry (element transforms, warps, smoothing, arc
// lengths) is baked CPU-side into a packed uniform table; every stroke look
// and draw animation is evaluated per-pixel on the GPU against the core
// clock, so line animations stay silky even when the UI thread is busy.
import type { LinesContent, LineElement, LineStroke, LineMotionFxMode } from '../lines/types';
import type { Point2D } from '../types';

export const LINES_NATIVE_SHADER_ID = 'lines/render';

export const LINES_MAX_ELEMENTS = 8;
export const LINES_ELEMENT_VEC4S = 9;
export const LINES_MAX_POINTS = 384;
const HEADER_VEC4S = 5;
const POINTS_OFFSET_VEC4 = HEADER_VEC4S + LINES_MAX_ELEMENTS * LINES_ELEMENT_VEC4S;
const TOTAL_VEC4S = POINTS_OFFSET_VEC4 + LINES_MAX_POINTS;
export const LINES_UNIFORM_BYTES = TOTAL_VEC4S * 16;

const STROKE_CODES: Record<LineStroke['type'], number> = {
  solid: 0, dashed: 1, dotted: 2, glow: 3, neon: 4, electric: 5, fire: 6,
  snake: 7, multiTail: 8, pulse: 9, scanner: 10, rainbow: 11, laser: 12, pipe: 13,
};

// Canonical control enums (index = packed code; the arrays also feed the
// layer-param audit's enum probe pool).
export const LINES_LOOP_MODE_LIST = ['once', 'loop', 'pingpong', 'continuous'];
export const LINES_EASING_LIST = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
export const LINES_BLEND_MODE_LIST = ['normal', 'add', 'multiply', 'screen'];
export const LINES_MOTION_FX_LIST = ['none', 'wave', 'breathe', 'shimmer', 'spin', 'orbit', 'audioPulse'];
export const LINES_STAGGER_MODE_LIST = ['simultaneous', 'sequential', 'cascade', 'solo', 'random', 'wave'];
const codeMap = (list: string[]): Record<string, number> =>
  Object.fromEntries(list.map((key, i) => [key, i]));
const LOOP_CODES = codeMap(LINES_LOOP_MODE_LIST);
const EASE_CODES = codeMap(LINES_EASING_LIST);
const BLEND_CODES = codeMap(LINES_BLEND_MODE_LIST);
const MOTION_CODES = codeMap(LINES_MOTION_FX_LIST) as Record<LineMotionFxMode, number>;

function finite(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function chaikin(points: Point2D[], closed: boolean): Point2D[] {
  if (points.length < 3) return points;
  const out: Point2D[] = [];
  const count = closed ? points.length : points.length - 1;
  if (!closed) out.push(points[0]);
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
    out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
  }
  if (!closed) out.push(points[points.length - 1]);
  return out;
}

function bilinearWarp(p: Point2D, corners: LineElement['warpCorners']): Point2D {
  const top = {
    x: corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * p.x,
    y: corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * p.x,
  };
  const bottom = {
    x: corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * p.x,
    y: corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * p.x,
  };
  return { x: top.x + (bottom.x - top.x) * p.y, y: top.y + (bottom.y - top.y) * p.y };
}

function meshWarp(p: Point2D, mesh: LineElement['meshWarp']): Point2D {
  const rows = mesh.rows;
  const cols = mesh.cols;
  if (rows < 2 || cols < 2 || !mesh.points?.length) return p;
  const gx = Math.min(cols - 2, Math.max(0, Math.floor(p.x * (cols - 1))));
  const gy = Math.min(rows - 2, Math.max(0, Math.floor(p.y * (rows - 1))));
  const fx = Math.min(1, Math.max(0, p.x * (cols - 1) - gx));
  const fy = Math.min(1, Math.max(0, p.y * (rows - 1) - gy));
  const p00 = mesh.points[gy]?.[gx] ?? p;
  const p10 = mesh.points[gy]?.[gx + 1] ?? p;
  const p01 = mesh.points[gy + 1]?.[gx] ?? p;
  const p11 = mesh.points[gy + 1]?.[gx + 1] ?? p;
  return {
    x: (p00.x * (1 - fx) + p10.x * fx) * (1 - fy) + (p01.x * (1 - fx) + p11.x * fx) * fy,
    y: (p00.y * (1 - fx) + p10.y * fx) * (1 - fy) + (p01.y * (1 - fx) + p11.y * fx) * fy,
  };
}

function strokeParams(stroke: LineStroke): { color: number[]; width: number; p: number[] } {
  const p = [0, 0, 0, 0, 0, 0, 0, 0];
  const anyStroke = stroke as any;
  const color = Array.isArray(anyStroke.color) ? anyStroke.color.slice(0, 4) : [1, 1, 1, 1];
  const width = Math.max(0.5, finite(anyStroke.width, 3));
  switch (stroke.type) {
    case 'dashed':
      p[0] = finite(stroke.dashLength, 12); p[1] = finite(stroke.gapLength, 8);
      p[2] = stroke.animated ? 1 : 0; p[3] = finite(stroke.animationSpeed, 1);
      break;
    case 'dotted':
      p[0] = Math.max(1, finite(stroke.dotSize, 4)); p[1] = Math.max(2, finite(stroke.spacing, 12));
      p[2] = stroke.animated ? 1 : 0; p[3] = finite(stroke.animationSpeed, 1);
      break;
    case 'glow':
      p[0] = Math.max(1, finite(stroke.glowSize, 15)); p[1] = finite(stroke.glowIntensity, 1);
      p[2] = finite(stroke.pulseSpeed, 0);
      break;
    case 'neon':
      p[0] = Math.max(1, finite(stroke.glowSize, 12)); p[1] = finite(stroke.flickerSpeed, 4);
      p[2] = finite(stroke.flickerIntensity, 0.3);
      break;
    case 'electric':
      p[0] = finite(stroke.arcIntensity, 0.5); p[1] = finite(stroke.speed, 1);
      p[2] = Math.max(0, Math.min(4, Math.round(finite(stroke.branches, 2))));
      break;
    case 'fire':
      p[0] = finite(stroke.intensity, 1); p[1] = finite(stroke.speed, 1);
      break;
    case 'snake':
      p[0] = Math.max(0.02, finite(stroke.length, 0.3)); p[1] = finite(stroke.speed, 1);
      p[2] = stroke.tailFade ? 1 : 0; p[3] = stroke.headGlow ? 1 : 0;
      p[4] = stroke.bidirectional ? 1 : 0;
      p[5] = Math.max(1, Math.min(8, Math.round(finite(stroke.snakeCount, 1))));
      break;
    case 'multiTail':
      p[0] = Math.max(2, Math.min(12, Math.round(finite(stroke.tailCount, 4))));
      p[1] = Math.max(0.02, finite(stroke.tailLength, 0.2));
      p[2] = Math.max(0, finite(stroke.spacing, 0.2));
      p[3] = finite(stroke.speed, 1);
      p[4] = stroke.tailFade ? 1 : 0; p[5] = stroke.headGlow ? 1 : 0;
      p[6] = stroke.colorShift ? 1 : 0; p[7] = finite(stroke.colorShiftAmount, 0.3);
      break;
    case 'pulse':
      p[0] = Math.max(1, Math.min(12, Math.round(finite(stroke.pulseCount, 3))));
      p[1] = finite(stroke.speed, 1); p[2] = Math.max(0.01, finite(stroke.fadeLength, 0.2));
      p[3] = stroke.direction === 'backward' ? 1 : stroke.direction === 'both' ? 2 : 0;
      break;
    case 'scanner':
      p[0] = Math.max(0.01, finite(stroke.beamWidth, 0.1)); p[1] = finite(stroke.speed, 1);
      p[2] = finite(stroke.trail, 0.3);
      break;
    case 'rainbow':
      p[0] = finite(stroke.saturation, 1); p[1] = finite(stroke.brightness, 1);
      p[2] = finite(stroke.speed, 0.5); p[3] = Math.max(1, finite(stroke.segments, 3));
      color[0] = 1; color[1] = 1; color[2] = 1; color[3] = 1;
      break;
    case 'laser':
      p[0] = Math.max(0.1, finite(stroke.intensity, 1.5)); p[1] = finite(stroke.scatter, 0.4);
      p[2] = finite(stroke.flicker, 0.2);
      break;
    case 'pipe': {
      p[0] = finite(stroke.depth, 0.7); p[1] = finite(stroke.edgeLight, 1);
      p[2] = finite(stroke.specular, 0.6); p[3] = finite(stroke.roughness, 0.3);
      const edge = Array.isArray(stroke.edgeLightColor) ? stroke.edgeLightColor : [1, 1, 1, 1];
      p[4] = finite(edge[0], 1); p[5] = finite(edge[1], 1); p[6] = finite(edge[2], 1);
      break;
    }
    default:
      break;
  }
  return { color, width, p };
}

export interface LinesNativeGraphOptions {
  sourceId: string;
  content: LinesContent;
  width: number;
  height: number;
  time: number;
  frameDelta: number;
  frameIndex: number;
  audioBass?: number;
  audioTreble?: number;
  audioBeat?: number;
  includeSnapshot?: boolean;
  shaderId?: string;
  passName?: string;
  uniformPrefix?: string;
}

export function buildLinesNativeComputeGraph(options: LinesNativeGraphOptions) {
  const width = Math.max(2, Math.round(options.width || 1920));
  const height = Math.max(2, Math.round(options.height || 1080));
  const time = Math.max(0, finite(options.time, 0));
  const content = options.content;
  const data = new Float32Array(TOTAL_VEC4S * 4);

  const visible = (content.elements ?? [])
    .filter((element) => element.visible !== false && (element.shape?.points?.length ?? 0) >= 2)
    .slice()
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .slice(0, LINES_MAX_ELEMENTS);

  let pointCursor = 0;
  let packedCount = 0;
  for (let index = 0; index < visible.length; index++) {
    const element = visible[index];
    let pts: Point2D[] = element.shape.points.map((point) => ({ x: point.x, y: point.y }));
    const closed = element.shape.type === 'pointClick' && !!element.shape.closed;
    if (element.shape.type === 'freehand') {
      const smoothing = finite(element.shape.smoothing, 0.5);
      const iterations = smoothing > 0.66 ? 2 : smoothing > 0.2 ? 1 : 0;
      for (let i = 0; i < iterations; i++) pts = chaikin(pts, false);
    }
    // Bake element transform: scale/rotate around center, then offset.
    const rot = (finite(element.rotation, 0) * Math.PI) / 180;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const sx = finite(element.scale?.x, 1);
    const sy = finite(element.scale?.y, 1);
    const ox = finite(element.position?.x, 0);
    const oy = finite(element.position?.y, 0);
    pts = pts.map((point) => {
      let x = (point.x - 0.5) * sx;
      let y = (point.y - 0.5) * sy;
      const rx = x * cosR - y * sinR;
      const ry = x * sinR + y * cosR;
      x = rx + 0.5 + ox;
      y = ry + 0.5 + oy;
      let out: Point2D = { x, y };
      if (element.warpEnabled) out = bilinearWarp(out, element.warpCorners);
      if (element.meshWarpEnabled) out = meshWarp(out, element.meshWarp);
      return out;
    });

    // Downsample into the shared pool budget.
    const remainingElements = visible.length - index;
    const budget = Math.max(4, Math.floor((LINES_MAX_POINTS - pointCursor) / remainingElements));
    if (pts.length > budget) {
      const sampled: Point2D[] = [];
      for (let i = 0; i < budget; i++) {
        sampled.push(pts[Math.min(pts.length - 1, Math.floor((i * pts.length) / budget))]);
      }
      sampled[budget - 1] = pts[pts.length - 1];
      pts = sampled;
    }
    if (pts.length < 2 || pointCursor + pts.length > LINES_MAX_POINTS) continue;

    // Pixel-space points + cumulative arc length.
    let cum = 0;
    const pointStart = pointCursor;
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i].x * width;
      const py = (1 - pts[i].y) * height;
      if (i > 0) {
        const qx = pts[i - 1].x * width;
        const qy = (1 - pts[i - 1].y) * height;
        cum += Math.hypot(px - qx, py - qy);
      }
      const base = (POINTS_OFFSET_VEC4 + pointCursor) * 4;
      data[base] = px;
      data[base + 1] = py;
      data[base + 2] = cum;
      data[base + 3] = 0;
      pointCursor += 1;
    }
    let totalLen = cum;
    if (closed && pts.length >= 3) {
      totalLen += Math.hypot(
        (pts[0].x - pts[pts.length - 1].x) * width,
        (pts[0].y - pts[pts.length - 1].y) * height,
      );
    }

    const { color, width: strokeWidth, p } = strokeParams(element.stroke);
    const anim = element.drawAnimation;
    const stagger = String(content.staggerMode ?? 'simultaneous');
    const staggerDelaySec = Math.max(0, finite(content.staggerDelay, 200)) / 1000;
    const globalSpeed = Math.max(0.05, finite(content.globalDrawSpeed, 1));
    // Phase offsets are in animation cycles (raw = t * speed * global * 0.25),
    // so convert the per-element delay from seconds using this element's rate.
    const cycleRate = Math.max(0.05, finite(anim?.drawSpeed, 1)) * globalSpeed * 0.25;
    let phaseOffset = 0;
    let animEnabledOverride: boolean | null = null;
    if (stagger === 'cascade') {
      phaseOffset = -packedCount * staggerDelaySec * cycleRate;
    } else if (stagger === 'wave') {
      const windowSize = Math.max(1, Math.round(finite(content.waveWindowSize, 3)));
      phaseOffset = -(packedCount % windowSize) * staggerDelaySec * cycleRate;
    } else if (stagger === 'random') {
      const seed = Math.abs(Math.sin((packedCount + 1) * 12.9898) * 43758.5453) % 1;
      phaseOffset = -seed * Math.max(staggerDelaySec, 0.05) * 8 * cycleRate;
    } else if (stagger === 'solo') {
      // Solo: only the selected line animates; the rest hold fully drawn.
      animEnabledOverride = element.id === content.selectedElementId;
    }

    const e = (HEADER_VEC4S + packedCount * LINES_ELEMENT_VEC4S) * 4;
    data[e] = STROKE_CODES[element.stroke.type] ?? 0;
    data[e + 1] = strokeWidth;
    data[e + 2] = pointStart;
    data[e + 3] = pts.length;
    data[e + 4] = finite(color[0], 1);
    data[e + 5] = finite(color[1], 1);
    data[e + 6] = finite(color[2], 1);
    data[e + 7] = finite(color[3], 1);
    for (let i = 0; i < 8; i++) data[e + 8 + i] = p[i];
    data[e + 16] = (animEnabledOverride === null ? !!anim?.enabled : (!!anim?.enabled && animEnabledOverride)) ? 1 : 0;
    data[e + 17] = Math.max(0.05, finite(anim?.drawSpeed, 1));
    data[e + 18] = LOOP_CODES[String(anim?.loopMode ?? 'loop')] ?? 1;
    data[e + 19] = EASE_CODES[String(anim?.easing ?? 'linear')] ?? 0;
    data[e + 20] = Math.max(0, Math.min(1, finite(anim?.drawProgress, 1)));
    data[e + 21] = Math.max(0, Math.min(1, finite(anim?.trailLength, 0)));
    data[e + 22] = anim?.reverse ? 1 : 0;
    data[e + 23] = Math.max(0, Math.min(1, finite(element.opacity, 1)));
    data[e + 24] = BLEND_CODES[String(element.blendMode ?? 'add')] ?? 1;
    data[e + 25] = closed ? 1 : 0;
    data[e + 26] = Math.max(1, totalLen);
    data[e + 27] = phaseOffset;
    // Motion FX
    const motion = element.motionFx ?? { mode: 'none' as const, amount: 0.5, speed: 1 };
    const motionMode = MOTION_CODES[motion.mode] ?? 0;
    data[e + 32] = motionMode;
    data[e + 33] = Math.max(0, Math.min(1, finite(motion.amount, 0.5)));
    data[e + 34] = Math.max(0, Math.min(4, finite(motion.speed, 1)));
    data[e + 35] = 0;
    // Bounding box (pixels), padded by stroke reach for early-out culling.
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const point of pts) {
      minX = Math.min(minX, point.x * width);
      minY = Math.min(minY, (1 - point.y) * height);
      maxX = Math.max(maxX, point.x * width);
      maxY = Math.max(maxY, (1 - point.y) * height);
    }
    const reach = strokeWidth * 2 + Math.max(p[0], 24) + finite(content.bloom, 0) * 40 + 24
      + finite(motion.amount, 0) * 80;
    // Spin/orbit/wave move the whole line — disable culling for them.
    if (motionMode === 1 || motionMode === 4 || motionMode === 5) {
      data[e + 28] = -1e6; data[e + 29] = -1e6; data[e + 30] = 1e6; data[e + 31] = 1e6;
    } else {
      data[e + 28] = minX - reach;
      data[e + 29] = minY - reach;
      data[e + 30] = maxX + reach;
      data[e + 31] = maxY + reach;
    }
    packedCount += 1;
  }

  const bg = Array.isArray(content.backgroundColor) ? content.backgroundColor : [0, 0, 0, 0];
  data[0] = width;
  data[1] = height;
  data[2] = time;
  data[3] = Math.max(0, Math.min(0.1, finite(options.frameDelta, 1 / 60)));
  data[4] = packedCount;
  data[5] = Math.max(0, Math.min(1, finite(content.bloom, 0)));
  data[6] = Math.max(0, Math.min(1.5, finite(options.audioBass, 0)));
  data[7] = Math.max(0, Math.min(1.5, finite(options.audioTreble, 0)));
  data[8] = Math.max(0, Math.min(1.5, finite(options.audioBeat, 0)));
  data[9] = Math.max(0.05, finite(content.globalDrawSpeed, 1));
  data[10] = String(content.staggerMode ?? 'simultaneous') === 'sequential' ? 1 : 0;
  data[11] = Math.max(0, finite(content.staggerDelay, 200)) / 1000;
  data[12] = Math.max(0, Math.min(1, finite(content.afterglow, 0)));
  data[13] = Math.max(1, Math.round(finite(content.waveWindowSize, 3)));
  data[14] = Math.max(0, LINES_STAGGER_MODE_LIST.indexOf(String(content.staggerMode ?? 'simultaneous')));
  data[15] = 0;
  data[16] = finite(bg[0], 0);
  data[17] = finite(bg[1], 0);
  data[18] = finite(bg[2], 0);
  data[19] = finite(bg[3], 0);

  const sourceId = String(options.sourceId || 'lines-native-source');
  const uniformPrefix = String(options.uniformPrefix || 'lines');
  const uniformId = `${uniformPrefix}:${sourceId.replace(/[^a-zA-Z0-9:_-]+/g, '_')}:uniform`;
  return {
    state: null as null,
    config: {
      buffers: [{
        id: uniformId,
        kind: 'uniform',
        byte_length: LINES_UNIFORM_BYTES,
        initial_f32: Array.from(data),
      }],
      passes: [],
      render_passes: [{
        name: String(options.passName || 'lines-render'),
        shader_id: String(options.shaderId || LINES_NATIVE_SHADER_ID),
        vertex_entry: 'vs_full',
        fragment_entry: 'fs_lines',
        target: 'source_frame',
        source_id: sourceId,
        seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
        clear: true,
        clear_color: [0, 0, 0, 0],
        include_snapshot: !!options.includeSnapshot,
        blend: 'replace',
        primitive: 'triangle-list',
        vertex_count: 3,
        instance_count: 1,
        bindings: [
          { binding: 0, resource: uniformId, kind: 'uniform' },
        ],
      }],
      readbacks: [],
    },
    sourceId,
    passCount: 1,
  };
}

export function getLinesNativeShaderSource() {
  return {
    shaderId: LINES_NATIVE_SHADER_ID,
    stage: 'render' as const,
    entry: 'fs_lines',
    source: LINES_NATIVE_WGSL,
  };
}

export function buildLinesNativePrecompileCommands() {
  const shader = getLinesNativeShaderSource();
  return [{
    type: 'precompile_shader' as const,
    shader_id: shader.shaderId,
    stage: shader.stage,
    entry: shader.entry,
    source: shader.source,
  }];
}

export const LINES_NATIVE_WGSL = /* wgsl */`
struct LinesData {
  header0: vec4<f32>, // width, height, time, delta
  header1: vec4<f32>, // elementCount, bloom, bass, treble
  header2: vec4<f32>, // beat, globalSpeed, sequentialFlag, staggerDelay
  header3: vec4<f32>, // afterglow, waveWindow, staggerMode, 0
  bg: vec4<f32>,
  elements: array<vec4<f32>, ${LINES_MAX_ELEMENTS * LINES_ELEMENT_VEC4S}>,
  points: array<vec4<f32>, ${LINES_MAX_POINTS}>,
}

@group(0) @binding(0) var<uniform> lines: LinesData;

fn ln_hash(n: f32) -> f32 {
  return fract(sin(n * 127.1) * 43758.5453);
}

fn ln_hash2(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn ln_noise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = ln_hash2(i);
  let b = ln_hash2(i + vec2<f32>(1.0, 0.0));
  let c = ln_hash2(i + vec2<f32>(0.0, 1.0));
  let d = ln_hash2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn ln_hsv(h: f32, s: f32, v: f32) -> vec3<f32> {
  let p = abs(fract(vec3<f32>(h) + vec3<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - vec3<f32>(3.0));
  return v * mix(vec3<f32>(1.0), clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), s);
}

fn ln_ease(p: f32, mode: i32) -> f32 {
  if (mode == 1) { return p * p; }
  if (mode == 2) { return 1.0 - (1.0 - p) * (1.0 - p); }
  if (mode == 3) { return p * p * (3.0 - 2.0 * p); }
  return p;
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vs_full(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0, 1.0),
    vec2<f32>(3.0, 1.0)
  );
  let pos = positions[vertex_index];
  var out: VsOut;
  out.position = vec4<f32>(pos, 0.0, 1.0);
  out.uv = vec2<f32>(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  return out;
}

@fragment
fn fs_lines(in: VsOut) -> @location(0) vec4<f32> {
  let res = lines.header0.xy;
  let t = lines.header0.z;
  let element_count = i32(floor(lines.header1.x + 0.5));
  let bloom = lines.header1.y;
  let bass = lines.header1.z;
  let treble = lines.header1.w;
  let beat = lines.header2.x;
  let global_speed = lines.header2.y;
  let afterglow = lines.header3.x;
  let p = in.uv * res;

  var col = lines.bg.rgb * lines.bg.a;
  var acc_a = lines.bg.a;

  for (var e = 0; e < ${LINES_MAX_ELEMENTS}; e = e + 1) {
    if (e >= element_count) { break; }
    let base = e * ${LINES_ELEMENT_VEC4S};
    let e7 = lines.elements[base + 7];
    if (p.x < e7.x || p.y < e7.y || p.x > e7.z || p.y > e7.w) { continue; }
    let e0 = lines.elements[base];
    let e1 = lines.elements[base + 1];
    let e2 = lines.elements[base + 2];
    let e3 = lines.elements[base + 3];
    let e4 = lines.elements[base + 4];
    let e5 = lines.elements[base + 5];
    let e6 = lines.elements[base + 6];
    let e8 = lines.elements[base + 8];
    let stroke_type = i32(floor(e0.x + 0.5));
    let motion_mode = i32(floor(e8.x + 0.5));
    let motion_amt = e8.y;
    let motion_speed = max(0.05, e8.z);
    var width = max(0.5, e0.y);
    // Whole-line motion: transform the query point so the entire stroke
    // (any type) moves as one — wave ripples, spin rotates, orbit drifts.
    var q = p;
    if (motion_mode == 1) {
      q.x = q.x + sin(q.y * 0.014 * (0.5 + motion_speed) + t * motion_speed * 2.2) * motion_amt * 46.0;
      q.y = q.y + cos(q.x * 0.011 * (0.5 + motion_speed) + t * motion_speed * 1.7) * motion_amt * 30.0;
    } else if (motion_mode == 2) {
      width = width * (1.0 + motion_amt * 0.7 * sin(t * motion_speed * 2.4));
    } else if (motion_mode == 4) {
      let center = res * 0.5;
      let ang = t * motion_speed * 0.6;
      let ca = cos(-ang); let sa = sin(-ang);
      let rel = q - center;
      q = center + vec2<f32>(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);
    } else if (motion_mode == 5) {
      let orbit_r = motion_amt * 120.0;
      q = q - vec2<f32>(cos(t * motion_speed * 1.3), sin(t * motion_speed * 1.3)) * orbit_r;
    } else if (motion_mode == 6) {
      width = width * (1.0 + bass * motion_amt * 1.2);
    }
    let point_start = i32(floor(e0.z + 0.5));
    let point_count = i32(floor(e0.w + 0.5));
    let closed = e6.y > 0.5;
    let total_len = max(1.0, e6.z);
    if (point_count < 2) { continue; }

    // Nearest segment: distance + arc position at projection.
    var best_d = 1e9;
    var best_s = 0.0;
    let seg_count = point_count - 1 + select(0, 1, closed);
    for (var j = 0; j < ${LINES_MAX_POINTS}; j = j + 1) {
      if (j >= seg_count) { break; }
      let ia = point_start + j;
      var ib = ia + 1;
      if (j == point_count - 1) { ib = point_start; }
      let pa = lines.points[ia];
      let pb = lines.points[ib];
      let a = pa.xy;
      let b = pb.xy;
      let ab = b - a;
      let seg_len = max(length(ab), 0.0001);
      let h = clamp(dot(q - a, ab) / (seg_len * seg_len), 0.0, 1.0);
      let d = length(q - a - ab * h);
      if (d < best_d) {
        best_d = d;
        var seg_end_cum = pb.z;
        if (j == point_count - 1) { seg_end_cum = total_len; }
        best_s = pa.z + h * (seg_end_cum - pa.z + select(0.0, seg_len, seg_end_cum < pa.z));
        if (j == point_count - 1) { best_s = pa.z + h * seg_len; }
      }
    }

    var s_norm = clamp(best_s / total_len, 0.0, 1.0);
    if (e5.z > 0.5) { s_norm = 1.0 - s_norm; }

    // Draw animation window.
    var vis = 1.0;
    let anim_enabled = e4.x > 0.5;
    let loop_mode = i32(floor(e4.z + 0.5));
    let sequential = lines.header2.z > 0.5;
    if (anim_enabled && sequential) {
      // One line draws at a time: the timeline is sliced into per-element
      // slots (draw duration + stagger delay). Lines before their slot are
      // hidden, the active slot draws on, completed slots hold fully drawn.
      let n = max(1.0, f32(element_count));
      let draw_dur = 4.0 / max(0.1, e4.y * global_speed);
      let slot_len = draw_dur + lines.header2.w;
      let total = slot_len * n;
      let local = t - floor(t / total) * total;
      let slot = i32(floor(local / slot_len));
      if (slot < e) {
        vis = 0.0;
      } else if (slot == e) {
        let in_slot = local - f32(e) * slot_len;
        var prog = clamp(in_slot / draw_dur, 0.0, 1.0);
        prog = ln_ease(prog, i32(floor(e4.w + 0.5)));
        if (s_norm > prog) {
          vis = 0.0;
        } else {
          let trail = e5.y;
          if (trail > 0.001) {
            let window = max(0.03, 1.0 - trail) * (1.0 + afterglow * 3.0);
            vis = 1.0 - clamp((prog - s_norm) / window, 0.0, 1.0);
          }
        }
      }
    } else if (anim_enabled) {
      let raw = (t * e4.y * global_speed * 0.25) + e5.x + e6.w;
      var prog = e5.x;
      if (loop_mode == 0) {
        prog = clamp(raw, 0.0, 1.0);
      } else if (loop_mode == 2) {
        prog = 1.0 - abs(1.0 - 2.0 * fract(raw * 0.5));
      } else {
        prog = fract(raw);
      }
      prog = ln_ease(prog, i32(floor(e4.w + 0.5)));
      if (s_norm > prog) {
        vis = 0.0;
      } else {
        var trail = e5.y;
        if (loop_mode == 3 && trail < 0.05) { trail = 0.6; }
        if (trail > 0.001) {
          let window = max(0.03, 1.0 - trail) * (1.0 + afterglow * 3.0);
          vis = 1.0 - clamp((prog - s_norm) / window, 0.0, 1.0);
        }
      }
    } else {
      if (s_norm > e5.x) { vis = 0.0; }
    }
    if (vis <= 0.001 && stroke_type != 7 && stroke_type != 8) { continue; }

    let aa = 1.5;
    let half_w = width * 0.5;
    let d = best_d;
    var cov = 1.0 - smoothstep(half_w - aa, half_w + aa, d);
    var out_rgb = e1.rgb;
    var out_a = e1.a * cov;

    if (stroke_type == 1) {
      // dashed
      let cycle = max(2.0, e2.x + e2.y);
      let phase = best_s + select(0.0, t * e2.w * 60.0, e2.z > 0.5);
      let on_dash = step(fract(phase / cycle) * cycle, e2.x);
      out_a = out_a * on_dash;
    } else if (stroke_type == 2) {
      // dotted
      let spacing = max(2.0, e2.y);
      let phase = best_s + select(0.0, t * e2.w * 60.0, e2.z > 0.5);
      let local = fract(phase / spacing) * spacing - spacing * 0.5;
      let dot_d = length(vec2<f32>(local, d));
      out_a = e1.a * (1.0 - smoothstep(e2.x * 0.5 - aa, e2.x * 0.5 + aa, dot_d));
    } else if (stroke_type == 3) {
      // glow (audio: beat swells the halo)
      let pulse = select(1.0, 0.75 + 0.25 * sin(t * e2.z * 6.28318), e2.z > 0.01);
      let glow_size = max(1.0, e2.x) * (1.0 + beat * 0.35);
      let halo = e2.y * pulse * exp(-d * d / (2.0 * glow_size * glow_size));
      out_a = clamp(e1.a * (cov + halo), 0.0, 1.0);
    } else if (stroke_type == 4) {
      // neon with flicker
      let flick = 1.0 - e2.z * step(0.72, ln_hash(floor(t * max(0.5, e2.y) * 8.0)));
      let halo = exp(-d * d / (2.0 * max(1.0, e2.x) * max(1.0, e2.x)));
      out_rgb = mix(e1.rgb, vec3<f32>(1.0), cov * 0.5);
      out_a = clamp(e1.a * (cov + halo * 0.8) * flick * (1.0 + beat * 0.2), 0.0, 1.0);
    } else if (stroke_type == 5) {
      // electric: jittered arcs + branches (treble-charged)
      let arc = e2.x * (1.0 + treble * 0.8);
      var energy = 0.0;
      let branch_count = i32(floor(e2.z + 0.5)) + 1;
      for (var k = 0; k < 5; k = k + 1) {
        if (k >= branch_count) { break; }
        let n = ln_noise(vec2<f32>(best_s * 0.02 + f32(k) * 13.7, t * max(0.2, e2.y) * 3.0));
        let offset = (n - 0.5) * arc * width * 6.0;
        let dd = abs(d - abs(offset));
        energy = energy + exp(-dd * dd / (2.0 * max(0.8, width * 0.4) * max(0.8, width * 0.4)));
      }
      out_rgb = mix(e1.rgb, vec3<f32>(1.0), clamp(energy * 0.4, 0.0, 0.6));
      out_a = clamp(e1.a * energy, 0.0, 1.0);
    } else if (stroke_type == 6) {
      // fire: rising flame noise above the line (bass-fed)
      let speed = max(0.2, e2.y);
      let n = ln_noise(vec2<f32>(best_s * 0.03, d * 0.08 - t * speed * 4.0));
      let n2 = ln_noise(vec2<f32>(best_s * 0.09 + 40.0, d * 0.16 - t * speed * 7.0));
      let flame_h = width * (2.0 + e2.x * 4.0) * (0.5 + n * 0.8 + n2 * 0.4) * (1.0 + bass * 0.6);
      let flame = clamp(1.0 - d / max(flame_h, 1.0), 0.0, 1.0);
      let heat = flame * flame;
      out_rgb = mix(vec3<f32>(1.0, 0.9, 0.35), e1.rgb, clamp(1.0 - heat, 0.0, 1.0));
      out_a = clamp(e1.a * (cov + heat * e2.x), 0.0, 1.0);
    } else if (stroke_type == 7) {
      // snake(s)
      let count = max(1.0, e3.y);
      var energy = 0.0;
      var head = 0.0;
      for (var k = 0; k < 8; k = k + 1) {
        if (f32(k) >= count) { break; }
        let head_pos = fract(t * e2.y * global_speed * 0.15 + f32(k) / count + e6.w);
        var rel = head_pos - s_norm;
        rel = rel - floor(rel);
        if (rel < e2.x) {
          var seg = 1.0;
          if (e2.z > 0.5) { seg = 1.0 - rel / e2.x; }
          energy = max(energy, seg);
          if (e2.w > 0.5 && rel < 0.02) { head = max(head, 1.0 - rel / 0.02); }
        }
        if (e3.x > 0.5) {
          var rel2 = s_norm - (1.0 - head_pos);
          rel2 = rel2 - floor(rel2);
          if (rel2 < e2.x) { energy = max(energy, select(1.0, 1.0 - rel2 / e2.x, e2.z > 0.5)); }
        }
      }
      out_rgb = mix(e1.rgb, vec3<f32>(1.0), head * 0.7);
      out_a = clamp(e1.a * cov * energy + head * cov, 0.0, 1.0);
    } else if (stroke_type == 8) {
      // multi-tail with per-tail hue shift
      let count = max(2.0, e2.x);
      var energy = 0.0;
      var tail_rgb = e1.rgb;
      for (var k = 0; k < 12; k = k + 1) {
        if (f32(k) >= count) { break; }
        let head_pos = fract(t * e2.w * global_speed * 0.15 + f32(k) * max(0.02, e2.z) + e6.w);
        var rel = head_pos - s_norm;
        rel = rel - floor(rel);
        if (rel < e2.y) {
          var seg = 1.0;
          if (e3.x > 0.5) { seg = 1.0 - rel / e2.y; }
          if (seg > energy) {
            energy = seg;
            if (e3.z > 0.5) {
              tail_rgb = ln_hsv(fract(f32(k) * e3.w * 0.25), 0.85, 1.0);
            }
          }
          if (e3.y > 0.5 && rel < 0.02) { energy = max(energy, 1.3 - rel * 15.0); }
        }
      }
      out_rgb = tail_rgb;
      out_a = clamp(e1.a * cov * energy, 0.0, 1.0);
    } else if (stroke_type == 9) {
      // pulse: travelling gaussians
      let count = max(1.0, e2.x);
      var energy = 0.2;
      for (var k = 0; k < 12; k = k + 1) {
        if (f32(k) >= count) { break; }
        var center = fract(t * e2.y * 0.2 + f32(k) / count);
        if (i32(floor(e2.w + 0.5)) == 1) { center = 1.0 - center; }
        var dd = abs(s_norm - center);
        dd = min(dd, 1.0 - dd);
        energy = max(energy, exp(-dd * dd / (2.0 * e2.z * e2.z * 0.25)));
        if (i32(floor(e2.w + 0.5)) == 2) {
          var dd2 = abs(s_norm - (1.0 - center));
          dd2 = min(dd2, 1.0 - dd2);
          energy = max(energy, exp(-dd2 * dd2 / (2.0 * e2.z * e2.z * 0.25)));
        }
      }
      out_a = clamp(e1.a * cov * energy, 0.0, 1.0);
    } else if (stroke_type == 10) {
      // scanner beam sweep
      let pos = 1.0 - abs(1.0 - 2.0 * fract(t * e2.y * 0.25));
      let dd = s_norm - pos;
      var energy = exp(-dd * dd / (2.0 * e2.x * e2.x * 0.25));
      if (dd < 0.0) { energy = max(energy, e2.z * exp(dd * 8.0 / max(0.05, e2.z))); }
      out_rgb = mix(e1.rgb, vec3<f32>(1.0), energy * 0.4);
      out_a = clamp(e1.a * cov * (0.12 + energy), 0.0, 1.0);
    } else if (stroke_type == 11) {
      // rainbow along path
      out_rgb = ln_hsv(fract(s_norm * e2.w + t * e2.z), e2.x, e2.y);
      out_a = cov;
    } else if (stroke_type == 12) {
      // laser: hot core + atmospheric scatter (beat boost)
      let flick = 1.0 - e2.z * 0.5 * ln_hash(floor(t * 24.0));
      let intensity = e2.x * flick * (1.0 + beat * 0.4);
      let core = 1.0 - smoothstep(half_w * 0.5 - aa, half_w * 0.5 + aa, d);
      let scatter = e2.y * exp(-d / max(2.0, width * 4.0));
      out_rgb = mix(e1.rgb, vec3<f32>(1.0), core * 0.75);
      out_a = clamp(e1.a * (core * intensity + scatter), 0.0, 1.0);
    } else if (stroke_type == 13) {
      // pipe: 3D tube illusion
      let h = clamp(d / half_w, 0.0, 1.0);
      let body = sqrt(max(0.0, 1.0 - h * h));
      let depth_shade = mix(1.0, body, e2.x);
      let spec_pos = 0.35;
      let spec_pow = mix(24.0, 4.0, clamp(e2.w, 0.0, 1.0));
      let spec = e2.z * pow(max(0.0, 1.0 - abs(h - spec_pos) * 2.2), spec_pow);
      let edge = e2.y * smoothstep(0.62, 0.98, h);
      let edge_rgb = vec3<f32>(e3.x, e3.y, e3.z);
      out_rgb = clamp(e1.rgb * depth_shade + vec3<f32>(spec) + edge_rgb * edge * 0.6, vec3<f32>(0.0), vec3<f32>(1.0));
      out_a = e1.a * cov;
    }

    // Afterglow approximation: travelling strokes leave a faint whole-path
    // ghost (no frame-history texture exists in this single pass).
    if (afterglow > 0.001 && (stroke_type == 7 || stroke_type == 8 || stroke_type == 9 || stroke_type == 10)) {
      out_a = max(out_a, e1.a * cov * afterglow * 0.3);
    }
    if (motion_mode == 3) {
      let sparkle = 0.55 + 0.45 * ln_noise(vec2<f32>(best_s * 0.05, t * motion_speed * 6.0));
      out_a = out_a * mix(1.0, sparkle, motion_amt);
    } else if (motion_mode == 6) {
      out_a = clamp(out_a * (1.0 + beat * motion_amt * 0.6), 0.0, 1.0);
    }
    out_a = out_a * vis * e5.w;
    if (bloom > 0.001) {
      out_a = clamp(out_a + bloom * 0.5 * exp(-d * d / (2.0 * width * width * 16.0)) * vis * e5.w, 0.0, 1.0);
    }
    if (out_a <= 0.0015) { continue; }

    let blend_mode = i32(floor(e6.x + 0.5));
    if (blend_mode == 1) {
      col = col + out_rgb * out_a;
    } else if (blend_mode == 2) {
      col = mix(col, col * out_rgb, out_a);
    } else if (blend_mode == 3) {
      col = mix(col, vec3<f32>(1.0) - (vec3<f32>(1.0) - col) * (vec3<f32>(1.0) - out_rgb), out_a);
    } else {
      col = mix(col, out_rgb, out_a);
    }
    acc_a = acc_a + out_a * (1.0 - acc_a);
  }

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(acc_a, 0.0, 1.0));
}
`;
