// SVG Layer Renderer - Three.js based animated SVG rendering
// Ported from the standalone SVG animator

import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { SVGContent } from '../types';

// ============================================================================
// TYPES
// ============================================================================

interface ParsedPolygon {
  id: number;
  points: THREE.Vector3[];
  centroid: THREE.Vector3;
  bounds: { min: THREE.Vector3; max: THREE.Vector3; width: number; height: number };
  edges: { start: THREE.Vector3; end: THREE.Vector3; polyId: number }[];
  perimeter: number;
  fillPhase: number;
  breathPhase: number;
  colorHue: number;
  colorSat: number;
  colorLight: number;
}

interface EdgeData {
  start: THREE.Vector3;
  end: THREE.Vector3;
  polyId: number;
  edgeId: number;
}

interface SharedVertex {
  pos: THREE.Vector3;
  polygons: number[];
}

// Color palettes for different shapes
const shapeColors = [
  { h: 0, s: 0.8, l: 0.5 },    // red
  { h: 20, s: 0.9, l: 0.5 },   // orange
  { h: 280, s: 0.7, l: 0.5 },  // purple
  { h: 200, s: 0.8, l: 0.5 },  // blue
  { h: 340, s: 0.85, l: 0.5 }, // pink
  { h: 40, s: 0.9, l: 0.55 },  // gold
  { h: 180, s: 0.7, l: 0.45 }, // teal
  { h: 320, s: 0.75, l: 0.5 }, // magenta
];

// ============================================================================
// SHADERS
// ============================================================================

