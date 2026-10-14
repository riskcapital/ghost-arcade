// Edge Effects on the full evaluator (edgeEffectShader.ts): the pass the
// compositor uses for stacks the drawing renderer cannot draw, which is any
// stack with an edge-only type, a beat reaction, a group chase, a custom
// centre or rounded corners. Looks are such stacks.
//
// The stack is packed exactly as the 2.0 render core receives it
// (nativeEdgeEffectPayload) into a one-row float texture, and drawn over the
// layer at composition resolution in a single full-screen pass.

import * as THREE from 'three';
import type { EdgeEffectsConfig, Layer } from '../types';
import { edgeTypeDef } from '../drawing/edgeEffectCatalog';
import {
  buildEdgeEffectContext,
  nativeEdgeEffectPayload,
  renderedEdgeEffects,
  type EdgeEffectContext,
} from '../drawing/edgeEffects';
import {
  EDGE_CHUNK_OFFSET,
  EDGE_CORNER_OFFSET,
  EDGE_DATA_WIDTH,
  EDGE_DIAG_OFFSET,
  EDGE_EFFECT_FRAGMENT,
  EDGE_EFFECT_VERTEX,
  EDGE_FX_OFFSET,
  EDGE_POINT_OFFSET,
} from '../drawing/edgeEffectShader';
import { launchClockPosition } from '../stores/launchClock';
import { getVisualAudioSnapshot } from '../audio/visualAudio';

const CHUNK = 16;
const MAX_CHUNKS = 32;
const MAX_POINTS = 512;
const MAX_CORNERS = 64;
const MAX_DIAGONALS = 64;
const FX_VEC4S = 22;

/** True when the stack needs this pass rather than the drawing renderer. */
export function needsEdgeEngine(config: EdgeEffectsConfig | null | undefined): boolean {
  const effects = renderedEdgeEffects(config);
  if (!effects.length) return false;
  if ((config?.cornerRadius ?? 0) > 0) return true;
  return effects.some((effect) => {
    const e = effect as any;
    if (e.react && e.react.mode !== 'none') return true;
    if (e.chaseMode && e.chaseMode !== 'none') return true;
    if (e.customCenter) return true;
    for (const kind of ['stroke', 'fill', 'animation'] as const) {
      const type = String(e[kind]?.type ?? 'none');
      const def = edgeTypeDef(kind, type);
      if (def && !def.webgl) return true;
    }
    return false;
  });
}

type ContextLayer = Parameters<typeof buildEdgeEffectContext>[0][number];

export class EdgeEffectPass {
  private readonly data = new Float32Array(EDGE_DATA_WIDTH * 4);
  private readonly dataTexture: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly startTime = performance.now() / 1000;
  private context: EdgeEffectContext | null = null;
  private contextLayers: readonly ContextLayer[] | null = null;
  /** Set when this GPU cannot run the shader: the caller then keeps the
   *  drawing renderer, so a failed program never blanks the frame. */
  private unsupported = false;

