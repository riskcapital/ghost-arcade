// Stage 3D viewer renderer.
//
// HYBRID architecture (post-STAGEFORGE pivot):
//   • Venue scenery: one of four presets (festival / arena / club /
//     nightclub) builds the static room + floor + atmospherics.
//   • LED screens: auto-built from project.layers (type === 'screen').
//     Each screen's bounding box on the 2D canvas maps onto the venue's
//     LED Wall region in world space. Flat planes (no frame depth).
//   • User-placed elements: trusses, lights, PA, decks live in the
//     stage3dScene store and render through buildUserElement().
//
// Selection is keyed in selectedStage3DNodeId as `screen:<layerId>` or
// `element:<elementId>` (parseSelection unifies the two).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { get } from 'svelte/store';
import { stage3dScene, selectedStage3DNodeId, selectedStage3DTargets, stage3DGizmoMode, parseSelection, stage3DRendererControls, stage3DSceneryList, sceneryLabel, stage3DCameraFov } from './store';
import { buildVenue, type VenueBuild } from './venues';
import { AtmosphereRig, type UserStripAnim } from './atmosphere';
import { DEFAULT_ATMOSPHERE } from './types';
import { getVisualAudioSnapshot } from '../audio/visualAudio';
import { buildUserElement } from './elementTypes';
import { resolveStageEffectForLayer, stageEffectsRuntime } from '../stores/stageEffects';
import type { Stage3DScene, Stage3DScreenOverride, Stage3DVenue, UserStageElement } from './types';
import { DEFAULT_LIGHTING } from './types';
import type { OutputSlice } from '../stores/settings';
import type { BezierPoint, Layer } from '../types';

interface LedEntry {
  layer: Layer;
  group: THREE.Group;
  surface: THREE.Mesh;
  material: THREE.ShaderMaterial;
  defaultPosition: [number, number, number];
  defaultWidth: number;
  defaultHeight: number;
  /** Set when this screen is a spherical sector on the venue's ledDome
   *  (sphere venue). Carries the angular rect (canvas-fraction space)
   *  so the geometry can be rebuilt when the user changes domeMapping,
   *  plus the glow light's local placement (relative to the dome
   *  centre, which is the group position). */
  dome?: {
    u0: number; u1: number;        // canvas-x fraction → azimuth range
    yTop: number; yBottom: number; // canvas-y fraction (Y-down) → elevation range
    mapping: 'wrap' | 'domemaster' | 'equirect';
    lightOffset: [number, number, number];
    lightTarget: [number, number, number];
  };
  /** Reactive room light coloured from the LED's average pixel — drives
   *  the "the room glows in sync with the visuals" effect. RectAreaLight
   *  sized to the panel so the spill reads as an LED-wall wash, not a
   *  spotlight pool. */
  ambientLight: THREE.RectAreaLight;
  /** 1×1 render target used to compute the LED's average colour each
   *  frame. Read back ASYNC (PBO + fence via readRenderTargetPixelsAsync)
   *  into `averagePixels` — the colour lands a frame or two later, which
   *  is invisible on a room-glow light but removes the GPU sync stall
   *  the old synchronous readback paid right after the downsample pass. */
  averageRT: THREE.WebGLRenderTarget;
  averagePixels: Uint8Array;
  stageFxBrightness: number;
  stageFxTint: THREE.Color;
  /** True while an async readback is in flight for this LED — prevents
   *  stacking requests if the GPU falls behind. */
  readbackPending?: boolean;
}

interface ElementEntry {
  element: UserStageElement;
  group: THREE.Group;
  signature: string;
}

// RectAreaLight needs its LTC lookup textures registered once per app
// before any material renders alongside an area light.
let rectAreaUniformsReady = false;
function ensureRectAreaLightUniforms(): void {
  if (rectAreaUniformsReady) return;
  RectAreaLightUniformsLib.init();
  rectAreaUniformsReady = true;
}

// ── Shaders ────────────────────────────────────────────────────────────

const LED_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const LED_FRAGMENT = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uTexture;
  uniform float uBrightness;
  uniform vec3 uStageTint;
  uniform float uHasTexture;
  uniform float uTime;
  uniform float uScreenAspect;
  uniform float uSourceAspect;
  uniform int   uDisplayFit;
  uniform int   uEdgeEffect;
  uniform vec2  uPanelSize;
  uniform vec3  uBezelColor;
  // Unified-group support: when on, this screen samples a SHARED group
  // shader texture using a crop window. Each screen in the group shows
  // its own slice of the full canvas, so all screens together read like
  // one continuous shader. uCropRegion is pre-converted to texture UV
  // space on the CPU (offsetY = 1 - maxCornerY, same math as the 2D
  // engine), so the shader applies it directly.
  uniform float uUnifiedCrop;
  uniform vec4  uCropRegion;   // (offsetX, offsetY, scaleX, scaleY) in texture UV space

  vec3 fallbackPattern(vec2 uv) {
    vec2 p = (uv - 0.5) * vec2(2.1, 1.25);
    float t = uTime;
    vec3 col = vec3(0.012, 0.008, 0.035);
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float z = fract(t * 0.18 + fi * 0.17);
      vec2 q = p / (0.28 + z * 1.9);
      q.y += t * (0.28 + fi * 0.035);
      q.x += sin(t * 0.55 + fi) * 0.08;
      vec2 cell = abs(fract(q * vec2(7.0, 4.0)) - 0.5);
      float grid = exp(-min(cell.x, cell.y) * 52.0);
      float edge = exp(-abs(length(p) - (0.2 + z * 1.35)) * 8.0);
      float depth = pow(1.0 - z, 1.35);
      vec3 neon = 0.5 + 0.5 * cos(vec3(0.0, 2.15, 4.25) + t * 0.9 + fi * 0.8);
      col += neon * (grid + edge * 0.35) * depth * 0.28;
    }
    float vignette = 1.0 - smoothstep(0.15, 1.3, length(p));
    float scan = 0.82 + 0.18 * sin((uv.y + t * 0.72) * 150.0);
    float pulse = 0.78 + 0.22 * sin(t * 2.4);
    return col * scan * pulse * vignette * 2.2;
  }

  vec3 applyDisplayFit(vec2 uv, out float panelMask) {
    panelMask = 1.0;
    if (uDisplayFit == 0) return vec3(uv, 1.0);
    float ratio = uSourceAspect / uScreenAspect;
    vec2 fitUv = uv;
    if (uDisplayFit == 1) {
      if (ratio > 1.0) {
        float scale = 1.0 / ratio;
        fitUv.y = (uv.y - (1.0 - scale) * 0.5) / scale;
        panelMask = step(0.0, uv.y - (1.0 - scale) * 0.5)
                  * step(uv.y, (1.0 + scale) * 0.5);
      } else {
        float scale = ratio;
        fitUv.x = (uv.x - (1.0 - scale) * 0.5) / scale;
        panelMask = step(0.0, uv.x - (1.0 - scale) * 0.5)
                  * step(uv.x, (1.0 + scale) * 0.5);
      }
    } else {
      if (ratio > 1.0) {
        float scale = 1.0 / ratio;
        fitUv.x = scale * (uv.x - 0.5) + 0.5;
      } else {
        float scale = ratio;
        fitUv.y = scale * (uv.y - 0.5) + 0.5;
      }
    }
    return vec3(fitUv, panelMask);
  }

  vec3 applyEdgeEffect(vec3 baseColor, vec2 uv) {
    if (uEdgeEffect == 0) return baseColor;
    if (uEdgeEffect == 1) {
      vec2 d = min(uv, 1.0 - uv);
      float edge = 1.0 - smoothstep(0.0, 0.06, min(d.x, d.y));
      return baseColor + uBezelColor * edge * 1.4;
    }
    if (uEdgeEffect == 2) {
      vec2 d = min(uv, 1.0 - uv);
      return baseColor * smoothstep(0.0, 0.12, min(d.x, d.y));
    }
    if (uEdgeEffect == 3) {
      return baseColor * (0.85 + 0.15 * sin(uv.y * 220.0));
    }
    if (uEdgeEffect == 4) {
      vec2 cells = vec2(uPanelSize.x * 60.0, uPanelSize.y * 60.0);
      vec2 cellUv = fract(uv * cells);
      vec2 d = min(cellUv, 1.0 - cellUv);
      return baseColor * mix(0.35, 1.0, smoothstep(0.0, 0.08, min(d.x, d.y)));
    }
    return baseColor;
  }

  // Composite textures from the engine are stored display-encoded (sRGB
  // colour values held in a linear-format render target — that's how
  // the editor's main canvas avoids double-gamma). Stage3D runs an
  // EffectComposer chain that ends with OutputPass, which applies a
  // linear→sRGB conversion on the way to the screen. If we output the
  // sRGB-encoded sample directly, OutputPass treats it as linear and
  // applies a second gamma → midtones blow out (the "washed-out
  // screen" the user kept seeing). So we convert sRGB→linear in the
  // shader, then OutputPass converts back to sRGB exactly, round-trip.
  vec3 sRGBToLinear(vec3 c) {
    bvec3 cutoff = lessThan(c, vec3(0.04045));
    vec3 higher = pow((c + 0.055) / 1.055, vec3(2.4));
    vec3 lower  = c / 12.92;
    return mix(higher, lower, vec3(cutoff));
  }

  void main() {
    if (uHasTexture < 0.5) {
      vec3 col = fallbackPattern(vUv);
      col = applyEdgeEffect(col, vUv);
      gl_FragColor = vec4(sRGBToLinear(col) * uStageTint * uBrightness, 1.0);
      return;
    }
    // Unified-group fast path: bypass display-fit, sample the shared
    // group texture using this screen's crop window. The region arrives
    // already in texture-UV space (CPU converts from canvas-Y-down
    // corners), so it applies directly to vUv.
    if (uUnifiedCrop > 0.5) {
      vec2 srcUv = uCropRegion.xy + uCropRegion.zw * vUv;
      vec3 sampled = sRGBToLinear(texture2D(uTexture, srcUv).rgb);
      vec3 lit = sampled * uStageTint * uBrightness;
      lit = applyEdgeEffect(lit, vUv);
      gl_FragColor = vec4(lit, 1.0);
      return;
    }
    float panelMask;
    vec3 fit = applyDisplayFit(vUv, panelMask);
    vec2 srcUv = fit.xy;
    vec3 sampled = sRGBToLinear(texture2D(uTexture, srcUv).rgb);
    vec3 lit = sampled * uStageTint * uBrightness * panelMask;
    lit = applyEdgeEffect(lit, vUv);
    gl_FragColor = vec4(lit, 1.0);
  }
