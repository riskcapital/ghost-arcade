// Native Light Painting renderer — a dedicated WGSL pass, not a remap onto the
// Lines strokes. Every brush family gets a bespoke treatment evaluated in the
// stroke's arc-length frame (s = distance along the path, sd = signed distance
// from it), with per-point pressure, world-space gravity for droplet/bubble
// brushes, audio reactivity, and draw-animation playback on the core clock.
import type {
  LightPaintingBrush,
  LightPaintingBrushType,
  LightPaintingContent,
  LightPaintingStroke,
} from '$lib/types';

export const LIGHT_PAINTING_NATIVE_SHADER_ID = 'light-painting/render-v7';

export const LIGHT_PAINTING_MAX_STROKES = 16;
export const LIGHT_PAINTING_STROKE_VEC4S = 9;
export const LIGHT_PAINTING_MAX_POINTS = 640;
// header0-2 + bg + fx0-fx4 (layer FX: pulse/strobe, breathe, wave,
// sparkle, hue shift, flow pulse, afterglow, echo, motion blur).
export const LIGHT_PAINTING_HEADER_VEC4S = 9;
// Hierarchical culling: every 8 points share a chunk bbox so the
// per-pixel segment scan can skip whole groups it can't be near.
export const LIGHT_PAINTING_CHUNK_POINTS = 8;
export const LIGHT_PAINTING_MAX_CHUNKS = LIGHT_PAINTING_MAX_POINTS / LIGHT_PAINTING_CHUNK_POINTS;
const HEADER_VEC4S = LIGHT_PAINTING_HEADER_VEC4S;
const POINTS_OFFSET_VEC4 = HEADER_VEC4S + LIGHT_PAINTING_MAX_STROKES * LIGHT_PAINTING_STROKE_VEC4S;
const CHUNKS_OFFSET_VEC4 = POINTS_OFFSET_VEC4 + LIGHT_PAINTING_MAX_POINTS;
const TOTAL_VEC4S = CHUNKS_OFFSET_VEC4 + LIGHT_PAINTING_MAX_CHUNKS;
export const LIGHT_PAINTING_UNIFORM_BYTES = TOTAL_VEC4S * 16;

export const NATIVE_LIGHT_PAINTING_BRUSHES = [
  'glow', 'neon', 'flame', 'electric', 'ribbon', 'particle', 'smoke', 'laser',
  'calligraphy', 'spray', 'paintbrush', 'marker', 'watercolor', 'spiral',
  'firefly', 'sap-flow', 'water', 'sparkle', 'plasma', 'galaxy', 'lightning',
  'vortex', 'nebula', 'kaleido', 'ink', 'crystal', 'aurora', 'bubbles',
  'orbit', 'helix',
] as const satisfies readonly LightPaintingBrushType[];

const BRUSH_CODES: Record<string, number> = Object.fromEntries(
  NATIVE_LIGHT_PAINTING_BRUSHES.map((brush, index) => [brush, index]),
);

const NATIVE_BRUSH_SET = new Set<LightPaintingBrushType>(NATIVE_LIGHT_PAINTING_BRUSHES);

export function isNativeLightPaintingBrush(type: LightPaintingBrushType): boolean {
  return NATIVE_BRUSH_SET.has(type);
}

function finite(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgba(rgb: [number, number, number] | null | undefined): [number, number, number, number] {
  return [
    clamp(finite(rgb?.[0], 255) / 255, 0, 1),
    clamp(finite(rgb?.[1], 255) / 255, 0, 1),
    clamp(finite(rgb?.[2], 255) / 255, 0, 1),
    1,
  ];
}

// Stroke playback order for sequential stagger — mirrors the legacy
// renderer's orderVisibleStrokes. Returns slot index per stroke: the
// stroke at index i animates during slot slots[i].
export function lightPaintingSequenceSlots(
  centers: ReadonlyArray<{ x: number; y: number }>,
  mode: string,
  seedBase: number,
  cycleIndex: number,
): number[] {
  const n = centers.length;
  const order = centers.map((_, i) => i);
  switch (mode) {
    case 'random': {
      let s = (((seedBase >>> 0) + cycleIndex * 1013904223) >>> 0) || 1;
      const rand = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let z = s;
        z = Math.imul(z ^ (z >>> 15), z | 1);
        z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
        return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
      };
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      break;
    }
    case 'alternating': {
      const interleaved: number[] = [];
      let left = 0;
      let right = n - 1;
      while (left <= right) {
        interleaved.push(left++);
        if (left <= right) interleaved.push(right--);
      }
      order.length = 0;
      order.push(...interleaved);
      break;
    }
    case 'bottomUp':
      order.sort((a, b) => centers[b].y - centers[a].y);
      break;
    case 'topDown':
      order.sort((a, b) => centers[a].y - centers[b].y);
      break;
    case 'centerOut':
    case 'outsideIn': {
      const dist = (i: number) =>
        (centers[i].x - 0.5) ** 2 + (centers[i].y - 0.5) ** 2;
      order.sort((a, b) => (mode === 'centerOut' ? dist(a) - dist(b) : dist(b) - dist(a)));
      break;
    }
    default:
      break; // recorded
  }
  const slots = new Array<number>(n).fill(0);
  order.forEach((strokeIndex, slot) => {
    slots[strokeIndex] = slot;
  });
  return slots;
}

export interface LightPaintingNativeGraphOptions {
  sourceId: string;
  content: LightPaintingContent;
  width: number;
  height: number;
  time: number;
  frameDelta: number;
  frameIndex: number;
  audioBass?: number;
  audioTreble?: number;
  audioBeat?: number;
  includeSnapshot?: boolean;
}

type PackableStroke = Pick<LightPaintingStroke, 'points' | 'brush'> & { visible?: boolean };