  constructor() {
    this.dataTexture = new THREE.DataTexture(this.data, EDGE_DATA_WIDTH, 1, THREE.RGBAFormat, THREE.FloatType);
    this.dataTexture.minFilter = THREE.NearestFilter;
    this.dataTexture.magFilter = THREE.NearestFilter;
    this.dataTexture.generateMipmaps = false;
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: EDGE_EFFECT_VERTEX,
      fragmentShader: EDGE_EFFECT_FRAGMENT,
      uniforms: {
        uSource: { value: null },
        uEdgeData: { value: this.dataTexture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uClock: { value: new THREE.Vector4(0, 120, 0, 0) },
        uAudio0: { value: new THREE.Vector4() },
        uAudio1: { value: new THREE.Vector4() },
        uAudio2: { value: new THREE.Vector4() },
        uEdgeInfo: { value: new THREE.Vector4() },
        uEdgeGeom: { value: new THREE.Vector4() },
        uEdgeExtra: { value: new THREE.Vector4() },
        uEdgeBox: { value: new THREE.Vector4() },
      },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** The layers of the frame being drawn: group chases and group swipes
   *  read every edge layer's place among its group. */
  beginFrame(layers: readonly ContextLayer[]): void {
    if (layers !== this.contextLayers) {
      this.contextLayers = layers;
      this.context = null;
    }
  }

  /**
   * Draw `layer`'s edge stack over `source` into `target`. Returns false
   * when the layer has no drawable outline (the caller keeps `source`).
   */
  render(renderer: THREE.WebGLRenderer, source: THREE.Texture, target: THREE.WebGLRenderTarget, layer: Layer): boolean {
    if (this.unsupported || !this.programRuns(renderer)) return false;
    const width = target.width;
    const height = target.height;
    if (!this.context || this.context.width !== width || this.context.height !== height) {
      this.context = buildEdgeEffectContext(this.contextLayers ?? [layer as ContextLayer], width, height);
    }
    const payload = nativeEdgeEffectPayload(layer as ContextLayer, width, height, this.context);
    if (!payload || payload.outline.length < 3) return false;

    const data = this.data;
    data.fill(0);
    const put = (slot: number, v: readonly number[]) => {
      const o = slot * 4;
      data[o] = v[0] ?? 0; data[o + 1] = v[1] ?? 0; data[o + 2] = v[2] ?? 0; data[o + 3] = v[3] ?? 0;
    };
    const effects = payload.effects.slice(0, 16);
    effects.forEach((fx, e) => fx.slice(0, FX_VEC4S).forEach((v, k) => put(EDGE_FX_OFFSET + e * FX_VEC4S + k, v)));
    const points = payload.outline.slice(0, MAX_POINTS);
    points.forEach((p, i) => put(EDGE_POINT_OFFSET + i, p));
    // Bounds of each run of 16 segments (segment i joins point i to i + 1).
    for (let c = 0; c < MAX_CHUNKS && c * CHUNK < points.length; c++) {
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = c * CHUNK; i < Math.min((c + 1) * CHUNK, points.length); i++) {
        for (const p of [points[i], points[(i + 1) % points.length]]) {
          box[0] = Math.min(box[0], p[0]); box[1] = Math.min(box[1], p[1]);
          box[2] = Math.max(box[2], p[0]); box[3] = Math.max(box[3], p[1]);
        }
      }
      put(EDGE_CHUNK_OFFSET + c, box);
    }
    const corners = payload.corners.slice(0, MAX_CORNERS);
    corners.forEach((corner, i) => put(EDGE_CORNER_OFFSET + i, corner));
    const diagonals = payload.diagonals
      .filter(([a, b]) => a >= 0 && b >= 0 && a < corners.length && b < corners.length)
      .slice(0, MAX_DIAGONALS);
    diagonals.forEach(([a, b], i) => {
      const o = (EDGE_DIAG_OFFSET + (i >> 1)) * 4 + (i % 2) * 2;
      data[o] = a; data[o + 1] = b;
    });
    this.dataTexture.needsUpdate = true;

    const bbox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of points) {
      bbox[0] = Math.min(bbox[0], p[0]); bbox[1] = Math.min(bbox[1], p[1]);
      bbox[2] = Math.max(bbox[2], p[0]); bbox[3] = Math.max(bbox[3], p[1]);
    }

    const u = this.material.uniforms;
    u.uSource.value = source;
    u.uResolution.value.set(width, height);
    u.uTime.value = performance.now() / 1000 - this.startTime;
    const clock = launchClockPosition();
    u.uClock.value.set(clock.beat, clock.beatMs > 0 ? 60000 / clock.beatMs : 120, 0, 0);
    const audio = getVisualAudioSnapshot();
    u.uAudio0.value.set(audio.level, audio.bass, audio.mid, audio.treble);
    u.uAudio1.value.set(audio.high, audio.beat, audio.beatPhase, audio.bpm);
    u.uAudio2.value.set(audio.centroid, audio.kick, audio.snare, audio.isActive ? 1 : 0);
    u.uEdgeInfo.value.set(points.length, effects.length, corners.length, diagonals.length);
    u.uEdgeGeom.value.fromArray(payload.geometry);
    u.uEdgeExtra.value.set(payload.seed, 0, 0, 0);
    u.uEdgeBox.value.fromArray(bbox);

    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    return true;
  }

  /** Compile once and keep the answer: false when the program failed. */
  private programChecked = false;
  private programRuns(renderer: THREE.WebGLRenderer): boolean {
    if (this.programChecked) return !this.unsupported;
    this.programChecked = true;
    try {
      renderer.compile(this.scene, this.camera);
      const program = (renderer.properties.get(this.material) as { currentProgram?: { diagnostics?: { runnable: boolean } } }).currentProgram;
      if (program?.diagnostics && !program.diagnostics.runnable) this.unsupported = true;
    } catch {
      this.unsupported = true;
    }
    if (this.unsupported) console.warn('[EdgeEffects] This GPU cannot run the edge effect shader; edge-only types and Looks will not draw.');
    return !this.unsupported;
  }

  dispose(): void {
    this.dataTexture.dispose();
    this.material.dispose();
    this.scene.traverse((obj) => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); });
  }
}