const NebulaShader = {
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform float uTime, uIntensity, uSpeed;
    varying vec2 vUv;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
      const vec2 C = vec2(1.0/6.0, 1.0/3.0);
      const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy));
      vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz);
      vec3 l = 1.0 - g;
      vec3 i1 = min(g.xyz, l.zxy);
      vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx;
      vec3 x2 = x0 - i2 + C.yyy;
      vec3 x3 = x0 - D.yyy;
      i = mod289(i);
      vec4 p = permute(permute(permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0))
        + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 0.142857142857;
      vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
      vec4 x_ = floor(j * ns.z);
      vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ *ns.x + ns.yyyy;
      vec4 y = y_ *ns.x + ns.yyyy;
      vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy);
      vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0)*2.0 + 1.0;
      vec4 s1 = floor(b1)*2.0 + 1.0;
      vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
      vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x);
      vec3 p1 = vec3(a0.zw, h.y);
      vec3 p2 = vec3(a1.xy, h.z);
      vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
      p0 *= norm.x;
      p1 *= norm.y;
      p2 *= norm.z;
      p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
      m = m * m;
      return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
    }

    void main() {
      float t = uTime * uSpeed;
      vec2 uv = vUv * 2.0 - 1.0;
      float n1 = snoise(vec3(uv * 0.5, t * 0.1)) * 0.5 + 0.5;
      float n2 = snoise(vec3(uv * 0.8 + 100.0, t * 0.15)) * 0.5 + 0.5;
      float n3 = snoise(vec3(uv * 1.2 + 200.0, t * 0.2)) * 0.5 + 0.5;
      vec3 c1 = vec3(0.1, 0.0, 0.2);
      vec3 c2 = vec3(0.0, 0.05, 0.15);
      vec3 c3 = vec3(0.15, 0.0, 0.1);
      vec3 color = c1 * n1 + c2 * n2 + c3 * n3;
      color *= uIntensity;
      gl_FragColor = vec4(color, 1.0);
    }
  `
};

// Fill shader with multiple modes
const FillShader = {
  vertexShader: `
    varying vec2 vUv;
    varying vec3 vPosition;
    void main() {
      vUv = uv;
      vPosition = position;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    precision highp float;
    uniform float uTime;
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform int uFillMode;
    uniform float uFillLevel;
    uniform float uWaveAmp;
    uniform float uWaveSpeed;
    uniform vec2 uBoundsMin;
    uniform vec2 uBoundsMax;
    uniform float uGradientAngle;
    uniform float uGradientSpread;
    uniform float uShimmerSpeed;
    uniform float uShimmerScale;
    uniform float uShimmerIntensity;
    uniform float uPulseSpeed;
    uniform float uPulseRingScale;
    uniform float uPulseRingSpeed;
    uniform float uNoiseScale;
    uniform float uNoiseSpeed;
    uniform float uNoiseContrast;
    uniform float uHeartbeat;
    uniform float uFluidScale;
    uniform float uFluidSpeed;
    uniform float uFluidTurbulence;

    varying vec2 vUv;
    varying vec3 vPosition;

    #define PI 3.14159265359

    float random(vec2 st) {
      return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float noise(vec2 st) {
      vec2 i = floor(st);
      vec2 f = fract(st);
      float a = random(i);
      float b = random(i + vec2(1.0, 0.0));
      float c = random(i + vec2(0.0, 1.0));
      float d = random(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }

    float fbm(vec2 st) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 5; i++) {
        value += amplitude * noise(st);
        st *= 2.0;
        amplitude *= 0.5;
      }
      return value;
    }

    void main() {
      vec2 size = uBoundsMax - uBoundsMin;
      vec2 localUV = (vPosition.xy - uBoundsMin) / size;

      vec4 color = vec4(uColor, uOpacity);

      // Apply heartbeat effect
      float heartbeatScale = 1.0 + uHeartbeat * 0.1;

      if (uFillMode == 0) {
        // Liquid fill
        float wave = sin(localUV.x * 10.0 + uTime * uWaveSpeed) * uWaveAmp;
        wave += sin(localUV.x * 7.0 - uTime * uWaveSpeed * 0.7) * uWaveAmp * 0.5;
        float fillY = uFillLevel + wave;
        float alpha = smoothstep(fillY - 0.02, fillY + 0.02, localUV.y);
        color.a *= (1.0 - alpha);
      } else if (uFillMode == 1) {
        // Solid fill - just use color as is
      } else if (uFillMode == 2) {
        // Gradient fill
        float angle = uGradientAngle * PI / 180.0;
        vec2 dir = vec2(cos(angle), sin(angle));
        float t = dot(localUV - 0.5, dir) + 0.5;
        float hueShift = (t - 0.5) * uGradientSpread;
        // Simple hue shift approximation
        color.rgb = mix(color.rgb * 0.7, color.rgb * 1.3, t);
      } else if (uFillMode == 3) {
        // Shimmer
        float shimmer = noise(localUV * uShimmerScale * 100.0 + uTime * uShimmerSpeed);
        shimmer = pow(shimmer, 2.0) * uShimmerIntensity;
        color.rgb += shimmer;
      } else if (uFillMode == 4) {
        // Pulse
        float dist = length(localUV - 0.5) * 2.0;
        float rings = sin(dist * uPulseRingScale - uTime * uPulseRingSpeed) * 0.5 + 0.5;
        float pulse = sin(uTime * uPulseSpeed) * 0.5 + 0.5;
        color.rgb *= (0.5 + rings * 0.5) * (0.7 + pulse * 0.3);
      } else if (uFillMode == 5) {
        // Noise (FBM)
        float n = fbm(localUV * uNoiseScale * 50.0 + uTime * uNoiseSpeed);
        n = mix(0.5, n, uNoiseContrast);
        color.rgb *= n * 2.0;
      } else if (uFillMode == 6) {
        // Particles (animated dots)
        vec2 grid = fract(localUV * 20.0 + uTime * 0.1);
        float particle = smoothstep(0.1, 0.0, length(grid - 0.5));
        color.rgb += particle * 0.5;
      } else if (uFillMode == 7) {
        // Fluid — curl/domain-warped FBM advection. Two coupled noise
        // fields warp the sample point over time so the fill reads like
        // a slow, organic flowing liquid rather than a static gradient.
        float t = uTime * uFluidSpeed;
        vec2 p = localUV * uFluidScale;
        vec2 q = vec2(fbm(p + vec2(0.0, 0.0)), fbm(p + vec2(5.2, 1.3)));
        vec2 r = vec2(
          fbm(p + uFluidTurbulence * q + vec2(1.7, 9.2) + 0.15 * t),
          fbm(p + uFluidTurbulence * q + vec2(8.3, 2.8) + 0.126 * t)
        );
        float f = fbm(p + uFluidTurbulence * r);
        float v = clamp(f * 1.6, 0.0, 1.0);
        // Mix darker→base→hot so the flow has visible structure + highlights.
        vec3 hot = min(color.rgb * 1.8 + 0.15, vec3(1.0));
        color.rgb = mix(color.rgb * 0.35, hot, smoothstep(0.2, 0.9, v));
        color.rgb += pow(max(v - 0.7, 0.0), 2.0) * 0.8; // bright filaments
      } else if (uFillMode == 8) {
        // Flow — directional advected bands (a flow field reading like
        // brushed energy moving across the shape).
        float t = uTime * uFluidSpeed;
        vec2 p = localUV * uFluidScale;
        float flow = fbm(p + vec2(t * 0.6, 0.0) + uFluidTurbulence * fbm(p * 1.7));
        float bands = 0.5 + 0.5 * sin((localUV.x + localUV.y) * 12.0 + flow * 8.0 - t * 3.0);
        color.rgb *= 0.5 + 0.9 * bands;
        color.rgb += pow(bands, 6.0) * 0.6;
      }

      gl_FragColor = color;
    }
  `
};

// ============================================================================
// SVG LAYER RENDERER CLASS
// ============================================================================

export class SVGLayerRenderer {
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private renderer: THREE.WebGLRenderer;
  private renderTarget: THREE.WebGLRenderTarget;
  private ownsRenderer: boolean;

  private mainGroup: THREE.Group;

  // Parsed geometry
  private polygons: ParsedPolygon[] = [];
  private allEdges: EdgeData[] = [];
  private sharedVertices: SharedVertex[] = [];
  private allVertices: THREE.Vector3[] = [];
  private edgeConnections: Map<number, number[]> = new Map();

  // Visual elements
  private outlines: THREE.Object3D[] = [];
  private liquidFills: THREE.Mesh[] = [];
  private glowNodes: THREE.Mesh[] = [];
  private energyPulses: THREE.Mesh[] = [];
  private connectionLines: THREE.Object3D[] = [];
  private ripples: THREE.Mesh[] = [];
  private lightningBolts: THREE.Line[] = [];
  private edgeFlowLines: THREE.Object3D[] = [];
  private innerGlows: THREE.Mesh[] = [];
  private nebulaPlanes: THREE.Mesh[] = [];
  private plasmaTendrils: THREE.Line[] = [];
  private echoLayers: THREE.Object3D[] = [];
  private arcBridges: THREE.Object3D[] = [];
  private particles: THREE.Points | null = null;
  private particleLinkPool: Line2[] = [];
  // Real volumetric fill particles (live INSIDE the shapes), distinct from
  // the edge-running `particles` system above.
  private fillParticles: THREE.Points | null = null;
  // 3D extruded shape solids (extrude render mode). Tracked separately from
  // `liquidFills` (flat shader planes) so animate() doesn't poke PBR meshes
  // with shader uniforms.
  private extrudeMeshes: THREE.Mesh[] = [];

  // ── 3D mode: perspective camera + light rig + IBL + bloom ────────────
  private perspCamera: THREE.PerspectiveCamera;
  private lightRig: THREE.Group;
  private pmrem: THREE.PMREMGenerator | null = null;
  private envTexture: THREE.Texture | null = null;
  private envRequested = false;
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private composerFailed = false;

  // Animation state
  private animationTime = 0;
  // Auto-spin accumulators (kept separate from mainGroup.rotation so the
  // manual base orientation can be added on top each frame).
  private spinX = 0;
  private spinY = 0;
  private spinZ = 0;
  private heartbeatPhase = 0;
  private colorCycleOffset = 0;
  private frameCount = 0;

  // Dimensions
  private width: number;
  private height: number;
  private initialWidth: number;
  private initialHeight: number;
  private svgWidth = 1000;
  private svgHeight = 1000;
  private svgMinX = 0;  // viewBox minX offset
  private svgMinY = 0;  // viewBox minY offset
  private scaleX = 0.55;
  private scaleY = 0.55;
  private sceneRoot: THREE.Group;

  constructor(width: number, height: number, externalRenderer?: THREE.WebGLRenderer) {
    // Ensure dimensions are valid integers (at least 1 pixel)
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));

    this.width = width;
    this.height = height;
    this.initialWidth = width;
    this.initialHeight = height;

    // Use external renderer if provided, otherwise create our own
    if (externalRenderer) {
      this.renderer = externalRenderer;
      this.ownsRenderer = false;
    } else {
      this.renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance'
      });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(1);
      this.ownsRenderer = true;
    }
    // Note: Don't set pixel ratio on shared renderer - it's already configured by the main engine

    // Create render target for output (always uses actual pixel dimensions, not affected by pixel ratio)
    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    // Create scene and camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);

    // Camera frustum matches render target dimensions exactly
    // Y-down convention to match SVG coordinates (top is negative, bottom is positive)
    // This combined with NOT negating Y in parsePolygonPoints produces correct orientation
    this.camera = new THREE.OrthographicCamera(
      -width / 2, width / 2,
      -height / 2, height / 2,
      1, 1000
    );
    this.camera.position.z = 500;

    // Perspective camera for the 3D extrude mode. Positioned so the z=0
    // plane frames identically to the ortho camera (camZ derived from FOV),
    // so toggling render modes doesn't jump the framing — rotation then
    // reveals the depth. Y-down to match the ortho/SVG convention (we look
    // from +Z toward -Z with an inverted up vector).
    this.perspCamera = new THREE.PerspectiveCamera(40, width / height, 1, 5000);
    this.updatePerspectiveCamera(40);

    // Light rig lives in scene space (NOT inside mainGroup) so the content
    // can rotate THROUGH the lighting. Populated per-preset in buildScene.
    this.lightRig = new THREE.Group();
    this.scene.add(this.lightRig);

    // Create scene root group that will be scaled on resize
    this.sceneRoot = new THREE.Group();
    this.scene.add(this.sceneRoot);

    // Create main group inside scene root
    this.mainGroup = new THREE.Group();
    this.sceneRoot.add(this.mainGroup);
  }

  /** Place the perspective camera so the world z=0 plane subtends exactly
   *  `height` vertically — i.e. matches the orthographic framing — for the
   *  given vertical FOV. Looking down -Z with a Y-down up vector. */
  private updatePerspectiveCamera(fovDeg: number): void {
    const fov = THREE.MathUtils.degToRad(fovDeg);
    const camZ = (this.height / 2) / Math.tan(fov / 2);
    this.perspCamera.fov = fovDeg;
    this.perspCamera.aspect = this.width / this.height;
    this.perspCamera.position.set(0, 0, camZ);
    this.perspCamera.up.set(0, -1, 0); // Y-down convention
    this.perspCamera.lookAt(0, 0, 0);
    this.perspCamera.near = Math.max(1, camZ - this.height * 2);
    this.perspCamera.far = camZ + this.height * 4;
    this.perspCamera.updateProjectionMatrix();
  }

  // Parse SVG source and extract polygons
  parseSVG(svgSource: string): void {
    if (!svgSource) return;

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgSource, 'image/svg+xml');

    // Get viewBox dimensions
    const svg = doc.querySelector('svg');
    if (svg) {
      const viewBox = svg.getAttribute('viewBox');
      if (viewBox) {
        // ViewBox format: minX minY width height (can be space or comma separated)
        const parts = viewBox.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        if (parts.length >= 4) {
          this.svgMinX = parts[0];
          this.svgMinY = parts[1];
          this.svgWidth = parts[2];
          this.svgHeight = parts[3];
        }
      } else {
        // Reset to defaults if no viewBox
        this.svgMinX = 0;
        this.svgMinY = 0;
      }

      // Also try width/height attributes if no viewBox
      const w = svg.getAttribute('width');
      const h = svg.getAttribute('height');
      if (w && h && !viewBox) {
        this.svgWidth = parseFloat(w) || 1000;
        this.svgHeight = parseFloat(h) || 1000;
        this.svgMinX = 0;
        this.svgMinY = 0;
      }
    }

    // Store the initial dimensions when SVG is parsed - geometry is built for these dimensions
    this.initialWidth = this.width;
    this.initialHeight = this.height;
    // Reset rebuild flag since we're rebuilding now
    this._needsRebuild = false;
    // Reset scene root scale since we're rebuilding geometry for current size
    this.sceneRoot.scale.set(1, 1, 1);

    // Calculate scale using "contain" behavior (uniform scale to fit without cropping)
    // This will be recalculated after we get actual content bounds
    const initialScaleX = this.width / this.svgWidth;
    const initialScaleY = this.height / this.svgHeight;
    const initialUniformScale = Math.min(initialScaleX, initialScaleY);
    this.scaleX = initialUniformScale;
    this.scaleY = initialUniformScale;

    // Debug logging moved to after we calculate actual content bounds

    // Parse polygons
    const svgPolygons: { points: string; fill: boolean; id: number }[] = [];

    // Parse polygon elements
    doc.querySelectorAll('polygon').forEach((poly, idx) => {
      const points = poly.getAttribute('points');
      if (points) {
        svgPolygons.push({ points, fill: true, id: idx });
      }
    });

    // Parse polyline elements
    doc.querySelectorAll('polyline').forEach((poly, _idx) => {
      const points = poly.getAttribute('points');
      if (points) {
        svgPolygons.push({ points, fill: false, id: svgPolygons.length });
      }
    });

    // Parse rect elements (convert to polygon points)
    doc.querySelectorAll('rect').forEach((rect, _idx) => {
      const x = parseFloat(rect.getAttribute('x') || '0');
      const y = parseFloat(rect.getAttribute('y') || '0');
      const w = parseFloat(rect.getAttribute('width') || '0');
      const h = parseFloat(rect.getAttribute('height') || '0');
      if (w > 0 && h > 0) {
        const points = `${x},${y} ${x + w},${y} ${x + w},${y + h} ${x},${y + h}`;
        svgPolygons.push({ points, fill: true, id: svgPolygons.length });
      }
    });

    // Parse circle elements (approximate as polygon)
    doc.querySelectorAll('circle').forEach((circle, _idx) => {
      const cx = parseFloat(circle.getAttribute('cx') || '0');
      const cy = parseFloat(circle.getAttribute('cy') || '0');
      const r = parseFloat(circle.getAttribute('r') || '0');
      if (r > 0) {
        const segments = 32;
        const pts: string[] = [];
        for (let i = 0; i < segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          pts.push(`${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`);
        }
        svgPolygons.push({ points: pts.join(' '), fill: true, id: svgPolygons.length });
      }
    });

    // Parse ellipse elements (approximate as polygon)
    doc.querySelectorAll('ellipse').forEach((ellipse, _idx) => {
      const cx = parseFloat(ellipse.getAttribute('cx') || '0');
      const cy = parseFloat(ellipse.getAttribute('cy') || '0');
      const rx = parseFloat(ellipse.getAttribute('rx') || '0');
      const ry = parseFloat(ellipse.getAttribute('ry') || '0');
      if (rx > 0 && ry > 0) {
        const segments = 32;
        const pts: string[] = [];
        for (let i = 0; i < segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          pts.push(`${cx + Math.cos(angle) * rx},${cy + Math.sin(angle) * ry}`);
        }
        svgPolygons.push({ points: pts.join(' '), fill: true, id: svgPolygons.length });
      }
    });

    // Parse line elements
    doc.querySelectorAll('line').forEach((line, _idx) => {
      const x1 = parseFloat(line.getAttribute('x1') || '0');
      const y1 = parseFloat(line.getAttribute('y1') || '0');
      const x2 = parseFloat(line.getAttribute('x2') || '0');
      const y2 = parseFloat(line.getAttribute('y2') || '0');
      svgPolygons.push({ points: `${x1},${y1} ${x2},${y2}`, fill: false, id: svgPolygons.length });
    });

    // Parse path elements (basic M, L, H, V, Z commands + curves)
    doc.querySelectorAll('path').forEach((path, _idx) => {
      const d = path.getAttribute('d');
      if (d) {
        const points = this.parsePathToPoints(d);
        if (points) {
          svgPolygons.push({ points, fill: true, id: svgPolygons.length });
        }
      }
    });

    // Calculate actual polygon bounds (not viewBox bounds)
    // This ensures we scale based on actual content, not viewBox padding
    let rawMinX = Infinity, rawMaxX = -Infinity, rawMinY = Infinity, rawMaxY = -Infinity;
    svgPolygons.forEach(poly => {
      const coords = poly.points.trim().replace(/,/g, ' ').split(/\s+/).map(Number);
      for (let i = 0; i < coords.length; i += 2) {
        rawMinX = Math.min(rawMinX, coords[i]);
        rawMaxX = Math.max(rawMaxX, coords[i]);
        rawMinY = Math.min(rawMinY, coords[i + 1]);
        rawMaxY = Math.max(rawMaxY, coords[i + 1]);
      }
    });

    if (svgPolygons.length > 0) {
      // Use actual content bounds instead of viewBox for scaling
      const contentWidth = rawMaxX - rawMinX;
      const contentHeight = rawMaxY - rawMinY;

      // Override viewBox-based values with actual content bounds
      // Store the actual bounds for use in coordinate transformation
      this.svgMinX = rawMinX;
      this.svgMinY = rawMinY;
      this.svgWidth = contentWidth;
      this.svgHeight = contentHeight;

      // Use "contain" behavior: uniform scale to fit content within canvas
      // Pick the smaller scale factor so the entire SVG fits without cropping
      const scaleToFitX = this.width / this.svgWidth;
      const scaleToFitY = this.height / this.svgHeight;
      const uniformScale = Math.min(scaleToFitX, scaleToFitY);

      // Apply padding factor to leave room for effects (glow, outlines, particles)
      // 0.75 = content uses 75% of canvas, leaving 12.5% padding on each edge
      const paddingFactor = 0.75;
      this.scaleX = uniformScale * paddingFactor;
      this.scaleY = uniformScale * paddingFactor;
    }

    this.buildPolygons(svgPolygons);
  }

  private parsePathToPoints(d: string): string | null {
    const points: number[] = [];
    let currentX = 0;
    let currentY = 0;
    let startX = 0;
    let startY = 0;

    // Full path parsing — handles M, L, H, V, C, S, Q, T, A, Z
    const commands = d.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/gi) || [];

    for (const cmd of commands) {
      const type = cmd[0];
      // Parse numbers including negatives and decimals like "0-8.86" → [0, -8.86]
      const args = (cmd.slice(1).match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi) || []).map(Number);
      const isRel = type === type.toLowerCase();

      switch (type.toUpperCase()) {
        case 'M':
          for (let i = 0; i < args.length; i += 2) {
            currentX = isRel ? currentX + args[i] : args[i];
            currentY = isRel ? currentY + args[i + 1] : args[i + 1];
            if (i === 0) { startX = currentX; startY = currentY; }
            points.push(currentX, currentY);
          }
          break;
        case 'L':
          for (let i = 0; i < args.length; i += 2) {
            currentX = isRel ? currentX + args[i] : args[i];
            currentY = isRel ? currentY + args[i + 1] : args[i + 1];
            points.push(currentX, currentY);
          }
          break;
        case 'H':
          for (let i = 0; i < args.length; i++) {
            currentX = isRel ? currentX + args[i] : args[i];
            points.push(currentX, currentY);
          }
          break;
        case 'V':
          for (let i = 0; i < args.length; i++) {
            currentY = isRel ? currentY + args[i] : args[i];
            points.push(currentX, currentY);
          }
          break;
        case 'C': {
          // Cubic bezier: 6 args per segment (x1,y1,x2,y2,x,y)
          const STEPS = 8;
          for (let i = 0; i + 5 < args.length; i += 6) {
            const x0 = currentX, y0 = currentY;
            const x1 = isRel ? x0 + args[i] : args[i];
            const y1 = isRel ? y0 + args[i + 1] : args[i + 1];
            const x2 = isRel ? x0 + args[i + 2] : args[i + 2];
            const y2 = isRel ? y0 + args[i + 3] : args[i + 3];
            const x3 = isRel ? x0 + args[i + 4] : args[i + 4];
            const y3 = isRel ? y0 + args[i + 5] : args[i + 5];
            for (let t = 1; t <= STEPS; t++) {
              const s = t / STEPS;
              const s2 = s * s, s3 = s2 * s;
              const u = 1 - s, u2 = u * u, u3 = u2 * u;
              points.push(
                u3 * x0 + 3 * u2 * s * x1 + 3 * u * s2 * x2 + s3 * x3,
                u3 * y0 + 3 * u2 * s * y1 + 3 * u * s2 * y2 + s3 * y3
              );
            }
            currentX = x3; currentY = y3;
          }
          break;
        }
        case 'S': {
          // Smooth cubic: 4 args per segment (x2,y2,x,y) — reflects previous control point
          const STEPS = 8;
          for (let i = 0; i + 3 < args.length; i += 4) {
            const x0 = currentX, y0 = currentY;
            // Reflection of last control point (simplified — use current as control)
            const x1 = x0, y1 = y0;
            const x2 = isRel ? x0 + args[i] : args[i];
            const y2 = isRel ? y0 + args[i + 1] : args[i + 1];
            const x3 = isRel ? x0 + args[i + 2] : args[i + 2];
            const y3 = isRel ? y0 + args[i + 3] : args[i + 3];
            for (let t = 1; t <= STEPS; t++) {
              const s = t / STEPS;
              const s2 = s * s, s3 = s2 * s;
              const u = 1 - s, u2 = u * u, u3 = u2 * u;
              points.push(
                u3 * x0 + 3 * u2 * s * x1 + 3 * u * s2 * x2 + s3 * x3,
                u3 * y0 + 3 * u2 * s * y1 + 3 * u * s2 * y2 + s3 * y3
              );
            }
            currentX = x3; currentY = y3;
          }
          break;
        }
        case 'Q': {
          // Quadratic bezier: 4 args per segment (x1,y1,x,y)
          const STEPS = 8;
          for (let i = 0; i + 3 < args.length; i += 4) {
            const x0 = currentX, y0 = currentY;
            const x1 = isRel ? x0 + args[i] : args[i];
            const y1 = isRel ? y0 + args[i + 1] : args[i + 1];
            const x2 = isRel ? x0 + args[i + 2] : args[i + 2];
            const y2 = isRel ? y0 + args[i + 3] : args[i + 3];
            for (let t = 1; t <= STEPS; t++) {
              const s = t / STEPS;
              const u = 1 - s;
              points.push(
                u * u * x0 + 2 * u * s * x1 + s * s * x2,
                u * u * y0 + 2 * u * s * y1 + s * s * y2
              );
            }
            currentX = x2; currentY = y2;
          }
          break;
        }
        case 'T': {
          // Smooth quadratic: 2 args (x,y) — reflects previous control point
          for (let i = 0; i + 1 < args.length; i += 2) {
            currentX = isRel ? currentX + args[i] : args[i];
            currentY = isRel ? currentY + args[i + 1] : args[i + 1];
            points.push(currentX, currentY);
          }
          break;
        }
        case 'A': {
          // Arc: 7 args (rx,ry,rotation,large-arc,sweep,x,y) — approximate with line to endpoint
          for (let i = 0; i + 6 < args.length; i += 7) {
            currentX = isRel ? currentX + args[i + 5] : args[i + 5];
            currentY = isRel ? currentY + args[i + 6] : args[i + 6];
            points.push(currentX, currentY);
          }
          break;
        }
        case 'Z':
          currentX = startX;
          currentY = startY;
          break;
      }
    }

    if (points.length < 4) return null;
    return points.join(' ');
  }

  private buildPolygons(svgPolygons: { points: string; fill: boolean; id: number }[]): void {
    this.polygons = [];
    this.allEdges = [];
    this.sharedVertices = [];
    this.allVertices = [];

    svgPolygons.forEach((poly, idx) => {
      const points = this.parsePolygonPoints(poly.points);
      const centroid = this.getCentroid(points);
      const bounds = this.getBounds(points);
      const perimeter = this.getPerimeter(points);

      const edges: { start: THREE.Vector3; end: THREE.Vector3; polyId: number }[] = [];
      for (let i = 0; i < points.length; i++) {
        const p1 = points[i];
        const p2 = points[(i + 1) % points.length];
        edges.push({ start: p1.clone(), end: p2.clone(), polyId: idx });
        this.allEdges.push({ start: p1.clone(), end: p2.clone(), polyId: idx, edgeId: this.allEdges.length });
      }

      points.forEach(p => this.allVertices.push(p.clone()));

      const colorIdx = idx % shapeColors.length;
      const baseColor = shapeColors[colorIdx];

      this.polygons.push({
        id: idx,
        points,
        centroid,
        bounds,
        edges,
        perimeter,
        fillPhase: Math.random() * Math.PI * 2,
        breathPhase: Math.random() * Math.PI * 2,
        colorHue: baseColor.h,
        colorSat: baseColor.s,
        colorLight: baseColor.l
      });
    });

    // Build shared vertices map
    const threshold = 5;
    const vertexMap = new Map<string, { pos: THREE.Vector3; polygons: Set<number> }>();

    this.polygons.forEach(poly => {
      poly.points.forEach(p => {
        const key = `${Math.round(p.x / threshold)},${Math.round(p.y / threshold)}`;
        if (!vertexMap.has(key)) {
          vertexMap.set(key, { pos: p.clone(), polygons: new Set() });
        }
        vertexMap.get(key)!.polygons.add(poly.id);
      });
    });

    vertexMap.forEach(data => {
      if (data.polygons.size >= 2) {
        this.sharedVertices.push({
          pos: data.pos,
          polygons: Array.from(data.polygons)
        });
      }
    });

    // Build edge connectivity
    this.edgeConnections = new Map();
    for (let i = 0; i < this.allEdges.length; i++) {
      const edge = this.allEdges[i];
      const connected: number[] = [];
      for (let j = 0; j < this.allEdges.length; j++) {
        if (i !== j && this.allEdges[j].start.distanceTo(edge.end) < 5) {
          connected.push(j);
        }
      }
      this.edgeConnections.set(i, connected);
    }
  }

  private parsePolygonPoints(pointsStr: string): THREE.Vector3[] {
    // Accept both "x,y x,y" (comma-separated pairs — very common in real
    // logos) and "x y x y": normalise commas to spaces before splitting.
    const coords = pointsStr.trim().replace(/,/g, ' ').split(/\s+/).map(Number);
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < coords.length; i += 2) {
      // Transform SVG coordinates to Three.js scene coordinates:
      // 1. Subtract content minX/minY to normalize to (0,0) origin
      // 2. Center the geometry (subtract half of content width/height)
      // 3. Scale to fit canvas with padding
      // Note: Camera uses Y-down convention (matching SVG), so NO Y negation needed
      const svgX = coords[i] - this.svgMinX;
      const svgY = coords[i + 1] - this.svgMinY;
      points.push(new THREE.Vector3(
        (svgX - this.svgWidth / 2) * this.scaleX,
        (svgY - this.svgHeight / 2) * this.scaleY,
        0
      ));
    }
    return points;
  }

  private getCentroid(points: THREE.Vector3[]): THREE.Vector3 {
    const c = new THREE.Vector3();
    points.forEach(p => c.add(p));
    return c.divideScalar(points.length);
  }

  private getBounds(points: THREE.Vector3[]): { min: THREE.Vector3; max: THREE.Vector3; width: number; height: number } {
    const min = new THREE.Vector3(Infinity, Infinity, 0);
    const max = new THREE.Vector3(-Infinity, -Infinity, 0);
    points.forEach(p => {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
    });
    return { min, max, width: max.x - min.x, height: max.y - min.y };
  }

  private getPerimeter(points: THREE.Vector3[]): number {
    let len = 0;
    for (let i = 0; i < points.length; i++) {
      len += points[i].distanceTo(points[(i + 1) % points.length]);
    }
    return len;
  }

  // Build the visual scene from parsed polygons
  buildScene(params: SVGContent): void {
    this.clearScene();

    // The scene background is set to black in the constructor via scene.background


    if (this.polygons.length === 0) return;

    // 3D mode: build the light rig and request the IBL env map. Both are
    // no-ops (rig emptied, no env request) in flat mode.
    this.setup3DLighting(params);
    if ((params.renderMode ?? 'flat') === 'extrude') this.ensureEnvMap();

    // Create visual elements based on enabled features
    if (params.nebulaEnabled) {
      this.createNebulaBackground(params);
    }

    if (params.echoEnabled) {
      this.createEchoLayers(params);
    }

    if (params.innerGlowEnabled) {
      this.createInnerGlows(params);
    }

    // Always create polygon fills
    this.createPolygonFills(params);

    if (params.ripplesEnabled) {
      this.createRipples(params);
    }

    if (params.connectionsEnabled) {
      this.createConnections(params);
    }

    if (params.arcBridgesEnabled) {
      this.createArcBridges(params);
    }

    if (params.edgeFlowEnabled) {
      this.createEdgeFlow(params);
    }

    // Always create outlines
    this.createPolygonOutlines(params);

    if (params.particlesEnabled) {
      this.createEdgeParticleSystem(params);
    }

    if (params.particleFillEnabled) {
      this.createParticleFill(params);
    }

    if (params.particleLinksEnabled && this.particles) {
      this.createParticleLinks(params);
    }

    if (params.energyEnabled) {
      this.createEnergyPulses(params);
    }

    if (params.glowEnabled) {
      this.createGlowNodes(params);
    }

    if (params.lightningEnabled) {
      this.createLightning(params);
    }

    if (params.plasmaEnabled) {
      this.createPlasmaTendrils(params);
    }
  }

  private clearScene(): void {
    while (this.mainGroup.children.length > 0) {
      const obj = this.mainGroup.children[0];
      if ((obj as any).geometry) (obj as any).geometry.dispose();
      if ((obj as any).material) {
        if (Array.isArray((obj as any).material)) {
          (obj as any).material.forEach((m: THREE.Material) => m.dispose());
        } else {
          (obj as any).material.dispose();
        }
      }
      this.mainGroup.remove(obj);
    }

    this.outlines = [];
    this.liquidFills = [];
    this.glowNodes = [];
    this.energyPulses = [];
    this.connectionLines = [];
    this.ripples = [];
    this.lightningBolts = [];
    this.edgeFlowLines = [];
    this.innerGlows = [];
    this.nebulaPlanes = [];
    this.plasmaTendrils = [];
    this.echoLayers = [];
    this.arcBridges = [];
    this.particles = null;
    this.particleLinkPool = [];
    this.fillParticles = null;
    this.extrudeMeshes = [];
  }

  private hslToColor(h: number, s: number, l: number): THREE.Color {
    return new THREE.Color().setHSL(h / 360, s, l);
  }

  private getColorForShape(idx: number, time: number, params: SVGContent): THREE.Color {
    const poly = this.polygons[idx];

    if (params.colorMode === 'white') {
      return new THREE.Color(1, 1, 1);
    }

    if (params.colorMode === 'rainbow') {
      const hue = ((idx / this.polygons.length) + time * params.colorCycleSpeed) % 1;
      return new THREE.Color().setHSL(hue, params.colorCycleSaturation, params.colorCycleLightness);
    }

    if (params.colorMode === 'monochrome') {
      const lightness = 0.3 + (idx / this.polygons.length) * 0.4;
      return new THREE.Color().setHSL(params.monochromeHue / 360, 0.8, lightness);
    }

    if (params.colorMode === 'complementary') {
      const baseHue = params.monochromeHue / 360;
      const hue = idx % 2 === 0 ? baseHue : (baseHue + 0.5) % 1;
      return new THREE.Color().setHSL(hue, params.colorCycleSaturation, params.colorCycleLightness);
    }

    if (params.colorMode === 'analogous') {
      const baseHue = params.monochromeHue / 360;
      const offset = ((idx % 3) - 1) * 0.08;
      return new THREE.Color().setHSL((baseHue + offset + 1) % 1, params.colorCycleSaturation, params.colorCycleLightness);
    }

    // perShape mode
    if (params.colorCycleEnabled) {
      const cycleHue = (poly.colorHue / 360 + time * params.colorCycleSpeed) % 1;
      return new THREE.Color().setHSL(cycleHue, params.colorCycleSaturation, params.colorCycleLightness);
    }

    return this.hslToColor(poly.colorHue, poly.colorSat, poly.colorLight);
  }

  // ============================================================================
  // 3D MODE: LIGHTING / MATERIALS / IBL
  // ============================================================================

  /** Build the light rig for extrude mode. Cleared + rebuilt per buildScene.
   *  Lights are sized to the content (≈width px) and live in scene space so
   *  the rotating shapes pass through the lighting. No-op visual cost in flat
   *  mode (rig is emptied). */
  private setup3DLighting(params: SVGContent): void {
    // Clear previous rig.
    while (this.lightRig.children.length) {
      const l = this.lightRig.children[0];
      this.lightRig.remove(l);
    }
    if ((params.renderMode ?? 'flat') !== 'extrude') return;

    const intensity = params.lightIntensity ?? 1;
    const D = Math.max(this.width, this.height);
    const preset = params.lightPreset ?? 'studio';
    const add = (light: THREE.Light) => this.lightRig.add(light);

    // Ambient floor so cavities never go fully black.
    add(new THREE.AmbientLight(0xffffff, 0.25 * intensity));

    if (preset === 'neon') {
      const pink = new THREE.PointLight(0xff3cb8, 2.2 * intensity, D * 4, 1.5);
      pink.position.set(-D * 0.5, -D * 0.4, D * 0.6);
      const cyan = new THREE.PointLight(0x4af2ff, 2.2 * intensity, D * 4, 1.5);
      cyan.position.set(D * 0.5, D * 0.4, D * 0.6);
      const key = new THREE.DirectionalLight(0xffffff, 0.5 * intensity);
      key.position.set(0, 0, D);
      add(pink); add(cyan); add(key);
    } else if (preset === 'rim') {
      const back = new THREE.DirectionalLight(0xffffff, 1.6 * intensity);
      back.position.set(0, -D * 0.3, -D); // strong rim from behind
      const fill = new THREE.DirectionalLight(0x88aaff, 0.4 * intensity);
      fill.position.set(D * 0.4, D * 0.4, D);
      add(back); add(fill);
    } else {
      // studio: classic key / fill / back three-point.
      const key = new THREE.DirectionalLight(0xffffff, 1.4 * intensity);
      key.position.set(-D * 0.4, -D * 0.5, D);
      const fill = new THREE.DirectionalLight(0xbfd4ff, 0.55 * intensity);
      fill.position.set(D * 0.6, D * 0.2, D * 0.5);
      const back = new THREE.DirectionalLight(0xffffff, 0.5 * intensity);
      back.position.set(0, D * 0.3, -D);
      add(key); add(fill); add(back);
    }
  }

  /** Lazily generate a PMREM environment map (RoomEnvironment) so chrome /
   *  glass / holographic materials have something to reflect. Async import
   *  keeps the cost out of flat-mode layers. */
  private ensureEnvMap(): void {
    if (this.envRequested) return;
    this.envRequested = true;
    import('three/examples/jsm/environments/RoomEnvironment.js')
      .then(({ RoomEnvironment }) => {
        try {
          const pmrem = new THREE.PMREMGenerator(this.renderer);
          const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
          this.scene.environment = env;
          this.envTexture = env;
          this.pmrem = pmrem;
        } catch (e) {
          console.warn('[SVG3D] env map generation failed', e);
        }
      })
      .catch(err => console.warn('[SVG3D] RoomEnvironment load failed', err));
  }

  /** PBR material for an extruded shape, per the material preset. */
  private makePBRMaterial(color: THREE.Color, params: SVGContent): THREE.MeshPhysicalMaterial {
    const preset = params.materialPreset ?? 'holographic';
    const base: THREE.MeshPhysicalMaterialParameters = {
      color,
      metalness: params.materialMetalness ?? 0.6,
      roughness: params.materialRoughness ?? 0.25,
      envMapIntensity: params.envIntensity ?? 1,
      side: THREE.DoubleSide,
    };
    if (preset === 'holographic') {
      base.metalness = 0.4;
      base.roughness = 0.15;
      base.iridescence = params.iridescence ?? 1;
      base.iridescenceIOR = 1.6;
      base.iridescenceThicknessRange = [120, 520];
      base.clearcoat = 0.6;
      base.clearcoatRoughness = 0.2;
    } else if (preset === 'chrome') {
      base.metalness = 1.0;
      base.roughness = Math.min(params.materialRoughness ?? 0.08, 0.15);
      base.envMapIntensity = Math.max(1.2, params.envIntensity ?? 1);
    } else if (preset === 'glass') {
      base.metalness = 0;
      base.roughness = params.materialRoughness ?? 0.08;
      base.transmission = params.glassTransmission ?? 0.9;
      base.thickness = (params.extrudeDepth ?? 28) * 0.5;
      base.ior = 1.45;
      base.transparent = true;
    } else if (preset === 'neon') {
      base.metalness = 0.1;
      base.roughness = 0.4;
      base.emissive = color.clone();
      base.emissiveIntensity = 1.8;
    }
    // matte = plain values from `base`.
    return new THREE.MeshPhysicalMaterial(base);
  }

  /** Random point-in-polygon test (even-odd) against a polygon's 2D points. */
  private pointInPolygon(x: number, y: number, pts: THREE.Vector3[]): boolean {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }

  /** Volumetric particle fill — scatter points INSIDE each polygon (rejection
   *  sampling within bounds) and drift them with a curl-ish wander, respawning
   *  inside the shape so the interior reads as alive with particles. */
  private createParticleFill(params: SVGContent): void {
    const perShape = Math.round(params.particleFillDensity ?? 200);
    const seeds: { x: number; y: number; poly: number; phase: number; speed: number }[] = [];
    this.polygons.forEach((poly, pIdx) => {
      const b = poly.bounds;
      let placed = 0, guard = 0;
      while (placed < perShape && guard < perShape * 30) {
        guard++;
        const x = b.min.x + Math.random() * b.width;
        const y = b.min.y + Math.random() * b.height;
        if (this.pointInPolygon(x, y, poly.points)) {
          seeds.push({ x, y, poly: pIdx, phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() });
          placed++;
        }
      }
    });
    if (seeds.length === 0) return;

    const positions = new Float32Array(seeds.length * 3);
    const colors = new Float32Array(seeds.length * 3);
    seeds.forEach((s, i) => {
      positions[i * 3] = s.x; positions[i * 3 + 1] = s.y; positions[i * 3 + 2] = 1;
      const c = this.getColorForShape(s.poly, 0, params);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: params.particleFillSize ?? 3,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.fillParticles = new THREE.Points(geometry, material);
    this.fillParticles.userData.seeds = seeds;
    this.mainGroup.add(this.fillParticles);
  }

  // ============================================================================
  // VISUAL ELEMENT CREATORS
  // ============================================================================

  private createNebulaBackground(params: SVGContent): void {
    const geometry = new THREE.PlaneGeometry(this.width * 1.5, this.height * 1.5);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uIntensity: { value: params.nebulaIntensity },
        uSpeed: { value: params.nebulaSpeed }
      },
      vertexShader: NebulaShader.vertexShader,
      fragmentShader: NebulaShader.fragmentShader,
      transparent: true,
      depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -100;
    this.mainGroup.add(mesh);
    this.nebulaPlanes.push(mesh);
  }

  private static readonly FILL_MODE_MAP: Record<string, number> = {
    'liquid': 0, 'solid': 1, 'gradient': 2, 'shimmer': 3,
    'pulse': 4, 'noise': 5, 'particles': 6, 'fluid': 7, 'flow': 8,
  };

  private createPolygonFills(params: SVGContent): void {
    const extrude = (params.renderMode ?? 'flat') === 'extrude';

    this.polygons.forEach((poly, idx) => {
      const shape = new THREE.Shape();
      shape.moveTo(poly.points[0].x, poly.points[0].y);
      for (let i = 1; i < poly.points.length; i++) {
        shape.lineTo(poly.points[i].x, poly.points[i].y);
      }
      shape.closePath();
      const color = this.getColorForShape(idx, 0, params);

      // ── 3D extrude path: solid beveled mesh with a PBR material ──────
      if (extrude) {
        const depth = Math.max(0.5, params.extrudeDepth ?? 28);
        const bevel = (params.bevelEnabled ?? true) && (params.bevelSize ?? 2) > 0;
        const geometry = new THREE.ExtrudeGeometry(shape, {
          depth,
          bevelEnabled: bevel,
          bevelSize: params.bevelSize ?? 2,
          bevelThickness: params.bevelSize ?? 2,
          bevelSegments: 2,
          curveSegments: 6,
        });
        // Front face at z=0, depth recedes to -depth (so flat effects at z=0
        // sit on the front of the solid).
        geometry.translate(0, 0, -depth);
        const material = this.makePBRMaterial(color, params);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.polyIdx = idx;
        this.mainGroup.add(mesh);
        this.extrudeMeshes.push(mesh);
        return;
      }

      // ── Flat path: animated shader plane (existing behaviour) ────────
      const geometry = new THREE.ShapeGeometry(shape);
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: color },
          uOpacity: { value: 0.6 },
          uFillMode: { value: SVGLayerRenderer.FILL_MODE_MAP[params.fillMode] || 0 },
          uFillLevel: { value: params.liquidEnabled ? 0.5 : 1.0 },
          uWaveAmp: { value: params.liquidWaveAmp },
          uWaveSpeed: { value: params.liquidSpeed * 5 },
          uBoundsMin: { value: new THREE.Vector2(poly.bounds.min.x, poly.bounds.min.y) },
          uBoundsMax: { value: new THREE.Vector2(poly.bounds.max.x, poly.bounds.max.y) },
          uGradientAngle: { value: params.gradientAngle },
          uGradientSpread: { value: params.gradientSpread },
          uShimmerSpeed: { value: params.shimmerSpeed },
          uShimmerScale: { value: params.shimmerScale },
          uShimmerIntensity: { value: params.shimmerIntensity },
          uPulseSpeed: { value: params.pulseSpeed },
          uPulseRingScale: { value: params.pulseRingScale },
          uPulseRingSpeed: { value: params.pulseRingSpeed },
          uNoiseScale: { value: params.noiseScale },
          uNoiseSpeed: { value: params.noiseSpeed },
          uNoiseContrast: { value: params.noiseContrast },
          uHeartbeat: { value: 0 },
          uFluidScale: { value: params.fluidScale ?? 2.5 },
          uFluidSpeed: { value: params.fluidSpeed ?? 0.6 },
          uFluidTurbulence: { value: params.fluidTurbulence ?? 1.0 },
        },
        vertexShader: FillShader.vertexShader,
        fragmentShader: FillShader.fragmentShader,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.polyIdx = idx;
      this.mainGroup.add(mesh);
      this.liquidFills.push(mesh);
    });
  }

  private createPolygonOutlines(params: SVGContent): void {
    const style = params.outlineStyle ?? 'solid';
    this.polygons.forEach((poly, idx) => {
      const positions: number[] = [];
      poly.points.forEach(p => positions.push(p.x, p.y, 0));
      positions.push(poly.points[0].x, poly.points[0].y, 0); // close loop
      const color = this.getColorForShape(idx, 0, params);
      const res = new THREE.Vector2(this.width, this.height);

      // Helper: build one Line2 with shared base options.
      const makeLine = (extra: Partial<ConstructorParameters<typeof LineMaterial>[0]>, dashed = false): Line2 => {
        const geometry = new LineGeometry();
        geometry.setPositions(positions);
        const material = new LineMaterial({
          color: color.getHex(),
          linewidth: params.outlineThickness,
          resolution: res,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          ...extra,
        });
        const line = new Line2(geometry, material);
        if (dashed) line.computeLineDistances();
        line.userData.polyIdx = idx;
        line.userData.style = style;
        return line;
      };

      if (style === 'dashed') {
        const span = Math.max(8, poly.perimeter * 0.04);
        const line = makeLine({ dashed: true, dashSize: span, gapSize: span * 0.6 } as any, true);
        this.mainGroup.add(line); this.outlines.push(line);
      } else if (style === 'gradient' || style === 'taper') {
        // Per-vertex colours: gradient cycles hue around the loop; taper
        // ramps brightness so the stroke fades along its length.
        const colors: number[] = [];
        const n = poly.points.length + 1;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          let c: THREE.Color;
          if (style === 'taper') {
            c = color.clone().multiplyScalar(0.15 + (1 - Math.abs(t - 0.5) * 2) * 0.85);
          } else {
            c = new THREE.Color().setHSL((color.getHSL({ h: 0, s: 0, l: 0 }).h + t * (params.outlineGradientSpread ?? 0.5)) % 1, 0.9, 0.55);
          }
          colors.push(c.r, c.g, c.b);
        }
        const geometry = new LineGeometry();
        geometry.setPositions(positions);
        geometry.setColors(colors);
        const material = new LineMaterial({
          linewidth: params.outlineThickness, resolution: res,
          transparent: true, opacity: 0.9, vertexColors: true,
          blending: THREE.AdditiveBlending,
        });
        const line = new Line2(geometry, material);
        line.userData.polyIdx = idx; line.userData.style = style;
        this.mainGroup.add(line); this.outlines.push(line);
      } else if (style === 'double') {
        // Neon: a fat soft halo behind a bright thin core.
        const halo = makeLine({ linewidth: params.outlineThickness * 2.6, opacity: 0.3 });
        const core = makeLine({ linewidth: Math.max(1, params.outlineThickness * 0.6), opacity: 1.0 });
        this.mainGroup.add(halo); this.mainGroup.add(core);
        this.outlines.push(halo); this.outlines.push(core);
      } else {
        // solid / glow-pulse (glow-pulse animates opacity+width in animate())
        const line = makeLine({});
        this.mainGroup.add(line); this.outlines.push(line);
      }
    });
  }

  private createEchoLayers(params: SVGContent): void {
    this.polygons.forEach((poly, idx) => {
      for (let layer = 1; layer <= params.echoLayers; layer++) {
        // scale = 1 + layer * params.echoSpacing / 100; // computed but unused - using offset-based approach instead
        const positions: number[] = [];

        poly.points.forEach(p => {
          const dir = p.clone().sub(poly.centroid).normalize();
          const offset = dir.multiplyScalar(layer * params.echoSpacing);
          positions.push(p.x + offset.x, p.y + offset.y, 0);
        });
        positions.push(positions[0], positions[1], 0);

        const geometry = new LineGeometry();
        geometry.setPositions(positions);

        const color = this.getColorForShape(idx, 0, params);
        const material = new LineMaterial({
          color: color.getHex(),
          linewidth: params.echoThickness,
          resolution: new THREE.Vector2(this.width, this.height),
          transparent: true,
          opacity: params.echoOpacity * (1 - layer / (params.echoLayers + 1)),
          blending: THREE.AdditiveBlending,
        });

        const line = new Line2(geometry, material);
        this.mainGroup.add(line);
        this.echoLayers.push(line);
      }
    });
  }

  private createInnerGlows(params: SVGContent): void {
    this.polygons.forEach((poly, idx) => {
      const shape = new THREE.Shape();
      shape.moveTo(poly.points[0].x, poly.points[0].y);
      for (let i = 1; i < poly.points.length; i++) {
        shape.lineTo(poly.points[i].x, poly.points[i].y);
      }
      shape.closePath();

      const geometry = new THREE.ShapeGeometry(shape);
      const color = this.getColorForShape(idx, 0, params);

      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: params.innerGlowIntensity * 0.3,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.z = -1;
      this.mainGroup.add(mesh);
      this.innerGlows.push(mesh);
    });
  }

  private createRipples(_params: SVGContent): void {
    const rippleCount = 3;

    this.sharedVertices.forEach(sv => {
      for (let i = 0; i < rippleCount; i++) {
        const geometry = new THREE.RingGeometry(5, 8, 32);
        const material = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.5,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.copy(sv.pos);
        mesh.userData.phase = i / rippleCount;
        mesh.userData.basePos = sv.pos.clone();
        this.mainGroup.add(mesh);
        this.ripples.push(mesh);
      }
    });
  }

  private createConnections(params: SVGContent): void {
    const style = params.connectionStyle ?? 'arc';
    const range = params.connectionRange ?? 200;
    const res = new THREE.Vector2(this.width, this.height);

    for (let i = 0; i < this.polygons.length; i++) {
      for (let j = i + 1; j < this.polygons.length; j++) {
        const p1 = this.polygons[i].centroid;
        const p2 = this.polygons[j].centroid;
        const dist = p1.distanceTo(p2);
        if (dist >= range) continue;

        // Build the path positions for this connection per style.
        let positions: number[] = [];
        const dir = new THREE.Vector3().subVectors(p2, p1);
        const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize();

        if (style === 'straight') {
          positions = [p1.x, p1.y, p1.z, p2.x, p2.y, p2.z];
        } else if (style === 'gravity') {
          // Catenary-ish sag (downward = +y in this Y-down space).
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k <= 20; k++) {
            const t = k / 20;
            const p = new THREE.Vector3().lerpVectors(p1, p2, t);
            p.y += Math.sin(t * Math.PI) * dist * 0.28;
            pts.push(p);
          }
          pts.forEach(p => positions.push(p.x, p.y, p.z));
        } else if (style === 'orbital') {
          // Curved bundle bowing to one side (alternating per pair).
          const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5)
            .add(perp.clone().multiplyScalar(dist * 0.3 * ((i + j) % 2 ? 1 : -1)));
          new THREE.QuadraticBezierCurve3(p1, mid, p2).getPoints(20)
            .forEach(p => positions.push(p.x, p.y, p.z));
        } else if (style === 'electric') {
          // Jagged bolt — re-jittered every frame in animate().
          for (let k = 0; k <= 14; k++) {
            const t = k / 14;
            const p = new THREE.Vector3().lerpVectors(p1, p2, t);
            if (k > 0 && k < 14) p.add(perp.clone().multiplyScalar((Math.random() - 0.5) * dist * 0.18));
            positions.push(p.x, p.y, p.z);
          }
        } else {
          // arc (default) / beaded / dataflow share the arc path
          const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
          mid.y += dist * 0.2;
          new THREE.QuadraticBezierCurve3(p1, mid, p2).getPoints(20)
            .forEach(p => positions.push(p.x, p.y, p.z));
        }

        const geometry = new LineGeometry();
        geometry.setPositions(positions);
        const dashed = style === 'dataflow' || style === 'beaded';
        const material = new LineMaterial({
          color: 0xff5a6e,
          linewidth: params.connectionThickness,
          resolution: res,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          ...(dashed ? { dashed: true, dashSize: style === 'beaded' ? 2 : 14, gapSize: style === 'beaded' ? 10 : 18 } : {}),
        } as any);
        const line = new Line2(geometry, material);
        if (dashed) line.computeLineDistances();
        line.userData.style = style;
        line.userData.p1 = p1.clone();
        line.userData.p2 = p2.clone();
        line.userData.perp = perp.clone();
        line.userData.dist = dist;
        this.mainGroup.add(line);
        this.connectionLines.push(line);
      }
    }
  }

  private createArcBridges(params: SVGContent): void {
    for (let i = 0; i < this.polygons.length; i++) {
      for (let j = i + 1; j < this.polygons.length; j++) {
        const p1 = this.polygons[i].centroid;
        const p2 = this.polygons[j].centroid;
        const dist = p1.distanceTo(p2);

        if (dist < 150 && dist > 50) {
          const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
          mid.z = params.arcBridgeHeight;

          const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
          const points = curve.getPoints(20);
          const positions: number[] = [];
          points.forEach(p => positions.push(p.x, p.y, p.z));

          const geometry = new LineGeometry();
          geometry.setPositions(positions);

          const material = new LineMaterial({
            color: 0xffff00,
            linewidth: params.arcBridgeThickness,
            resolution: new THREE.Vector2(this.width, this.height),
            transparent: true,
            opacity: params.arcBridgeOpacity,
            blending: THREE.AdditiveBlending,
          });

          const line = new Line2(geometry, material);
          this.mainGroup.add(line);
          this.arcBridges.push(line);
        }
      }
    }
  }

  private createEdgeFlow(params: SVGContent): void {
    this.allEdges.forEach(edge => {
      const positions = [
        edge.start.x, edge.start.y, edge.start.z,
        edge.end.x, edge.end.y, edge.end.z
      ];

      const geometry = new LineGeometry();
      geometry.setPositions(positions);

      const material = new LineMaterial({
        color: 0xff8844,
        linewidth: params.edgeFlowThickness,
        resolution: new THREE.Vector2(this.width, this.height),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
      });

      const line = new Line2(geometry, material);
      line.userData.progress = Math.random();
      this.mainGroup.add(line);
      this.edgeFlowLines.push(line);
    });
  }

  private createEdgeParticleSystem(params: SVGContent): void {
    const particleCount = 3000;
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const userData: { edgeIdx: number; t: number }[] = [];

    for (let i = 0; i < particleCount; i++) {
      const edgeIdx = Math.floor(Math.random() * this.allEdges.length);
      const t = Math.random();
      const edge = this.allEdges[edgeIdx];

      const pos = new THREE.Vector3().lerpVectors(edge.start, edge.end, t);
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;

      colors[i * 3] = 1;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;

      userData.push({ edgeIdx, t });
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: params.particleSize,
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geometry, material);
    this.particles.userData.particleData = userData;
    this.mainGroup.add(this.particles);
  }

  private createParticleLinks(params: SVGContent): void {
    // Use a pool of Line2 objects for thick, smooth lines
    const maxLinks = params.particleLinkMaxLinks || 800;

    // Create line pool
    this.particleLinkPool = [];
    for (let i = 0; i < maxLinks; i++) {
      const geometry = new LineGeometry();
      geometry.setPositions([0, 0, 0, 0, 0, 0]); // Will be updated in animate

      const material = new LineMaterial({
        color: 0xff8866,
        linewidth: params.particleLinkThickness || 2,
        resolution: new THREE.Vector2(this.width, this.height),
        transparent: true,
        opacity: params.particleLinkOpacity,
        blending: THREE.AdditiveBlending,
      });

      const line = new Line2(geometry, material);
      line.visible = false; // Start hidden
      line.frustumCulled = false;
      this.mainGroup.add(line);
      this.particleLinkPool.push(line);
    }
  }

  private createEnergyPulses(_params: SVGContent): void {
    const pulseCount = 50;

    for (let i = 0; i < pulseCount; i++) {
      const geometry = new THREE.CircleGeometry(3, 16);
      const material = new THREE.MeshBasicMaterial({
        color: 0xffaa00,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(geometry, material);

      const edgeIdx = Math.floor(Math.random() * this.allEdges.length);
      const t = Math.random();
      const edge = this.allEdges[edgeIdx];
      const pos = new THREE.Vector3().lerpVectors(edge.start, edge.end, t);

      mesh.position.copy(pos);
      mesh.userData = { edgeIdx, t };

      this.mainGroup.add(mesh);
      this.energyPulses.push(mesh);
    }
  }

  private createGlowNodes(params: SVGContent): void {
    // Add glow at each vertex
    this.allVertices.forEach((v, idx) => {
      const geometry = new THREE.CircleGeometry(5, 16);
      const color = this.getColorForShape(idx % this.polygons.length, 0, params);
      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(v);
      mesh.userData.baseScale = 1;
      this.mainGroup.add(mesh);
      this.glowNodes.push(mesh);
    });

    // Add glow at centroids
    this.polygons.forEach((poly, idx) => {
      const geometry = new THREE.CircleGeometry(8, 16);
      const color = this.getColorForShape(idx, 0, params);
      const material = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(poly.centroid);
      mesh.userData.baseScale = 1.5;
      this.mainGroup.add(mesh);
      this.glowNodes.push(mesh);
    });
  }

  private createLightning(_params: SVGContent): void {
    // Lightning bolts will be created dynamically in animate
    for (let i = 0; i < 20; i++) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(30 * 3); // Up to 30 segments
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.setDrawRange(0, 0);

      const material = new THREE.LineBasicMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(geometry, material);
      line.userData = { active: false, startTime: 0 };
      this.mainGroup.add(line);
      this.lightningBolts.push(line);
    }
  }

  private createPlasmaTendrils(params: SVGContent): void {
    this.polygons.forEach((poly, idx) => {
      for (let i = 0; i < 5; i++) {
        const edgeIdx = Math.floor(Math.random() * poly.edges.length);
        const edge = poly.edges[edgeIdx];
        const t = Math.random();
        const target = new THREE.Vector3().lerpVectors(edge.start, edge.end, t);

        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(20 * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const color = this.getColorForShape(idx, 0, params);
        const material = new THREE.LineBasicMaterial({
          color: color,
          transparent: true,
          opacity: params.plasmaOpacity,
          linewidth: params.plasmaThickness,
          blending: THREE.AdditiveBlending,
        });

        const line = new THREE.Line(geometry, material);
        line.userData = {
          start: poly.centroid.clone(),
          target: target,
          phase: Math.random() * Math.PI * 2,
        };

        this.mainGroup.add(line);
        this.plasmaTendrils.push(line);
      }
    });
  }

  // ============================================================================
  // ANIMATION
  // ============================================================================

  animate(deltaTime: number, params: SVGContent): void {
    this.animationTime += deltaTime;
    this.frameCount++;

    const extrude = (params.renderMode ?? 'flat') === 'extrude';

    // Apply user pan and scale transforms to mainGroup
    // Pan: convert -1 to 1 range to pixel offset (half canvas size)
    const panOffsetX = (params.panX || 0) * (this.width / 2);
    const panOffsetY = (params.panY || 0) * (this.height / 2);
    // Float bob (3D mode) — gentle vertical drift.
    const floatY = extrude && (params.floatAmount ?? 0) > 0
      ? Math.sin(this.animationTime * (params.floatSpeed ?? 0.8)) * (params.floatAmount ?? 0)
      : 0;
    this.mainGroup.position.x = panOffsetX;
    this.mainGroup.position.y = panOffsetY + floatY;

    // Breathing — per-scene scale pulse (organic).
    const breathe = params.breatheEnabled
      ? 1 + Math.sin(this.animationTime * (params.breatheSpeed ?? 1)) * (params.breatheAmount ?? 0.08)
      : 1;
    // Scale: apply user scale multiplier (default 1) × breathe. In 3D mode
    // scale Z too so the extrude depth scales with the content.
    const userScale = (params.contentScale || 1) * breathe;
    this.mainGroup.scale.set(userScale, userScale, extrude ? userScale : 1);

    // 3D rotation — manual base orientation (degrees) PLUS accumulated
    // auto-spin. With all spin speeds at 0 the manual angles drive the
    // orientation directly (hand-pose the logo); non-zero speeds spin on
    // top of that pose.
    if (extrude) {
      // Per-axis: a non-zero speed accumulates spin; a zero speed resets
      // its accumulator so the manual angle is ABSOLUTE (Rotate Y=40 with
      // Spin Y=0 means exactly 40°, not 40° + leftover spin).
      const sx = params.rotateSpeedX ?? 0, sy = params.rotateSpeedY ?? 0, sz = params.rotateSpeedZ ?? 0;
      this.spinX = sx ? this.spinX + deltaTime * sx : 0;
      this.spinY = sy ? this.spinY + deltaTime * sy : 0;
      this.spinZ = sz ? this.spinZ + deltaTime * sz : 0;
      const d2r = Math.PI / 180;
      this.mainGroup.rotation.set(
        (params.rotateX ?? 0) * d2r + this.spinX,
        (params.rotateY ?? 0) * d2r + this.spinY,
        (params.rotateZ ?? 0) * d2r + this.spinZ,
      );
    } else if (this.mainGroup.rotation.x || this.mainGroup.rotation.y || this.mainGroup.rotation.z) {
      this.mainGroup.rotation.set(0, 0, 0); // reset when leaving 3D mode
      this.spinX = this.spinY = this.spinZ = 0;
    }

    // Heartbeat effect
    if (params.heartbeatEnabled) {
      this.heartbeatPhase += deltaTime * params.heartbeatSpeed * 2 * Math.PI;
      // heartbeat value computed from phase (used for future heartbeat scale animation)
      void Math.sin(this.heartbeatPhase);
    }

    // Color cycling
    if (params.colorCycleEnabled) {
      this.colorCycleOffset += deltaTime * params.colorCycleSpeed;
    }

    // Update nebula
    this.nebulaPlanes.forEach(mesh => {
      const mat = mesh.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = this.animationTime;
      mat.uniforms.uIntensity.value = params.nebulaIntensity;
      mat.uniforms.uSpeed.value = params.nebulaSpeed;
    });

    // Update fills
    const heartbeatValue = params.heartbeatEnabled
      ? Math.sin(this.heartbeatPhase) * params.heartbeatIntensity
      : 0;

    // Map fillMode string to shader int (shared map incl. fluid/flow).
    const fillModeValue = SVGLayerRenderer.FILL_MODE_MAP[params.fillMode] || 0;

    this.liquidFills.forEach((mesh, _idx) => {
      const mat = mesh.material as THREE.ShaderMaterial;

      // Update time and heartbeat
      mat.uniforms.uTime.value = this.animationTime;
      mat.uniforms.uHeartbeat.value = heartbeatValue;

      // Update color
      const color = this.getColorForShape(mesh.userData.polyIdx, this.animationTime, params);
      mat.uniforms.uColor.value = color;

      // Update fill mode and all effect parameters from params
      mat.uniforms.uFillMode.value = fillModeValue;
      mat.uniforms.uFillLevel.value = params.liquidEnabled ? 0.5 : 1.0;
      mat.uniforms.uWaveAmp.value = params.liquidWaveAmp;
      mat.uniforms.uWaveSpeed.value = params.liquidSpeed * 5;

      // Gradient parameters
      mat.uniforms.uGradientAngle.value = params.gradientAngle;
      mat.uniforms.uGradientSpread.value = params.gradientSpread;

      // Shimmer parameters
      mat.uniforms.uShimmerSpeed.value = params.shimmerSpeed;
      mat.uniforms.uShimmerScale.value = params.shimmerScale;
      mat.uniforms.uShimmerIntensity.value = params.shimmerIntensity;

      // Pulse parameters
      mat.uniforms.uPulseSpeed.value = params.pulseSpeed;
      mat.uniforms.uPulseRingScale.value = params.pulseRingScale;
      mat.uniforms.uPulseRingSpeed.value = params.pulseRingSpeed;

      // Noise parameters
      mat.uniforms.uNoiseScale.value = params.noiseScale;
      mat.uniforms.uNoiseSpeed.value = params.noiseSpeed;
      mat.uniforms.uNoiseContrast.value = params.noiseContrast;

      // Fluid / flow parameters
      if (mat.uniforms.uFluidScale) {
        mat.uniforms.uFluidScale.value = params.fluidScale ?? 2.5;
        mat.uniforms.uFluidSpeed.value = params.fluidSpeed ?? 0.6;
        mat.uniforms.uFluidTurbulence.value = params.fluidTurbulence ?? 1.0;
      }
    });

    // Update volumetric fill particles — drift inside the shapes with a
    // wander, respawning at their seed when they stray out of the polygon.
    if (this.fillParticles && params.particleFillEnabled) {
      const arr = (this.fillParticles.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const seeds = this.fillParticles.userData.seeds as { x: number; y: number; poly: number; phase: number; speed: number }[];
      const spd = (params.particleFillSpeed ?? 1) * 12;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        let x = arr[i * 3], y = arr[i * 3 + 1];
        const a = this.animationTime * s.speed + s.phase;
        x += Math.cos(a * 1.3) * spd * deltaTime;
        y += Math.sin(a) * spd * deltaTime;
        if (!this.pointInPolygon(x, y, this.polygons[s.poly].points)) { x = s.x; y = s.y; }
        arr[i * 3] = x; arr[i * 3 + 1] = y;
      }
      this.fillParticles.geometry.attributes.position.needsUpdate = true;
      (this.fillParticles.material as THREE.PointsMaterial).size = params.particleFillSize ?? 3;
    }

    // Organic warp — displace each extrude/flat fill + outline with a
    // time-varying positional jitter so static shapes feel alive.
    if (params.organicWarpEnabled) {
      const amt = params.warpAmount ?? 6;
      const wp = this.animationTime * (params.warpSpeed ?? 0.8);
      this.mainGroup.position.x += Math.sin(wp * 1.7) * amt * 0.4;
      this.mainGroup.position.y += Math.cos(wp * 1.3) * amt * 0.4;
      this.mainGroup.rotation.z += Math.sin(wp) * 0.0006 * amt;
    }

    // Update outlines (style-aware)
    this.outlines.forEach(line => {
      const mat = (line as Line2).material as LineMaterial;
      const style = line.userData.style ?? 'solid';
      // Gradient/taper drive colour per-vertex, so don't overwrite it.
      if (style !== 'gradient' && style !== 'taper') {
        mat.color = this.getColorForShape(line.userData.polyIdx, this.animationTime, params);
      }
      mat.linewidth = params.outlineThickness;
      if (style === 'dashed') {
        (mat as any).dashOffset = -this.animationTime * (params.outlineDashSpeed ?? 1) * 12;
      } else if (style === 'glow-pulse') {
        const pulse = 0.5 + 0.5 * Math.sin(this.animationTime * 3 + line.userData.polyIdx);
        mat.opacity = 0.35 + pulse * 0.65;
        mat.linewidth = params.outlineThickness * (0.7 + pulse * 0.8);
      }
    });

    // Update glow nodes
    this.glowNodes.forEach((mesh, idx) => {
      const scale = mesh.userData.baseScale * (1 + Math.sin(this.animationTime * params.glowPulseSpeed + idx) * 0.3) * params.glowSize;
      mesh.scale.set(scale, scale, 1);
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.6 * params.glowIntensity;
    });

    // Update inner glows
    this.innerGlows.forEach((mesh, idx) => {
      (mesh.material as THREE.MeshBasicMaterial).opacity = params.innerGlowIntensity * 0.3;
      const color = this.getColorForShape(idx, this.animationTime, params);
      (mesh.material as THREE.MeshBasicMaterial).color = color;
    });

    // Update echo layers
    this.echoLayers.forEach((line) => {
      const mat = (line as Line2).material as LineMaterial;
      mat.linewidth = params.echoThickness;
    });

    // Update energy pulses
    this.energyPulses.forEach(mesh => {
      mesh.userData.t += deltaTime * params.energySpeed / 1000;
      if (mesh.userData.t > 1) {
        // Jump to connected edge
        const connected = this.edgeConnections.get(mesh.userData.edgeIdx) || [];
        if (connected.length > 0) {
          mesh.userData.edgeIdx = connected[Math.floor(Math.random() * connected.length)];
        } else {
          mesh.userData.edgeIdx = Math.floor(Math.random() * this.allEdges.length);
        }
        mesh.userData.t = 0;
      }

      const edge = this.allEdges[mesh.userData.edgeIdx];
      if (edge) {
        const pos = new THREE.Vector3().lerpVectors(edge.start, edge.end, mesh.userData.t);
        mesh.position.copy(pos);
      }

      // Update energy pulse size
      const pulseScale = params.energySize || 1;
      mesh.scale.set(pulseScale, pulseScale, 1);
    });

    // Update ripples
    this.ripples.forEach(mesh => {
      const phase = (this.animationTime * params.rippleSpeed + mesh.userData.phase) % 1;
      const scale = (1 + phase * 4) * params.rippleSize;
      mesh.scale.set(scale, scale, 1);
      (mesh.material as THREE.MeshBasicMaterial).opacity = params.rippleOpacity * (1 - phase);
    });

    // Update particles
    if (this.particles && params.particlesEnabled) {
      const positions = (this.particles.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const particleData = this.particles.userData.particleData;

      for (let i = 0; i < particleData.length; i++) {
        const data = particleData[i];
        data.t += deltaTime * params.particleSpeed / 1000;

        if (data.t > 1) {
          const connected = this.edgeConnections.get(data.edgeIdx) || [];
          if (connected.length > 0) {
            data.edgeIdx = connected[Math.floor(Math.random() * connected.length)];
          } else {
            data.edgeIdx = Math.floor(Math.random() * this.allEdges.length);
          }
          data.t = 0;
        }

        const edge = this.allEdges[data.edgeIdx];
        if (edge) {
          const pos = new THREE.Vector3().lerpVectors(edge.start, edge.end, data.t);
          positions[i * 3] = pos.x;
          positions[i * 3 + 1] = pos.y;
          positions[i * 3 + 2] = pos.z;
        }
      }

      this.particles.geometry.attributes.position.needsUpdate = true;
      (this.particles.material as THREE.PointsMaterial).size = params.particleSize;
    }

    // Update particle links using Line2 pool for thick smooth lines
    const linkUpdateFrequency = Math.max(1, Math.floor(11 - (params.particleLinkSpeed || 5))); // Higher speed = more frequent updates
    if (this.particleLinkPool.length > 0 && params.particleLinksEnabled && this.particles &&
        this.frameCount % linkUpdateFrequency === 0) {
      const particlePositions = (this.particles.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const numParticles = particlePositions.length / 3;

      // Hide all lines first
      for (const line of this.particleLinkPool) {
        line.visible = false;
      }

      // Deterministic sampling for consistent, smooth links
      const sampleSize = Math.min(200, numParticles);
      const step = Math.max(1, Math.floor(numParticles / sampleSize));
      const distThreshold = params.particleLinkDistance;
      const distThresholdSq = distThreshold * distThreshold;
      const minDistSq = 25; // Minimum distance to avoid clutter

      let linkCount = 0;
      const maxLinks = Math.min(this.particleLinkPool.length, params.particleLinkMaxLinks || 800);

      // Get link color based on color mode
      let linkColor: THREE.Color;
      if (params.colorMode === 'rainbow') {
        linkColor = new THREE.Color().setHSL(this.colorCycleOffset % 1, 0.8, 0.55);
      } else if (params.colorMode === 'monochrome') {
        linkColor = new THREE.Color().setHSL(params.monochromeHue / 360, 0.8, 0.55);
      } else if (params.colorMode === 'white') {
        linkColor = new THREE.Color(1, 1, 1);
      } else {
        linkColor = new THREE.Color(0xff8866); // Default warm orange
      }

      // Systematic sampling for consistent results
      for (let i = 0; i < sampleSize && linkCount < maxLinks; i++) {
        const idx1 = i * step;
        const x1 = particlePositions[idx1 * 3];
        const y1 = particlePositions[idx1 * 3 + 1];
        const z1 = particlePositions[idx1 * 3 + 2] || 0;

        for (let j = i + 1; j < sampleSize && linkCount < maxLinks; j++) {
          const idx2 = j * step;
          const x2 = particlePositions[idx2 * 3];
          const y2 = particlePositions[idx2 * 3 + 1];
          const z2 = particlePositions[idx2 * 3 + 2] || 0;

          const dx = x2 - x1;
          const dy = y2 - y1;
          const distSq = dx * dx + dy * dy;

          if (distSq < distThresholdSq && distSq > minDistSq) {
            const line = this.particleLinkPool[linkCount];

            // Update line geometry
            const lineGeom = line.geometry as LineGeometry;
            lineGeom.setPositions([x1, y1, z1 + 2.5, x2, y2, z2 + 2.5]);

            // Update line material
            const lineMat = line.material as LineMaterial;
            lineMat.linewidth = params.particleLinkThickness || 2;
            lineMat.opacity = params.particleLinkOpacity;
            lineMat.color = linkColor;

            line.visible = true;
            linkCount++;
          }
        }
      }
    }

    // Update connection lines (style-aware)
    this.connectionLines.forEach((line, idx) => {
      const l = line as Line2;
      const mat = l.material as LineMaterial;
      const style = l.userData.style ?? 'arc';
      mat.linewidth = params.connectionThickness;
      mat.opacity = 0.3 + Math.sin(this.animationTime * params.connectionPulseSpeed + idx) * 0.2;
      if (style === 'dataflow' || style === 'beaded') {
        // Travel the dashes along the path → reads as flowing data / beads.
        (mat as any).dashOffset = -this.animationTime * (params.connectionDataFlowSpeed ?? 1.5)
          * (style === 'beaded' ? 8 : 22);
      } else if (style === 'electric') {
        // Re-jitter the bolt every few frames for a crackling arc.
        if (this.frameCount % 3 === 0) {
          const p1 = l.userData.p1 as THREE.Vector3;
          const p2 = l.userData.p2 as THREE.Vector3;
          const perp = l.userData.perp as THREE.Vector3;
          const dist = l.userData.dist as number;
          const positions: number[] = [];
          for (let k = 0; k <= 14; k++) {
            const t = k / 14;
            const p = new THREE.Vector3().lerpVectors(p1, p2, t);
            if (k > 0 && k < 14) p.add(perp.clone().multiplyScalar((Math.random() - 0.5) * dist * 0.18));
            positions.push(p.x, p.y, p.z);
          }
          (l.geometry as LineGeometry).setPositions(positions);
        }
        mat.opacity = 0.5 + Math.random() * 0.5; // flicker
      }
    });

    // Update edge flow
    this.edgeFlowLines.forEach(line => {
      line.userData.progress += deltaTime * params.edgeFlowSpeed;
      if (line.userData.progress > 1) line.userData.progress = 0;
      const mat = (line as Line2).material as LineMaterial;
      mat.opacity = 0.3 + Math.sin(line.userData.progress * Math.PI * 2) * 0.3;
      mat.linewidth = params.edgeFlowThickness;
    });

    // Update arc bridges
    this.arcBridges.forEach((line) => {
      const mat = (line as Line2).material as LineMaterial;
      mat.linewidth = params.arcBridgeThickness;
      mat.opacity = params.arcBridgeOpacity;
    });

    // Update lightning
    if (params.lightningEnabled && Math.random() < deltaTime * params.lightningFrequency) {
      // Find an inactive bolt
      const bolt = this.lightningBolts.find(b => !b.userData.active);
      if (bolt) {
        this.generateLightningBolt(bolt, params);
      }
    }

    this.lightningBolts.forEach(bolt => {
      if (bolt.userData.active) {
        const age = this.animationTime - bolt.userData.startTime;
        if (age > params.lightningDuration) {
          bolt.userData.active = false;
          (bolt.material as THREE.LineBasicMaterial).opacity = 0;
        } else {
          const fade = 1 - age / params.lightningDuration;
          (bolt.material as THREE.LineBasicMaterial).opacity = fade;
        }
      }
    });

    // Update plasma tendrils
    this.plasmaTendrils.forEach(line => {
      const positions = (line.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      const start = line.userData.start;
      const target = line.userData.target;
      const phase = line.userData.phase + this.animationTime * params.plasmaSpeed;

      const segments = 20;
      for (let i = 0; i < segments; i++) {
        const t = i / (segments - 1);
        const pos = new THREE.Vector3().lerpVectors(start, target, t);

        // Add perpendicular wobble
        const dir = new THREE.Vector3().subVectors(target, start).normalize();
        const perp = new THREE.Vector3(-dir.y, dir.x, 0);
        const wobble = Math.sin(t * 10 + phase) * params.plasmaIntensity * 5 * (1 - Math.abs(t - 0.5) * 2);
        pos.add(perp.multiplyScalar(wobble));

        positions[i * 3] = pos.x;
        positions[i * 3 + 1] = pos.y;
        positions[i * 3 + 2] = pos.z;
      }

      line.geometry.attributes.position.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).opacity = params.plasmaOpacity;
    });
  }

  private generateLightningBolt(bolt: THREE.Line, params: SVGContent): void {
    // Pick two random polygons
    if (this.polygons.length < 2) return;

    const idx1 = Math.floor(Math.random() * this.polygons.length);
    let idx2 = Math.floor(Math.random() * this.polygons.length);
    if (idx2 === idx1) idx2 = (idx2 + 1) % this.polygons.length;

    const start = this.polygons[idx1].centroid.clone();
    const end = this.polygons[idx2].centroid.clone();

    const positions = (bolt.geometry as THREE.BufferGeometry).attributes.position.array as Float32Array;
    const segments = 10 + params.lightningBranches * 2;

    let current = start.clone();
    positions[0] = current.x;
    positions[1] = current.y;
    positions[2] = current.z;

    for (let i = 1; i < segments; i++) {
      const t = i / (segments - 1);
      const target = new THREE.Vector3().lerpVectors(start, end, t);

      // Add random offset
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 30,
        0
      );
      current = target.add(offset);

      positions[i * 3] = current.x;
      positions[i * 3 + 1] = current.y;
      positions[i * 3 + 2] = current.z;
    }

    (bolt.geometry as THREE.BufferGeometry).attributes.position.needsUpdate = true;
    (bolt.geometry as THREE.BufferGeometry).setDrawRange(0, segments);
    (bolt.material as THREE.LineBasicMaterial).opacity = 1;
    bolt.userData.active = true;
    bolt.userData.startTime = this.animationTime;
  }

  // ============================================================================
  // RENDERING
  // ============================================================================

  /** Internal bloom composer (RenderPass → UnrealBloomPass), built lazily.
   *  Keeps output LINEAR (no OutputPass) so the engine composites it the
   *  same way as the direct path — only the glow is added. With both passes
   *  `needsSwap=false` there are no buffer swaps, so `readBuffer` is stable. */
  private ensureComposer(): void {
    if (this.composer) return;
    const composer = new EffectComposer(this.renderer);
    composer.renderToScreen = false;
    composer.setSize(this.renderTarget.width, this.renderTarget.height);
    const renderPass = new RenderPass(this.scene, this.perspCamera);
    composer.addPass(renderPass);
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(this.renderTarget.width, this.renderTarget.height), 1.0, 0.4, 0.1,
    );
    composer.addPass(bloom);
    this.composer = composer;
    this.renderPass = renderPass;
    this.bloomPass = bloom;
  }

  render(params?: SVGContent): THREE.Texture {
    const extrude = (params?.renderMode ?? 'flat') === 'extrude';
    const cam = extrude ? this.perspCamera : this.camera;
    // Bloom is part of the 3D level-up only — flat mode keeps its exact
    // prior look (the bloom params were inert before, and existing layers
    // ship a non-zero default, so gating on extrude avoids regressing them).
    const bloomOn = extrude && (params?.bloomStrength ?? 0) > 0.01 && !this.composerFailed;

    // Save renderer state when sharing renderer (incl. tonemap so the 3D
    // PBR lighting never leaks into the engine's other layers).
    const currentRenderTarget = this.renderer.getRenderTarget();
    const currentAutoClear = this.renderer.autoClear;
    const currentViewport = new THREE.Vector4();
    this.renderer.getViewport(currentViewport);
    const currentScissor = new THREE.Vector4();
    this.renderer.getScissor(currentScissor);
    const currentScissorTest = this.renderer.getScissorTest();
    const currentToneMapping = this.renderer.toneMapping;
    const currentExposure = this.renderer.toneMappingExposure;

    this.renderer.autoClear = true;
    // PBR tone mapping only in extrude mode — flat mode keeps its additive
    // look untouched.
    if (extrude) {
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.0;
    }

    const renderDirect = (): THREE.Texture => {
      this.renderer.setRenderTarget(this.renderTarget);
      this.renderer.setViewport(0, 0, this.renderTarget.width, this.renderTarget.height);
      this.renderer.setScissor(0, 0, this.renderTarget.width, this.renderTarget.height);
      this.renderer.setScissorTest(true);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      return this.renderTarget.texture;
    };

    let outTex: THREE.Texture;
    if (bloomOn) {
      try {
        this.ensureComposer();
        this.renderPass!.camera = cam;
        this.bloomPass!.strength = params!.bloomStrength;
        this.bloomPass!.threshold = params!.bloomThreshold ?? 0.1;
        this.composer!.render();
        outTex = this.composer!.readBuffer.texture;
      } catch (e) {
        this.composerFailed = true;
        console.warn('[SVG] internal bloom disabled after GPU error:', e);
        outTex = renderDirect();
      }
    } else {
      outTex = renderDirect();
    }

    // Restore renderer state
    this.renderer.setRenderTarget(currentRenderTarget);
    this.renderer.setViewport(currentViewport);
    this.renderer.setScissor(currentScissor);
    this.renderer.setScissorTest(currentScissorTest);
    this.renderer.autoClear = currentAutoClear;
    this.renderer.toneMapping = currentToneMapping;
    this.renderer.toneMappingExposure = currentExposure;

    return outTex;
  }

  getTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  resize(width: number, height: number): void {
    // Skip if dimensions haven't changed
    if (width === this.width && height === this.height) return;

    // Ensure dimensions are valid (at least 1 pixel)
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));

    this.width = width;
    this.height = height;

    // Only resize renderer if we own it
    if (this.ownsRenderer) {
      this.renderer.setSize(width, height);
    }
    this.renderTarget.setSize(width, height);

    // Update camera to match new dimensions exactly
    // Y-down convention to match SVG coordinates
    this.camera.left = -width / 2;
    this.camera.right = width / 2;
    this.camera.top = -height / 2;
    this.camera.bottom = height / 2;
    this.camera.updateProjectionMatrix();

    // Keep the perspective camera + bloom composer in sync with the new size.
    this.updatePerspectiveCamera(this.perspCamera.fov);
    this.composer?.setSize(width, height);
    this.bloomPass?.setSize(width, height);

    // Scale the scene root to fill the new canvas size
    // The geometry was built for initialWidth/initialHeight, so we scale to match new dimensions
    if (this.initialWidth > 0 && this.initialHeight > 0) {
      const scaleX = width / this.initialWidth;
      const scaleY = height / this.initialHeight;
      this.sceneRoot.scale.set(scaleX, scaleY, 1);
    }

    // Update line material resolutions
    [...this.outlines, ...this.connectionLines, ...this.edgeFlowLines, ...this.echoLayers, ...this.arcBridges, ...this.particleLinkPool].forEach(line => {
      if ((line as Line2).material) {
        ((line as Line2).material as LineMaterial).resolution.set(width, height);
      }
    });

    // Mark that geometry needs to be rebuilt for optimal quality at new size
    this._needsRebuild = true;
  }

  needsRebuild(): boolean {
    return this._needsRebuild || false;
  }

  private _needsRebuild = false;

  dispose(): void {
    this.clearScene();
    this.composer?.dispose?.();
    this.bloomPass?.dispose?.();
    this.composer = null;
    this.bloomPass = null;
    this.renderPass = null;
    this.envTexture?.dispose();
    this.pmrem?.dispose();
    this.envTexture = null;
    this.pmrem = null;
    this.scene.environment = null;
    // Only dispose renderer if we own it
    if (this.ownsRenderer) {
      this.renderer.dispose();
    }
    this.renderTarget.dispose();
  }
}