export function buildLightPaintingNativeComputeGraph(options: LightPaintingNativeGraphOptions) {
  const width = Math.max(2, Math.round(options.width || 1920));
  const height = Math.max(2, Math.round(options.height || 1080));
  const time = Math.max(0, finite(options.time, 0));
  const content = options.content;
  const data = new Float32Array(TOTAL_VEC4S * 4);

  const strokes: PackableStroke[] = (content.strokes ?? [])
    .filter((stroke) => stroke.visible !== false && (stroke.points?.length ?? 0) >= 2);
  const live = content.livePreviewStroke;
  const liveIncluded = !!(live && (live.points?.length ?? 0) >= 2 && live.brush);
  if (liveIncluded) strokes.push({ points: live!.points as any, brush: live!.brush });
  const packable = strokes.slice(-LIGHT_PAINTING_MAX_STROKES);

  const playbackPosition = clamp(finite(content.playbackPosition, 0), 0, 1);
  const pausedProgress = playbackPosition > 0.0005 && playbackPosition < 0.9995 ? playbackPosition : 1;
  const globalSpeed = Math.max(0.05, finite(content.animationSpeed, 1));
  const staggerDelaySec = Math.max(0, finite(content.staggerDelay, 200)) / 1000;

  let pointCursor = 0;
  let packedCount = 0;
  const packedStrokes: Array<{ base: number; center: { x: number; y: number }; isLive: boolean }> = [];
  const chunkMinX = new Float32Array(LIGHT_PAINTING_MAX_CHUNKS).fill(Infinity);
  const chunkMinY = new Float32Array(LIGHT_PAINTING_MAX_CHUNKS).fill(Infinity);
  const chunkMaxX = new Float32Array(LIGHT_PAINTING_MAX_CHUNKS).fill(-Infinity);
  const chunkMaxY = new Float32Array(LIGHT_PAINTING_MAX_CHUNKS).fill(-Infinity);
  const extendChunk = (chunk: number, x: number, y: number) => {
    if (x < chunkMinX[chunk]) chunkMinX[chunk] = x;
    if (y < chunkMinY[chunk]) chunkMinY[chunk] = y;
    if (x > chunkMaxX[chunk]) chunkMaxX[chunk] = x;
    if (y > chunkMaxY[chunk]) chunkMaxY[chunk] = y;
  };
  for (let index = 0; index < packable.length; index++) {
    const stroke = packable[index];
    const isLive = liveIncluded && index === packable.length - 1;
    const brush = stroke.brush ?? ({} as LightPaintingBrush);
    let pts = stroke.points.map((point: any) => ({
      x: clamp(finite(point.x, 0.5), -0.5, 1.5),
      y: clamp(finite(point.y, 0.5), -0.5, 1.5),
      pressure: clamp(finite(point.pressure, 1), 0.05, 1),
    }));

    const remaining = packable.length - index;
    const budget = Math.max(4, Math.floor((LIGHT_PAINTING_MAX_POINTS - pointCursor) / remaining));
    if (pts.length > budget) {
      const sampled: typeof pts = [];
      for (let i = 0; i < budget; i++) {
        sampled.push(pts[Math.min(pts.length - 1, Math.floor((i * pts.length) / budget))]);
      }
      sampled[budget - 1] = pts[pts.length - 1];
      pts = sampled;
    }
    if (pts.length < 2 || pointCursor + pts.length > LIGHT_PAINTING_MAX_POINTS) continue;

    // Organic wind — legacy per-point sway, re-baked every frame. Root
    // Lock (windAnchor) pins the bottom of the stroke while the top sways.
    const windSway = clamp(finite(content.windSway, 0), 0, 1);
    const windActive = content.isPlaying && windSway > 0.001;
    const windSpeed = Math.max(0.05, finite(content.windSpeed, 1));
    const windScale = Math.max(0.1, finite(content.windScale, 2));
    const windAnchor = clamp(finite(content.windAnchor, 0.7), 0, 1);
    const windPhase = ((packedCount * 37.73) % 17) * 0.3695;
    const TAU = Math.PI * 2;

    let cum = 0;
    const pointStart = pointCursor;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    let prevX = 0;
    let prevY = 0;
    for (let i = 0; i < pts.length; i++) {
      let px = pts[i].x * width;
      let py = pts[i].y * height;
      if (windActive) {
        const topWeight = Math.pow(clamp(1 - pts[i].y, 0, 1), 1.35);
        const anchorWeight = (1 - windAnchor) + windAnchor * topWeight;
        const amp = windSway * Math.min(width, height) * 0.045 * anchorWeight;
        const wave = Math.sin(time * windSpeed * TAU + pts[i].y * windScale * TAU + windPhase);
        const detail = Math.sin(time * windSpeed * Math.PI * 3.1 + pts[i].x * windScale * TAU - windPhase) * 0.35;
        const strokeProgress = i / Math.max(1, pts.length - 1);
        px += (wave + detail) * amp;
        py += Math.cos(time * windSpeed * Math.PI * 1.3 + strokeProgress * TAU + windPhase) * amp * 0.18;
      }
      if (i > 0) cum += Math.hypot(px - prevX, py - prevY);
      const base = (POINTS_OFFSET_VEC4 + pointCursor) * 4;
      data[base] = px;
      data[base + 1] = py;
      data[base + 2] = cum;
      data[base + 3] = pts[i].pressure;
      // Chunk bboxes: a segment straddling a chunk boundary must be
      // contained by the earlier chunk too, so extend both.
      const chunk = pointCursor >> 3;
      extendChunk(chunk, px, py);
      if (i > 0) {
        const prevChunk = (pointCursor - 1) >> 3;
        if (prevChunk !== chunk) extendChunk(prevChunk, px, py);
      }
      minX = Math.min(minX, px); minY = Math.min(minY, py);
      maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
      prevX = px;
      prevY = py;
      pointCursor += 1;
    }

    const widthPx = Math.max(0.75, finite(brush.size, 20) * 0.5);
    const glow = clamp(finite(brush.glow, 1), 0, 3);
    const softness = clamp(finite(brush.softness, 0.5), 0, 1);
    const jitter = clamp(finite(brush.jitter, 0), 0, 1);
    const speed = Math.max(0.05, finite(brush.speed, 1));
    const brushCode = BRUSH_CODES[String(brush.type)] ?? 0;

    const e = (HEADER_VEC4S + packedCount * LIGHT_PAINTING_STROKE_VEC4S) * 4;
    data[e] = brushCode;
    data[e + 1] = widthPx;
    data[e + 2] = pointStart;
    data[e + 3] = pts.length;
    data.set(rgba(brush.color), e + 4);
    data.set(rgba(brush.secondaryColor ?? brush.color), e + 8);
    data[e + 12] = glow;
    data[e + 13] = softness;
    data[e + 14] = jitter;
    data[e + 15] = speed;
    data[e + 16] = clamp(finite(brush.opacity, 1), 0, 1);
    data[e + 17] = 0.85; // pressure response
    data[e + 18] = (packedCount * 37.73) % 17; // deterministic seed
    data[e + 19] = 0.65; // end taper
    // Snake mode turns the draw animation into a travelling segment of
    // light: the head-size slider sets the visible fraction and Snake
    // Speed scales the travel rate.
    const snakeAmount = clamp(finite(content.snake, 0), 0, 0.98);
    const snakeOn = !isLive && content.isPlaying && snakeAmount > 0.005;
    data[e + 20] = !isLive && content.isPlaying ? 1 : 0;
    data[e + 21] = Math.max(0.05, finite(content.drawSpeed, 1)) *
      (snakeOn ? Math.max(0.1, finite(content.snakeSpeed, 1)) : 1);
    data[e + 22] = content.loopMode === 'once' ? (snakeOn ? 1 : 0) : content.loopMode === 'pingpong' ? 2 : 1;
    data[e + 23] = 0;
    // Paused mid-animation freezes the partial draw at the scrub position;
    // a never-played stroke (position 0) is retained artwork, not empty.
    data[e + 24] = isLive ? 1 : content.isPlaying ? playbackPosition : pausedProgress;
    data[e + 25] = snakeOn ? 1 - snakeAmount : clamp(finite(content.trailLength, 0.3), 0, 1);
    data[e + 26] = content.loopMode === 'reverse' ? 1 : 0;
    data[e + 27] = 0;
    // Render reach: how far a pixel can be from the path and still get
    // visible energy. Falling/rising particle brushes travel further.
    let reach = widthPx * (4 + glow * 3) + 90;
    if (brushCode === 16 || brushCode === 27) reach += 240;
    data[e + 28] = Math.max(1, cum);
    data[e + 29] = reach;
    data[e + 30] = 0;
    data[e + 31] = 0;
    const b = (HEADER_VEC4S + packedCount * LIGHT_PAINTING_STROKE_VEC4S + 8) * 4;
    data[b] = minX - reach;
    data[b + 1] = minY - reach;
    data[b + 2] = maxX + reach;
    data[b + 3] = maxY + reach;
    let cxSum = 0;
    let cySum = 0;
    for (const point of pts) {
      cxSum += point.x;
      cySum += point.y;
    }
    packedStrokes.push({
      base: e,
      center: { x: cxSum / pts.length, y: cySum / pts.length },
      isLive,
    });
    packedCount += 1;
  }

  // Sequential-stagger playback order. The live preview stroke never
  // animates, so it keeps slot 0 and is excluded from the ordering.
  const animatedStrokes = packedStrokes.filter((stroke) => !stroke.isLive);
  if (animatedStrokes.length > 1) {
    const drawSpeed = Math.max(0.05, finite(content.drawSpeed, 1));
    const drawDur = 4.5 / (drawSpeed * globalSpeed);
    const cycleLen = Math.max(0.001, (drawDur + staggerDelaySec) * packedCount);
    const cycleIndex = content.loopMode === 'once' ? 0 : Math.floor(time / cycleLen);
    const slots = lightPaintingSequenceSlots(
      animatedStrokes.map((stroke) => stroke.center),
      String(content.sequenceMode ?? 'recorded'),
      finite(content.randomSequenceSeed, 1337),
      cycleIndex,
    );
    animatedStrokes.forEach((stroke, index) => {
      data[stroke.base + 23] = slots[index];
    });
  }

  for (let chunk = 0; chunk < LIGHT_PAINTING_MAX_CHUNKS; chunk++) {
    if (!Number.isFinite(chunkMinX[chunk])) continue;
    const base = (CHUNKS_OFFSET_VEC4 + chunk) * 4;
    data[base] = chunkMinX[chunk];
    data[base + 1] = chunkMinY[chunk];
    data[base + 2] = chunkMaxX[chunk];
    data[base + 3] = chunkMaxY[chunk];
  }

  const bg = Array.isArray(content.backgroundColor) ? content.backgroundColor : [0, 0, 0, 0];
  data[0] = width;
  data[1] = height;
  data[2] = time;
  data[3] = clamp(finite(options.frameDelta, 1 / 60), 0, 0.1);
  data[4] = packedCount;
  data[5] = clamp(finite(content.bloom, 0), 0, 3);
  data[6] = clamp(finite(options.audioBass, 0), 0, 1.5);
  data[7] = clamp(finite(options.audioTreble, 0), 0, 1.5);
  data[8] = clamp(finite(options.audioBeat, 0), 0, 1.5);
  data[9] = globalSpeed;
  data[10] = content.staggerStrokes ? 1 : 0;
  data[11] = staggerDelaySec;
  data[12] = clamp(finite(bg[0], 0), 0, 1);
  data[13] = clamp(finite(bg[1], 0), 0, 1);
  data[14] = clamp(finite(bg[2], 0), 0, 1);
  data[15] = clamp(finite(bg[3], 0), 0, 1);
  // Layer FX (fx0-fx4). Motion FX are gated on playback, matching the
  // legacy renderer; hue shift, multi-color glow, and echo stay active
  // on static artwork.
  const playing = !!content.isPlaying;
  const gate = (value: number) => (playing ? value : 0);
  data[16] = clamp(finite(content.colorShift, 0), 0, 1);
  data[17] = gate(clamp(finite(content.pulse, 0), 0, 1));
  data[18] = Math.max(0.05, finite(content.pulseSpeed, 1));
  data[19] = gate(clamp(finite(content.strobe, 0), 0, 1));
  data[20] = gate(clamp(finite(content.flicker, 0), 0, 1));
  data[21] = gate(clamp(finite(content.breathe, 0), 0, 1));
  data[22] = Math.max(0.05, finite(content.breatheSpeed, 1));
  data[23] = gate(clamp(finite(content.wave, 0), 0, 1));
  data[24] = clamp(finite(content.waveFreq, 2), 0.5, 10);
  data[25] = Math.max(0.05, finite(content.waveSpeed, 1));
  data[26] = gate(clamp(finite(content.sparkle, 0), 0, 1));
  data[27] = content.multiColorGlow ? 1 : 0;
  data[28] = gate(clamp(finite(content.flowPulse, 0), 0, 1));
  data[29] = Math.max(0.05, finite(content.flowSpeed, 1));
  data[30] = clamp(finite(content.flowWidth, 0.12), 0.02, 0.5);
  data[31] = gate(clamp(finite(content.afterglow, 0), 0, 1));
  data[32] = clamp(Math.round(finite(content.echo, 0)), 0, 10);
  data[33] = clamp(finite(content.echoOffset, 0.05), 0, 0.2);
  data[34] = clamp(finite(content.echoDecay, 0.3), 0, 1);
  data[35] = gate(clamp(finite(content.motionBlur, 0), 0, 1));

  const sourceId = String(options.sourceId || 'light-painting-native-source');
  const uniformId = `light-painting:${sourceId.replace(/[^a-zA-Z0-9:_-]+/g, '_')}:uniform`;
  return {
    state: null as null,
    config: {
      buffers: [{
        id: uniformId,
        kind: 'uniform',
        byte_length: LIGHT_PAINTING_UNIFORM_BYTES,
        initial_f32: Array.from(data),
      }],
      passes: [],
      readbacks: [],
      render_passes: [{
        name: 'light-painting-render',
        shader_id: LIGHT_PAINTING_NATIVE_SHADER_ID,
        vertex_entry: 'vs_full',
        fragment_entry: 'fs_paint',
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
    },
    sourceId,
    passCount: 1,
  };
}

export function buildLightPaintingNativePrecompileCommands() {
  return [{
    type: 'precompile_shader' as const,
    shader_id: LIGHT_PAINTING_NATIVE_SHADER_ID,
    stage: 'render' as const,
    entry: 'fs_paint',
    source: LIGHT_PAINTING_NATIVE_WGSL,
  }];
}

export const LIGHT_PAINTING_NATIVE_WGSL = /* wgsl */`
struct PaintData {
  header0: vec4<f32>, // width, height, time, delta
  header1: vec4<f32>, // strokeCount, bloom, bass, treble
  header2: vec4<f32>, // beat, globalSpeed, staggerSeq, staggerDelay
  bg: vec4<f32>,
  fx0: vec4<f32>, // colorShift, pulse, pulseSpeed, strobe
  fx1: vec4<f32>, // flicker, breathe, breatheSpeed, wave
  fx2: vec4<f32>, // waveFreq, waveSpeed, sparkle, multiColorGlow
  fx3: vec4<f32>, // flowPulse, flowSpeed, flowWidth, afterglow
  fx4: vec4<f32>, // echo, echoOffset, echoDecay, motionBlur
  strokes: array<vec4<f32>, ${LIGHT_PAINTING_MAX_STROKES * LIGHT_PAINTING_STROKE_VEC4S}>,
  points: array<vec4<f32>, ${LIGHT_PAINTING_MAX_POINTS}>,
  chunks: array<vec4<f32>, ${LIGHT_PAINTING_MAX_CHUNKS}>,
}
@group(0) @binding(0) var<uniform> paint: PaintData;

fn lp_hash(n: f32) -> f32 { return fract(sin(n * 127.1) * 43758.5453); }
fn lp_hash2(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn lp_noise(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(lp_hash2(i), lp_hash2(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(lp_hash2(i + vec2<f32>(0.0, 1.0)), lp_hash2(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
fn lp_fbm(p0: vec2<f32>) -> f32 {
  var p = p0; var v = 0.0; var a = 0.5;
  for (var i = 0; i < 3; i = i + 1) { v = v + lp_noise(p) * a; p = p * 2.1; a = a * 0.5; }
  return v;
}
fn lp_hsv(h: f32, s: f32, v: f32) -> vec3<f32> {
  let q = abs(fract(vec3<f32>(h) + vec3<f32>(1.0, 0.6666667, 0.3333333)) * 6.0 - vec3<f32>(3.0));
  return v * mix(vec3<f32>(1.0), clamp(q - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), s);
}
fn lp_gauss(d: f32, sigma: f32) -> f32 { return exp(-d * d / max(2.0 * sigma * sigma, 0.0001)); }
fn lp_hue_rotate(c: vec3<f32>, turns: f32) -> vec3<f32> {
  let a = turns * 6.28318530;
  let ca = cos(a); let sa = sin(a);
  let k = vec3<f32>(0.57735027);
  return c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
}

struct VsOut { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
@vertex fn vs_full(@builtin(vertex_index) i: u32) -> VsOut {
  var pos = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var out: VsOut;
  out.position = vec4<f32>(pos[i], 0.0, 1.0);
  out.uv = vec2<f32>(pos[i].x * 0.5 + 0.5, 0.5 - pos[i].y * 0.5);
  return out;
}

@fragment fn fs_paint(in: VsOut) -> @location(0) vec4<f32> {
  let res = paint.header0.xy;
  let t = paint.header0.z;
  let stroke_count = i32(paint.header1.x + 0.5);
  let bloom = paint.header1.y;
  let bass = paint.header1.z;
  let treble = paint.header1.w;
  let beat = paint.header2.x;
  let global_speed = paint.header2.y;

  // ── Layer FX preamble: breathe scale, wave wobble, global brightness ──
  var p_base = in.uv * res;
  if (paint.fx1.y > 0.001) {
    let breathe_scale = 1.0 + paint.fx1.y * 0.3 * sin(t * paint.fx1.z * 6.28318);
    p_base = res * 0.5 + (p_base - res * 0.5) / max(0.2, breathe_scale);
  }
  if (paint.fx1.w > 0.001) {
    let wamt = paint.fx1.w * 15.0;
    let wphase = t * paint.fx2.y * 6.28318;
    p_base = p_base - vec2<f32>(sin(wphase) * wamt, cos(wphase * paint.fx2.x) * wamt * 0.5);
  }
  var global_mult = 1.0;
  if (paint.fx0.y > 0.001) {
    global_mult = global_mult * (1.0 - paint.fx0.y * 0.5 * (0.5 - 0.5 * sin(t * paint.fx0.z * 6.28318)));
  }
  if (paint.fx0.w > 0.001) {
    global_mult = global_mult * select(0.05, 1.0, sin(t * paint.fx0.w * 20.0 * 6.28318) > 0.0);
  }
  if (paint.fx1.x > 0.001) {
    global_mult = global_mult * (1.0 - paint.fx1.x * lp_hash(floor(t * 24.0)) * 0.6);
  }
  let hue_shift_base = select(0.0, fract(t / 3.0 * paint.fx0.x), paint.fx0.x > 0.001);
  let echo_n = i32(paint.fx4.x + 0.5);
  let echo_off_px = paint.fx4.y * res.x * 0.5;

  var col = paint.bg.rgb * paint.bg.a;
  var acc = paint.bg.a;

  for (var e = 0; e < ${LIGHT_PAINTING_MAX_STROKES}; e = e + 1) {
    if (e >= stroke_count) { break; }
    let base = e * ${LIGHT_PAINTING_STROKE_VEC4S};
    let bb = paint.strokes[base + 8];
    let e0 = paint.strokes[base];
    let color = paint.strokes[base + 1];
    let color2 = paint.strokes[base + 2];
    let e3 = paint.strokes[base + 3]; // glow, softness, jitter, speed
    let e4 = paint.strokes[base + 4]; // opacity, pressureAmt, seed, taper
    let e5 = paint.strokes[base + 5]; // animEnabled, drawSpeed, loopMode, seqSlot
    let e6 = paint.strokes[base + 6]; // drawProgress, trailLength, reverse, phase
    let e7 = paint.strokes[base + 7]; // totalLen
    let brush = i32(e0.x + 0.5);
    let bw = max(0.75, e0.y);
    let point_start = i32(e0.z + 0.5);
    let point_count = i32(e0.w + 0.5);
    let glow = e3.x;
    let softness = e3.y;
    let jitter = e3.z;
    let speed = e3.w;
    let seed = e4.z;
    let total_len = max(1.0, e7.x);
    if (point_count < 2) { continue; }

    // Echo copies re-evaluate the stroke at vertically shifted sample
    // points with decaying brightness (legacy Echo Lines).
    for (var ec = 0; ec <= 10; ec = ec + 1) {
    if (ec > echo_n) { break; }
    let p = p_base + vec2<f32>(0.0, echo_off_px * f32(ec));
    var echo_fade = 1.0;
    if (ec > 0) {
      echo_fade = pow(1.0 - paint.fx4.z, f32(ec));
      if (echo_fade < 0.004) { continue; }
    }
    if (p.x < bb.x || p.y < bb.y || p.x > bb.z || p.y > bb.w) { continue; }

    // ── Nearest segment: distance, arc position, tangent, side, pressure ──
    // Chunked scan: 8-point groups are skipped wholesale when the pixel
    // is beyond the stroke's render reach from the chunk's bbox — the
    // skipped segments could not have contributed visible energy.
    var best_d = 1e9;
    var best_s = 0.0;
    var best_tan = vec2<f32>(1.0, 0.0);
    var best_side = 1.0;
    var best_q = p;
    var best_pressure = 1.0;
    let reach = max(e7.y, 1.0);
    let near_pad = bw * 3.0 + 60.0;
    let last_point = point_start + point_count - 1;
    let chunk_first = point_start / ${LIGHT_PAINTING_CHUNK_POINTS};
    let chunk_last = (last_point - 1) / ${LIGHT_PAINTING_CHUNK_POINTS};
    for (var cj = chunk_first; cj <= chunk_last; cj = cj + 1) {
      let cb = paint.chunks[cj];
      let rdx = max(max(cb.x - p.x, p.x - cb.z), 0.0);
      let rdy = max(max(cb.y - p.y, p.y - cb.w), 0.0);
      let rect_d2 = rdx * rdx + rdy * rdy;
      if (rect_d2 > reach * reach) { continue; }
      let j_start = max(cj * ${LIGHT_PAINTING_CHUNK_POINTS}, point_start);
      let j_end = min(cj * ${LIGHT_PAINTING_CHUNK_POINTS} + ${LIGHT_PAINTING_CHUNK_POINTS}, last_point);
      if (rect_d2 > near_pad * near_pad) {
        // Far field: the halo tail varies slowly out here, so one chord
        // spanning the chunk stands in for its 8 segments.
        let pa = paint.points[j_start];
        let pb = paint.points[j_end];
        let a = pa.xy; let b = pb.xy;
        let ab = b - a;
        let seg_len2 = max(dot(ab, ab), 0.0001);
        let h = clamp(dot(p - a, ab) / seg_len2, 0.0, 1.0);
        let q = a + ab * h;
        let dseg = distance(p, q);
        if (dseg < best_d) {
          best_d = dseg;
          best_s = mix(pa.z, pb.z, h);
          best_tan = normalize(ab);
          best_side = sign((p.x - a.x) * ab.y - (p.y - a.y) * ab.x);
          best_q = q;
          best_pressure = mix(pa.w, pb.w, h);
        }
        continue;
      }
      for (var j = j_start; j < j_end; j = j + 1) {
        let pa = paint.points[j];
        let pb = paint.points[j + 1];
        let a = pa.xy; let b = pb.xy;
        let ab = b - a;
        let seg_len = max(length(ab), 0.0001);
        let h = clamp(dot(p - a, ab) / (seg_len * seg_len), 0.0, 1.0);
        let q = a + ab * h;
        let dseg = distance(p, q);
        if (dseg < best_d) {
          best_d = dseg;
          best_s = pa.z + h * seg_len;
          best_tan = ab / seg_len;
          best_side = sign((p.x - a.x) * ab.y - (p.y - a.y) * ab.x);
          best_q = q;
          best_pressure = mix(pa.w, pb.w, h);
        }
      }
    }
    if (best_d > reach) { continue; }
    let d = best_d;
    let s = best_s;
    let sd = d * best_side;
    var s_norm = clamp(s / total_len, 0.0, 1.0);
    if (e6.z > 0.5) { s_norm = 1.0 - s_norm; }

    // ── Draw animation window (playback on the core clock) ──
    var vis = 1.0;
    if (e5.x > 0.5) {
      let raw = t * e5.y * global_speed * 0.22 + e6.x + e6.w;
      if (paint.header2.z > 0.5) {
        // Sequential stagger: strokes reveal one after another in the
        // slot order packed by the CPU (Sequence Order modes).
        let slot_target = i32(e5.w + 0.5);
        let n = max(1.0, paint.header1.x);
        let draw_dur = 4.5 / max(0.1, e5.y * global_speed);
        let slot_len = draw_dur + paint.header2.w;
        let total = slot_len * n;
        let local = t - floor(t / total) * total;
        let slot = i32(floor(local / slot_len));
        if (slot < slot_target) { vis = 0.0; }
        else if (slot == slot_target) {
          let prog = clamp((local - f32(slot_target) * slot_len) / draw_dur, 0.0, 1.0);
          if (s_norm > prog) { vis = 0.0; }
        }
      } else {
        var prog = fract(raw);
        let loop_mode = i32(e5.z + 0.5);
        if (loop_mode == 0) { prog = clamp(raw, 0.0, 1.0); }
        else if (loop_mode == 2) { prog = 1.0 - abs(1.0 - 2.0 * fract(raw * 0.5)); }
        if (s_norm > prog) { vis = 0.0; }
        else if (e6.y > 0.001 || paint.fx3.w > 0.001) {
          let window = max(0.03, 1.0 - e6.y);
          vis = 1.0 - clamp((prog - s_norm) / window, 0.0, 1.0);
          // Afterglow leaves a long dim tail behind the animated head.
          if (paint.fx3.w > 0.001) {
            let tail = (1.0 - clamp((prog - s_norm) / (window * (1.0 + paint.fx3.w * 6.0)), 0.0, 1.0)) * paint.fx3.w * 0.55;
            vis = max(vis, tail);
          }
        }
      }
    } else {
      if (s_norm > e6.x) { vis = 0.0; }
    }
    if (vis <= 0.001) { continue; }

    // Pressure + end taper drive the working width.
    let taper = min(smoothstep(0.0, e4.w * 60.0, s), smoothstep(0.0, e4.w * 60.0, total_len - s));
    var w = bw * mix(1.0, best_pressure, e4.y) * mix(0.55, 1.0, taper);
    // Flow pulse — a luminous swell travelling along the stroke.
    if (paint.fx3.x > 0.001) {
      let head = fract(t * paint.fx3.y * 0.25 + seed * 0.0588);
      let fdist = abs(s_norm - head);
      let wdist = min(fdist, 1.0 - fdist);
      let fw = max(0.02, paint.fx3.z);
      w = w * (1.0 + exp(-wdist * wdist / (2.0 * fw * fw)) * paint.fx3.x * 1.8);
    }
    if (paint.fx4.w > 0.001) { w = w * (1.0 + paint.fx4.w * 0.6); }
    var out_rgb = color.rgb;
    var out_a = 0.0;
    var additive = true;

    if (brush == 0) { // glow — hot core, wide breathing halo, chroma fringe
      let core = lp_gauss(d, w * 0.42);
      let halo = lp_gauss(d, w * (1.4 + glow * 1.8)) * (0.4 + glow * 0.3) * (1.0 + beat * 0.3);
      out_rgb = mix(color.rgb, vec3<f32>(1.0), core * 0.55) + color2.rgb * halo * 0.3;
      out_a = core + halo;
    } else if (brush == 1) { // neon — glass tube, reflection line, flicker
      let flick = 1.0 - 0.12 * step(0.86, lp_hash(floor(t * speed * 9.0) + seed));
      let tube = 1.0 - smoothstep(w * 0.55, w * 0.75, d);
      let core = lp_gauss(d, w * 0.22);
      let halo = lp_gauss(d, w * (1.6 + glow * 1.4)) * 0.55;
      let reflect_line = lp_gauss(abs(sd + w * 0.3), w * 0.1) * 0.6;
      out_rgb = mix(color.rgb, vec3<f32>(1.0), core * 0.8 + reflect_line);
      out_a = (tube * 0.85 + core + halo) * flick;
    } else if (brush == 2) { // flame — licking fire with sparks (bass-fed)
      let rise = t * speed * 3.0;
      let n1 = lp_fbm(vec2<f32>(s * 0.025 + seed, d * 0.05 - rise));
      let n2 = lp_noise(vec2<f32>(s * 0.09, d * 0.11 - rise * 1.8));
      let env = w * (2.2 + glow * 2.0) * (0.55 + n1 * 0.8 + n2 * 0.3) * (1.0 + bass * 0.5);
      let flame = clamp(1.0 - d / max(env, 1.0), 0.0, 1.0);
      let heat = flame * flame;
      let spark = step(0.985, lp_hash2(floor(vec2<f32>(s * 0.4, sd * 0.4) + vec2<f32>(0.0, -rise * 8.0)))) * heat;
      out_rgb = mix(vec3<f32>(1.0, 0.85, 0.3), color.rgb, clamp(1.0 - heat * 1.2, 0.0, 1.0)) + vec3<f32>(spark);
      out_a = heat + lp_gauss(d, w * 0.4) * 0.8 + spark;
    } else if (brush == 3) { // electric — jittered filaments + spurs (treble)
      var energy = 0.0;
      let amp = w * (2.0 + jitter * 6.0) * (1.0 + treble * 0.7);
      for (var k = 0; k < 3; k = k + 1) {
        let off = (lp_fbm(vec2<f32>(s * 0.03 + f32(k) * 13.7 + seed, t * speed * 2.6)) - 0.5) * amp;
        energy = energy + lp_gauss(abs(sd - off), max(0.7, w * 0.16));
      }
      let spur = step(0.94, lp_hash2(vec2<f32>(floor(s * 0.08), floor(t * speed * 6.0)))) *
        lp_gauss(abs(sd) - w * 1.6, w * 0.5) * 0.6;
      out_rgb = mix(color.rgb, vec3<f32>(1.0), clamp(energy * 0.5, 0.0, 0.75));
      out_a = energy + spur;
    } else if (brush == 4) { // ribbon — twisting 3D band
      let twist = cos(s * 0.02 * (0.5 + speed) + t * speed * 2.0);
      let half_w = max(w * 0.25, w * abs(twist));
      let band = 1.0 - smoothstep(half_w - 1.5, half_w + 1.5, d);
      let facing = step(0.0, twist);
      let shade = 0.55 + 0.45 * abs(twist);
      out_rgb = mix(color2.rgb, color.rgb, facing) * shade + vec3<f32>(lp_gauss(abs(d - half_w), 1.2) * 0.5);
      out_a = band;
      additive = false;
    } else if (brush == 5 || brush == 9) { // particle / spray
      let spacing = max(3.0, w * select(1.1, 0.55, brush == 9));
      var energy = 0.0;
      var tintpick = 0.0;
      for (var k = -1; k <= 1; k = k + 1) {
        let cell = floor(s / spacing) + f32(k);
        let h1 = lp_hash(cell + seed); let h2 = lp_hash(cell * 1.7 + seed + 5.0);
        let cx = (cell + 0.5 + (h1 - 0.5) * 0.8) * spacing;
        let cy = (h2 - 0.5) * w * select(1.6, 3.2, brush == 9);
        let pr = max(0.8, w * select(0.3, 0.14, brush == 9) * (0.5 + h1));
        let pd = length(vec2<f32>(s - cx, sd - cy));
        let en = lp_gauss(pd, pr) * (0.6 + 0.4 * sin(t * speed * 3.0 + h1 * 6.28));
        if (en > energy) { energy = en; tintpick = h1; }
      }
      out_rgb = mix(color.rgb, color2.rgb, tintpick);
      out_a = energy;
      additive = brush == 5;
    } else if (brush == 6) { // smoke — curling wisps
      let drift = t * speed * 0.7;
      let n = lp_fbm(vec2<f32>(s * 0.012 + drift * 0.3, sd * 0.02 - drift));
      let n2 = lp_fbm(vec2<f32>(s * 0.03 - drift * 0.2, sd * 0.05 - drift * 1.7) + vec2<f32>(seed));
      let env = w * (2.5 + softness * 3.5);
      let wisp = clamp(1.0 - d / env, 0.0, 1.0) * (0.35 + n * 0.5 + n2 * 0.3);
      out_rgb = mix(color.rgb, color2.rgb, n);
      out_a = wisp * wisp * (0.5 + glow * 0.3);
    } else if (brush == 7) { // laser — surgical core + speckled scatter
      let flick = 1.0 - 0.1 * lp_hash(floor(t * 30.0) + seed);
      let core = lp_gauss(d, max(0.5, w * 0.14)) * (1.6 + glow) * flick * (1.0 + beat * 0.4);
      let mid = lp_gauss(d, w * 0.5) * 0.5;
      let speck = lp_noise(vec2<f32>(s * 0.2, t * 14.0)) * 0.4 + 0.6;
      let scatter = exp(-d / max(3.0, w * 3.2)) * 0.3 * speck;
      out_rgb = mix(color.rgb, vec3<f32>(1.0), clamp(core, 0.0, 0.85));
      out_a = core + mid + scatter;
    } else if (brush == 8) { // calligraphy — angle-sensitive nib
      let nib = abs(best_tan.x * 0.7071 - best_tan.y * 0.7071);
      let nib_w = w * mix(0.3, 1.15, nib);
      let ink_n = lp_noise(vec2<f32>(s * 0.15, sd * 0.3)) * 0.15;
      out_a = (1.0 - smoothstep(nib_w - 1.2, nib_w + 1.2, d)) * (0.92 - ink_n);
      out_rgb = color.rgb;
      additive = false;
    } else if (brush == 10) { // paintbrush — dry bristle streaks
      var energy = 0.0;
      for (var k = 0; k < 7; k = k + 1) {
        let fk = f32(k) - 3.0;
        let off = fk * w * 0.26 + (lp_hash(f32(k) + seed) - 0.5) * w * 0.14;
        let gap = step(0.22, lp_noise(vec2<f32>(s * 0.05 + f32(k) * 9.1, f32(k) * 3.0)));
        energy = max(energy, lp_gauss(abs(sd - off), w * 0.13) * gap * (0.75 + 0.25 * lp_hash(f32(k) * 2.0)));
      }
      out_rgb = color.rgb * (0.85 + 0.15 * lp_noise(vec2<f32>(s * 0.02, sd * 0.1)));
      out_a = energy;
      additive = false;
    } else if (brush == 11) { // marker — chisel band with edge darkening
      let band = 1.0 - smoothstep(w * 0.85, w * 1.0, d);
      let edge_dark = smoothstep(w * 0.55, w * 0.95, d) * 0.25;
      let streak = 0.92 + 0.08 * lp_noise(vec2<f32>(s * 0.08, sd * 0.4));
      out_rgb = color.rgb * (1.0 - edge_dark) * streak;
      out_a = band * 0.96;
      additive = false;
    } else if (brush == 12) { // watercolor — bleeding pigment pools
      let bleed = lp_fbm(vec2<f32>(s * 0.02 + seed, sd * 0.04)) - 0.5;
      let env = w * (1.6 + softness * 1.6) * (1.0 + bleed * 0.8);
      let body = 1.0 - smoothstep(env * 0.4, env, d);
      let rim = smoothstep(env * 0.55, env * 0.98, d) * body * 0.55;
      let gran = 0.9 + 0.1 * lp_noise(vec2<f32>(s * 0.2, sd * 0.2));
      out_rgb = mix(color.rgb, color.rgb * 0.55, rim) * gran;
      out_a = body * (0.4 + glow * 0.15);
      additive = false;
    } else if (brush == 13) { // spiral — candy wrap bands
      let phase = s * (0.06 + speed * 0.04) - t * speed * 4.0 + sd * (3.14159 / max(w, 1.0));
      let band = pow(0.5 + 0.5 * sin(phase), 6.0);
      let body = 1.0 - smoothstep(w * 0.9, w * 1.15, d);
      out_rgb = mix(color2.rgb, color.rgb, band) + vec3<f32>(band * 0.3);
      out_a = body * (0.35 + band * 0.85) + lp_gauss(d, w * 1.8) * glow * 0.25;
    } else if (brush == 14) { // firefly — drifting twinkles
      let spacing = max(8.0, w * 2.4);
      var energy = 0.0;
      var warm = 0.0;
      for (var k = -1; k <= 1; k = k + 1) {
        let cell = floor(s / spacing) + f32(k);
        let h1 = lp_hash(cell + seed); let h2 = lp_hash(cell * 3.1 + seed);
        let cycle = fract(t * speed * 0.22 + h1);
        let drift = cycle * w * (2.0 + h2 * 3.0);
        let ang = h2 * 6.28318 + cycle * 1.5;
        let center = vec2<f32>((cell + 0.5) * spacing, 0.0) + vec2<f32>(cos(ang), sin(ang)) * drift;
        let pd = length(vec2<f32>(s, sd) - center);
        let twinkle = pow(0.5 + 0.5 * sin(t * (4.0 + h1 * 6.0) + h1 * 40.0), 3.0);
        let fade = 1.0 - cycle * 0.7;
        let en = (lp_gauss(pd, 1.6) + lp_gauss(pd, 5.0) * 0.35) * twinkle * fade;
        if (en > energy) { energy = en; warm = h1; }
      }
      out_rgb = mix(color.rgb, vec3<f32>(1.0, 0.95, 0.6), warm * 0.4 + energy * 0.3);
      out_a = energy;
    } else if (brush == 15) { // sap-flow — travelling luminous droplets
      var energy = 0.0;
      for (var k = 0; k < 5; k = k + 1) {
        let head = fract(t * speed * 0.14 + f32(k) * 0.2 + seed * 0.05) * total_len;
        let rel = s - head;
        let drop = lp_gauss(length(vec2<f32>(max(rel, rel * 0.35), sd)), w * 0.6);
        let trail_g = select(0.0, exp(rel * 0.02) * 0.4, rel < 0.0 && rel > -80.0);
        energy = max(energy, drop + trail_g * lp_gauss(sd, w * 0.4));
      }
      let vein = lp_gauss(d, w * 0.28) * 0.35;
      out_rgb = mix(color.rgb, color2.rgb, 0.5 + 0.5 * sin(s * 0.01 + t));
      out_a = energy + vein;
    } else if (brush == 16) { // water — droplets raining off the stroke
      let dx = p.x - best_q.x;
      let dy = p.y - best_q.y;
      let spacing = max(9.0, w * 2.2);
      var energy = 0.0;
      for (var k = -1; k <= 1; k = k + 1) {
        let cell = floor((s + dx) / spacing) + f32(k);
        let h1 = lp_hash(cell + seed);
        let cycle = fract(t * speed * 0.5 + h1);
        let fall = cycle * cycle * (60.0 + h1 * 120.0);
        let pd = length(vec2<f32>(s + dx - (cell + 0.5) * spacing, dy - fall));
        let stretch = lp_gauss(pd, 1.4 + cycle * 1.2);
        energy = max(energy, stretch * (1.0 - cycle * 0.5));
      }
      let sheen = lp_gauss(d, w * 0.5) * 0.5;
      out_rgb = mix(color.rgb, vec3<f32>(0.85, 0.95, 1.0), 0.5);
      out_a = energy + sheen;
    } else if (brush == 17) { // sparkle — 4-point star glints
      let spacing = max(6.0, w * (1.4 + jitter * 1.6));
      var energy = 0.0;
      for (var k = -1; k <= 1; k = k + 1) {
        let cell = floor(s / spacing) + f32(k);
        let h1 = lp_hash(cell + seed); let h2 = lp_hash(cell * 2.3 + seed);
        let center = vec2<f32>((cell + 0.5 + (h1 - 0.5) * 0.6) * spacing, (h2 - 0.5) * w * 2.0);
        let rel = vec2<f32>(s, sd) - center;
        let tw = pow(0.5 + 0.5 * sin(t * (5.0 + h1 * 7.0) + h2 * 40.0), 4.0);
        let star = lp_gauss(abs(rel.x) + abs(rel.y), 1.8) + lp_gauss(length(rel), 4.5) * 0.3;
        energy = max(energy, star * tw * (0.5 + h1));
      }
      out_rgb = mix(color.rgb, vec3<f32>(1.0), energy * 0.6);
      out_a = energy;
    } else if (brush == 18) { // plasma — living energy blob
      let n = lp_fbm(vec2<f32>(s * 0.02, sd * 0.03) + vec2<f32>(t * speed * 0.5, seed));
      let env = w * (1.8 + glow);
      let body = clamp(1.0 - d / env, 0.0, 1.0);
      let iso = pow(0.5 + 0.5 * sin(n * 12.0 - t * speed * 3.0), 2.0);
      out_rgb = mix(color.rgb, color2.rgb, iso) + vec3<f32>(pow(body * iso, 3.0) * 0.6);
      out_a = body * (0.3 + iso * 0.8);
    } else if (brush == 19) { // galaxy — spiral-arm starfield
      let ang = atan2(sd, 12.0) + s * 0.01 - t * speed * 0.4;
      let arms = pow(0.5 + 0.5 * sin(ang * 3.0 + d * 0.08), 2.0);
      let stars = step(0.965, lp_hash2(floor(vec2<f32>(s * 0.45, sd * 0.45)))) *
        (0.5 + 0.5 * sin(t * 3.0 + s));
      let coreg = lp_gauss(d, w * 0.8);
      out_rgb = mix(color.rgb, color2.rgb, arms) + vec3<f32>(stars);
      out_a = coreg * 0.7 + arms * exp(-d / (w * 3.0)) * 0.7 + stars * exp(-d / (w * 4.0));
    } else if (brush == 20) { // lightning — branching bolt with strikes
      let strike = 0.35 + 0.65 * step(0.55, lp_hash(floor(t * speed * 3.0) + seed));
      let amp = w * (3.0 + jitter * 8.0);
      let off1 = (lp_fbm(vec2<f32>(s * 0.02 + seed, floor(t * speed * 8.0))) - 0.5) * amp;
      let off2 = off1 + (lp_noise(vec2<f32>(s * 0.09, floor(t * speed * 8.0) + 3.0)) - 0.5) * amp * 0.5;
      var energy = lp_gauss(abs(sd - off1), max(0.8, w * 0.14)) * 1.3;
      energy = max(energy, lp_gauss(abs(sd - off2), max(0.6, w * 0.09)));
      let branch_gate = step(0.9, lp_hash2(vec2<f32>(floor(s * 0.05), floor(t * speed * 8.0))));
      energy = max(energy, branch_gate * lp_gauss(abs(abs(sd) - amp * 0.5), w * 0.3) * 0.7);
      out_rgb = mix(color.rgb, vec3<f32>(0.9, 0.95, 1.0), clamp(energy, 0.0, 0.8));
      out_a = energy * strike + lp_gauss(d, w * 2.4) * 0.12 * strike;
    } else if (brush == 21) { // vortex — swirling pull
      let ang = atan2(sd, max(6.0, w * 0.5));
      let swirl = pow(0.5 + 0.5 * sin(ang * 4.0 + d * 0.12 - t * speed * 5.0 + s * 0.02), 3.0);
      let body = exp(-d / (w * 2.6));
      out_rgb = mix(color.rgb, color2.rgb, swirl);
      out_a = body * (0.25 + swirl * 0.9);
    } else if (brush == 22) { // nebula — deep space clouds + star dust
      let drift = t * speed * 0.12;
      let n = lp_fbm(vec2<f32>(s * 0.008 + drift, sd * 0.012) + vec2<f32>(seed));
      let n2 = lp_fbm(vec2<f32>(s * 0.02 - drift * 0.6, sd * 0.03) + vec2<f32>(9.0));
      let env = w * (3.2 + softness * 3.0);
      let cloud = clamp(1.0 - d / env, 0.0, 1.0) * (0.3 + n * 0.6 + n2 * 0.3);
      let dust = step(0.975, lp_hash2(floor(vec2<f32>(s * 0.6, sd * 0.6)))) * cloud;
      out_rgb = mix(color.rgb, color2.rgb, n) * (0.6 + n2 * 0.6) + vec3<f32>(dust);
      out_a = cloud * cloud * 1.1 + dust;
    } else if (brush == 23) { // kaleido — mirrored jewel bands
      let seg = floor(s / max(18.0, w * 2.0));
      let m = abs(sd);
      let band = pow(0.5 + 0.5 * sin(m * (6.28318 / max(w, 2.0)) - t * speed * 2.0), 4.0);
      let body = 1.0 - smoothstep(w * 1.1, w * 1.35, d);
      out_rgb = lp_hsv(fract(seg * 0.13 + t * speed * 0.05), 0.85, 1.0) * (0.4 + band);
      out_a = body * (0.3 + band * 0.8) + lp_gauss(d, w * 2.0) * 0.2;
    } else if (brush == 24) { // ink — sumi-e with rough bleed
      let rough = (lp_fbm(vec2<f32>(s * 0.05 + seed, sd * 0.08)) - 0.5) * w * 1.2;
      let env = w * (0.8 + best_pressure * 0.6) + rough;
      let body = 1.0 - smoothstep(env * 0.7, env, d);
      let tendril = step(0.88, lp_noise(vec2<f32>(s * 0.11, sd * 0.05))) *
        (1.0 - smoothstep(env, env * 2.2, d)) * 0.4;
      let gran = 0.85 + 0.15 * lp_noise(vec2<f32>(s * 0.3, sd * 0.3));
      out_rgb = color.rgb * gran;
      out_a = clamp(body + tendril, 0.0, 1.0) * 0.94;
      additive = false;
    } else if (brush == 25) { // crystal — faceted shards with glints
      let cell = floor(vec2<f32>((s + sd) * 0.06, (s - sd) * 0.06));
      let facet = lp_hash2(cell + vec2<f32>(seed));
      let body = 1.0 - smoothstep(w * 1.1, w * 1.35, d);
      let glint = pow(0.5 + 0.5 * sin(t * speed * 2.0 + facet * 40.0), 14.0);
      out_rgb = mix(color.rgb * (0.45 + facet * 0.7), color2.rgb, glint) + vec3<f32>(glint * 0.8);
      out_a = body * (0.5 + facet * 0.4) + glint * body;
      additive = false;
    } else if (brush == 26) { // aurora — layered curtains with rays
      var energy = 0.0;
      var hue_mix = 0.0;
      for (var k = 0; k < 3; k = k + 1) {
        let fk = f32(k);
        let wave = sin(s * 0.014 + t * speed * (0.7 + fk * 0.23) + fk * 2.1) * w * 1.6;
        let band = lp_gauss(sd - wave - (fk - 1.0) * w * 0.9, w * (0.5 + fk * 0.28));
        if (band > energy) { hue_mix = fk / 2.0; }
        energy = max(energy, band);
      }
      let rays = pow(0.5 + 0.5 * sin(s * 0.25 + t * speed), 3.0) *
        (0.5 + 0.5 * lp_noise(vec2<f32>(s * 0.03, t * 0.5)));
      out_rgb = mix(color.rgb, color2.rgb, hue_mix) * (0.7 + rays * 0.6);
      out_a = energy * (0.5 + rays * 0.5);
    } else if (brush == 27) { // bubbles — rising rings with specular pops
      let dx2 = p.x - best_q.x;
      let dy2 = p.y - best_q.y;
      let spacing = max(10.0, w * 2.6);
      var energy = 0.0;
      var spec = 0.0;
      for (var k = -1; k <= 1; k = k + 1) {
        let cell = floor((s + dx2) / spacing) + f32(k);
        let h1 = lp_hash(cell + seed);
        let cycle = fract(t * speed * 0.3 + h1);
        let rise_y = -cycle * (50.0 + h1 * 100.0);
        let br = 2.0 + h1 * w * 0.55;
        let rel = vec2<f32>(s + dx2 - (cell + 0.5) * spacing, dy2 - rise_y);
        let ring = lp_gauss(abs(length(rel) - br), 1.1) * (1.0 - cycle * 0.55);
        energy = max(energy, ring);
        spec = max(spec, lp_gauss(length(rel - vec2<f32>(br * 0.4, -br * 0.4)), 1.0) * (1.0 - cycle * 0.55));
      }
      out_rgb = mix(color.rgb, vec3<f32>(1.0), spec);
      out_a = energy * 0.8 + spec + lp_gauss(d, w * 0.5) * 0.18;
    } else if (brush == 28) { // orbit — particle clusters circling the stroke with comet trails
      let spacing = max(12.0, w * 2.2);
      var energy = 0.0;
      var hot = 0.0;
      var tint = 0.0;
      for (var k = -1; k <= 1; k = k + 1) {
        let cell = floor(s / spacing) + f32(k);
        let h1 = lp_hash(cell + seed);
        let h2 = lp_hash(cell * 3.7 + seed + 11.0);
        let cx = (cell + 0.5 + (h1 - 0.5) * 0.5) * spacing;
        let radius = w * (1.1 + h2 * 1.5);
        let dir = select(-1.0, 1.0, h1 > 0.5);
        let theta = t * speed * (1.6 + h1 * 1.4) * dir + h1 * 6.28318;
        let head_r = max(1.6, w * 0.24) * (0.8 + h2 * 0.4);
        // Head + trail samples spaced back along the orbit form the
        // crescent streak the old compute-particle trail buffer gave us.
        for (var j = 0; j < 6; j = j + 1) {
          let phi = theta - f32(j) * 0.24 * dir;
          let pos = vec2<f32>(cx + cos(phi) * radius * 0.55, sin(phi) * radius);
          let depth = 0.55 + 0.45 * sin(phi + 1.1);
          let fall = 1.0 - f32(j) / 6.0;
          let pd = length(vec2<f32>(s, sd) - pos);
          let en = lp_gauss(pd, head_r * (1.0 - f32(j) * 0.09)) * fall * fall * depth;
          if (j == 0 && en > hot) { hot = en; }
          if (en > energy) { energy = en; tint = f32(j) / 6.0 + h2 * 0.2; }
        }
      }
      out_rgb = mix(mix(vec3<f32>(1.0), color.rgb, clamp(tint * 1.6, 0.0, 1.0)), color2.rgb, clamp(tint - 0.4, 0.0, 0.6));
      out_a = energy + hot * 0.8 + lp_gauss(d, w * 0.35) * 0.1;
    } else { // helix — candy-cane wrap of streaking particles (old spiral)
      let spacing = max(4.5, w * 0.65);
      var energy = 0.0;
      var hot = 0.0;
      for (var k = -1; k <= 1; k = k + 1) {
        let cell = floor(s / spacing) + f32(k);
        let h1 = lp_hash(cell + seed);
        let cx = (cell + 0.5) * spacing;
        let radius = w * (1.35 + h1 * 0.3);
        // Progressive phase along the stroke winds the wrap like a helix;
        // trail samples smear each particle into a perpendicular streak.
        let theta = t * speed * 4.2 + cell * 0.85 + h1 * 0.6;
        let pr = max(1.3, w * 0.17);
        for (var j = 0; j < 7; j = j + 1) {
          let phi = theta - f32(j) * 0.16;
          let depth = 0.5 + 0.5 * cos(phi);
          let pos = vec2<f32>(cx + (h1 - 0.5) * spacing * 0.4, sin(phi) * radius);
          let fall = 1.0 - f32(j) / 7.0;
          let pd = length(vec2<f32>(s, sd) - pos);
          let en = lp_gauss(pd, pr * (1.1 - f32(j) * 0.08)) * fall * (0.2 + 0.8 * depth);
          if (j == 0) { hot = max(hot, en * depth); }
          energy = max(energy, en);
        }
      }
      let band = 0.5 + 0.5 * sin(s * 0.05 + t * speed);
      out_rgb = mix(color.rgb, color2.rgb, band * 0.5) + vec3<f32>(hot * 0.9);
      out_a = energy + hot * 0.6;
    }

    // Sparkle overlay — white glints scattered across the visible stroke.
    if (paint.fx2.z > 0.001 && d < w * 3.0) {
      let sp_uv = vec2<f32>(s, sd) / max(5.0, w * 0.7);
      let sp_h = lp_hash2(floor(sp_uv) + vec2<f32>(floor(t * 8.0) * 13.7, seed));
      if (sp_h > 1.0 - paint.fx2.z * 0.1) {
        let glint = lp_gauss(length((fract(sp_uv) - 0.5) * max(5.0, w * 0.7)), 1.6);
        out_rgb = mix(out_rgb, vec3<f32>(1.0), clamp(glint, 0.0, 0.85));
        out_a = out_a + glint * 0.9;
      }
    }
    // Hue shift cycles color over time; multi-color glow de-correlates
    // each stroke's hue so a composition reads as a rainbow of lights.
    let hue_turn = hue_shift_base + select(0.0, fract(seed * 0.618), paint.fx2.w > 0.5);
    if (hue_turn > 0.001) { out_rgb = lp_hue_rotate(out_rgb, hue_turn); }

    // Soft containment: energy fades to zero before the culling reach so
    // skipped chunks and the bbox boundary can never produce hard edges.
    let reach_fade = 1.0 - smoothstep(reach * 0.6, reach * 0.95, d);
    out_a = clamp(out_a, 0.0, 1.0) * vis * e4.x * global_mult * echo_fade * reach_fade;
    if (paint.fx4.w > 0.001) { out_a = out_a * (1.0 - paint.fx4.w * 0.3); }
    if (bloom > 0.001) {
      out_a = clamp(out_a + bloom * 0.4 * lp_gauss(d, w * 5.0) * vis * e4.x * global_mult * echo_fade * reach_fade, 0.0, 1.0);
    }
    if (out_a <= 0.0015) { continue; }
    if (additive) {
      col = col + out_rgb * out_a;
    } else {
      col = mix(col, out_rgb, out_a);
    }
    acc = acc + out_a * (1.0 - acc);
    }
  }

  return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), clamp(acc, 0.0, 1.0));
}
`;