`;

// ── Helpers ────────────────────────────────────────────────────────────

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child: any) => {
    if (child.geometry) child.geometry.dispose?.();
    const mat = child.material;
    if (Array.isArray(mat)) {
      for (const m of mat) m.dispose?.();
    } else {
      mat?.dispose?.();
    }
  });
}

/** Build a Three.Shape from a screen layer's polygon (set by Apply
 *  Stage in the 2D Stage Designer). Returns null when the layer has
 *  no polygon — caller falls back to a rectangle. */
function buildShapeFromLayer(layer: Layer, width: number, height: number): THREE.Shape | null {
  const points = (layer as any).layerShape?.params?.customPoints as BezierPoint[] | undefined;
  if (!Array.isArray(points) || points.length < 3) return null;
  const shape = new THREE.Shape();
  const px = (p: BezierPoint) => ({
    x: (p.x - 0.5) * width,
    y: (p.y - 0.5) * height,
  });
  const p0 = px(points[0]);
  shape.moveTo(p0.x, p0.y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const pp = px(prev);
    const pc = px(curr);
    if (curr.cpIn || prev.cpOut) {
      const cp1 = prev.cpOut
        ? { x: (prev.cpOut.x - 0.5) * width, y: (prev.cpOut.y - 0.5) * height }
        : pp;
      const cp2 = curr.cpIn
        ? { x: (curr.cpIn.x - 0.5) * width, y: (curr.cpIn.y - 0.5) * height }
        : pc;
      shape.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, pc.x, pc.y);
    } else {
      shape.lineTo(pc.x, pc.y);
    }
  }
  shape.closePath();
  return shape;
}

function screenLayerPlacement(layer: Layer, wall: VenueBuild['ledWall']):
  { position: [number, number, number]; width: number; height: number } | null {
  const corners = (layer as any).corners as
    | { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomLeft: { x: number; y: number }; bottomRight: { x: number; y: number } }
    | undefined;
  if (!corners) return null;
  const xs = [corners.topLeft.x, corners.topRight.x, corners.bottomLeft.x, corners.bottomRight.x];
  const ys = [corners.topLeft.y, corners.topRight.y, corners.bottomLeft.y, corners.bottomRight.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const w = Math.max(0.1, maxX - minX) * wall.width;
  const h = Math.max(0.1, maxY - minY) * wall.height;
  return {
    position: [
      wall.centerX + (cx - 0.5) * wall.width,
      // Corner space is canvas Y-DOWN (y=0 top); wall space is Y-up.
      // A screen at the top of the 2D canvas belongs at the top of the
      // LED wall. (Was `cy - 0.5`, which matched the old Y-flipped
      // Apply-Stage corners — both sides now use the canvas convention.)
      wall.centerY + (0.5 - cy) * wall.height,
      wall.centerZ + 0.1,
    ],
    width: w,
    height: h,
  };
}

// ── Dome screens (sphere venue) ────────────────────────────────────────

type LedDome = NonNullable<VenueBuild['ledDome']>;
type DomeMapping = 'wrap' | 'domemaster' | 'equirect';

/** Unit direction for a dome surface point. Azimuth 0 faces the stage
 *  (-Z), positive azimuth toward +X; elevation 0 = horizon through the
 *  dome centre, 90 = zenith. Y-up world. */
function domeDirection(azDeg: number, elDeg: number): [number, number, number] {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  const ce = Math.cos(el);
  return [ce * Math.sin(az), Math.sin(el), -ce * Math.cos(az)];
}

/**
 * TRUE spherical-sector geometry for a dome screen — a lat/long grid on
 * the sphere's interior, NOT a bent plane. Vertices are relative to the
 * dome centre (the mesh's group sits at the centre).
 *
 * The screen's 2D canvas rect (u0..u1 across, yTop..yBottom down,
 * canvas Y-DOWN convention) maps onto the dome's angular extents: a
 * full-canvas screen covers the whole sweep, smaller screens tile it.
 *
 * UVs depend on the content mapping:
 *  `wrap`       — plain (u,v) across the sector: the screen's own
 *                 source rectangle spreads over its patch of dome
 *                 (equirect-style; flat content, Sphere-style look).
 *  `domemaster` — per-vertex inverse 180° angular fisheye: the source
 *                 is a circular domemaster frame (what the editor's
 *                 Dome Projection output produces in fisheye modes);
 *                 each vertex samples where its 3D direction lands in
 *                 that circle (zenith = centre, horizon = rim).
 *  `equirect`   — source is a 360×180 equirect panorama; u from
 *                 azimuth, v from elevation.
 */
function buildDomeSectorGeometry(
  dome: LedDome,
  u0: number, u1: number,
  yTop: number, yBottom: number,
  mapping: DomeMapping,
): THREE.BufferGeometry {
  const az = (u: number) => (u - 0.5) * dome.hSweepDeg;
  const el = (y: number) => dome.vEndDeg + y * (dome.vStartDeg - dome.vEndDeg);
  const az0 = az(u0), az1 = az(u1);
  const elBottom = el(yBottom), elTop = el(yTop);

  // Segment density follows angular coverage so a small tile doesn't
  // pay full-dome tessellation (and a full dome stays smooth).
  const wSegs = Math.max(8, Math.round(((az1 - az0) / dome.hSweepDeg) * 128));
  const hSegs = Math.max(8, Math.round(((elTop - elBottom) / Math.max(1, dome.vEndDeg - dome.vStartDeg)) * 64));

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iy = 0; iy <= hSegs; iy++) {
    const v = iy / hSegs;                       // 0 = bottom edge, 1 = top edge (GL convention)
    const elev = elBottom + v * (elTop - elBottom);
    for (let ix = 0; ix <= wSegs; ix++) {
      const u = ix / wSegs;
      const azim = az0 + u * (az1 - az0);
      const d = domeDirection(azim, elev);
      positions.push(d[0] * dome.radius, d[1] * dome.radius, d[2] * dome.radius);

      if (mapping === 'domemaster') {
        // Angle from zenith → fisheye radius (180° FOV: horizon at the
        // rim); azimuth → angle around the circle. Below-horizon points
        // clamp to the rim. Matches the angular mode of the editor's
        // dome-projection output shader (renderer/shaders/dome.ts).
        const psi = Math.acos(Math.min(1, Math.max(-1, d[1])));
        const rr = Math.min(1, psi / (Math.PI / 2));
        const phi = Math.atan2(d[0], -d[2]);
        uvs.push(0.5 + 0.5 * rr * Math.sin(phi), 0.5 + 0.5 * rr * Math.cos(phi));
      } else if (mapping === 'equirect') {
        const phi = Math.atan2(d[0], -d[2]);
        const elevRad = Math.asin(Math.min(1, Math.max(-1, d[1])));
        uvs.push(0.5 + phi / (2 * Math.PI), 0.5 + elevRad / Math.PI);
      } else {
        uvs.push(u, v);
      }
    }
  }
  const stride = wSegs + 1;
  for (let iy = 0; iy < hSegs; iy++) {
    for (let ix = 0; ix < wSegs; ix++) {
      const a = iy * stride + ix;
      indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Map a screen layer's 2D canvas corner box onto the venue dome.
 *  Returns the angular rect plus chord sizes (for aspect / glow). */
function domeScreenPlacement(layer: Layer, dome: LedDome):
  { u0: number; u1: number; yTop: number; yBottom: number; chordW: number; chordH: number } | null {
  const corners = (layer as any).corners as
    | { topLeft: { x: number; y: number }; topRight: { x: number; y: number }; bottomLeft: { x: number; y: number }; bottomRight: { x: number; y: number } }
    | undefined;
  if (!corners) return null;
  const xs = [corners.topLeft.x, corners.topRight.x, corners.bottomLeft.x, corners.bottomRight.x];
  const ys = [corners.topLeft.y, corners.topRight.y, corners.bottomLeft.y, corners.bottomRight.y];
  const u0 = Math.max(0, Math.min(...xs));
  const u1 = Math.min(1, Math.max(...xs));
  const yTop = Math.max(0, Math.min(...ys));
  const yBottom = Math.min(1, Math.max(...ys));
  if (u1 - u0 < 0.005 || yBottom - yTop < 0.005) return null;

  const vRange = dome.vEndDeg - dome.vStartDeg;
  const elMid = dome.vEndDeg - ((yTop + yBottom) / 2) * vRange;
  const azArc = (u1 - u0) * dome.hSweepDeg;
  const chordW = dome.radius * THREE.MathUtils.degToRad(azArc) * Math.cos(THREE.MathUtils.degToRad(elMid));
  const chordH = dome.radius * THREE.MathUtils.degToRad((yBottom - yTop) * vRange);
  return { u0, u1, yTop, yBottom, chordW, chordH };
}

function textureForLayer(layer: Layer | undefined, masterTexture: THREE.Texture | null): THREE.Texture | null {
  if (!layer) return masterTexture;
  // Direct texture on the layer's source (set by VJ injection in
  // Canvas.svelte when the user binds a screen to a VJ layer index).
  const direct = (layer.source?.texture as THREE.Texture | null | undefined)
    ?? (layer as any)._linesTexture
    ?? (layer as any)._svgTexture
    ?? (layer as any)._lightPaintingTexture
    ?? (layer as any)._textTexture
    ?? (layer as any)._splatTexture
    ?? (layer as any)._model3dTexture
    ?? (layer as any)._gpuLayerTexture
    ?? null;
  // Fall back to the master composite — what the 2D canvas is showing —
  // so screens are never blank just because the layer has no VJ
  // binding. The user can override per-screen later via Source picker.
  return direct ?? masterTexture;
}

function ledMaterialUniforms(): Record<string, THREE.IUniform> {
  return {
    uTexture:      { value: null },
    uBrightness:   { value: 1 },
    uStageTint:    { value: new THREE.Color(1, 1, 1) },
    uHasTexture:   { value: 0 },
    uTime:         { value: 0 },
    uScreenAspect: { value: 1 },
    uSourceAspect: { value: 16 / 9 },
    uDisplayFit:   { value: 0 },
    uEdgeEffect:   { value: 0 },
    uBezelColor:   { value: new THREE.Color('#BB86FC') },
    uPanelSize:    { value: new THREE.Vector2(1, 1) },
    uUnifiedCrop:  { value: 0 },
    uCropRegion:   { value: new THREE.Vector4(0, 0, 1, 1) },
  };
}

const FIT_INDEX: Record<NonNullable<Stage3DScreenOverride['displayFit']>, number> = {
  stretch: 0, contain: 1, cover: 2,
};
const EDGE_INDEX: Record<NonNullable<Stage3DScreenOverride['edgeEffect']>, number> = {
  'none': 0, 'bezel-glow': 1, 'soft-border': 2, 'scanlines': 3, 'pixel-grid': 4,
};

/** Signature of an element's identity for rebuild detection. When this
 *  changes, the element's THREE.Group is rebuilt from scratch. */
function elementSignature(el: UserStageElement): string {
  return `${el.type}|${JSON.stringify(el.params)}`;
}

// ── Renderer ───────────────────────────────────────────────────────────

export class Stage3DRenderer {
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000);
  private controls: OrbitControls;
  private transformControls: TransformControls;
  private raycaster = new THREE.Raycaster();
  private pointerNDC = new THREE.Vector2();
  private ledEntries: LedEntry[] = [];
  private ledByLayerId = new Map<string, LedEntry>();
  private elementEntries = new Map<string, ElementEntry>();
  private currentLedSignature = '';
  private currentVenue: Stage3DVenue | null = null;
  private venueBuild: VenueBuild | null = null;
  private venueLights: THREE.Light[] = [];
  /** Baseline floor colour captured at venue build time, used so the
   *  floorDarkness slider can darken back to black and brighten back to
   *  baseline without drifting. */
  private venueFloorBaseColor: THREE.Color | null = null;
  /** Baseline floor PBR params — also lerped to zero at 100% darkness
   *  so the floor stops reflecting the room env map and goes truly black. */
  private venueFloorBaseMetalness = 0;
  private venueFloorBaseRoughness = 1;
  private venueFloorBaseEnvMapIntensity = 1;
  /** Every truss material in the venue + user elements, tagged via
   *  `userData.role === 'truss'`. Rebuilt on venue swap / element sync
   *  so the trussColor lighting override applies live without per-frame
   *  scene traversal. */
  private trussMaterials = new Set<THREE.MeshStandardMaterial>();
  /** Baseline truss colour captured at first registration — restored
   *  when the user clears the override. */
  private trussBaseColor = new THREE.Color(0x9aa3ad);
  private gridHelper: THREE.GridHelper | null = null;
  /** Every scenery group tagged with `userData.sceneryId`, indexed by
   *  that id so override / picking can find them in O(1). Rebuilt each
   *  venue swap. Tracks each piece's baseline transform so we know
   *  what to lerp BACK to when the user clears an override. */
  private sceneryEntries = new Map<string, {
    group: THREE.Object3D;
    basePosition: [number, number, number];
    baseRotation: [number, number, number];
    baseScale: [number, number, number];
  }>();
  private cameraInitialized = false;
  private fallbackTexture: THREE.DataTexture;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;
  private outputPass: OutputPass | null = null;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTexture: THREE.Texture | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  /** One outline per selected target. Primary selection uses a brighter
   *  cyan, secondary selections use a dimmer purple so the user can
   *  tell at a glance which one drives the inspector. */
  private selectionOutlines = new Map<string, THREE.BoxHelper>();
  private bound = {
    pointerDown: this.onPointerDown.bind(this),
    keyDown: this.onKeyDown.bind(this),
    wheel: this.onWheel.bind(this),
    transformDraggingChanged: this.onTransformDraggingChanged.bind(this),
    transformChange: this.onTransformChange.bind(this),
  };
  private pointerDownPos: { x: number; y: number } | null = null;
  private selectionUnsub: (() => void) | null = null;
  /** Atmosphere FX rig — rebuilt per venue, ticked every render(). */
  private atmosphereRig: AtmosphereRig | null = null;
  private lastAtmoTime = 0;
  /** Stable identity of the screens' CONTENT (clip/source ids) — when
   *  it changes, the show director calls a new lighting cue. */
  private lastContentSig = '';
  /** Set when user elements are added/rebuilt/removed so the rig
   *  re-collects ledstrip animation holders. */
  private userStripsDirty = true;
  /** Demo Reel camera drive — when set, render() applies this state and
   *  bypasses OrbitControls so shot interpolation lands exactly. */
  private drivenCamera: { position: [number, number, number]; target: [number, number, number]; fov: number } | null = null;
  /** One-shot frame-capture request (Demo Reel offline render +
   *  shot thumbnails). Fulfilled at the end of renderScene with a
   *  synchronous default-framebuffer readback. */
  private pendingCapture: {
    resolve: (r: { data: Uint8Array; width: number; height: number }) => void;
    reject: (e: Error) => void;
  } | null = null;
  /** Fixed-16:9 recording path. When set, render() does a SECOND scene
   *  render each frame through `composer` (bloom + output, matching the
   *  live view) into `rt` at a fixed 16:9 resolution that's independent
   *  of the project's output resolution — then async-reads it into the
   *  2D `canvas` the MediaRecorder captures. Decoupling means a wide
   *  comp (e.g. 4000×1080) keeps its LED content full-res while the
   *  recorded frame stays a clean 1920×1080 / 4K 16:9. */
  private recording: {
    width: number;
    height: number;
    rt: THREE.WebGLRenderTarget;
    composer: EffectComposer;
    bloomPass: UnrealBloomPass;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    pixels: Uint8Array;
    image: ImageData;
    readbackPending: boolean;
  } | null = null;
  /** Frame counter for staggering the per-LED average-colour readback
   *  across multiple frames so we never pay 6× readback-stall cost in
   *  one frame. One readback per frame, cycled. */
  private frameTick = 0;
  /** Shared downsample scene + ortho camera + 16×16 averaging shader,
   *  reused across every LED. Lazily created on first use. */
  private downsampleScene: THREE.Scene | null = null;
  private downsampleCamera: THREE.OrthographicCamera | null = null;
  private downsampleMaterial: THREE.ShaderMaterial | null = null;
  private downsampleFailed = false;
  private composerFailed = false;

  /** Multi-selection pivot. When 2+ targets are selected, all of them
   *  reparent under this group via THREE.Object3D.attach() so dragging
   *  the gizmo moves them as one rigid unit. On selection change the
   *  pivot is dismantled and its children are reattached to the scene
   *  (preserving world transforms). */
  private gizmoPivot: THREE.Group | null = null;
  private gizmoDragging = false;
  /** Set of layer/element IDs currently parented under the gizmoPivot;
   *  while present, render() skips applying transform overrides to them
   *  because the pivot owns their world transforms during multi-edit. */
  private pivotedIds = new Set<string>();

  constructor(private canvas: HTMLCanvasElement) {
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    // Relaxed polar range so the user can rotate up for audience view
    // (looking up at the stage) or all the way down for plan view.
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.target.set(0, 5, 0);
    // Screen-space panning so a vertical drag moves the camera straight
    // up/down instead of sliding along the ground plane — essential for
    // climbing inside the Sphere dome. Middle-drag pans too (the wheel
    // already owns dolly), alongside the default right-drag pan.
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN,
    };

    this.transformControls = new TransformControls(this.camera, canvas);
    const helper = (this.transformControls as any).getHelper?.() ?? (this.transformControls as any);
    this.scene.add(helper);
    this.transformControls.addEventListener('dragging-changed', this.bound.transformDraggingChanged as any);
    this.transformControls.addEventListener('change', this.bound.transformChange as any);

    canvas.addEventListener('pointerdown', this.bound.pointerDown);
    window.addEventListener('keydown', this.bound.keyDown);
    // Shift+scroll = FOV (capture phase so OrbitControls' own wheel
    // listener doesn't also dolly on the same gesture).
    canvas.addEventListener('wheel', this.bound.wheel, { capture: true, passive: false });

    this.fallbackTexture = new THREE.DataTexture(new Uint8Array([12, 10, 18, 255]), 1, 1);
    this.fallbackTexture.colorSpace = THREE.SRGBColorSpace;
    this.fallbackTexture.needsUpdate = true;

    // Expose camera + snap controls to the Svelte UI via the bus.
    stage3DRendererControls.set({
      frameCamera: () => this.frameCamera(),
      topCamera:   () => this.topCamera(),
      setSnap:     (on) => this.setSnap(on),
      reload:      () => this.reload(),
      getCameraState: () => ({
        position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
        target:   [this.controls.target.x, this.controls.target.y, this.controls.target.z],
        fov:      this.camera.fov,
      }),
      setCameraState: (s) => { this.drivenCamera = s; },
      releaseCamera:  () => { this.drivenCamera = null; },
      setFov:         (f) => this.setFov(f),
      nudgeElevation: (dir) => this.nudgeElevation(dir),
      captureFrame:   () => new Promise((resolve, reject) => {
        if (this.pendingCapture) this.pendingCapture.reject(new Error('superseded'));
        this.pendingCapture = { resolve, reject };
      }),
      beginRecording: (w, h) => this.beginRecording(w, h),
      endRecording:   () => this.endRecording(),
    });

    // When the selection set changes from outside (library click,
    // delete shortcut, store import), rebuild the gizmo / pivot to
    // match. Skip when we're mid-drag — the gizmo OWNS the transform
    // and we'd disconnect it.
    let lastKey = '';
    const selUnsub = selectedStage3DTargets.subscribe(set => {
      if (this.gizmoDragging) return;
      const key = [...set].sort().join('|');
      if (key === lastKey) return;
      lastKey = key;
      this.applySelection(get(selectedStage3DNodeId));
    });
    // Gizmo mode (Move / Rotate / Scale) is driven by the top-bar
    // segment; push that into the live TransformControls so clicking
    // the button switches the gizmo immediately instead of after a
    // re-select. Without this the controls had stale modes.
    let lastMode: 'translate' | 'rotate' | 'scale' = 'translate';
    const modeUnsub = stage3DGizmoMode.subscribe(mode => {
      if (mode === lastMode) return;
      lastMode = mode;
      this.transformControls.setMode(mode);
    });
    this.selectionUnsub = () => { selUnsub(); modeUnsub(); };
  }

  /** Force a full rebuild of venue + LEDs + user elements on the next
   *  render frame. Wired to the "Reload" top-bar button; useful when
   *  the scene state-machine has drifted (e.g. VJ-to-screen binding
   *  didn't activate until you reload). */
  reload(): void {
    const venue = this.currentVenue;
    this.currentVenue = null; // forces swapVenue on next render
    this.currentLedSignature = '__force__';
    // Tear down element entries so syncUserElements rebuilds from scratch.
    for (const entry of this.elementEntries.values()) {
      this.scene.remove(entry.group);
      disposeObject(entry.group);
    }
    this.elementEntries.clear();
    // Hint TransformControls to detach since attached groups may have
    // been replaced.
    this.transformControls.detach();
    console.log('[Stage3D] Reload — venue', venue, 'will rebuild on next frame');
  }

  render(
    renderer: THREE.WebGLRenderer,
    stage: Stage3DScene,
    masterTexture: THREE.Texture | null,
    _outputSlices: OutputSlice[],
    sourceLayers: Layer[] = [],
  ): void {
    this.ensureRenderTargets(renderer);
    const venue = stage.venue ?? 'festival';
    if (venue !== this.currentVenue) this.swapVenue(venue);

    // Build LEDs from project.layers when the set changes.
    const screenLayers = sourceLayers.filter(l => l.type === 'screen' && l.visible !== false);
    const ledSig = screenLayers.map(l => l.id).join('|');
    if (ledSig !== this.currentLedSignature) {
      this.currentLedSignature = ledSig;
      this.rebuildLeds(screenLayers);
    }

    // Sync user-placed library elements with the store.
    this.syncUserElements(stage.userElements ?? []);

    // Apply venue scenery overrides — per-frame so dragging the gizmo
    // immediately reflects in the next render. Skip the write when a
    // piece is being actively dragged (same pattern as screens /
    // elements) so the gizmo's transform stays authoritative until
    // drag-end.
    const sceneryOverrides = stage.sceneryOverrides ?? {};
    for (const [id, entry] of this.sceneryEntries) {
      const override = sceneryOverrides[id];
      const obj = entry.group;
      if (override?.deleted) { obj.visible = false; continue; }
      obj.visible = true;
      if (this.pivotedIds.has(id)) continue;
      if (this.gizmoDragging && this.transformControls.object === obj) continue;
      const pos = override?.position ?? entry.basePosition;
      const rot = override?.rotation ?? entry.baseRotation;
      const scl = override?.scale ?? entry.baseScale;
      obj.position.set(pos[0], pos[1], pos[2]);
      obj.rotation.set(rot[0], rot[1], rot[2]);
      obj.scale.set(scl[0], scl[1], scl[2]);
    }

    // Apply scene-wide lighting overrides on top of the venue baseline.
    // Cheap: a few scalar writes per frame + a colour lerp on the floor.
    const lighting = { ...DEFAULT_LIGHTING, ...(stage.lighting ?? {}) };
    // Exposure is a master scene multiplier on everything visible.
    //   • Built-in materials (deck, trusses, walls, floor): scaled
    //     by renderer.toneMappingExposure via LinearToneMapping — this
    //     is what makes metal trusses brighten with exposure even when
    //     their dominant light source is IBL (env-map reflection)
    //     rather than direct lights.
    //   • LED ShaderMaterial: doesn't get tone mapping in its shader,
    //     so we fold the same factor into uBrightness below.
    // 0 is treated as the neutral 1.0 sentinel so stored values from
    // before the slider was wired don't suddenly black-out the room.
    const exposureMul = lighting.exposure > 0 ? lighting.exposure : 1;
    if (this.renderer) {
      this.renderer.toneMappingExposure = exposureMul;
    }
    if (this.venueBuild) {
      const base = this.venueBuild.baselineIntensities;
      for (let i = 0; i < this.venueLights.length; i++) {
        // Lights scale by roomIntensity only — exposure is applied
        // downstream via toneMappingExposure so the metals + IBL
        // contributions move together with direct-light contributions.
        this.venueLights[i].intensity = (base[i] ?? this.venueLights[i].intensity)
          * lighting.roomIntensity;
      }
      if (this.venueFloorBaseColor) {
        const floorMat = this.venueBuild.floor.material as THREE.MeshStandardMaterial;
        const dark = Math.max(0, Math.min(1, lighting.floorDarkness));
        // Lerp ALL the PBR knobs that contribute light to the floor:
        //   • color goes to black (kills diffuse from any direct light)
        //   • metalness to zero (kills metal-tinted spec)
        //   • envMapIntensity to zero (kills IBL reflection)
        //   • roughness to 1 (spreads dielectric F0 spec across all
        //     directions so no white grazing-angle highlight reads)
        //   • visible = false at fully dark — last-ditch guarantee
        floorMat.color.copy(this.venueFloorBaseColor).multiplyScalar(1 - dark);
        floorMat.metalness = this.venueFloorBaseMetalness * (1 - dark);
        floorMat.envMapIntensity = this.venueFloorBaseEnvMapIntensity * (1 - dark);
        floorMat.roughness = this.venueFloorBaseRoughness * (1 - dark) + 1.0 * dark;
        this.venueBuild.floor.visible = dark < 0.995;
      }
      if (this.bloomPass) {
        this.bloomPass.strength = this.venueBuild.bloomStrength;
      }
      // Truss colour
      if (lighting.trussColor) {
        const c = new THREE.Color(lighting.trussColor);
        for (const mat of this.trussMaterials) mat.color.copy(c);
      } else {
        for (const mat of this.trussMaterials) mat.color.copy(this.trussBaseColor);
      }
      // Key light position + colour overrides — null/empty restore baseline.
      const key = this.venueBuild.keyLight;
      const basePos = this.venueBuild.keyPositionBaseline;
      const targetPos = lighting.keyPosition ?? basePos;
      key.position.set(targetPos[0], targetPos[1], targetPos[2]);
      if (lighting.keyColor) key.color.set(lighting.keyColor);
      else key.color.setHex(this.venueBuild.keyColorBaseline);
      // Shadow toggle — flip the renderer's global shadow map enable
      // and ONLY directional/spot/point lights' castShadow flag.
      // HemisphereLight + AmbientLight inherit castShadow from Object3D
      // but don't actually support shadow casting; setting their flag
      // makes WebGLShadowMap spam "X has no shadow" warnings every frame.
      const shadowsOn = lighting.shadows;
      if (this.renderer) this.renderer.shadowMap.enabled = shadowsOn;
      for (const l of this.venueLights) {
        if (l instanceof THREE.DirectionalLight
         || l instanceof THREE.SpotLight
         || l instanceof THREE.PointLight) {
          l.castShadow = shadowsOn;
        }
      }
    }
    // Expose for the LED loop below.
    (this as any)._exposureMul = exposureMul;

    const width = Math.max(1, this.canvas.width || this.canvas.clientWidth || 1);
    const height = Math.max(1, this.canvas.height || this.canvas.clientHeight || 1);
    // Camera aspect follows the canvas's DISPLAYED size (the pop-out
    // window), NOT the backing-store resolution. The shared GL canvas is
    // sized to the project's OUTPUT resolution (engine.resize → e.g.
    // vertical 4K), but the design viewport must stay proportional to the
    // window it's shown in — otherwise a vertical/portrait output squishes
    // the whole stage. The full backing store is still rendered (kept for
    // crispness + recording); only the projection aspect decouples. This
    // also keeps click-picking, which already maps in client space
    // (pickAt uses getBoundingClientRect), consistent with the projection.
    const displayW = this.canvas.clientWidth || width;
    const displayH = this.canvas.clientHeight || height;
    this.camera.aspect = displayW / Math.max(1, displayH);
    if (this.drivenCamera) {
      // Demo Reel playback / offline render owns the camera: apply the
      // driven state verbatim and skip OrbitControls (its damping would
      // smear exact shot interpolation).
      const d = this.drivenCamera;
      this.camera.position.set(d.position[0], d.position[1], d.position[2]);
      this.controls.target.set(d.target[0], d.target[1], d.target[2]);
      if (this.camera.fov !== d.fov) {
        this.camera.fov = d.fov;
        // Keep the toolbar FOV slider tracking reel playback (write
        // only on change so we don't spam the store at 60Hz).
        stage3DCameraFov.set(d.fov);
      }
      this.camera.lookAt(this.controls.target);
      this.camera.updateProjectionMatrix();
    } else {
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }

    // Build a layer-id index so we can resolve each screen's parent
    // group (for unified-shader-mode crop). Cheap — one map per frame
    // typed against the sourceLayers array Canvas.svelte hands us.
    const layerById = new Map<string, Layer>();
    for (const l of sourceLayers) layerById.set(l.id, l);
    const stageFxRt = get(stageEffectsRuntime);

    // Atmosphere FX — sync toggles from the scene, then tick the rig
    // with the smoothed visual-audio bus so beams/lasers/strips ride
    // the music. dt derives from the same clock as the LED uniforms.
    const atmoNow = performance.now() * 0.001;
    const atmoDt = this.lastAtmoTime > 0
      ? Math.max(0.001, Math.min(0.1, atmoNow - this.lastAtmoTime))
      : 0.016;
    this.lastAtmoTime = atmoNow;
    if (this.atmosphereRig) {
      const atmoFlags = { ...DEFAULT_ATMOSPHERE, ...(stage.atmosphere ?? {}) };
      this.atmosphereRig.setFlags(atmoFlags);

      // Content sync — when the screens' source identity changes (new
      // clip / shader fired), the director calls a new lighting cue.
      const contentSig = screenLayers
        .map(l => (l.source ? `${l.source.id}:${l.source.name}` : ''))
        .join('|');
      if (contentSig !== this.lastContentSig) {
        if (this.lastContentSig !== '') this.atmosphereRig.notifyContentChange();
        this.lastContentSig = contentSig;
      }
      // Palette from the screens: feed the live average color of the
      // first LED's content (already async-read for the room glow).
      if (this.ledEntries.length > 0) {
        this.atmosphereRig.setContentColor(this.ledEntries[0].ambientLight.color);
      }

      // Hand user-placed ledstrip elements to the rig when the element
      // set changed.
      if (this.userStripsDirty) {
        this.userStripsDirty = false;
        const list: UserStripAnim[] = [];
        for (const [, entry] of this.elementEntries) {
          entry.group.traverse(o => {
            const a = o.userData.ledStripAnim as UserStripAnim | undefined;
            if (a) list.push(a);
          });
        }
        this.atmosphereRig.setUserStrips(list);
      }

      this.atmosphereRig.update(atmoDt, getVisualAudioSnapshot());

      // Guarantee enough bloom for the show elements to glow even in
      // venues that run bloom-free at idle (festival/arena).
      if (this.bloomPass && this.venueBuild) {
        const anyAtmo = atmoFlags.beams || atmoFlags.lasers || atmoFlags.haze || atmoFlags.strips;
        this.bloomPass.strength = anyAtmo
          ? Math.max(this.venueBuild.bloomStrength, 0.16)
          : this.venueBuild.bloomStrength;
      }
    }

    // Per-frame LED uniforms + transforms.
    const time = performance.now() * 0.001;
    const overrides = stage.screenOverrides ?? {};
    for (const entry of this.ledEntries) {
      // CRITICAL: pull the FRESH layer clone from layerById each
      // frame. Canvas.svelte's VJ-injection pass produces a new clone
      // every frame, with a new `source.texture`. If we read from
      // `entry.layer` (captured at LED build time), we're stuck on the
      // VJ clip that was active when the LEDs were built — every clip
      // change after that goes invisible until the user hits Reload.
      // The fresh layer also carries up-to-date parentGroupId, effects,
      // corners, etc. so unified-group binding stays correct too.
      const layer = layerById.get(entry.layer.id) ?? entry.layer;
      entry.layer = layer;
      const override = overrides[layer.id] ?? {};
      const u = entry.material.uniforms;

      // Resolve unified-group support FIRST: when this screen is a
      // child of a group whose shaderMode is 'unified', the group's
      // source.texture is the shared shader (or VJ-injected texture)
      // and this screen samples a crop window of it instead of its
      // own per-layer texture. Mirrors engine.ts's _unifiedCrop path
      // (line ~2273) so 2D mapping mode and Stage3D mode look the same.
      let texture: THREE.Texture | null = null;
      let useUnifiedCrop = false;
      const parentId = (layer as any).parentGroupId as string | null | undefined;
      const parent = parentId ? layerById.get(parentId) : null;
      const parentUnified = parent?.groupConfig?.shaderMode === 'unified';
      const parentTex = (parent?.source?.texture as THREE.Texture | null | undefined) ?? null;
      if (parent && parentUnified && parentTex) {
        const c = (layer as any).corners;
        if (c) {
          const xs = [c.topLeft.x, c.topRight.x, c.bottomLeft.x, c.bottomRight.x];
          const ys = [c.topLeft.y, c.topRight.y, c.bottomLeft.y, c.bottomRight.y];
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          texture = parentTex;
          useUnifiedCrop = true;
          // (offsetX, offsetY, width, height) in texture UV space.
          // Corners are canvas Y-DOWN (y=0 top); the texture is GL V-up.
          // offsetY = 1 - maxY converts between the two — the SAME math
          // engine.ts uses for the 2D unified crop, so both views sample
          // identical bands of the shared group texture.
          u.uCropRegion.value.set(minX, 1 - maxY, maxX - minX, maxY - minY);
        }
      }
      if (!texture) texture = textureForLayer(layer, masterTexture);

      u.uTexture.value = texture ?? this.fallbackTexture;
      u.uHasTexture.value = texture ? 1 : 0;
      u.uUnifiedCrop.value = useUnifiedCrop ? 1 : 0;
      const finish = override.finish ?? 'led';
      const base = override.brightness ?? 1.0;
      const screenBoost = lighting.screenBoost;
      // Stage-FX modulation: if this screen is bound to a Surface slice
      // (via Apply Stage), the runtime publishes a brightness factor
      // 0..1 for that slice each frame — Radial Pulse / Sweep / Strobe
      // etc. all drive this. Multiply it into the LED so the 3D screens
      // pulse the same way the 2D mapped slices do.
      const stageFx = resolveStageEffectForLayer(layer, stageFxRt);
      const fxBrightness = stageFx.brightness;
      const stageTint = u.uStageTint.value as THREE.Color;
      if (stageFx.color) {
        stageTint.set(stageFx.color).convertSRGBToLinear();
      } else {
        stageTint.setRGB(1, 1, 1);
      }
      entry.stageFxBrightness = fxBrightness;
      entry.stageFxTint.copy(stageTint);
      // Note: exposureMul is intentionally NOT applied here. Exposure
      // is the master scenery brightness, and coupling it into the
      // LED makes a dark room (low exposure) inevitably dim the
      // screens too — you can't get "house lights down, screens
      // visible" without screen boost fighting exposure. Decoupled,
      // screen boost is the only multiplier on the LED so you can dial
      // a 0.2× dim room with screens still bright at boost ~3–4×.
      u.uBrightness.value = (finish === 'projection' ? base * 0.6 : base) * screenBoost * fxBrightness;
      u.uTime.value = time;
      u.uScreenAspect.value = entry.defaultWidth / Math.max(0.0001, entry.defaultHeight);
      u.uSourceAspect.value = 16 / 9;
      u.uDisplayFit.value = FIT_INDEX[override.displayFit ?? 'stretch'] ?? 0;
      u.uEdgeEffect.value = EDGE_INDEX[override.edgeEffect ?? 'none'] ?? 0;
      u.uPanelSize.value.set(entry.defaultWidth, entry.defaultHeight);

      // Dome screens: rebake the sector's UVs when the user switches
      // content mapping (wrap / domemaster / equirect). Geometry-only —
      // positions are identical, so this is a cheap one-off rebuild.
      // Fisheye / equirect mappings carry exact per-vertex UVs that the
      // display-fit letterboxing would corrupt — force stretch there.
      if (entry.dome) {
        const mapping = (override.domeMapping ?? 'wrap') as DomeMapping;
        const domeRegion = this.venueBuild?.ledDome;
        if (mapping !== entry.dome.mapping && domeRegion) {
          entry.dome.mapping = mapping;
          entry.surface.geometry.dispose();
          entry.surface.geometry = buildDomeSectorGeometry(
            domeRegion, entry.dome.u0, entry.dome.u1, entry.dome.yTop, entry.dome.yBottom, mapping,
          );
        }
        if (mapping !== 'wrap') u.uDisplayFit.value = 0;
      }

      // Transform writes are skipped when the entry is currently a
      // child of the multi-select pivot (pivot owns world transforms
      // during multi-edit) OR when the gizmo is actively dragging this
      // single target (avoids fighting the gizmo every frame).
      if (this.pivotedIds.has(layer.id)) continue;
      if (this.gizmoDragging && this.transformControls.object === entry.group) continue;
      const pos = override.position ?? entry.defaultPosition;
      entry.group.position.set(pos[0], pos[1], pos[2]);
      const rot = override.rotation ?? [0, 0, 0];
      entry.group.rotation.set(rot[0], rot[1], rot[2]);
      const scl = override.scale ?? [1, 1, 1];
      entry.group.scale.set(scl[0], scl[1], scl[2]);
      // Keep the reactive area light glued to the LED's current
      // position so moving the LED moves the glow with it. Dome
      // screens carry a precomputed offset on the sector's
      // mid-direction (group position = dome centre); flat panels sit
      // the light just in front, aimed forward + slightly down.
      if (entry.dome) {
        const lo = entry.dome.lightOffset;
        const lt = entry.dome.lightTarget;
        entry.ambientLight.position.set(pos[0] + lo[0], pos[1] + lo[1], pos[2] + lo[2]);
        entry.ambientLight.lookAt(pos[0] + lt[0], pos[1] + lt[1], pos[2] + lt[2]);
      } else {
        entry.ambientLight.position.set(pos[0], pos[1], pos[2] + 0.3);
        entry.ambientLight.lookAt(pos[0], pos[1] - entry.defaultHeight * 0.6, pos[2] + 12);
      }
    }

    this.updateSelectionOutline();

    // Reactive room glow: each LED has a PointLight whose colour tracks
    // the average colour of its content. We run the downsample shader
    // for ONE LED per frame (rotating index) and read back its pixel,
    // so the per-frame stall stays bounded at ~one readback. Lights
    // for off-cycle LEDs hold their last colour — fine for 60fps.
    const lightInfluence = lighting.screenLightInfluence ?? 1;
    if (this.ledEntries.length > 0 && lightInfluence > 0.001 && !this.downsampleFailed) {
      this.ensureDownsample();
      const idx = this.frameTick % this.ledEntries.length;
      const led = this.ledEntries[idx];
      const inputTex = led.material.uniforms.uTexture.value as THREE.Texture | null;
      if (
        inputTex &&
        led.material.uniforms.uHasTexture.value > 0.5 &&
        !led.readbackPending &&
        this.downsampleScene && this.downsampleCamera && this.downsampleMaterial
      ) {
        try {
          this.downsampleMaterial.uniforms.uSrc.value = inputTex;
          renderer.setRenderTarget(led.averageRT);
          renderer.render(this.downsampleScene, this.downsampleCamera);
          renderer.setRenderTarget(null);
          // Async readback — no fence wait on the render thread. The
          // resolved colour applies when the GPU finishes; a frame of
          // latency is invisible on a glow light.
          led.readbackPending = true;
          renderer.readRenderTargetPixelsAsync(led.averageRT, 0, 0, 1, 1, led.averagePixels)
            .then(() => {
              led.ambientLight.color.setRGB(
                led.averagePixels[0] / 255,
                led.averagePixels[1] / 255,
                led.averagePixels[2] / 255,
              ).multiply(led.stageFxTint);
            })
            .catch((err: unknown) => {
              this.downsampleFailed = true;
              for (const e of this.ledEntries) e.ambientLight.intensity = 0;
              console.warn('[Stage3D] LED average-colour readback disabled after GPU error:', err);
            })
            .finally(() => { led.readbackPending = false; });
        } catch (err) {
          renderer.setRenderTarget(null);
          this.downsampleFailed = true;
          for (const e of this.ledEntries) e.ambientLight.intensity = 0;
          console.warn('[Stage3D] LED average-colour readback disabled after GPU error:', err);
        }
      }
      // Per-LED point-light intensity scales with:
      //   • lightInfluence  → user slider (master "glow" amount)
      //   • screenBoost     → so cranking the screens to overpower a
      //                       dim room also pushes more spill light
      //   • 1 / exposureMul → compensates for the toneMappingExposure
      //                       scaling that dims everything visible in
      //                       low-exposure rooms. Without this, dropping
      //                       exposure to ~0.2 made the room dark BUT
      //                       killed the screen-glow contribution too,
      //                       defeating the whole "dark room, glowing
      //                       LEDs" look.
      // RectAreaLight intensity is luminance (per unit area) — the panel
      // itself is the emitter, so the multiplier is far smaller than the
      // old PointLight's (which packed the whole wall's output into one
      // point and read as a hard spotlight pool on the deck).
      const glowScale = lightInfluence * 0.9 * lighting.screenBoost / Math.max(0.1, exposureMul);
      for (const e of this.ledEntries) {
        e.ambientLight.intensity = glowScale * e.stageFxBrightness;
      }
    } else {
      for (const e of this.ledEntries) e.ambientLight.intensity = 0;
    }
    this.frameTick++;

    this.renderScene(renderer, width, height);

    // Fixed-16:9 recording: a SECOND render of the same scene through the
    // record-sized bloom composer, captured at a resolution that ignores
    // the project's output resolution. Runs after the display render so
    // every uniform/transform is already current for this frame.
    if (this.recording) this.renderRecordingFrame(renderer);
  }

  /** Called by the Svelte UI / pointer pick when the user clicks a
   *  library entry or a target in the scene. With `additive=true`
   *  (shift-click) the target is toggled in the multi-select set;
   *  otherwise selection is replaced. The primary selectedStage3DNodeId
   *  tracks the most recently clicked target (drives the inspector). */
  selectNode(target: string | null, additive = false): void {
    if (!target) {
      selectedStage3DNodeId.set(null);
      selectedStage3DTargets.set(new Set());
      this.applySelection(null);
      return;
    }
    selectedStage3DTargets.update(current => {
      const next = new Set(additive ? current : []);
      if (additive && next.has(target)) {
        next.delete(target);
      } else {
        next.add(target);
      }
      return next;
    });
    // Primary selection is the just-clicked target unless we removed it.
    const targets = get(selectedStage3DTargets);
    if (targets.has(target)) {
      selectedStage3DNodeId.set(target);
    } else {
      // Removed via shift-click — fall back to any remaining target.
      const remaining = [...targets];
      selectedStage3DNodeId.set(remaining[remaining.length - 1] ?? null);
    }
    this.applySelection(get(selectedStage3DNodeId));
  }

  /** Camera frame: fit everything in view. Triggered by the Frame
   *  button + venue swap. */
  frameCamera(): void {
    const box = new THREE.Box3();
    let any = false;
    for (const e of this.ledEntries) { box.expandByObject(e.group); any = true; }
    for (const e of this.elementEntries.values()) { box.expandByObject(e.group); any = true; }
    if (!any && this.venueBuild) {
      box.set(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 15, 20));
    }
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const r = Math.max(sz.x, sz.y, sz.z) * 0.9 + 18;
    this.controls.target.copy(c);
    this.camera.position.set(c.x + r * 0.8, c.y + r * 0.55, c.z + r);
    this.controls.update();
  }

  topCamera(): void {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 90, 0.01);
    this.controls.update();
  }

  setGizmoMode(mode: 'translate' | 'rotate' | 'scale'): void {
    this.transformControls.setMode(mode);
    stage3DGizmoMode.set(mode);
  }

  setSnap(on: boolean): void {
    this.transformControls.setTranslationSnap(on ? 1 : null);
    this.transformControls.setRotationSnap(on ? THREE.MathUtils.degToRad(15) : null);
    this.transformControls.setScaleSnap(on ? 0.25 : null);
  }

  duplicateSelection(): UserStageElement[] {
    const targets = get(selectedStage3DTargets);
    const allElements = get(stage3dScene).userElements ?? [];
    const clones: UserStageElement[] = [];
    for (const key of targets) {
      const sel = parseSelection(key);
      if (!sel || sel.kind !== 'element') continue;
      const original = allElements.find(e => e.id === sel.id);
      if (!original) continue;
      const clone: UserStageElement = {
        ...original,
        id: `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7) + Math.random().toString(36).slice(2, 4)}`,
        params: { ...original.params },
        position: [original.position[0] + 3, original.position[1], original.position[2] + 3],
      };
      stage3dScene.addUserElement(clone);
      clones.push(clone);
    }
    if (clones.length) {
      selectedStage3DNodeId.set(`element:${clones[clones.length - 1].id}`);
      selectedStage3DTargets.set(new Set(clones.map(c => `element:${c.id}`)));
    }
    return clones;
  }

  deleteSelection(): void {
    const targets = [...get(selectedStage3DTargets)];
    if (targets.length === 0) return;
    // Dismantle pivot first so children are back in the scene before
    // we tear their entries down.
    this.dismantlePivot();
    this.transformControls.detach();
    for (const key of targets) {
      const sel = parseSelection(key);
      if (sel?.kind === 'element')  stage3dScene.removeUserElement(sel.id);
      if (sel?.kind === 'scenery')  stage3dScene.setSceneryOverride(sel.id, { deleted: true });
      // Screens can't be deleted from here — they're owned by the 2D
      // Stage Designer. Removing them means removing the layer.
    }
    selectedStage3DNodeId.set(null);
    selectedStage3DTargets.set(new Set());
  }

  dispose(): void {
    this.endRecording();
    if (this.pendingCapture) {
      this.pendingCapture.reject(new Error('renderer disposed'));
      this.pendingCapture = null;
    }
    for (const entry of this.ledEntries) entry.averageRT.dispose();
    this.downsampleMaterial?.dispose();
    disposeObject(this.scene);
    this.ledEntries = [];
    this.ledByLayerId.clear();
    this.elementEntries.clear();
    for (const helper of this.selectionOutlines.values()) {
      helper.geometry.dispose();
      (helper.material as THREE.Material).dispose();
    }
    this.selectionOutlines.clear();
    this.controls.dispose();
    this.transformControls.removeEventListener('dragging-changed', this.bound.transformDraggingChanged as any);
    this.transformControls.removeEventListener('change', this.bound.transformChange as any);
    this.transformControls.dispose();
    this.canvas.removeEventListener('pointerdown', this.bound.pointerDown);
    window.removeEventListener('keydown', this.bound.keyDown);
    this.canvas.removeEventListener('wheel', this.bound.wheel, { capture: true } as EventListenerOptions);
    this.atmosphereRig?.dispose();
    this.atmosphereRig = null;
    this.fallbackTexture.dispose();
    this.envTexture?.dispose();
    this.pmrem?.dispose();
    this.composer?.dispose?.();
    this.bloomPass?.dispose?.();
    this.outputPass?.dispose?.();
    this.selectionUnsub?.();
    this.selectionUnsub = null;
    stage3DRendererControls.set(null);
  }

  // ── Render setup ─────────────────────────────────────────────────────

  private ensureRenderTargets(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    this.renderer = renderer;
    this.composerFailed = false;
    this.downsampleFailed = false;
    // LinearToneMapping is just `color *= toneMappingExposure` inside
    // every built-in material's fragment shader. No filmic S-curve, no
    // gamma. At exposure 1.0 it's indistinguishable from NoToneMapping,
    // but it gives us a master scenery brightness knob the LED shader
    // (which sets toneMapped:false) doesn't see. The LED applies the
    // same exposure factor manually in its uBrightness, so screens and
    // scenery scale together.
    renderer.toneMapping = THREE.LinearToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    // Bloom kept available but defaults to 0; venues opt in via
    // `bloomStrength`. Strength updated on venue swap.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(this.canvas.width || 1920, this.canvas.height || 1080),
      0.0, 0.45, 0.85,
    );
    this.composer.addPass(this.bloomPass);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    void import('three/examples/jsm/environments/RoomEnvironment.js').then(({ RoomEnvironment }) => {
      if (!this.renderer) return;
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const roomEnv = new RoomEnvironment();
      const env = pmrem.fromScene(roomEnv, 0.04).texture;
      this.scene.environment = env;
      this.envTexture = env;
      this.pmrem = pmrem;
      disposeObject(roomEnv);
    }).catch(err => console.warn('[Stage3D] RoomEnvironment load failed', err));
  }

  private prepareFinalRender(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    renderer.setRenderTarget(null);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
    renderer.autoClear = true;
    renderer.resetState?.();
  }

  private renderSceneDirect(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    this.prepareFinalRender(renderer, width, height);
    renderer.render(this.scene, this.camera);
  }

  private renderScene(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    const bloomActive = (this.bloomPass?.strength ?? 0) > 0.001;
    const useComposer = !!this.composer && bloomActive && !this.composerFailed;
    if (!useComposer) {
      this.renderSceneDirect(renderer, width, height);
      this.fulfillCapture(renderer, width, height);
      return;
    }
    try {
      this.composer!.setSize(width, height);
      this.bloomPass?.setSize(width, height);
      this.prepareFinalRender(renderer, width, height);
      this.composer!.render();
    } catch (err) {
      this.composerFailed = true;
      console.warn('[Stage3D] Postprocessing disabled after GPU error:', err);
      this.renderSceneDirect(renderer, width, height);
    }
    this.fulfillCapture(renderer, width, height);
  }

  /** Resolve a pending one-shot frame capture. MUST run synchronously
   *  in the same task as the scene render: the renderer runs with
   *  preserveDrawingBuffer:false, so the default framebuffer is only
   *  valid until Chromium composites the page. readPixels returns
   *  bottom-up rows; flip to top-down so consumers (putImageData /
   *  JPEG encode) get a normal image. */
  private fulfillCapture(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    if (!this.pendingCapture) return;
    const pending = this.pendingCapture;
    this.pendingCapture = null;
    try {
      const gl = renderer.getContext();
      const data = new Uint8Array(width * height * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const rowBytes = width * 4;
      const tmp = new Uint8Array(rowBytes);
      for (let y = 0; y < (height >> 1); y++) {
        const top = y * rowBytes;
        const bot = (height - 1 - y) * rowBytes;
        tmp.set(data.subarray(top, top + rowBytes));
        data.copyWithin(top, bot, bot + rowBytes);
        data.set(tmp, bot);
      }
      pending.resolve({ data, width, height });
    } catch (err) {
      pending.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // ── Fixed-16:9 stage recording ───────────────────────────────────────

  /** Stand up the offscreen 16:9 capture path. The composer mirrors the
   *  live chain (RenderPass → UnrealBloomPass → OutputPass) but renders
   *  into an 8-bit sRGB target at `width`×`height` instead of the screen,
   *  so MediaRecorder can grab a clean 16:9 frame regardless of the
   *  project's output resolution. Returns the 2D canvas to record. */
  beginRecording(width: number, height: number): HTMLCanvasElement | null {
    if (!this.renderer) return null;
    this.endRecording();
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));

    // 8-bit sRGB target so OutputPass writes display-encoded bytes we can
    // read straight into ImageData (no float decode). Passing it to the
    // EffectComposer makes BOTH its ping-pong buffers this format.
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      colorSpace: THREE.SRGBColorSpace,
      depthBuffer: true,
    });
    const composer = new EffectComposer(this.renderer, rt);
    // renderToScreen off → the final OutputPass result lands in
    // composer.readBuffer (three swaps after the last needsSwap pass).
    composer.renderToScreen = false;
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.0, 0.45, 0.85);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { composer.dispose(); rt.dispose(); return null; }

    this.recording = {
      width: w, height: h, rt, composer, bloomPass, canvas, ctx,
      pixels: new Uint8Array(w * h * 4),
      image: new ImageData(w, h),
      readbackPending: false,
    };
    console.log(`[Stage3D] Recording capture armed at ${w}×${h} (16:9, output-res independent)`);
    return canvas;
  }

  endRecording(): void {
    const rec = this.recording;
    if (!rec) return;
    this.recording = null;
    rec.composer.dispose();
    rec.rt.dispose();
  }

  /** Render the scene a second time at the fixed 16:9 record resolution
   *  and async-read it into the record canvas. Camera aspect is forced to
   *  the record aspect for this pass only, then restored so picking and
   *  OrbitControls (which run between frames) keep the window aspect. */
  private renderRecordingFrame(renderer: THREE.WebGLRenderer): void {
    const rec = this.recording;
    if (!rec) return;
    // Match the live bloom amount (venue + atmosphere drive it each frame).
    rec.bloomPass.strength = this.bloomPass?.strength ?? 0;

    const prevAspect = this.camera.aspect;
    this.camera.aspect = rec.width / rec.height;
    this.camera.updateProjectionMatrix();
    try {
      rec.composer.render();
    } catch (err) {
      console.warn('[Stage3D] Recording render pass failed:', err);
    } finally {
      renderer.setRenderTarget(null);
      this.camera.aspect = prevAspect;
      this.camera.updateProjectionMatrix();
    }

    // One readback in flight at a time — a frame or two of latency is
    // invisible since captureStream samples the canvas continuously.
    if (rec.readbackPending) return;
    rec.readbackPending = true;
    renderer.readRenderTargetPixelsAsync(rec.composer.readBuffer, 0, 0, rec.width, rec.height, rec.pixels)
      .then(() => this.blitRecording())
      .catch((err: unknown) => console.warn('[Stage3D] Recording readback failed:', err))
      .finally(() => { if (this.recording === rec) rec.readbackPending = false; });
  }

  /** Flip the GL-bottom-up readback to top-down and push it into the
   *  record canvas the MediaRecorder is sampling. */
  private blitRecording(): void {
    const rec = this.recording;
    if (!rec) return;
    const { width: w, height: h, pixels } = rec;
    const dst = rec.image.data;
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * rowBytes;
      dst.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
    }
    rec.ctx.putImageData(rec.image, 0, 0);
  }

  // ── Venue swap ───────────────────────────────────────────────────────

  private swapVenue(venue: Stage3DVenue): void {
    // Tear the atmosphere rig down BEFORE the venue group disposes —
    // its beams/strips are parented inside venue scenery.
    this.atmosphereRig?.dispose();
    this.atmosphereRig = null;
    if (this.venueBuild) {
      this.scene.remove(this.venueBuild.group);
      disposeObject(this.venueBuild.group);
    }
    for (const l of this.venueLights) this.scene.remove(l);
    this.venueLights = [];
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
      (this.gridHelper.material as THREE.Material).dispose();
      this.gridHelper = null;
    }

    const build = buildVenue(venue);
    this.venueBuild = build;
    this.currentVenue = venue;
    this.scene.add(build.group);
    for (const l of build.lights) { this.scene.add(l); this.venueLights.push(l); }
    // Capture floor baseline PBR params so floorDarkness can lerp them
    // all the way to zero (truly black) and back to venue baseline.
    const floorMat = build.floor.material as THREE.MeshStandardMaterial;
    this.venueFloorBaseColor = floorMat.color.clone();
    this.venueFloorBaseMetalness = floorMat.metalness;
    this.venueFloorBaseRoughness = floorMat.roughness;
    this.venueFloorBaseEnvMapIntensity = floorMat.envMapIntensity ?? 1;
    // Re-collect tagged truss materials (venue scenery only — element
    // entries register their own via syncUserElements).
    this.trussMaterials.clear();
    this.collectTrussMaterials(build.group);
    // Index every sceneryId-tagged group so the picker can find them
    // and the per-frame override apply can move / hide / delete them.
    this.sceneryEntries.clear();
    build.group.traverse(obj => {
      const id = obj.userData.sceneryId as string | undefined;
      if (!id || this.sceneryEntries.has(id)) return;
      this.sceneryEntries.set(id, {
        group: obj,
        basePosition: [obj.position.x, obj.position.y, obj.position.z],
        baseRotation: [obj.rotation.x, obj.rotation.y, obj.rotation.z],
        baseScale:    [obj.scale.x, obj.scale.y, obj.scale.z],
      });
    });
    // Publish the piece list so the designer tree can show + manage each
    // venue default like a user element. Insertion order from traverse()
    // groups related pieces (deck, trusses, towers, movers, pars, PA).
    stage3DSceneryList.set([...this.sceneryEntries.keys()].map(id => ({ id, label: sceneryLabel(id) })));
    this.scene.background = new THREE.Color(build.backgroundColor);
    this.scene.fog = new THREE.FogExp2(new THREE.Color(build.fogColor).getHex(), build.fogDensity);

    if (build.showGrid) {
      this.gridHelper = new THREE.GridHelper(400, 80, 0x3a4250, 0x1a1f29);
      (this.gridHelper.material as THREE.Material).transparent = true;
      (this.gridHelper.material as THREE.Material).opacity = 0.5;
      this.scene.add(this.gridHelper);
    }

    // Tune renderer to the venue: bloom only — toneMappingExposure is
    // driven by the lighting block in render() so the user's exposure
    // slider stays authoritative.
    if (this.bloomPass) this.bloomPass.strength = build.bloomStrength;

    if (!this.cameraInitialized) {
      this.camera.position.set(...build.cameraPosition);
      this.controls.target.set(...build.cameraTarget);
      this.cameraInitialized = true;
    }

    // Fresh atmosphere rig for the new venue — flags re-sync on the
    // next render() tick from stage.atmosphere, and the user-strip
    // holders need re-handing to the new instance.
    this.atmosphereRig = new AtmosphereRig(this.scene, build);
    this.userStripsDirty = true;

    // Force LED rebuild on next render — new wall geometry.
    this.currentLedSignature = '';
  }

  // ── LED build ────────────────────────────────────────────────────────

  private rebuildLeds(screenLayers: Layer[]): void {
    for (const entry of this.ledEntries) {
      this.scene.remove(entry.group);
      this.scene.remove(entry.ambientLight);
      entry.averageRT.dispose();
      disposeObject(entry.group);
    }
    this.ledEntries = [];
    this.ledByLayerId.clear();

    const wall = this.venueBuild?.ledWall;
    const dome = this.venueBuild?.ledDome;
    if (!wall && !dome) return;

    const screenOverrides = get(stage3dScene).screenOverrides ?? {};

    for (const layer of screenLayers) {
      // ── Dome venue: screens are TRUE spherical sectors on the dome
      //    interior — the layer's canvas rect maps onto the dome's
      //    angular extents (full-canvas screen = the whole dome). ──
      if (dome) {
        const dp = domeScreenPlacement(layer, dome);
        if (!dp) continue;
        const mapping = (screenOverrides[layer.id]?.domeMapping ?? 'wrap') as DomeMapping;

        const group = new THREE.Group();
        group.position.set(dome.centerX, dome.centerY, dome.centerZ);
        group.userData = { layerId: layer.id, kind: 'led-screen' };

        const material = new THREE.ShaderMaterial({
          uniforms: ledMaterialUniforms(),
          vertexShader: LED_VERTEX,
          fragmentShader: LED_FRAGMENT,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const geometry = buildDomeSectorGeometry(dome, dp.u0, dp.u1, dp.yTop, dp.yBottom, mapping);
        const surface = new THREE.Mesh(geometry, material);
        surface.userData = { layerId: layer.id };
        group.add(surface);
        this.scene.add(group);

        // Glow light sits on the sector's mid-direction, inside the
        // dome, aimed at the bowl. Sized to the sector chord (capped —
        // a full dome's 200m chord would blow the area-light math).
        ensureRectAreaLightUniforms();
        const azMid = ((dp.u0 + dp.u1) / 2 - 0.5) * dome.hSweepDeg;
        const vRange = dome.vEndDeg - dome.vStartDeg;
        const elMid = dome.vEndDeg - ((dp.yTop + dp.yBottom) / 2) * vRange;
        const midDir = domeDirection(azMid, elMid);
        const lightOffset: [number, number, number] = [
          midDir[0] * dome.radius * 0.85,
          midDir[1] * dome.radius * 0.85,
          midDir[2] * dome.radius * 0.85,
        ];
        // Aim at the bowl centre (≈[0, 6, 5] world), expressed local to
        // the group (which sits at the dome centre).
        const lightTarget: [number, number, number] = [
          -dome.centerX, 6 - dome.centerY, 5 - dome.centerZ,
        ];
        const ambientLight = new THREE.RectAreaLight(
          0xffffff, 0, Math.min(40, dp.chordW), Math.min(40, dp.chordH),
        );
        ambientLight.position.set(
          dome.centerX + lightOffset[0],
          dome.centerY + lightOffset[1],
          dome.centerZ + lightOffset[2],
        );
        ambientLight.lookAt(
          dome.centerX + lightTarget[0],
          dome.centerY + lightTarget[1],
          dome.centerZ + lightTarget[2],
        );
        this.scene.add(ambientLight);
        const averageRT = new THREE.WebGLRenderTarget(1, 1, {
          format: THREE.RGBAFormat,
          type: THREE.UnsignedByteType,
          depthBuffer: false,
          stencilBuffer: false,
        });

        this.ledEntries.push({
          layer, group, surface, material,
          defaultPosition: [dome.centerX, dome.centerY, dome.centerZ],
          defaultWidth: dp.chordW,
          defaultHeight: dp.chordH,
          dome: { u0: dp.u0, u1: dp.u1, yTop: dp.yTop, yBottom: dp.yBottom, mapping, lightOffset, lightTarget },
          ambientLight, averageRT,
          averagePixels: new Uint8Array(4),
          stageFxBrightness: 1,
          stageFxTint: new THREE.Color(1, 1, 1),
        });
        this.ledByLayerId.set(layer.id, this.ledEntries[this.ledEntries.length - 1]);
        continue;
      }

      const placement = screenLayerPlacement(layer, wall!);
      if (!placement) continue;

      const group = new THREE.Group();
      group.position.set(...placement.position);
      group.userData = { layerId: layer.id, kind: 'led-screen' };

      const material = new THREE.ShaderMaterial({
        uniforms: ledMaterialUniforms(),
        vertexShader: LED_VERTEX,
        fragmentShader: LED_FRAGMENT,
        side: THREE.DoubleSide,
        toneMapped: false,
      });

      const shape = buildShapeFromLayer(layer, placement.width, placement.height);
      const geometry = shape
        ? new THREE.ShapeGeometry(shape, 18)
        : new THREE.PlaneGeometry(placement.width, placement.height);
      if (shape) {
        const pos = geometry.attributes.position;
        const uvAttr = geometry.attributes.uv;
        if (uvAttr) {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i), y = pos.getY(i);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
          const rx = Math.max(0.0001, maxX - minX);
          const ry = Math.max(0.0001, maxY - minY);
          for (let i = 0; i < uvAttr.count; i++) {
            uvAttr.setXY(i, (pos.getX(i) - minX) / rx, (pos.getY(i) - minY) / ry);
          }
          uvAttr.needsUpdate = true;
        }
        geometry.computeVertexNormals();
      }
      const surface = new THREE.Mesh(geometry, material);
      surface.userData = { layerId: layer.id };
      group.add(surface);

      this.scene.add(group);

      // Per-LED reactive AREA light + its average-colour readback RT.
      // A RectAreaLight the size of the panel, facing the audience and
      // tilted slightly down, emits like the LED wall itself — a soft
      // wash over the deck and fixtures. (Was a PointLight 6m out,
      // which collapsed all that emission into a hard spotlight pool.)
      ensureRectAreaLightUniforms();
      const ambientLight = new THREE.RectAreaLight(
        0xffffff, 0, placement.width, placement.height,
      );
      ambientLight.position.set(
        placement.position[0],
        placement.position[1],
        placement.position[2] + 0.3,
      );
      // Aim forward (toward the audience) with a slight downward tilt so
      // the wash favours the deck in front of the wall.
      ambientLight.lookAt(
        placement.position[0],
        placement.position[1] - placement.height * 0.6,
        placement.position[2] + 12,
      );
      this.scene.add(ambientLight);
      const averageRT = new THREE.WebGLRenderTarget(1, 1, {
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
      });
      const averagePixels = new Uint8Array(4);

      const entry: LedEntry = {
        layer, group, surface, material,
        defaultPosition: placement.position,
        defaultWidth: placement.width,
        defaultHeight: placement.height,
        ambientLight, averageRT, averagePixels,
        stageFxBrightness: 1,
        stageFxTint: new THREE.Color(1, 1, 1),
      };
      this.ledEntries.push(entry);
      this.ledByLayerId.set(layer.id, entry);
    }
    console.log(`[Stage3D] Built ${this.ledEntries.length} LED screen(s) from project layers`);
    this.applySelection(get(selectedStage3DNodeId));
  }

  /** Lazily build the shared downsample apparatus. One scene + ortho
   *  camera + averaging shader is reused for every LED's per-frame
   *  read; only the input texture uniform swaps. */
  private ensureDownsample(): void {
    if (this.downsampleScene) return;
    this.downsampleScene = new THREE.Scene();
    this.downsampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.downsampleMaterial = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null as THREE.Texture | null } },
      vertexShader: `
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D uSrc;
        void main() {
          // 8×8 grid sample = 64 reads. Good-enough average for a
          // light's colour; cheaper than a true mip-pyramid chain.
          vec3 avg = vec3(0.0);
          const float N = 8.0;
          for (float y = 0.0; y < N; y++) {
            for (float x = 0.0; x < N; x++) {
              avg += texture2D(uSrc, vec2((x + 0.5) / N, (y + 0.5) / N)).rgb;
            }
          }
          gl_FragColor = vec4(avg / (N * N), 1.0);
        }
      `,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.downsampleMaterial);
    quad.frustumCulled = false;
    this.downsampleScene.add(quad);
  }

  /** Walk a subtree and register any material whose userData.role is
   *  'truss' so the trussColor override can recolour them. Cheap once
   *  per venue swap / element rebuild. */
  private collectTrussMaterials(root: THREE.Object3D): void {
    root.traverse((obj: any) => {
      const mats = Array.isArray(obj.material) ? obj.material : (obj.material ? [obj.material] : []);
      for (const mat of mats) {
        if (mat?.userData?.role === 'truss' && mat instanceof THREE.MeshStandardMaterial) {
          this.trussMaterials.add(mat);
        }
      }
    });
  }

  // ── User-element sync ────────────────────────────────────────────────

  private syncUserElements(elements: UserStageElement[]): void {
    const liveIds = new Set(elements.map(e => e.id));
    for (const [id, entry] of [...this.elementEntries]) {
      if (!liveIds.has(id)) {
        this.scene.remove(entry.group);
        disposeObject(entry.group);
        this.elementEntries.delete(id);
        this.userStripsDirty = true;
      }
    }
    for (const el of elements) {
      const existing = this.elementEntries.get(el.id);
      const sig = elementSignature(el);
      if (!existing) {
        const group = buildUserElement(el);
        this.scene.add(group);
        this.elementEntries.set(el.id, { element: el, group, signature: sig });
        this.collectTrussMaterials(group);
        this.userStripsDirty = true;
      } else if (existing.signature !== sig) {
        // Params changed — rebuild children but preserve the wrapping
        // group so the gizmo stays attached.
        for (let i = existing.group.children.length - 1; i >= 0; i--) {
          const ch = existing.group.children[i];
          existing.group.remove(ch);
          disposeObject(ch);
        }
        const rebuilt = buildUserElement(el);
        while (rebuilt.children.length) existing.group.add(rebuilt.children[0]);
        existing.element = el;
        existing.signature = sig;
        existing.group.position.set(el.position[0], el.position[1], el.position[2]);
        existing.group.rotation.y = el.rotationY;
        existing.group.scale.setScalar(el.scale);
        // Re-tag any new truss materials.
        this.collectTrussMaterials(existing.group);
        this.userStripsDirty = true;
      } else {
        // Skip transform write when this entry is being driven by the
        // multi-select pivot or actively dragged by the gizmo.
        const pivoted = this.pivotedIds.has(el.id);
        const beingDragged = this.gizmoDragging && this.transformControls.object === existing.group;
        if (!pivoted && !beingDragged) {
          existing.group.position.set(el.position[0], el.position[1], el.position[2]);
          existing.group.rotation.y = el.rotationY;
          existing.group.scale.setScalar(el.scale);
        }
        existing.element = el;
      }
    }
  }

  // ── Selection ────────────────────────────────────────────────────────

  private updateSelectionOutline(): void {
    const selectedKeys = get(selectedStage3DTargets);
    const primary = get(selectedStage3DNodeId);
    // Drop outlines whose target is no longer selected (or whose group
    // no longer resolves).
    for (const [key, helper] of [...this.selectionOutlines]) {
      const target = this.resolveTargetGroup(key);
      if (!selectedKeys.has(key) || !target) {
        this.scene.remove(helper);
        helper.geometry.dispose();
        (helper.material as THREE.Material).dispose();
        this.selectionOutlines.delete(key);
      }
    }
    // Add / update outlines for each selected target. Primary = cyan,
    // secondary = purple so multi-select state is visually obvious.
    for (const key of selectedKeys) {
      const target = this.resolveTargetGroup(key);
      if (!target) continue;
      let helper = this.selectionOutlines.get(key);
      const color = key === primary ? 0x4af2ff : 0xbb86fc;
      if (!helper) {
        helper = new THREE.BoxHelper(target, color);
        this.selectionOutlines.set(key, helper);
        this.scene.add(helper);
      } else {
        (helper.material as THREE.LineBasicMaterial).color.setHex(color);
      }
      helper.setFromObject(target);
    }
  }

  /** Resolve a selection key (`screen:<id>` / `element:<id>` /
   *  `scenery:<id>`) to the underlying THREE.Group, regardless of
   *  whether it currently lives in the scene or under the multi-select
   *  pivot. */
  private resolveTargetGroup(key: string): THREE.Object3D | null {
    const sel = parseSelection(key);
    if (!sel) return null;
    if (sel.kind === 'screen') return this.ledByLayerId.get(sel.id)?.group ?? null;
    if (sel.kind === 'element') return this.elementEntries.get(sel.id)?.group ?? null;
    return this.sceneryEntries.get(sel.id)?.group ?? null;
  }

  /** Build / rebuild the gizmo attachment based on the current
   *  selection set. Single selection → attach gizmo directly. Multi
   *  selection → create a pivot Group at the centroid, attach all
   *  targets to it via .attach() so they move/rotate/scale as a unit. */
  private applySelection(_target: string | null): void {
    // Always dismantle the previous pivot first — reparents children
    // back to the scene preserving world transforms.
    this.dismantlePivot();
    this.transformControls.detach();

    const targets = [...get(selectedStage3DTargets)]
      .map(key => ({ key, group: this.resolveTargetGroup(key) }))
      .filter((t): t is { key: string; group: THREE.Group } => t.group !== null);

    if (targets.length === 0) return;
    if (targets.length === 1) {
      this.transformControls.attach(targets[0].group);
      this.transformControls.setMode(get(stage3DGizmoMode));
      return;
    }

    // Multi — pivot at centroid.
    const centroid = new THREE.Vector3();
    for (const t of targets) centroid.add(t.group.getWorldPosition(new THREE.Vector3()));
    centroid.divideScalar(targets.length);

    const pivot = new THREE.Group();
    pivot.position.copy(centroid);
    this.scene.add(pivot);
    this.gizmoPivot = pivot;

    // attach() reads matrixWorld to preserve world transforms — force a
    // refresh so reparented children land in the correct local space.
    this.scene.updateMatrixWorld(true);
    for (const t of targets) {
      pivot.attach(t.group);
      const sel = parseSelection(t.key);
      if (sel) this.pivotedIds.add(sel.id);
    }
    this.transformControls.attach(pivot);
    this.transformControls.setMode(get(stage3DGizmoMode));
  }

  private dismantlePivot(): void {
    if (!this.gizmoPivot) {
      this.pivotedIds.clear();
      return;
    }
    // Reattach each child back to the scene, preserving world transform.
    const children = [...this.gizmoPivot.children];
    for (const c of children) this.scene.attach(c);
    this.scene.remove(this.gizmoPivot);
    this.gizmoPivot = null;
    this.pivotedIds.clear();
  }

  // ── Pointer / keyboard ───────────────────────────────────────────────

  private onPointerDown(event: PointerEvent): void {
    if ((this.transformControls as any).dragging) return;
    this.pointerDownPos = { x: event.clientX, y: event.clientY };
    const additive = event.shiftKey || event.metaKey;
    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener('pointerup', onUp);
      if (!this.pointerDownPos) return;
      const dx = upEvent.clientX - this.pointerDownPos.x;
      const dy = upEvent.clientY - this.pointerDownPos.y;
      this.pointerDownPos = null;
      if (Math.hypot(dx, dy) > 5) return;
      this.pickAt(upEvent.clientX, upEvent.clientY, additive);
    };
    window.addEventListener('pointerup', onUp);
  }

  private pickAt(clientX: number, clientY: number, additive: boolean): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNDC.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.raycaster.setFromCamera(this.pointerNDC, this.camera);
    // Also raycast against the venue group so trusses/deck/fixtures
    // become pickable. Sourced from sceneryEntries' indexed groups so
    // we never snag hidden (deleted) or pivot-wrapped pieces.
    const targets: THREE.Object3D[] = [];
    for (const e of this.ledEntries) targets.push(e.surface);
    for (const e of this.elementEntries.values()) targets.push(e.group);
    for (const e of this.sceneryEntries.values()) {
      if (e.group.visible) targets.push(e.group);
    }
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length === 0) {
      if (!additive) this.selectNode(null);
      return;
    }
    let o: THREE.Object3D | null = hits[0].object;
    while (o) {
      if (o.userData?.layerId)    { this.selectNode(`screen:${o.userData.layerId}`,   additive); return; }
      if (o.userData?.elementId)  { this.selectNode(`element:${o.userData.elementId}`, additive); return; }
      if (o.userData?.sceneryId)  { this.selectNode(`scenery:${o.userData.sceneryId}`, additive); return; }
      o = o.parent;
    }
    if (!additive) this.selectNode(null);
  }

  private onKeyDown(event: KeyboardEvent): void {
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const k = event.key.toLowerCase();
    if (k === 'w' || k === 'g') { this.setGizmoMode('translate'); }
    else if (k === 'e' || k === 'r') { this.setGizmoMode('rotate'); }
    else if (k === 's') { this.setGizmoMode('scale'); }
    else if (k === 'd') { this.duplicateSelection(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') { this.deleteSelection(); }
    else if (event.key === 'Escape') { this.selectNode(null); }
    // Camera flight: ↑/↓ raise/lower the rig, ←/→ truck sideways.
    // Handled here (not OrbitControls.listenToKeyEvents) so typing in
    // panel inputs never pans, thanks to the tag guard above.
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.nudgeElevation(1); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); this.nudgeElevation(-1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.truck(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  /** Camera FOV in degrees — clamped to a usable creative range. Wide
   *  (90–120°) is how you swallow the whole Sphere dome in one frame;
   *  narrow (15–25°) gives a compressed long-lens look. */
  private setFov(fov: number): void {
    this.camera.fov = Math.max(15, Math.min(120, fov));
    this.camera.updateProjectionMatrix();
    stage3DCameraFov.set(this.camera.fov);
  }

  /** Move camera + orbit target straight up/down in world space. Step
   *  scales with distance to target so the move feels the same whether
   *  you're inside the dome or framing the whole venue. */
  private nudgeElevation(dir: 1 | -1): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const step = Math.max(0.5, dist * 0.06) * dir;
    this.camera.position.y += step;
    this.controls.target.y += step;
  }

  /** Truck sideways along the camera's right vector (ground-parallel). */
  private truck(dir: 1 | -1): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const step = Math.max(0.5, dist * 0.06) * dir;
    const right = new THREE.Vector3();
    this.camera.getWorldDirection(right);
    right.cross(this.camera.up).normalize();
    this.camera.position.addScaledVector(right, step);
    this.controls.target.addScaledVector(right, step);
  }

  /** Shift+scroll adjusts FOV instead of dollying. Capture-phase with
   *  stopPropagation so OrbitControls' wheel handler doesn't also fire. */
  private onWheel(event: WheelEvent): void {
    if (!event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    this.setFov(this.camera.fov + (event.deltaY > 0 ? 2 : -2));
  }

  private onTransformDraggingChanged(event: any): void {
    this.controls.enabled = !event.value;
    this.gizmoDragging = !!event.value;
    // When drag ends in multi mode, dismantle the pivot so subsequent
    // single-clicks attach the gizmo to a single target cleanly.
    if (!event.value && this.gizmoPivot) {
      this.persistAllSelected();
      this.dismantlePivot();
      // Restore single-target gizmo on whatever is the primary.
      this.applySelection(get(selectedStage3DNodeId));
    }
  }

  private onTransformChange(): void {
    // Refresh every active outline so they track the dragged targets.
    for (const [key, helper] of this.selectionOutlines) {
      const target = this.resolveTargetGroup(key);
      if (target) helper.setFromObject(target);
    }
    // Persist on EVERY change (not just drag-end) so the per-frame
    // override write in render() matches the gizmo's current transform.
    // Without this, render() snaps the group back to the stored
    // override and the gizmo appears frozen. snapshot() coalesces
    // within 400ms so slider drags don't flood undo history.
    if (this.gizmoDragging) this.persistAllSelected();
  }

  /** Walk every selected target, sample its WORLD transform, and write
   *  back to the store. Works for single + multi selections; safe to
   *  call mid-drag or on drag-end. */
  private persistAllSelected(): void {
    const targets = get(selectedStage3DTargets);
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3();
    const we = new THREE.Euler();
    for (const key of targets) {
      const sel = parseSelection(key);
      if (!sel) continue;
      // Use the unified resolver — the previous inline lookup only
      // handled screen/element, so scenery groups resolved to undefined
      // and their drag was never persisted (the render loop then snapped
      // the piece back to its baseline every frame).
      const group = this.resolveTargetGroup(key);
      if (!group) continue;
      group.getWorldPosition(wp);
      group.getWorldQuaternion(wq);
      group.getWorldScale(ws);
      we.setFromQuaternion(wq, 'XYZ');
      if (sel.kind === 'screen') {
        const entry = this.ledByLayerId.get(sel.id);
        if (!entry) continue;
        stage3dScene.setScreenOverride(entry.layer.id, {
          position: [wp.x, wp.y, wp.z],
          rotation: [we.x, we.y, we.z],
          scale:    [ws.x, ws.y, ws.z],
        });
      } else if (sel.kind === 'element') {
        const entry = this.elementEntries.get(sel.id);
        if (!entry) continue;
        stage3dScene.setUserElementTransform(entry.element.id, {
          position: [wp.x, wp.y, wp.z],
          rotationY: we.y,
          scale: ws.x,
        });
      } else if (sel.kind === 'scenery') {
        stage3dScene.setSceneryOverride(sel.id, {
          position: [wp.x, wp.y, wp.z],
          rotation: [we.x, we.y, we.z],
          scale:    [ws.x, ws.y, ws.z],
        });
      }
    }
  }
}
