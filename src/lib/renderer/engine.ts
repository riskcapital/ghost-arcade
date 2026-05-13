import * as THREE from 'three';
import type { Layer, WarpCorners, BlendMode, MeshWarpGrid, Effect, ColorContent, MaskConfig, LayerShapeType, Point2D, ContentFitMode, EdgeEffect, GroupConfig } from '../types';
import { getShapeVertices } from '../types';

// ── Group rendering types ──────────────────────────────────────────────────
type RenderUnit =
  | { kind: 'standalone'; layer: Layer }
  | { kind: 'group'; group: Layer; children: Layer[] };
// Edge effects still use old drawing types for temporary element construction
import type { DrawingElement, PointClickLineShape } from '../drawing/types';
import { createDefaultShapeWarp, createDefaultShapeMesh } from '../drawing/types';
import type { LineElement } from '../lines/types';
import { warpVertexShader, textureFragmentShader, blendShaders, passthroughVertexShader, opaqueOutputFragmentShader } from './shaders';
import { createEffectMaterial, updateEffectUniforms, effectVertexShader, polygonMaskShader, polygonMaskAlphaShader, applyExternalMaskShader, layerShapeMaskShader } from './effects';
import { domeProjectionShader } from './shaders/dome';
import { getTransition, applyFaderCurve, type TransitionDef } from './crossfadeTransitions';
// Geometry imports kept for potential future use with shape control point warping
// import { createShapeGeometry, updateGeometryFromControlPoints } from './geometry';

// Module-level watermark texture cache — shared across engine instances
// so the PNG is only fetched once per session.
let _watermarkTextureCache: THREE.Texture | null = null;

export interface RenderEngineOptions {
  preserveDrawingBuffer?: boolean;
}

export interface OutputTransformParams {
  rotation?: 0 | 90 | 180 | 270;
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  brightness?: number;
  contrast?: number;
  gamma?: number;
}

interface LayerRenderObject {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  renderTarget: THREE.WebGLRenderTarget;
  geometry: THREE.BufferGeometry;
  warpMode: 'corners' | 'mesh';
  meshGridSize?: { rows: number; cols: number };
  // Store original UV coordinates for mesh warp (so we can reapply warp each frame)
  originalUVs?: Float32Array;
  // Track the shape type for geometry recreation when shape changes
  shapeType: LayerShapeType | 'quad';
  // Track shape params hash to detect parameter changes requiring geometry recreation
  shapeParamsHash?: string;
  // Default control points for shape warping (used as reference for warp calculations)
  defaultControlPoints?: Point2D[];
}

export class RenderEngine {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private width: number;
  private height: number;

  // Render targets for compositing
  private compositeTarget: THREE.WebGLRenderTarget;
  private tempTarget: THREE.WebGLRenderTarget;

  // Layer render objects cache
  private layerObjects: Map<string, LayerRenderObject> = new Map();

  // Composite quad
  private compositeScene: THREE.Scene;
  private compositeMaterial: THREE.ShaderMaterial;
  private compositeQuad: THREE.Mesh;

  // Blend materials cache
  private blendMaterials: Map<BlendMode, THREE.ShaderMaterial> = new Map();

  // Effect materials cache (keyed by effectId)
  private effectMaterials: Map<string, THREE.ShaderMaterial> = new Map();

  // Effect processing render targets (ping-pong)
  private effectTargetA: THREE.WebGLRenderTarget;
  private effectTargetB: THREE.WebGLRenderTarget;
  private effectBlendTarget: THREE.WebGLRenderTarget; // Third target for per-effect blend pass

  // Effect scene/quad
  private effectScene: THREE.Scene;
  private effectQuad: THREE.Mesh;

  // Time tracking for animated effects
  private startTime: number;

  // Output display
  private outputQuad: THREE.Mesh;
  private outputScene: THREE.Scene;

  // Color textures cache (for solid color layers)
  private colorTextures: Map<string, THREE.DataTexture> = new Map();

  // Mask materials cache (keyed by layerId). Single-polygon path uses the
  // inline polygonMaskShader; the union path uses a separate alpha-only
  // shader plus an apply-mask compositor.
  private maskMaterials: Map<string, THREE.ShaderMaterial> = new Map();
  // Mask render target (final masked source for the active layer)
  private maskTarget: THREE.WebGLRenderTarget | null = null;
  // Union accumulator for multi-shape masks (alpha channel = union silhouette)
  private maskUnionTarget: THREE.WebGLRenderTarget | null = null;
  // Reusable material for accumulating one shape's silhouette into the union
  // target. Single material reused across shapes/layers — uniforms swap per
  // shape, points uniform is rewritten between renders.
  private maskUnionAccumMaterial: THREE.ShaderMaterial | null = null;
  // Reusable material that applies the union mask's alpha to a source texture.
  private maskApplyMaterial: THREE.ShaderMaterial | null = null;

  // Shape mask (SDF-based) material and render target
  private shapeMaskMaterial: THREE.ShaderMaterial | null = null;
  private shapeMaskTarget: THREE.WebGLRenderTarget | null = null;

  // Edge effects rendering
  private drawingRendererRef: any = null;      // LinesRenderer (legacy, for line strokes)
  private shapeRendererRef: any = null;        // DrawingRenderer (fills, animations, strokes)
  private edgeEffectTarget: THREE.WebGLRenderTarget | null = null;

  // Group layer render targets (lazy-allocated per group ID)
  private groupTargets: Map<string, THREE.WebGLRenderTarget> = new Map();
  private groupShaderTargets: Map<string, THREE.WebGLRenderTarget> = new Map();

  // Cached copy objects — reused every frame to avoid per-frame allocations
  private _copyGeometry: THREE.PlaneGeometry;
  private _copyMaterial: THREE.MeshBasicMaterial;
  private _copyMesh: THREE.Mesh;
  private _copyScene: THREE.Scene;
  private _tempColor: THREE.Color;

  // Watermark overlay (free/demo tier) — grid of darkened logo outlines with random illumination
  private watermarkEnabled: boolean = true;
  private watermarkScene: THREE.Scene | null = null;
  private watermarkQuad: THREE.Mesh | null = null;
  private watermarkMaterial: THREE.ShaderMaterial | null = null;
  private watermarkTexture: THREE.Texture | null = null;

  // Dome projection overlay
  private domeEnabled: boolean = false;
  private domeScene: THREE.Scene | null = null;
  private domeQuad: THREE.Mesh | null = null;
  private domeMaterial: THREE.ShaderMaterial | null = null;
  private domeSettings = {
    mode: 0,
    fov: Math.PI,
    rotation: 0,
    tilt: 0,
    offsetX: 0,
    offsetY: 0,
    curvature: 1.0,
    truncation: 1.0,
  };

  // Preset transition state
  private transitionTarget: THREE.WebGLRenderTarget | null = null;
  private transitionScene: THREE.Scene | null = null;
  private transitionQuad: THREE.Mesh | null = null;
  private transitionMaterial: THREE.ShaderMaterial | null = null;
  private transitionProgress: number = 1; // 1 = no transition active
  private transitionStartTime: number = 0;
  private transitionDuration: number = 0;

  // ── VJ A/B crossfader state ──────────────────────────────────────────
  // When active, the layer render plan is partitioned by Layer.bank into
  // bankATarget / bankBTarget; the two are mixed via a transition shader
  // whose source comes from crossfadeTransitions.ts. setCrossfade() is
  // called once per frame from Canvas.svelte before render().
  private bankATarget: THREE.WebGLRenderTarget | null = null;
  private bankBTarget: THREE.WebGLRenderTarget | null = null;
  private crossfadeScene: THREE.Scene | null = null;
  private crossfadeQuad: THREE.Mesh | null = null;
  /** Cache of compiled transition materials keyed by transition name —
   *  we never want to recompile a 200-line GLSL when the user just
   *  wiggles the fader. */
  private crossfadeMaterials: Map<string, THREE.ShaderMaterial> = new Map();
  private crossfadeActive: boolean = false;
  private crossfadeValue: number = 0;
  private crossfadeTransitionName: string = 'dissolve';
  // 0 = normal (transition shader output verbatim), 1+ = per-channel
  // blend math (multiply/screen/add/etc.). The shader's BLEND_TAIL
  // overwrites the transition output with a triangular A → blended → B
  // sweep when this is non-zero. See crossfadeTransitions.ts.
  private crossfadeBlendModeIndex: number = 0;
  private crossfadeStartTime: number = performance.now() / 1000;

  // Per-VJ-layer crossfade FBOs. When stage mode is on AND a single VJ
  // layer index has both Bank A and Bank B clips active, we crossfade
  // the two banks PER LAYER (not just at the final composite) so each
  // mapped Screen sees an A/B mix of its assigned VJ layer. Keyed by
  // VJ layer index. Lazy-created on first use; disposed on resize/dispose.
  private vjCrossfadeTargets: Map<number, THREE.WebGLRenderTarget> = new Map();

  constructor(canvas: HTMLCanvasElement, width: number, height: number, options: RenderEngineOptions = {}) {
    this.width = width;
    this.height = height;
    const preserveDrawingBuffer = options.preserveDrawingBuffer ?? true;

    // Create renderer
    // premultipliedAlpha: false is critical for correct video capture colors
    // powerPreference: 'high-performance' ensures discrete GPU is used (not integrated)
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      preserveDrawingBuffer,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    // Always render at the project's native resolution — pixelRatio=1 regardless
    // of devicePixelRatio. This is a production rendering app, not a web page:
    // the project size IS the authoritative canvas resolution, and Spout/Syphon
    // output + recording + export all sample from it. Applying DPR=2 on a 1080p
    // project silently turned the backing store into 4K and forced 33MB-per-frame
    // readbacks through the CPU-IPC pipe for Spout/Syphon, for zero visual
    // benefit since consumers (MadMapper, Resolume, the output window) all
    // ingest at their own resolution.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false); // false = don't modify CSS styles
    this.renderer.setClearColor(0x000000, 1);

    // Always surface shader compile/link errors to the console. In production
    // builds Three.js defaults this to `false`, which silently swallows GLSL
    // errors — you get "shader doesn't draw anything" with no indication why.
    // Cheap to leave on; only runs during shader compile, not per-frame.
    this.renderer.debug.checkShaderErrors = true;

    // Detect and log GPU info — warn if using integrated GPU
    this.detectGPU();

    // Query the driver's actual maximum texture + renderbuffer dimensions and
    // clamp all RT creation against them. On low-end integrated GPUs this can
    // be 4096 or even 2048 — accepting a project file with 8192×8192 would
    // throw `gl.INVALID_VALUE` at every RT creation and hard-fail the mount.
    const gl = this.renderer.getContext();
    this.maxTextureSize = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 4096,
    );
    if (this.width > this.maxTextureSize || this.height > this.maxTextureSize) {
      console.warn(`[RenderEngine] Project size ${this.width}x${this.height} exceeds GPU max ${this.maxTextureSize}x${this.maxTextureSize}; clamping.`);
      this.width = Math.min(this.width, this.maxTextureSize);
      this.height = Math.min(this.height, this.maxTextureSize);
      this.renderer.setSize(this.width, this.height, false);
    }

    // Create orthographic camera
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    this.camera.position.z = 1;

    // Create main scene
    this.scene = new THREE.Scene();

    // Create render targets
    this.compositeTarget = this.createRenderTarget();
    this.tempTarget = this.createRenderTarget();

    // Setup composite scene (for blending layers)
    this.compositeScene = new THREE.Scene();
    this.compositeMaterial = this.createBlendMaterial('normal');
    const compositeGeometry = new THREE.PlaneGeometry(2, 2);
    this.compositeQuad = new THREE.Mesh(compositeGeometry, this.compositeMaterial);
    this.compositeScene.add(this.compositeQuad);

    // Crossfader scene + reusable quad (one quad, swap material per
    // transition). Bank FBOs are lazily allocated on first use to avoid
    // ~32MB of always-on GPU memory when nobody's using the crossfader.
    this.crossfadeScene = new THREE.Scene();
    this.crossfadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.crossfadeScene.add(this.crossfadeQuad);

    // Setup output scene (final render to screen)
    // Use a shader that forces alpha = 1.0 to fix faded recording issues
    this.outputScene = new THREE.Scene();
    const outputMaterial = new THREE.ShaderMaterial({
      vertexShader: passthroughVertexShader,
      fragmentShader: opaqueOutputFragmentShader,
      uniforms: {
        uTexture: { value: this.compositeTarget.texture },
        uOutputCrop: { value: new THREE.Vector4(0, 0, 1, 1) },
        uOutputRotation: { value: 0 },
        uBrightness: { value: 1 },
        uContrast: { value: 1 },
        uGamma: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const outputGeometry = new THREE.PlaneGeometry(2, 2);
    this.outputQuad = new THREE.Mesh(outputGeometry, outputMaterial);
    this.outputScene.add(this.outputQuad);

    // Setup effect render targets (ping-pong for multi-pass effects)
    this.effectTargetA = this.createRenderTarget();
    this.effectTargetB = this.createRenderTarget();
    this.effectBlendTarget = this.createRenderTarget();

    // Setup effect processing scene
    this.effectScene = new THREE.Scene();
    const effectGeometry = new THREE.PlaneGeometry(2, 2);
    this.effectQuad = new THREE.Mesh(effectGeometry);
    this.effectScene.add(this.effectQuad);

    // Track start time for animated effects
    this.startTime = performance.now() / 1000;

    // Initialize blend materials
    this.initBlendMaterials();

    // Initialize cached copy objects (reused every frame to avoid per-frame allocations)
    this._copyGeometry = new THREE.PlaneGeometry(2, 2);
    this._copyMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    this._copyMesh = new THREE.Mesh(this._copyGeometry, this._copyMaterial);
    this._copyScene = new THREE.Scene();
    this._copyScene.add(this._copyMesh);
    this._tempColor = new THREE.Color();
  }

  // Final output transform
  public setOutputTransform(params: OutputTransformParams): void {
    const material = this.outputQuad.material as THREE.ShaderMaterial;
    const cropX = Math.max(0, Math.min(0.99, params.cropX ?? 0));
    const cropY = Math.max(0, Math.min(0.99, params.cropY ?? 0));
    const cropWidth = Math.max(0.01, Math.min(1 - cropX, params.cropWidth ?? 1));
    const cropHeight = Math.max(0.01, Math.min(1 - cropY, params.cropHeight ?? 1));
    const rotation = (((params.rotation ?? 0) % 360) + 360) % 360;
    const rotationIndex = rotation === 90 ? 1 : rotation === 180 ? 2 : rotation === 270 ? 3 : 0;

    material.uniforms.uOutputCrop.value.set(cropX, cropY, cropWidth, cropHeight);
    material.uniforms.uOutputRotation.value = rotationIndex;
    material.uniforms.uBrightness.value = Math.max(0, params.brightness ?? 1);
    material.uniforms.uContrast.value = Math.max(0, params.contrast ?? 1);
    material.uniforms.uGamma.value = Math.max(0.001, params.gamma ?? 1);
  }

  // ─── Watermark System ─────────────────────────────────────────────────────
  // Tiled logo watermark: the Ghost Arcade brand mark renders as a grid
  // across the output, with one cell illuminated at a time on a 10s rotation.
  // Active in demo mode; removed once the user activates a Pro license.
  // Rendered in "screen" blend mode so it overlays everything including
  // recordings/Spout/Syphon output.

  /** Enable or disable the watermark overlay (controlled by license store) */
  setWatermark(enabled: boolean): void {
    this.watermarkEnabled = enabled;
  }

  private initWatermark(): void {
    if (this.watermarkScene) return; // Already initialized

    this.watermarkScene = new THREE.Scene();

    // Load logo texture — cache the loaded THREE.Texture across engine
    // instances (e.g. re-init, output window) so we avoid re-fetching the
    // PNG on every engine creation (~50-200ms on cold start).
    if (!_watermarkTextureCache) {
      const loader = new THREE.TextureLoader();
      _watermarkTextureCache = loader.load(
        './logo.png',
        () => { console.log('[Watermark] Logo texture loaded successfully (cached)'); },
        undefined,
        (err) => { console.error('[Watermark] Failed to load logo texture:', err); }
      );
      _watermarkTextureCache.minFilter = THREE.LinearFilter;
      _watermarkTextureCache.magFilter = THREE.LinearFilter;
    }
    this.watermarkTexture = _watermarkTextureCache;

    // Grid of logos: most are dark outlines, random ones illuminate full-color
    this.watermarkMaterial = new THREE.ShaderMaterial({
      vertexShader: passthroughVertexShader,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D uTexture;    // scene composite
        uniform sampler2D uLogo;       // logo texture
        uniform float uTime;
        uniform float uAspect;         // screen width/height
        uniform float uGridSize;       // logo size as fraction of screen height

        // Pseudo-random hash
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          vec4 base = texture2D(uTexture, vUv);

          // Compute grid cell — square cells based on screen height
          float cellH = uGridSize;
          float cellW = cellH / uAspect;

          vec2 cell = floor(vUv / vec2(cellW, cellH));
          vec2 cellUV = fract(vUv / vec2(cellW, cellH));

          // Add padding so logos don't touch edges (80% of cell used)
          float pad = 0.1;
          vec2 logoUV = (cellUV - pad) / (1.0 - 2.0 * pad);

          // Only draw if inside the padded logo area
          if (logoUV.x >= 0.0 && logoUV.x <= 1.0 && logoUV.y >= 0.0 && logoUV.y <= 1.0) {
            vec4 logo = texture2D(uLogo, logoUV);

            if (logo.a > 0.01) {
              // One logo illuminated at a time, 10 seconds each
              // Count total cells in view and pick one based on time
              float cols = floor(1.0 / cellW);
              float rows = floor(1.0 / cellH);
              float totalCells = cols * rows;
              float activeIndex = mod(floor(uTime / 10.0), totalCells);

              // Map cell to a shuffled index so it doesn't go left-to-right
              float cellIndex = cell.y * cols + cell.x;
              float shuffled = mod(cellIndex * 7.0 + 3.0, totalCells); // pseudo-shuffle

              // Smooth fade: 2s fade in, 6s hold, 2s fade out within 10s window
              float cycleT = mod(uTime, 10.0);
              float fadeIn = smoothstep(0.0, 2.0, cycleT);
              float fadeOut = 1.0 - smoothstep(8.0, 10.0, cycleT);
              float illuminate = (shuffled == activeIndex) ? fadeIn * fadeOut : 0.0;

              // Dark outline: very subtle darken so shader content stays visible
              float darkAlpha = logo.a * 0.08;  // barely-there dark outline
              vec3 darkened = base.rgb * (1.0 - darkAlpha);

              // Illuminated logo via soft difference blend (reduced intensity)
              vec3 diff = abs(base.rgb - logo.rgb);
              vec3 lit = mix(base.rgb, diff, 0.5); // 50% blend, not full difference

              // Mix between dark outline and illuminated
              vec3 result = mix(darkened, lit, illuminate * logo.a * 0.7);
              gl_FragColor = vec4(result, base.a);
            } else {
              gl_FragColor = base;
            }
          } else {
            gl_FragColor = base;
          }
        }
      `,
      uniforms: {
        uTexture: { value: null },
        uLogo: { value: this.watermarkTexture },
        uTime: { value: 0 },
        uAspect: { value: this.width / this.height },
        uGridSize: { value: 0.18 }, // each logo = 18% of screen height (fewer, larger)
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    const wmGeometry = new THREE.PlaneGeometry(2, 2);
    this.watermarkQuad = new THREE.Mesh(wmGeometry, this.watermarkMaterial);
    this.watermarkScene.add(this.watermarkQuad);
  }

  /** Apply watermark overlay to the compositeTarget (in-place) */
  private applyWatermark(): void {
    if (!this.watermarkEnabled) return;

    // Lazy-init watermark resources
    this.initWatermark();
    if (!this.watermarkScene || !this.watermarkMaterial || !this.watermarkQuad) return;

    const time = (performance.now() / 1000) - this.startTime;

    // Update uniforms
    this.watermarkMaterial.uniforms.uTexture.value = this.compositeTarget.texture;
    this.watermarkMaterial.uniforms.uTime.value = time;
    this.watermarkMaterial.uniforms.uAspect.value = this.width / this.height;

    // Render watermark over compositeTarget using tempTarget as scratch
    this.renderer.setRenderTarget(this.tempTarget);
    this.renderer.render(this.watermarkScene, this.camera);

    // Copy result back to compositeTarget (using cached copy objects)
    this._copyMaterial.map = this.tempTarget.texture;
    this.renderer.setRenderTarget(this.compositeTarget);
    this.renderer.render(this._copyScene, this.camera);
  }

  /** Update dome projection settings from the settings store */
  setDomeEnabled(enabled: boolean) {
    this.domeEnabled = enabled;
  }

  setDomeSettings(settings: {
    mode: 'angular' | 'stereographic' | 'orthographic' | 'equirectangular';
    fov: number;        // degrees
    rotation: number;   // degrees
    tilt: number;       // degrees
    offsetX: number;
    offsetY: number;
    curvature: number;
    truncation: number;
  }) {
    const modeMap = { angular: 0, stereographic: 1, orthographic: 2, equirectangular: 3 };
    this.domeSettings = {
      mode: modeMap[settings.mode] ?? 0,
      fov: (settings.fov * Math.PI) / 180,       // to radians
      rotation: (settings.rotation * Math.PI) / 180,
      tilt: (settings.tilt * Math.PI) / 180,
      offsetX: settings.offsetX,
      offsetY: settings.offsetY,
      curvature: settings.curvature,
      truncation: settings.truncation,
    };
  }

  private initDomeProjection() {
    if (this.domeScene) return;

    this.domeScene = new THREE.Scene();

    this.domeMaterial = new THREE.ShaderMaterial({
      vertexShader: passthroughVertexShader,
      fragmentShader: domeProjectionShader,
      uniforms: {
        uTexture: { value: null },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uFOV: { value: Math.PI },
        uRotation: { value: 0 },
        uTilt: { value: 0 },
        uOffset: { value: new THREE.Vector2(0, 0) },
        uMode: { value: 0 },
        uCurvature: { value: 1.0 },
        uTruncation: { value: 1.0 },
      },
      depthTest: false,
      depthWrite: false,
    });

    const geo = new THREE.PlaneGeometry(2, 2);
    this.domeQuad = new THREE.Mesh(geo, this.domeMaterial);
    this.domeScene.add(this.domeQuad);
  }

  /** Apply dome fisheye reprojection to compositeTarget (in-place) */
  private applyDomeProjection(): void {
    if (!this.domeEnabled) return;

    this.initDomeProjection();
    if (!this.domeScene || !this.domeMaterial) return;

    // Update uniforms
    this.domeMaterial.uniforms.uTexture.value = this.compositeTarget.texture;
    this.domeMaterial.uniforms.uResolution.value.set(this.width, this.height);
    this.domeMaterial.uniforms.uFOV.value = this.domeSettings.fov;
    this.domeMaterial.uniforms.uRotation.value = this.domeSettings.rotation;
    this.domeMaterial.uniforms.uTilt.value = this.domeSettings.tilt;
    this.domeMaterial.uniforms.uOffset.value.set(this.domeSettings.offsetX, this.domeSettings.offsetY);
    this.domeMaterial.uniforms.uMode.value = this.domeSettings.mode;
    this.domeMaterial.uniforms.uCurvature.value = this.domeSettings.curvature;
    this.domeMaterial.uniforms.uTruncation.value = this.domeSettings.truncation;

    // Render dome projection to tempTarget
    this.renderer.setRenderTarget(this.tempTarget);
    this.renderer.render(this.domeScene, this.camera);

    // Copy back to compositeTarget
    this._copyMaterial.map = this.tempTarget.texture;
    this.renderer.setRenderTarget(this.compositeTarget);
    this.renderer.render(this._copyScene, this.camera);
  }

  // GPU information detected at startup
  private gpuRenderer: string = 'unknown';
  private gpuVendor: string = 'unknown';
  private gpuIsIntegrated: boolean = false;
  private maxTextureSize: number = 4096; // set from GL params in constructor

  private detectGPU(): void {
    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      this.gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'unknown';
      this.gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'unknown';
    } else {
      this.gpuRenderer = gl.getParameter(gl.RENDERER) || 'unknown';
      this.gpuVendor = gl.getParameter(gl.VENDOR) || 'unknown';
    }

    // ANGLE wraps GPU names like: "ANGLE (NVIDIA GeForce RTX 4070 Laptop GPU Direct3D11 ...)"
    // First check if a discrete GPU name appears anywhere in the renderer string
    const rendererLower = this.gpuRenderer.toLowerCase();
    const discretePatterns = [
      'nvidia', 'geforce', 'rtx', 'gtx', 'quadro',  // NVIDIA discrete
      'radeon rx', 'radeon pro', 'radeon vii',        // AMD discrete
      'arc a',                                         // Intel Arc discrete
    ];
    const hasDiscreteGPU = discretePatterns.some(p => rendererLower.includes(p));

    // Only flag as integrated if NO discrete GPU name is found
    if (hasDiscreteGPU) {
      this.gpuIsIntegrated = false;
    } else {
      const integratedPatterns = [
        'intel', 'uhd', 'iris', 'hd graphics',  // Intel integrated
        'vega 3', 'vega 5', 'vega 6', 'vega 7', 'vega 8', 'vega 10', 'vega 11', // AMD APU iGPU
        'radeon(tm) graphics',  // AMD Ryzen iGPU (no model number = iGPU)
        'microsoft basic render', 'swiftshader', 'llvmpipe', // Software renderers
      ];
      this.gpuIsIntegrated = integratedPatterns.some(p => rendererLower.includes(p));
    }

    // Grab extra diagnostics that are useful when FPS is low — these often
    // reveal things like ANGLE fallback, D3D9-vs-D3D11 backend, very low
    // MAX_TEXTURE_SIZE on integrated GPUs, or a mismatched DPR blowing up
    // the backing-store resolution.
    const glVersion = gl.getParameter(gl.VERSION);
    const shadingVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const maxViewportDims = gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    const maxRenderBufferSize = gl.getParameter(gl.MAX_RENDERBUFFER_SIZE);
    const drawBufW = gl.drawingBufferWidth;
    const drawBufH = gl.drawingBufferHeight;
    const pixelRatio = this.renderer.getPixelRatio();

    // Log GPU info with clear warning if using integrated GPU. Prefix `[GPU]`
    // is whitelisted in electron/main.js's console-message forwarder so these
    // lines appear in the app's main log file (no DevTools needed).
    const gpuType = this.gpuIsIntegrated ? '⚠️  INTEGRATED GPU (may cause shader timeouts)' : '✅ Discrete GPU';
    console.log(`[GPU] Detected: ${this.gpuRenderer}`);
    console.log(`[GPU] Vendor: ${this.gpuVendor}`);
    console.log(`[GPU] Type: ${gpuType}`);
    console.log(`[GPU] GL Version: ${glVersion}`);
    console.log(`[GPU] GLSL Version: ${shadingVersion}`);
    console.log(`[GPU] Max Texture Size: ${maxTex}`);
    console.log(`[GPU] Max Renderbuffer: ${maxRenderBufferSize}`);
    console.log(`[GPU] Max Viewport: ${maxViewportDims?.[0]}x${maxViewportDims?.[1]}`);
    console.log(`[GPU] Drawing Buffer: ${drawBufW}x${drawBufH}  (pixelRatio=${pixelRatio}, window.devicePixelRatio=${typeof window !== 'undefined' ? window.devicePixelRatio : 'n/a'})`);
    console.log(`[GPU] Project Size: ${this.width}x${this.height}`);

    if (this.gpuIsIntegrated) {
      const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
      if (isMac) {
        // On macOS the user can't flip the GPU preference — Macs pick the GPU
        // automatically (or Apple Silicon has only one). Keep the warning but
        // don't print Windows-only settings advice that's nonsensical here.
        console.warn('[GPU] Running on integrated GPU. Heavy shaders may slow down or timeout on this machine.');
      } else {
        console.warn(
          '[GPU] WARNING: Running on integrated GPU. Heavy shaders may timeout.\n' +
          'To fix: Open Windows Graphics Settings → Add this app → Set to "High Performance".\n' +
          'Or in NVIDIA Control Panel → Manage 3D Settings → Add this program → High-performance NVIDIA processor.'
        );
      }
    }
  }

  /** Get detected GPU info for UI display */
  public getGPUInfo(): { renderer: string; vendor: string; isIntegrated: boolean } {
    return {
      renderer: this.gpuRenderer,
      vendor: this.gpuVendor,
      isIntegrated: this.gpuIsIntegrated,
    };
  }

  private createRenderTarget(): THREE.WebGLRenderTarget {
    // Clamp against the GPU's real limit. Callers that used to silently
    // succeed on desktop and throw on low-end iGPU laptops now behave
    // identically everywhere.
    const w = Math.min(this.width, this.maxTextureSize);
    const h = Math.min(this.height, this.maxTextureSize);
    try {
      return new THREE.WebGLRenderTarget(w, h, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
      });
    } catch (err) {
      // VRAM exhaustion or driver refusal — fall back to a tiny safe target
      // so the render pipeline can still complete (black output) instead of
      // crashing the whole engine init.
      console.error(`[RenderEngine] RenderTarget allocation failed at ${w}x${h}:`, err);
      return new THREE.WebGLRenderTarget(64, 64, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
      });
    }
  }

  private initBlendMaterials(): void {
    const modes: BlendMode[] = [
      'normal', 'multiply', 'screen', 'difference',
      'add', 'subtract', 'overlay', 'darken', 'lighten',
      'exclusion', 'hardlight', 'softlight', 'color-dodge', 'color-burn',
      'hue', 'saturation', 'color', 'luminosity',
      'divide', 'average', 'negation', 'phoenix',
      'linear-light', 'hard-mix', 'vivid-light', 'pin-light'
    ];
    for (const mode of modes) {
      this.blendMaterials.set(mode, this.createBlendMaterial(mode));
    }
  }

  private createBlendMaterial(mode: BlendMode): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: passthroughVertexShader,
      fragmentShader: blendShaders[mode] || blendShaders.normal,
      uniforms: {
        uBase: { value: null },
        uLayer: { value: null },
        uOpacity: { value: 1.0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  private createLayerMaterial(corners: WarpCorners): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      vertexShader: warpVertexShader,
      fragmentShader: textureFragmentShader,
      uniforms: {
        uTexture: { value: null },
        uOpacity: { value: 1.0 },
        uTopLeft: { value: new THREE.Vector2(corners.topLeft.x, corners.topLeft.y) },
        uTopRight: { value: new THREE.Vector2(corners.topRight.x, corners.topRight.y) },
        uBottomLeft: { value: new THREE.Vector2(corners.bottomLeft.x, corners.bottomLeft.y) },
        uBottomRight: { value: new THREE.Vector2(corners.bottomRight.x, corners.bottomRight.y) },
        uUseMeshPosition: { value: false },
        uCropRegion: { value: new THREE.Vector4(0, 0, 1, 1) },
        uCropEnabled: { value: false },
        uLayerShapeType: { value: 0 },
        uLayerShapeFeather: { value: 0.0 },
        uLayerShapeRotation: { value: 0.0 },
        uLayerShapeScale: { value: 1.0 },
        uLayerShapeHasControlPoints: { value: 0 },
        uLayerShapeControlPointCount: { value: 0 },
        uLayerShapeControlPoints: { value: [
          new THREE.Vector2(0.2, 0.8),
          new THREE.Vector2(0.8, 0.8),
          new THREE.Vector2(0.2, 0.2),
          new THREE.Vector2(0.8, 0.2),
          new THREE.Vector2(0.5, 0.5),
        ] },
        uFlipH: { value: false },
        uFlipV: { value: false },
        uContentFit: { value: 0 },     // 0=stretch, 1=fill, 2=crop
        uSourceAspect: { value: 1.0 },  // source width / height
        uLayerAspect: { value: 1.0 },   // layer quad width / height
        // Custom shape polygon (inline, warps with geometry) — tessellated for bezier
        uCustomShapeEnabled: { value: 0 },
        uCustomShapePointCount: { value: 0 },
        uCustomShapePoints: { value: Array.from({ length: 256 }, () => new THREE.Vector2(0, 0)) },
        uCustomShapeFit: { value: 1 },          // 0=mask, 1=warp(stretch-to-bbox), 2=fill(aspect-fit)
        uCustomShapeBBox: { value: new THREE.Vector4(0, 0, 1, 1) },  // minX, minY, maxX, maxY
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }

  private getOrCreateLayerObject(layer: Layer): LayerRenderObject {
    let obj = this.layerObjects.get(layer.id);

    // Shape masking is done via SDF post-process shader, not geometry.
    // Always use 'quad' for geometry. Shape type only used for legacy control point warping.
    const currentShapeType: LayerShapeType | 'quad' = 'quad';

    // Check if we need to recreate for mesh warp mode change
    const needsRecreate = obj && (
      (layer.warpMode === 'mesh' && obj.warpMode !== 'mesh') ||
      (layer.warpMode !== 'mesh' && obj.warpMode === 'mesh') ||
      (layer.warpMode === 'mesh' && layer.meshGrid &&
        (obj.meshGridSize?.rows !== layer.meshGrid.rows || obj.meshGridSize?.cols !== layer.meshGrid.cols))
    );

    // Store existing texture before recreating
    let existingTexture: THREE.Texture | null = null;
    if (needsRecreate && obj) {
      existingTexture = obj.material.uniforms.uTexture.value;
      obj.mesh.geometry.dispose();
      obj.material.dispose();
      obj.renderTarget.dispose();
      this.layerObjects.delete(layer.id);
      obj = undefined;
    }

    if (!obj) {
      let geometry: THREE.BufferGeometry;
      const defaultControlPoints: Point2D[] | undefined = undefined;

      if (layer.warpMode === 'mesh' && layer.meshGrid) {
        // For mesh warp, create geometry that matches the grid
        const segmentsX = layer.meshGrid.cols - 1;
        const segmentsY = layer.meshGrid.rows - 1;
        geometry = new THREE.PlaneGeometry(2, 2, segmentsX, segmentsY);
      } else {
        // For corner warp, use higher subdivisions for smooth bilinear interpolation
        geometry = new THREE.PlaneGeometry(2, 2, 32, 32);
      }

      const material = this.createLayerMaterial(layer.corners);

      // Restore existing texture if we had one
      if (existingTexture) {
        material.uniforms.uTexture.value = existingTexture;
      }

      const mesh = new THREE.Mesh(geometry, material);
      const renderTarget = this.createRenderTarget();

      // Store original UV coordinates for mesh warp mode
      // These are the normalized positions (-1 to 1) that we'll use to calculate UVs
      const positions = geometry.attributes.position;
      const originalUVs = new Float32Array(positions.count * 2);
      for (let i = 0; i < positions.count; i++) {
        // Store as UV coordinates (0-1 range)
        originalUVs[i * 2] = (positions.getX(i) + 1) / 2;
        originalUVs[i * 2 + 1] = (positions.getY(i) + 1) / 2;
      }

      obj = {
        mesh,
        material,
        renderTarget,
        geometry,
        warpMode: layer.warpMode === 'mesh' ? 'mesh' : 'corners',
        meshGridSize: layer.meshGrid ? { rows: layer.meshGrid.rows, cols: layer.meshGrid.cols } : undefined,
        originalUVs,
        shapeType: currentShapeType,
        defaultControlPoints,
      };
      this.layerObjects.set(layer.id, obj);
    }
    return obj;
  }

  // Apply mesh warp on top of corner warp
  // corners: the 4 corner positions that define the base quad
  // meshGrid: local deformations within that quad
  // originalUVs: the original UV coordinates (0-1) stored when geometry was created
  private applyMeshWarp(geometry: THREE.BufferGeometry, meshGrid: MeshWarpGrid, corners: WarpCorners, originalUVs: Float32Array): void {
    const positions = geometry.attributes.position;
    const rows = meshGrid.rows;
    const cols = meshGrid.cols;

    for (let i = 0; i < positions.count; i++) {
      // Get original UV coordinates (0-1) from stored array
      // This is critical - we can't read from positions because they get modified each frame
      const uvX = originalUVs[i * 2];
      // Flip Y coordinate - Three.js plane has Y going up, but we need it going down for proper orientation
      const uvY = 1.0 - originalUVs[i * 2 + 1];

      // First: get mesh deformation (local coords 0-1)
      const gridX = uvX * (cols - 1);
      const gridY = uvY * (rows - 1);

      const col0 = Math.floor(gridX);
      const col1 = Math.min(col0 + 1, cols - 1);
      const row0 = Math.floor(gridY);
      const row1 = Math.min(row0 + 1, rows - 1);

      const tx = gridX - col0;
      const ty = gridY - row0;

      // Bilinear interpolation of mesh grid points
      const p00 = meshGrid.points[row0][col0];
      const p10 = meshGrid.points[row0][col1];
      const p01 = meshGrid.points[row1][col0];
      const p11 = meshGrid.points[row1][col1];

      const meshX = (1 - tx) * (1 - ty) * p00.x + tx * (1 - ty) * p10.x +
                    (1 - tx) * ty * p01.x + tx * ty * p11.x;
      const meshY = (1 - tx) * (1 - ty) * p00.y + tx * (1 - ty) * p10.y +
                    (1 - tx) * ty * p01.y + tx * ty * p11.y;

      // Second: apply corner warp to the mesh-deformed position
      // Bilinear interpolation using the corner positions
      const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * meshX;
      const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * meshX;
      const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * meshX;
      const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * meshX;

      const finalX = bottomX + (topX - bottomX) * meshY;
      const finalY = bottomY + (topY - bottomY) * meshY;

      // Convert to clip space (-1, 1)
      positions.setXY(i, finalX * 2 - 1, finalY * 2 - 1);
    }

    positions.needsUpdate = true;
  }

  // Apply shape control point warping (currently unused - shape masking uses SDF post-process)
  // This modifies the geometry positions based on user-moved control points
  /* eslint-disable @typescript-eslint/no-unused-vars */
  /* istanbul ignore next -- reserved for future use */
  applyShapeWarp(
    geometry: THREE.BufferGeometry,
    shapeType: LayerShapeType | 'quad',
    controlPoints: Point2D[],
    defaultControlPoints: Point2D[],
    corners: WarpCorners
  ): void {
    if (!controlPoints.length || !defaultControlPoints.length) return;
    if (shapeType === 'quad' || shapeType === 'rectangle') return;

    const positions = geometry.attributes.position;

    // For triangle, we have direct vertex correspondence
    if (shapeType === 'triangle') {
      // Triangle has 3 vertices that directly map to 3 control points
      for (let i = 0; i < 3 && i < controlPoints.length; i++) {
        // Apply corner warp to the control point position
        const cp = controlPoints[i];
        const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * cp.x;
        const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * cp.x;
        const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * cp.x;
        const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * cp.x;
        const finalX = bottomX + (topX - bottomX) * cp.y;
        const finalY = bottomY + (topY - bottomY) * cp.y;

        // Convert to clip space
        positions.setXY(i, finalX * 2 - 1, finalY * 2 - 1);
      }
      positions.needsUpdate = true;
      return;
    }

    // For circular/radial shapes (circle, ellipse, polygon, star)
    // The geometry has rings, with control points being the outer edge
    // We need to interpolate inner vertices based on control point movement

    // Calculate deltas between default and current control points
    const deltas: Point2D[] = controlPoints.map((cp, i) => ({
      x: cp.x - defaultControlPoints[i].x,
      y: cp.y - defaultControlPoints[i].y,
    }));

    // Get the number of segments (control points on outer edge)
    const numControlPoints = controlPoints.length;

    // Iterate through all vertices in the geometry
    for (let i = 0; i < positions.count; i++) {
      // Get original position in clip space
      const posX = positions.getX(i);
      const posY = positions.getY(i);

      // Convert to normalized coordinates (0-1)
      const normX = (posX + 1) / 2;
      const normY = (posY + 1) / 2;

      // For center point (very close to 0.5, 0.5), don't warp
      const distFromCenter = Math.sqrt(Math.pow(normX - 0.5, 2) + Math.pow(normY - 0.5, 2));
      if (distFromCenter < 0.01) {
        // Apply corner warp only
        const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * normX;
        const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * normX;
        const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * normX;
        const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * normX;
        const finalX = bottomX + (topX - bottomX) * normY;
        const finalY = bottomY + (topY - bottomY) * normY;
        positions.setXY(i, finalX * 2 - 1, finalY * 2 - 1);
        continue;
      }

      // Calculate angle from center (to find which control points influence this vertex)
      const angle = Math.atan2(normY - 0.5, normX - 0.5);
      // Normalize angle to 0-1 range (matching control point distribution)
      const normalizedAngle = (angle + Math.PI) / (2 * Math.PI);

      // Find the two nearest control points
      const cpIndexFloat = normalizedAngle * numControlPoints;
      const cpIndex0 = Math.floor(cpIndexFloat) % numControlPoints;
      const cpIndex1 = (cpIndex0 + 1) % numControlPoints;
      const t = cpIndexFloat - Math.floor(cpIndexFloat);

      // Interpolate delta from the two control points
      const delta = {
        x: deltas[cpIndex0].x * (1 - t) + deltas[cpIndex1].x * t,
        y: deltas[cpIndex0].y * (1 - t) + deltas[cpIndex1].y * t,
      };

      // Scale delta by distance from center (outer = full effect, center = no effect)
      const maxDist = 0.5; // maximum distance from center in normalized space
      const warpStrength = Math.min(1, distFromCenter / maxDist);

      // Apply the warped position
      const warpedX = normX + delta.x * warpStrength;
      const warpedY = normY + delta.y * warpStrength;

      // Apply corner warp
      const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * warpedX;
      const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * warpedX;
      const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * warpedX;
      const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * warpedX;
      const finalX = bottomX + (topX - bottomX) * warpedY;
      const finalY = bottomY + (topY - bottomY) * warpedY;

      positions.setXY(i, finalX * 2 - 1, finalY * 2 - 1);
    }

    positions.needsUpdate = true;
  }

  public updateLayerCorners(layerId: string, corners: WarpCorners): void {
    const obj = this.layerObjects.get(layerId);
    if (obj) {
      obj.material.uniforms.uTopLeft.value.set(corners.topLeft.x, corners.topLeft.y);
      obj.material.uniforms.uTopRight.value.set(corners.topRight.x, corners.topRight.y);
      obj.material.uniforms.uBottomLeft.value.set(corners.bottomLeft.x, corners.bottomLeft.y);
      obj.material.uniforms.uBottomRight.value.set(corners.bottomRight.x, corners.bottomRight.y);
    }
  }

  public updateLayerTexture(layerId: string, texture: THREE.Texture): void {
    const obj = this.layerObjects.get(layerId);
    if (obj) {
      obj.material.uniforms.uTexture.value = texture;
    }
  }

  public removeLayer(layerId: string): void {
    const obj = this.layerObjects.get(layerId);
    if (obj) {
      obj.mesh.geometry.dispose();
      obj.material.dispose();
      obj.renderTarget.dispose();
      this.layerObjects.delete(layerId);
    }
    // Also clean up color texture if exists
    const colorTex = this.colorTextures.get(layerId);
    if (colorTex) {
      colorTex.dispose();
      this.colorTextures.delete(layerId);
    }
    // Clean up mask material if exists
    const maskMat = this.maskMaterials.get(layerId);
    if (maskMat) {
      maskMat.dispose();
      this.maskMaterials.delete(layerId);
    }
  }

  /**
   * Convert HSL to RGB
   * h: 0-360, s: 0-100, l: 0-100
   * Returns [r, g, b] in 0-255 range
   */
  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [
      Math.round(f(0) * 255),
      Math.round(f(8) * 255),
      Math.round(f(4) * 255)
    ];
  }

  /**
   * Get or create a color texture for a solid color layer
   */
  public getOrCreateColorTexture(layerId: string, colorContent: ColorContent): THREE.DataTexture {
    let texture = this.colorTextures.get(layerId);

    if (!texture) {
      // Create a 1x1 texture for solid color
      const data = new Uint8Array(4);
      texture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      this.colorTextures.set(layerId, texture);
    }

    // Update color data
    const [r, g, b] = this.hslToRgb(colorContent.hue, colorContent.saturation, colorContent.lightness);
    const alpha = Math.round(colorContent.alpha * 255);
    const data = texture.image.data as Uint8Array;
    data[0] = r;
    data[1] = g;
    data[2] = b;
    data[3] = alpha;
    texture.needsUpdate = true;

    return texture;
  }

  /**
   * Get or create an effect material for the given effect
   */
  private getOrCreateEffectMaterial(effect: Effect): THREE.ShaderMaterial {
    let material = this.effectMaterials.get(effect.id);
    if (!material) {
      material = createEffectMaterial(effect.type);
      // Force shader compilation to detect errors early
      material.needsUpdate = true;
      this.effectMaterials.set(effect.id, material);

      // Log shader compilation errors
      const gl = this.renderer.getContext();
      const program = (material as any).program;
      if (program) {
        const fragShader = program.fragmentShader;
        if (fragShader && !gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
          console.error(`[Effect ${effect.type}] Fragment shader error:`, gl.getShaderInfoLog(fragShader));
        }
      }
    }
    return material;
  }

  /**
   * Get or create a mask material for a layer
   */
  private getOrCreateMaskMaterial(layerId: string): THREE.ShaderMaterial {
    let material = this.maskMaterials.get(layerId);
    if (!material) {
      // Initialize uniforms with array of Vector2 for points
      const pointUniforms: THREE.Vector2[] = [];
      for (let i = 0; i < 64; i++) {
        pointUniforms.push(new THREE.Vector2(0, 0));
      }

      material = new THREE.ShaderMaterial({
        vertexShader: effectVertexShader,
        fragmentShader: polygonMaskShader,
        uniforms: {
          uTexture: { value: null },
          uPoints: { value: pointUniforms },
          uPointCount: { value: 0 },
          uFeather: { value: 0 },
          uInvert: { value: 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      this.maskMaterials.set(layerId, material);
    }
    return material;
  }

  /**
   * Tessellate a bezier sub-polygon into a straight-segment point list using
   * the same approach as the custom layer-shape mask (cubic bezier between
   * each pair of anchors). Anchors without cpOut/cpIn produce straight
   * segments. Capped at the shader's 64-point uniform — if a single shape
   * exceeds that, we drop the overflow with a console warning.
   */
  private tessellateMaskShape(anchors: import('../types').BezierPoint[]): Point2D[] {
    const out: Point2D[] = [];
    const BEZIER_STEPS = 24;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const nextI = (i + 1) % anchors.length;
      const b = anchors[nextI];
      const hasCurve = a.cpOut || b.cpIn;
      out.push({ x: a.x, y: a.y });
      if (hasCurve) {
        const cp1 = a.cpOut ?? a;
        const cp2 = b.cpIn ?? b;
        for (let s = 1; s < BEZIER_STEPS; s++) {
          const t = s / BEZIER_STEPS;
          const mt = 1 - t;
          out.push({
            x: mt * mt * mt * a.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * b.x,
            y: mt * mt * mt * a.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * b.y,
          });
        }
      }
    }
    return out;
  }

  /** Lazy-create the union-accumulation material (alpha-only output). */
  private getOrCreateMaskUnionAccumMaterial(): THREE.ShaderMaterial {
    if (!this.maskUnionAccumMaterial) {
      const pointUniforms: THREE.Vector2[] = [];
      for (let i = 0; i < 64; i++) pointUniforms.push(new THREE.Vector2(0, 0));
      this.maskUnionAccumMaterial = new THREE.ShaderMaterial({
        vertexShader: effectVertexShader,
        fragmentShader: polygonMaskAlphaShader,
        uniforms: {
          uPoints: { value: pointUniforms },
          uPointCount: { value: 0 },
          uFeather: { value: 0 },
        },
        // Custom alpha-max blending: dst.a = max(dst.a, src.a). Lets each pass
        // contribute its silhouette to the union without overwriting prior
        // shapes.
        transparent: true,
        blending: THREE.CustomBlending,
        blendEquationAlpha: THREE.MaxEquation,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneFactor,
        // Color channel: keep src so first shape paints white(1,1,1,a) and
        // subsequent shapes inherit; we only sample .a downstream anyway.
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
        depthTest: false,
        depthWrite: false,
      });
    }
    return this.maskUnionAccumMaterial;
  }

  /** Lazy-create the "apply external mask" compositor. */
  private getOrCreateMaskApplyMaterial(): THREE.ShaderMaterial {
    if (!this.maskApplyMaterial) {
      this.maskApplyMaterial = new THREE.ShaderMaterial({
        vertexShader: effectVertexShader,
        fragmentShader: applyExternalMaskShader,
        uniforms: {
          uSource: { value: null },
          uMask: { value: null },
          uInvert: { value: 0 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
    }
    return this.maskApplyMaterial;
  }

  /**
   * Apply polygon mask to a texture
   * Returns the masked texture
   *
   * Handles the three cases:
   *  - 0 closed shapes: pass-through (no mask to apply)
   *  - 1 closed shape: single-pass `polygonMaskShader` (preserves the legacy
   *    rendering exactly for users who only ever drew one polygon)
   *  - 2+ closed shapes: build the union silhouette into `maskUnionTarget`
   *    using THREE.MaxEquation on alpha, then multiply through with
   *    `applyExternalMaskShader`.
   */
  private applyMask(
    sourceTexture: THREE.Texture,
    mask: MaskConfig,
    layerId: string
  ): THREE.Texture {
    if (!mask.enabled) return sourceTexture;
    const shapes = mask.shapes ?? [];
    const closedShapes = shapes.filter((s) => s.closed && s.points.length >= 3);
    if (closedShapes.length === 0) return sourceTexture;

    // Tessellate every closed shape once. Drop shapes that still don't have
    // enough points after tessellation (defensive — shouldn't happen) and
    // warn if any single shape exceeds the 64-point shader uniform cap.
    const tessellated: Point2D[][] = [];
    for (const shape of closedShapes) {
      let pts = this.tessellateMaskShape(shape.points);
      if (pts.length < 3) continue;
      if (pts.length > 64) {
        // Naive downsample: keep every Nth point. Bezier tessellation is
        // already dense; this preserves overall silhouette quality.
        console.warn(`[applyMask] Shape on layer ${layerId} tessellates to ${pts.length} points (>64); downsampling for shader.`);
        const stride = pts.length / 64;
        const ds: Point2D[] = [];
        for (let i = 0; i < 64; i++) ds.push(pts[Math.floor(i * stride)]);
        pts = ds;
      }
      tessellated.push(pts);
    }
    if (tessellated.length === 0) return sourceTexture;

    // Ensure the final-mask target exists (used by both paths)
    if (!this.maskTarget) {
      this.maskTarget = this.createRenderTarget();
    }

    const prevMaskClearColor = this.renderer.getClearColor(this._tempColor);
    const prevMaskClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);

    if (tessellated.length === 1) {
      // ── Single-shape path: identical to the legacy implementation. ──
      const pts = tessellated[0];
      const material = this.getOrCreateMaskMaterial(layerId);
      material.uniforms.uTexture.value = sourceTexture;
      material.uniforms.uPointCount.value = Math.min(pts.length, 64);
      material.uniforms.uFeather.value = mask.feather;
      material.uniforms.uInvert.value = mask.inverted ? 1.0 : 0.0;
      const pointsUniform = material.uniforms.uPoints.value as THREE.Vector2[];
      for (let i = 0; i < 64; i++) {
        if (i < pts.length) pointsUniform[i].set(pts[i].x, pts[i].y);
        else pointsUniform[i].set(0, 0);
      }
      this.effectQuad.material = material;
      this.renderer.setRenderTarget(this.maskTarget);
      this.renderer.clear();
      this.renderer.render(this.effectScene, this.camera);
    } else {
      // ── Multi-shape union path. ──
      if (!this.maskUnionTarget) {
        this.maskUnionTarget = this.createRenderTarget();
      }
      const accumMat = this.getOrCreateMaskUnionAccumMaterial();

      // Clear union target to fully transparent so MaxEquation starts at 0.
      this.renderer.setRenderTarget(this.maskUnionTarget);
      this.renderer.clear();

      // Three.js defaults autoClear=true, which would CLEAR the target
      // before every render() call — wiping out previous shapes and
      // leaving only the last one's silhouette. Disable it for the
      // accumulation loop, then restore. This is the bug that made
      // 2+ shape masks render as if only the last shape existed.
      const prevAutoClear = this.renderer.autoClear;
      this.renderer.autoClear = false;

      // Accumulate each shape's silhouette into the alpha channel via
      // CustomBlending + MaxEquation. The shader writes vec4(1,1,1,inside).
      this.effectQuad.material = accumMat;
      const accumUniform = accumMat.uniforms.uPoints.value as THREE.Vector2[];
      for (const pts of tessellated) {
        const n = Math.min(pts.length, 64);
        accumMat.uniforms.uPointCount.value = n;
        accumMat.uniforms.uFeather.value = mask.feather;
        for (let i = 0; i < 64; i++) {
          if (i < pts.length) accumUniform[i].set(pts[i].x, pts[i].y);
          else accumUniform[i].set(0, 0);
        }
        this.renderer.render(this.effectScene, this.camera);
      }

      this.renderer.autoClear = prevAutoClear;

      // Apply the union mask to the source texture (uSource.rgb, uSource.a *
      // unionAlpha, with optional invert).
      const applyMat = this.getOrCreateMaskApplyMaterial();
      applyMat.uniforms.uSource.value = sourceTexture;
      applyMat.uniforms.uMask.value = this.maskUnionTarget.texture;
      applyMat.uniforms.uInvert.value = mask.inverted ? 1.0 : 0.0;
      this.effectQuad.material = applyMat;
      this.renderer.setRenderTarget(this.maskTarget);
      this.renderer.clear();
      this.renderer.render(this.effectScene, this.camera);
    }

    this.renderer.setClearColor(prevMaskClearColor, prevMaskClearAlpha);
    return this.maskTarget.texture;
  }

  /**
   * Apply SDF shape mask to a texture (circle, ellipse, triangle, polygon, star)
   * Uses signed distance functions to clip the layer to a shape with feathered edges
   */
  private applyShapeMask(
    sourceTexture: THREE.Texture,
    layer: Layer
  ): THREE.Texture {
    if (!layer.layerShape || !layer.layerShape.enabled || layer.layerShape.type === 'rectangle') {
      return sourceTexture;
    }

    // Custom shapes use the polygon mask shader (ray-casting) instead of SDF
    if (layer.layerShape.type === 'custom') {
      const customPoints = layer.layerShape.params.customPoints;
      if (!customPoints || customPoints.length < 3 || !layer.layerShape.params.customClosed) {
        return sourceTexture;
      }
      if (!this.shapeMaskTarget) {
        this.shapeMaskTarget = this.createRenderTarget();
      }
      const material = this.getOrCreateMaskMaterial(layer.id + '_custom');
      material.uniforms.uTexture.value = sourceTexture;
      material.uniforms.uPointCount.value = Math.min(customPoints.length, 64);
      material.uniforms.uFeather.value = layer.layerShape.params.feather ?? 0;
      material.uniforms.uInvert.value = 0;
      const pointsUniform = material.uniforms.uPoints.value as THREE.Vector2[];
      for (let i = 0; i < 64; i++) {
        if (i < customPoints.length) {
          pointsUniform[i].set(customPoints[i].x, customPoints[i].y);
        } else {
          pointsUniform[i].set(0, 0);
        }
      }
      const prevClearColor = this.renderer.getClearColor(this._tempColor);
      const prevClearAlpha = this.renderer.getClearAlpha();
      this.renderer.setClearColor(0x000000, 0);
      this.effectQuad.material = material;
      this.renderer.setRenderTarget(this.shapeMaskTarget);
      this.renderer.clear();
      this.renderer.render(this.effectScene, this.camera);
      this.renderer.setClearColor(prevClearColor, prevClearAlpha);
      return this.shapeMaskTarget.texture;
    }

    // Create shape mask target if needed
    if (!this.shapeMaskTarget) {
      this.shapeMaskTarget = this.createRenderTarget();
    }

    // Create shape mask material if needed
    if (!this.shapeMaskMaterial) {
      this.shapeMaskMaterial = new THREE.ShaderMaterial({
        vertexShader: effectVertexShader,
        fragmentShader: layerShapeMaskShader,
        uniforms: {
          uTexture: { value: null },
          uShapeType: { value: 0 },
          uRadiusX: { value: 0.5 },
          uRadiusY: { value: 0.5 },
          uSides: { value: 6 },
          uInnerRadius: { value: 0.4 },
          uRotation: { value: 0.0 },
          uFeather: { value: 0.0 },
          uScale: { value: 1.0 },
          uLineWidth: { value: 0.05 },
          uLineStart: { value: new THREE.Vector2(0.2, 0.5) },
          uLineEnd: { value: new THREE.Vector2(0.8, 0.5) },
          uInvert: { value: 0 },
          uHasControlPoints: { value: 0 },
          uControlPointCount: { value: 0 },
          uControlPoints: { value: [
            new THREE.Vector2(0.2, 0.8),
            new THREE.Vector2(0.8, 0.8),
            new THREE.Vector2(0.2, 0.2),
            new THREE.Vector2(0.8, 0.2),
            new THREE.Vector2(0.5, 0.5),
          ] },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
    }

    // Map shape type to integer
    const shapeTypeMap: Record<string, number> = {
      rectangle: 0,
      circle: 1,
      ellipse: 2,
      triangle: 3,
      polygon: 4,
      star: 5,
      line: 6,
      polyline: 6,
    };

    const params = layer.layerShape.params;
    const mat = this.shapeMaskMaterial;

    // Update uniforms
    mat.uniforms.uTexture.value = sourceTexture;
    mat.uniforms.uShapeType.value = shapeTypeMap[layer.layerShape.type] ?? 0;
    mat.uniforms.uRadiusX.value = params.radiusX ?? 0.5;
    mat.uniforms.uRadiusY.value = params.radiusY ?? 0.35;
    mat.uniforms.uSides.value = params.sides ?? 6;
    mat.uniforms.uInnerRadius.value = params.innerRadius ?? 0.4;
    mat.uniforms.uRotation.value = (params.rotation ?? 0) * Math.PI / 180;
    mat.uniforms.uFeather.value = params.feather ?? 0;
    mat.uniforms.uScale.value = params.scale ?? 1.0;
    mat.uniforms.uLineWidth.value = params.lineWidth ?? 0.05;
    mat.uniforms.uInvert.value = params.invert ? 1 : 0;
    mat.uniforms.uHasControlPoints.value = 0;
    mat.uniforms.uControlPointCount.value = 0;

    const cps = layer.layerShape.controlPoints;
    if (
      cps &&
      cps.length > 0 &&
      (layer.layerShape.type === 'circle' || layer.layerShape.type === 'triangle')
    ) {
      const target = mat.uniforms.uControlPoints.value as THREE.Vector2[];
      const count = Math.min(cps.length, target.length);
      for (let i = 0; i < count; i++) {
        target[i].set(cps[i].x, cps[i].y);
      }
      mat.uniforms.uHasControlPoints.value = 1;
      mat.uniforms.uControlPointCount.value = count;
    }

    // Render shape mask - clear to TRANSPARENT black so masked-off areas have alpha=0
    const prevShapeClearColor = this.renderer.getClearColor(this._tempColor);
    const prevShapeClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);

    this.effectQuad.material = mat;
    this.renderer.setRenderTarget(this.shapeMaskTarget);
    this.renderer.clear();
    this.renderer.render(this.effectScene, this.camera);

    this.renderer.setClearColor(prevShapeClearColor, prevShapeClearAlpha);

    return this.shapeMaskTarget.texture;
  }

  /**
   * Apply all enabled effects to a render target
   * Uses ping-pong rendering between effectTargetA and effectTargetB
   * Returns the final texture after all effects are applied
   */
  private applyEffects(
    sourceTexture: THREE.Texture,
    effects: Effect[]
  ): THREE.Texture {
    const enabledEffects = effects.filter(e => e.enabled);
    if (enabledEffects.length === 0) {
      return sourceTexture;
    }

    const currentTime = performance.now() / 1000 - this.startTime;
    let currentSource = sourceTexture;
    let writeTarget = this.effectTargetA;
    let readTarget = this.effectTargetB;

    // Use transparent clear for effects so alpha is preserved correctly
    const prevEffClearColor = this.renderer.getClearColor(this._tempColor);
    const prevEffClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);

    for (let i = 0; i < enabledEffects.length; i++) {
      const effect = enabledEffects[i];
      const material = this.getOrCreateEffectMaterial(effect);

      // Update effect uniforms
      updateEffectUniforms(material, effect, this.width, this.height, currentTime);

      // Set input texture
      material.uniforms.uTexture.value = currentSource;

      const effectOpacity = effect.opacity ?? 1;
      const effectBlend = effect.blendMode ?? 'normal';
      const needsBlendPass = effectOpacity < 1 || effectBlend !== 'normal';

      // Save pre-effect source for blend pass
      const preEffectSource = currentSource;

      // Render effect
      this.effectQuad.material = material;
      this.renderer.setRenderTarget(writeTarget);
      this.renderer.clear();
      this.renderer.render(this.effectScene, this.camera);

      if (needsBlendPass) {
        // Blend the effect output with the pre-effect source using the effect's blend mode.
        // Uses a dedicated third render target to avoid ping-pong conflicts
        // (both A and B may hold data needed as inputs).
        const blendMat = this.blendMaterials.get(effectBlend) || this.blendMaterials.get('normal')!;
        blendMat.uniforms.uBase.value = preEffectSource;
        blendMat.uniforms.uLayer.value = writeTarget.texture;
        blendMat.uniforms.uOpacity.value = effectOpacity;

        this.effectQuad.material = blendMat;
        this.renderer.setRenderTarget(this.effectBlendTarget);
        this.renderer.clear();
        this.renderer.render(this.effectScene, this.camera);

        // Blended result is in effectBlendTarget. WebGL executes sequentially,
        // so the next effect will fully read this before any subsequent blend overwrites it.
        currentSource = this.effectBlendTarget.texture;
        // Standard swap so writeTarget is free for the next effect pass
        const temp = writeTarget;
        writeTarget = readTarget;
        readTarget = temp;
      } else {
        // Normal full-opacity pass — just swap
        currentSource = writeTarget.texture;
        const temp = writeTarget;
        writeTarget = readTarget;
        readTarget = temp;
      }
    }

    this.renderer.setClearColor(prevEffClearColor, prevEffClearAlpha);

    return currentSource;
  }

  /**
   * Build a render plan: partition the flat layer array into render units.
   * Group layers bundle their visible children. Children of hidden groups are skipped.
   * When no groups exist, all units are standalone — zero overhead.
   */
  private buildRenderPlan(layers: Layer[]): RenderUnit[] {
    const units: RenderUnit[] = [];
    const childIds = new Set(layers.filter(l => l.parentGroupId).map(l => l.id));

    for (const layer of layers) {
      // Skip children — they're handled by their parent group
      if (layer.parentGroupId) continue;
      if (!layer.visible) continue;

      if (layer.type === 'group') {
        const groupHasSource = !!(layer.source?.texture);
        const children = layers.filter(l =>
          l.parentGroupId === layer.id && l.visible && (groupHasSource || this.hasLayerTexture(l))
        );
        if (children.length > 0) {
          units.push({ kind: 'group', group: layer, children });
        }
      } else if (this.hasLayerTexture(layer)) {
        units.push({ kind: 'standalone', layer });
      }
    }

    return units;
  }

  /** Check if a layer has renderable content (texture, color, etc.) */
  private hasLayerTexture(l: Layer): boolean {
    if ((l.type === 'media' || l.type === 'screen') && l.source) {
      if (l.source.texture) return true;
      const cached = this.layerObjects.get(l.id);
      if (cached && cached.material.uniforms.uTexture.value) return true;
      return false;
    }
    if (l.type === 'lines' && (l as any)._linesTexture) return true;
    if (l.type === 'svg' && (l as any)._svgTexture) return true;
    if (l.type === 'color' && l.colorContent) return true;
    if (l.type === 'lightpainting' && (l as any)._lightPaintingTexture) return true;
    if (l.type === 'text' && (l as any)._textTexture) return true;
    if (l.type === 'splat' && (l as any)._splatTexture) return true;
    if (l.type === 'model3d' && (l as any)._model3dTexture) return true;
    return false;
  }

  public render(
    layers: Layer[],
    drawingTexture?: THREE.Texture | null,
    compositionEffects?: Effect[],
    /** Macros — each macro carries an effect chain that's run on the
     *  composite output after compositionEffects. The macro's `value`
     *  (0..1) scales each effect's opacity to act as a single wet/dry
     *  knob for the whole bundle. value=0 → bundle is invisible (dry
     *  passthrough); value=1 → bundle at its authored opacity values.
     *  Multiple macros stack — ENERGY then CHAOS run in sequence on
     *  the composite. */
    macroBundles?: { id: string; value: number; effects: Effect[] }[],
  ): void {
    // Build render plan — partitions layers into standalone and group units
    const renderPlan = this.buildRenderPlan(layers);
    // Reverse so top-of-list renders last (on top)
    renderPlan.reverse();

    if (this.crossfadeActive) {
      // ─── Dual-bank crossfade path ───────────────────────────────────
      // Partition the plan by Layer.bank tag. Layers without a bank tag
      // (e.g. mapping-mode layers in stage mode) bypass the crossfader
      // entirely and overlay on top of the mixed banks at the end.
      const aUnits = renderPlan.filter(u => this.unitBank(u) === 'A');
      const bUnits = renderPlan.filter(u => this.unitBank(u) === 'B');
      const neutralUnits = renderPlan.filter(u => !this.unitBank(u));

      this.ensureBankTargets();

      // Render Bank A into bankATarget. We swap this.compositeTarget so
      // the existing compositeTexture() / processLayerPipeline() / etc
      // all write into the bank target without any of them needing to
      // know about bank routing.
      const origCompositeTarget = this.compositeTarget;

      this.compositeTarget = this.bankATarget!;
      this.renderer.setRenderTarget(this.bankATarget);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      this.renderUnitsToCurrentTarget(aUnits);

      this.compositeTarget = this.bankBTarget!;
      this.renderer.setRenderTarget(this.bankBTarget);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      this.renderUnitsToCurrentTarget(bUnits);

      this.compositeTarget = origCompositeTarget;

      // Mix bankA + bankB → compositeTarget via the chosen transition shader
      this.applyBankCrossfade();

      // Then render any neutral (non-bank-tagged) units on top
      if (neutralUnits.length > 0) {
        // compositeIdx starts at 1 so the first neutral layer blends
        // (rather than clearing) the freshly-mixed bank composite.
        this.renderUnitsToCurrentTarget(neutralUnits, /* startIdx */ 1);
      }
    } else {
      // ─── Single-bank (default) path ────────────────────────────────
      this.renderer.setRenderTarget(this.compositeTarget);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear();
      this.renderUnitsToCurrentTarget(renderPlan);
    }

    // Composite drawing layer on top if provided
    if (drawingTexture) {
      // Copy current composite to temp
      this.swapTargets();

      // Blend drawing texture on top using additive blending
      const blendMat = this.blendMaterials.get('add') || this.blendMaterials.get('normal')!;
      blendMat.uniforms.uBase.value = this.tempTarget.texture;
      blendMat.uniforms.uLayer.value = drawingTexture;
      blendMat.uniforms.uOpacity.value = 1.0;
      this.compositeQuad.material = blendMat;

      this.renderer.setRenderTarget(this.compositeTarget);
      this.renderer.render(this.compositeScene, this.camera);
    }

    // Apply composition-level effects to the final composite (after all layers blended)
    if (compositionEffects && compositionEffects.length > 0) {
      let compositeTexture: THREE.Texture = this.compositeTarget.texture;
      compositeTexture = this.applyEffects(compositeTexture, compositionEffects);

      // If effects produced a different texture, copy it back to compositeTarget (using cached copy objects)
      if (compositeTexture !== this.compositeTarget.texture) {
        this._copyMaterial.map = compositeTexture;
        this.renderer.setRenderTarget(this.compositeTarget);
        this.renderer.render(this._copyScene, this.camera);
      }
    }

    // Apply macro effect bundles AFTER composition effects. Each macro
    // is a wet/dry knob: run the chain at its authored per-effect
    // opacities, then mix the bundle's output with the pre-bundle
    // composite by `bundle.value`. value=0 → original passthrough,
    // value=1 → fully effected. Bundles stack: each bundle's wet output
    // becomes the next bundle's input.
    //
    // Earlier impl (v1) scaled each effect's `opacity` by bundle.value
    // and re-ran applyEffects(). For some effects (notably ones whose
    // shader writes opaque black/zero alpha for "no-effect" pixels —
    // posterize, certain glow/light masks, etc.) this triggered a
    // per-effect blend pass against the composite that produced a
    // darker-than-expected output below opacity=1; at midrange knob
    // values the result clamped near full black. Doing a single
    // top-of-bundle wet/dry mix with the existing 'normal' blend
    // material avoids that — every effect runs with its authored
    // opacity (preserving the visual the operator tuned in the popover
    // expand panel), and the macro knob is purely a final crossfade
    // between original and effected.
    if (macroBundles && macroBundles.length > 0) {
      for (const bundle of macroBundles) {
        if (bundle.value <= 0.001 || bundle.effects.length === 0) continue;
        const enabled = bundle.effects.filter(e => e.enabled);
        if (enabled.length === 0) continue;

        // Capture the dry composite BEFORE the chain runs. We need it
        // as the base for the wet/dry mix below. swap+copy puts the
        // pre-bundle composite into tempTarget so we can read from it
        // while writing to compositeTarget.
        this.swapTargets();
        const dryTexture = this.tempTarget.texture;

        // Run the bundle at full effect opacities. applyEffects reads
        // from `dryTexture` and writes to its internal ping-pong
        // targets, ultimately returning a texture handle for the wet
        // result.
        const wetTexture = this.applyEffects(dryTexture, enabled);

        // Wet/dry mix → compositeTarget via the 'normal' blend material.
        // mix(dry, wet, layer.a * uOpacity) — passing layer alpha as 1
        // (effect output is opaque) and uOpacity = bundle.value gives
        // a clean linear crossfade dry → wet across the knob's 0..1.
        const blendMat = this.blendMaterials.get('normal')!;
        blendMat.uniforms.uBase.value = dryTexture;
        blendMat.uniforms.uLayer.value = wetTexture;
        blendMat.uniforms.uOpacity.value = bundle.value;
        this.compositeQuad.material = blendMat;
        this.renderer.setRenderTarget(this.compositeTarget);
        this.renderer.clear();
        this.renderer.render(this.compositeScene, this.camera);
      }
    }

    // Apply watermark overlay for demo/free tier (after effects, before final output)
    this.applyWatermark();

    // Apply dome projection (after watermark, before final output)
    this.applyDomeProjection();

    // Render final composite to screen
    if (this.transitionProgress < 1) {
      // Transition active: blend snapshot with live composite
      this.applyTransition();
    } else {
      // Normal output: use the output shader to apply projection-safe final transforms.
      this.renderer.setRenderTarget(null);
      (this.outputQuad.material as THREE.ShaderMaterial).uniforms.uTexture.value = this.compositeTarget.texture;
      this.renderer.render(this.outputScene, this.camera);
    }
  }

  private swapTargets(): void {
    // Copy composite to temp by rendering (using cached copy objects)
    this._copyMaterial.map = this.compositeTarget.texture;
    this.renderer.setRenderTarget(this.tempTarget);
    this.renderer.render(this._copyScene, this.camera);
  }

  /**
   * Composite a texture onto the main compositeTarget using blend mode.
   */
  private compositeTexture(texture: THREE.Texture, opacity: number, blendMode: BlendMode, isFirst: boolean): void {
    if (isFirst) {
      const blendMat = this.blendMaterials.get('normal')!;
      blendMat.uniforms.uBase.value = this.createBlackTexture();
      blendMat.uniforms.uLayer.value = texture;
      blendMat.uniforms.uOpacity.value = opacity;
      this.compositeQuad.material = blendMat;
      this.renderer.setRenderTarget(this.compositeTarget);
      this.renderer.render(this.compositeScene, this.camera);
    } else {
      this.swapTargets();
      const blendMat = this.blendMaterials.get(blendMode) || this.blendMaterials.get('normal')!;
      blendMat.uniforms.uBase.value = this.tempTarget.texture;
      blendMat.uniforms.uLayer.value = texture;
      blendMat.uniforms.uOpacity.value = opacity;
      this.compositeQuad.material = blendMat;
      this.renderer.setRenderTarget(this.compositeTarget);
      this.renderer.render(this.compositeScene, this.camera);
    }
  }

  /**
   * Render a group's children to a group render target and return the texture.
   * Individual mode: each child renders normally to the group target.
   * Unified mode: group's shader fills the target, children act as masked windows.
   * Group warp is applied to the composited result.
   */
  private renderGroupToTexture(group: Layer, children: Layer[]): THREE.Texture | null {
    // Get or create group render target
    let groupTarget = this.groupTargets.get(group.id);
    if (!groupTarget) {
      groupTarget = this.createRenderTarget();
      this.groupTargets.set(group.id, groupTarget);
    }

    // Clear group target
    this.renderer.setRenderTarget(groupTarget);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();

    const config = group.groupConfig;
    const isUnified = config?.shaderMode === 'unified';
    const overrideStyles = config?.overrideStyles ?? false;

    // Group's source texture (shader rendered by Canvas.svelte updateShaderTextures)
    const groupSourceTexture = group.source?.texture ?? null;

    // Swap compositeTarget to render children into group target
    const origComposite = this.compositeTarget;
    this.compositeTarget = groupTarget;

    let childIdx = 0;
    for (const child of children) {
      // Determine texture source for this child
      const useGroupTexture = groupSourceTexture != null;

      if (!useGroupTexture && !this.hasLayerTexture(child)) continue;

      // ── Inject group's texture as child's source ──────────────────────
      let origChildTexture: any = null;
      let origContentFit: any = null;
      let origCropRegion: any = null;
      let origCropEnabled: boolean = false;
      if (useGroupTexture) {
        if (!child.source) {
          (child as any).source = { texture: groupSourceTexture, type: 'shader', src: '', id: 'group-inject', name: 'group' };
        } else {
          origChildTexture = child.source.texture;
          (child.source as any).texture = groupSourceTexture;
        }

        origContentFit = child.contentFit;
        origCropRegion = child.cropRegion;

        if (isUnified) {
          // Unified mode: shader fills entire canvas; each child shows only its portion.
          // We'll apply the UV crop directly on the material uniform after processLayerPipeline
          // sets up the child, so it works with ALL shape types (rect, custom, circle, etc.)
          (child as any).contentFit = 'stretch';
          // Tag this child so we can apply unified crop after material setup
          (child as any)._unifiedCrop = true;
        } else if (overrideStyles && group.contentFit) {
          // Individual mode with override: use group's content fit for all children
          (child as any).contentFit = group.contentFit;
        }
      }

      // ── Group effects propagation ────────────────────────────────────
      const origEffects = child.effects;
      const groupHasEffects = (group.effects?.length ?? 0) > 0;
      if (groupHasEffects) {
        if (overrideStyles) {
          (child as any).effects = group.effects;
        } else {
          (child as any).effects = [...(child.effects ?? []), ...(group.effects ?? [])];
        }
      }

      // ── Group edge effects ALWAYS apply to child shapes ──────────────
      const origEdge = child.edgeEffects;
      const groupHasEdgeEffects = group.edgeEffects?.enabled && (group.edgeEffects.effects?.length ?? 0) > 0;
      if (groupHasEdgeEffects) {
        (child as any).edgeEffects = group.edgeEffects;
      }

      // ── Render the child through the full pipeline ───────────────────
      const obj = this.getOrCreateLayerObject(child);
      const layerTexture = this.getLayerTexture(child, obj);
      if (layerTexture) {
        const finalTexture = this.processLayerPipeline(child, obj, layerTexture);
        this.compositeTexture(finalTexture, child.opacity, child.blendMode, childIdx === 0);
        childIdx++;
      }

      // ── Restore overridden properties ────────────────────────────────
      if (groupHasEffects) {
        (child as any).effects = origEffects;
      }
      if (groupHasEdgeEffects) {
        (child as any).edgeEffects = origEdge;
      }
      if (useGroupTexture) {
        if (origChildTexture !== null && child.source) {
          (child.source as any).texture = origChildTexture;
        } else if ((child.source as any)?.id === 'group-inject') {
          (child as any).source = null;
        }
        (child as any).contentFit = origContentFit;
        (child as any).cropRegion = origCropRegion;
        delete (child as any)._unifiedCrop;
      }
    }

    // Restore compositeTarget
    this.compositeTarget = origComposite;

    // Apply group-level warp if the group has non-default corners
    const gc = group.corners;
    const hasGroupWarp = gc.topLeft.x !== 0 || gc.topLeft.y !== 1 ||
      gc.topRight.x !== 1 || gc.topRight.y !== 1 ||
      gc.bottomLeft.x !== 0 || gc.bottomLeft.y !== 0 ||
      gc.bottomRight.x !== 1 || gc.bottomRight.y !== 0;

    if (hasGroupWarp) {
      // Render the group target through a warp layer object
      const groupObj = this.getOrCreateLayerObject(group);
      groupObj.material.uniforms.uTexture.value = groupTarget.texture;
      groupObj.material.uniforms.uUseMeshPosition.value = false;
      groupObj.material.uniforms.uCustomShapeEnabled.value = 0;
      groupObj.material.uniforms.uLayerShapeType.value = 0;
      groupObj.material.uniforms.uCropEnabled.value = false;
      groupObj.material.uniforms.uFlipH.value = false;
      groupObj.material.uniforms.uFlipV.value = false;
      groupObj.material.uniforms.uContentFit.value = 0;
      this.updateLayerCorners(group.id, group.corners);

      // Render warped group to a temp target
      const prevClearColor = this.renderer.getClearColor(this._tempColor);
      const prevClearAlpha = this.renderer.getClearAlpha();
      this.renderer.setClearColor(0x000000, 0);
      this.scene.add(groupObj.mesh);
      this.renderer.setRenderTarget(groupObj.renderTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      this.scene.remove(groupObj.mesh);
      this.renderer.setClearColor(prevClearColor, prevClearAlpha);

      return groupObj.renderTarget.texture;
    }

    return groupTarget.texture;
  }

  /** Get the renderable texture for a layer */
  private getLayerTexture(layer: Layer, obj: LayerRenderObject): THREE.Texture | null {
    if (layer.type === 'lines') return (layer as any)._linesTexture;
    if (layer.type === 'svg') return (layer as any)._svgTexture;
    if (layer.type === 'lightpainting') return (layer as any)._lightPaintingTexture;
    if (layer.type === 'text') return (layer as any)._textTexture;
    if (layer.type === 'splat') return (layer as any)._splatTexture;
    if (layer.type === 'model3d') return (layer as any)._model3dTexture;
    if (layer.type === 'color' && layer.colorContent) return this.getOrCreateColorTexture(layer.id, layer.colorContent);
    return layer.source?.texture || obj.material.uniforms.uTexture.value;
  }

  /**
   * Process a layer through the full render pipeline (material setup, warp, render, effects, mask).
   * Returns the final compositable texture.
   */
  private processLayerPipeline(layer: Layer, obj: LayerRenderObject, layerTexture: THREE.Texture): THREE.Texture {
    // Update material
    obj.material.uniforms.uTexture.value = layerTexture;

    const activeShapeType = layer.layerShape?.enabled ? layer.layerShape.type : 'rectangle';
    const inlineShapeTypeMap: Record<string, number> = { rectangle: 0, circle: 1, triangle: 2 };
    const inlineShapeType = inlineShapeTypeMap[activeShapeType] ?? 0;

    // Crop region
    if (layer.cropRegion && inlineShapeType === 0) {
      obj.material.uniforms.uCropEnabled.value = true;
      obj.material.uniforms.uCropRegion.value.set(layer.cropRegion.x, layer.cropRegion.y, layer.cropRegion.width, layer.cropRegion.height);
    } else {
      obj.material.uniforms.uCropEnabled.value = false;
      obj.material.uniforms.uCropRegion.value.set(0, 0, 1, 1);
    }

    // Inline layer shape
    obj.material.uniforms.uLayerShapeType.value = inlineShapeType;
    obj.material.uniforms.uLayerShapeFeather.value = layer.layerShape?.params.feather ?? 0.0;
    obj.material.uniforms.uLayerShapeRotation.value = ((layer.layerShape?.params.rotation ?? 0) * Math.PI) / 180;
    obj.material.uniforms.uLayerShapeScale.value = layer.layerShape?.params.scale ?? 1.0;
    obj.material.uniforms.uLayerShapeHasControlPoints.value = 0;
    obj.material.uniforms.uLayerShapeControlPointCount.value = 0;

    // Custom shape
    if (activeShapeType === 'custom' && layer.layerShape?.params.customPoints && layer.layerShape.params.customClosed) {
      const customPts = layer.layerShape.params.customPoints;
      if (customPts.length >= 3) {
        const tessellated: { x: number; y: number }[] = [];
        // Higher step count = smoother curves but more vertices in the
        // shader polygon test (capped at 256 below). 24 keeps tight curves
        // visually clean while leaving headroom for ~10 anchor segments.
        const BEZIER_STEPS = 24;
        for (let ci = 0; ci < customPts.length; ci++) {
          const a = customPts[ci];
          const nextI = (ci + 1) % customPts.length;
          const b = customPts[nextI];
          const hasCurve = a.cpOut || b.cpIn;
          tessellated.push({ x: a.x, y: a.y });
          if (hasCurve) {
            const cp1 = a.cpOut ?? a;
            const cp2 = b.cpIn ?? b;
            for (let s = 1; s < BEZIER_STEPS; s++) {
              const t = s / BEZIER_STEPS;
              const mt = 1 - t;
              tessellated.push({
                x: mt * mt * mt * a.x + 3 * mt * mt * t * cp1.x + 3 * mt * t * t * cp2.x + t * t * t * b.x,
                y: mt * mt * mt * a.y + 3 * mt * mt * t * cp1.y + 3 * mt * t * t * cp2.y + t * t * t * b.y,
              });
            }
          }
        }
        const count = Math.min(tessellated.length, 256);

        // Compute UV expansion range (if points extend beyond 0-1)
        let uvMinU = 0, uvMaxU = 1, uvMinV = 0, uvMaxV = 1;
        for (let ci = 0; ci < count; ci++) {
          uvMinU = Math.min(uvMinU, tessellated[ci].x);
          uvMaxU = Math.max(uvMaxU, tessellated[ci].x);
          uvMinV = Math.min(uvMinV, tessellated[ci].y);
          uvMaxV = Math.max(uvMaxV, tessellated[ci].y);
        }

        // If points extend beyond 0-1, remap them into the expanded UV space
        // The geometry will be expanded to cover [uvMinU, uvMaxU] x [uvMinV, uvMaxV]
        // so the shader's 0-1 UV corresponds to that expanded range
        const needsExpand = uvMinU < 0 || uvMaxU > 1 || uvMinV < 0 || uvMaxV > 1;
        const uvRangeU = uvMaxU - uvMinU;
        const uvRangeV = uvMaxV - uvMinV;

        obj.material.uniforms.uCustomShapeEnabled.value = 1;
        obj.material.uniforms.uCustomShapePointCount.value = count;
        const target = obj.material.uniforms.uCustomShapePoints.value as THREE.Vector2[];
        for (let ci = 0; ci < count; ci++) {
          if (needsExpand) {
            // Remap from original UV space to expanded 0-1 UV space
            target[ci].set(
              (tessellated[ci].x - uvMinU) / uvRangeU,
              (tessellated[ci].y - uvMinV) / uvRangeV
            );
          } else {
            target[ci].set(tessellated[ci].x, tessellated[ci].y);
          }
        }

        // BBox in the remapped UV space
        let bbMinX = 1, bbMinY = 1, bbMaxX = 0, bbMaxY = 0;
        for (let ci = 0; ci < count; ci++) {
          bbMinX = Math.min(bbMinX, target[ci].x);
          bbMinY = Math.min(bbMinY, target[ci].y);
          bbMaxX = Math.max(bbMaxX, target[ci].x);
          bbMaxY = Math.max(bbMaxY, target[ci].y);
        }
        obj.material.uniforms.uCustomShapeBBox.value.set(bbMinX, bbMinY, bbMaxX, bbMaxY);
        const fitMode = layer.layerShape?.params.customShapeFit ?? 'warp';
        const fitMap: Record<string, number> = { mask: 0, warp: 1, fill: 2 };
        obj.material.uniforms.uCustomShapeFit.value = fitMap[fitMode] ?? 1;
      } else {
        obj.material.uniforms.uCustomShapeEnabled.value = 0;
      }
    } else {
      obj.material.uniforms.uCustomShapeEnabled.value = 0;
    }

    // Flip, content fit, aspect
    obj.material.uniforms.uFlipH.value = layer.flipH || false;
    obj.material.uniforms.uFlipV.value = layer.flipV || false;
    const contentFitMap: Record<string, number> = { stretch: 0, fill: 1, crop: 2 };
    obj.material.uniforms.uContentFit.value = contentFitMap[layer.contentFit || 'stretch'] ?? 0;
    let sourceAspect = this.width / this.height;
    if (layerTexture && (layerTexture as any).image) {
      const img = (layerTexture as any).image;
      if (img.videoWidth && img.videoHeight) sourceAspect = img.videoWidth / img.videoHeight;
      else if (img.width && img.height) sourceAspect = img.width / img.height;
    }
    obj.material.uniforms.uSourceAspect.value = sourceAspect;
    const corners = layer.corners;
    const minX = Math.min(corners.topLeft.x, corners.bottomLeft.x, corners.topRight.x, corners.bottomRight.x);
    const maxX = Math.max(corners.topLeft.x, corners.bottomLeft.x, corners.topRight.x, corners.bottomRight.x);
    const minY = Math.min(corners.topLeft.y, corners.bottomLeft.y, corners.topRight.y, corners.bottomRight.y);
    const maxY = Math.max(corners.topLeft.y, corners.bottomLeft.y, corners.topRight.y, corners.bottomRight.y);
    obj.material.uniforms.uLayerAspect.value = (maxY - minY) * this.height > 0 ? ((maxX - minX) * this.width) / ((maxY - minY) * this.height) : 1.0;

    // Control points
    const cps = layer.layerShape?.controlPoints;
    if ((inlineShapeType === 1 || inlineShapeType === 2) && cps && cps.length > 0) {
      const target = obj.material.uniforms.uLayerShapeControlPoints.value as THREE.Vector2[];
      const count = Math.min(cps.length, target.length);
      for (let cpIndex = 0; cpIndex < count; cpIndex++) target[cpIndex].set(cps[cpIndex].x, cps[cpIndex].y);
      obj.material.uniforms.uLayerShapeHasControlPoints.value = 1;
      obj.material.uniforms.uLayerShapeControlPointCount.value = count;
    }

    // Warp — expand corner bounds to encompass custom shape points that extend beyond the quad
    let effectiveCorners = layer.corners;
    if (activeShapeType === 'custom' && layer.layerShape?.params.customPoints && layer.layerShape.params.customClosed) {
      const cpts = layer.layerShape.params.customPoints;
      if (cpts.length >= 3) {
        // Find bounding box of custom shape in 0-1 UV space
        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (const cp of cpts) {
          minU = Math.min(minU, cp.x, cp.cpOut?.x ?? cp.x, cp.cpIn?.x ?? cp.x);
          maxU = Math.max(maxU, cp.x, cp.cpOut?.x ?? cp.x, cp.cpIn?.x ?? cp.x);
          minV = Math.min(minV, cp.y, cp.cpOut?.y ?? cp.y, cp.cpIn?.y ?? cp.y);
          maxV = Math.max(maxV, cp.y, cp.cpOut?.y ?? cp.y, cp.cpIn?.y ?? cp.y);
        }
        // If any point extends beyond 0-1 UV space, expand corners via bilinear extrapolation
        // Use the full UV bounding box (clamped to include 0-1) as the new effective quad
        const eMinU = Math.min(minU, 0);
        const eMaxU = Math.max(maxU, 1);
        const eMinV = Math.min(minV, 0);
        const eMaxV = Math.max(maxV, 1);

        if (eMinU < 0 || eMaxU > 1 || eMinV < 0 || eMaxV > 1) {
          const c = layer.corners;
          // Bilinear interpolation: map (u, v) in [0,1] local space to canvas coords
          // Then extrapolate to the expanded UV range
          function bilinear(u: number, v: number) {
            const u1 = 1 - u, v1 = 1 - v;
            return {
              x: c.bottomLeft.x * u1 * v1 + c.bottomRight.x * u * v1 + c.topLeft.x * u1 * v + c.topRight.x * u * v,
              y: c.bottomLeft.y * u1 * v1 + c.bottomRight.y * u * v1 + c.topLeft.y * u1 * v + c.topRight.y * u * v,
            };
          }
          effectiveCorners = {
            topLeft: bilinear(eMinU, eMaxV),
            topRight: bilinear(eMaxU, eMaxV),
            bottomLeft: bilinear(eMinU, eMinV),
            bottomRight: bilinear(eMaxU, eMinV),
          };
        }
      }
    }

    if (layer.warpMode === 'mesh' && layer.meshGrid && obj.originalUVs) {
      this.applyMeshWarp(obj.geometry, layer.meshGrid, layer.corners, obj.originalUVs);
      obj.material.uniforms.uUseMeshPosition.value = true;
    } else {
      obj.material.uniforms.uUseMeshPosition.value = false;
      this.updateLayerCorners(layer.id, effectiveCorners);
    }

    // ── Unified group crop: override crop uniform to map texture → child's screen region ──
    // This runs AFTER all other material setup so it works with any shape type.
    let prevCropEnabled: boolean | undefined;
    let prevCropRegion: THREE.Vector4 | undefined;
    if ((layer as any)._unifiedCrop) {
      const c = layer.corners;
      const minX = Math.min(c.topLeft.x, c.topRight.x, c.bottomLeft.x, c.bottomRight.x);
      const maxX = Math.max(c.topLeft.x, c.topRight.x, c.bottomLeft.x, c.bottomRight.x);
      const minY = Math.min(c.topLeft.y, c.topRight.y, c.bottomLeft.y, c.bottomRight.y);
      const maxY = Math.max(c.topLeft.y, c.topRight.y, c.bottomLeft.y, c.bottomRight.y);

      prevCropEnabled = obj.material.uniforms.uCropEnabled.value;
      prevCropRegion = obj.material.uniforms.uCropRegion.value.clone();

      // Map UVs so child shows only its portion of the full-canvas shader
      // uCropRegion: sampledUv = xy + sampledUv * zw
      // So xy = offset, zw = scale (portion of texture to show)
      obj.material.uniforms.uCropEnabled.value = true;
      obj.material.uniforms.uCropRegion.value.set(minX, 1 - maxY, maxX - minX, maxY - minY);
    }

    // Render to layer target
    const prevClearColor = this.renderer.getClearColor(this._tempColor);
    const prevClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(obj.mesh);
    this.renderer.setRenderTarget(obj.renderTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.scene.remove(obj.mesh);
    this.renderer.setClearColor(prevClearColor, prevClearAlpha);

    // Restore crop if we overrode it for unified mode
    if ((layer as any)._unifiedCrop) {
      obj.material.uniforms.uCropEnabled.value = prevCropEnabled;
      obj.material.uniforms.uCropRegion.value.copy(prevCropRegion!);
      delete (layer as any)._unifiedCrop;
    }

    let finalTexture: THREE.Texture = obj.renderTarget.texture;

    // Effects
    if (layer.effects && layer.effects.length > 0) {
      finalTexture = this.applyEffects(finalTexture, layer.effects);
    }
    // Polygon mask (union of one-or-more bezier sub-polygons)
    if (
      layer.mask &&
      layer.mask.enabled &&
      layer.mask.shapes &&
      layer.mask.shapes.some((s) => s.closed && s.points.length >= 3)
    ) {
      finalTexture = this.applyMask(finalTexture, layer.mask, layer.id);
    }
    // Legacy shape mask
    if (layer.layerShape && layer.layerShape.enabled && !['rectangle', 'circle', 'triangle', 'custom'].includes(layer.layerShape.type)) {
      finalTexture = this.applyShapeMask(finalTexture, layer);
    }
    // Edge effects
    if (layer.edgeEffects?.enabled && layer.edgeEffects.effects.length > 0) {
      finalTexture = this.renderLayerEdgeEffects(finalTexture, layer);
    }

    return finalTexture;
  }

  private blackTexture: THREE.DataTexture | null = null;

  private createBlackTexture(): THREE.Texture {
    if (!this.blackTexture) {
      // Transparent black base so first composited layer keeps true alpha.
      const data = new Uint8Array([0, 0, 0, 0]);
      this.blackTexture = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      this.blackTexture.needsUpdate = true;
    }
    return this.blackTexture;
  }

  /**
   * Resize the render engine.
   * @param projectW  Project output width (canvas backing store resolution)
   * @param projectH  Project output height (canvas backing store resolution)
   * @param displayW  Optional CSS display width (from container). If omitted, CSS is not touched.
   * @param displayH  Optional CSS display height (from container). If omitted, CSS is not touched.
   */
  public resize(projectW: number, projectH: number, displayW?: number, displayH?: number): void {
    this.width = projectW;
    this.height = projectH;

    // Keep pixelRatio at 1 — see construction-time comment. Resize must not
    // re-introduce DPR scaling or the backing store will balloon on retina Macs.
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(projectW, projectH, false); // false = don't modify CSS styles

    // CSS display size is handled by the canvas's CSS rule (width: 100%; height: 100%)
    // which fills the aspect-ratio-constrained container. Do NOT set inline styles here —
    // setting explicit pixel dimensions can race with the container's aspect-ratio CSS
    // and cause the canvas to appear square or misshapen.

    // Resize render targets to project resolution
    this.compositeTarget.setSize(projectW, projectH);
    this.tempTarget.setSize(projectW, projectH);
    this.effectTargetA.setSize(projectW, projectH);
    this.effectTargetB.setSize(projectW, projectH);
    this.effectBlendTarget.setSize(projectW, projectH);

    // Resize layer render targets
    for (const obj of this.layerObjects.values()) {
      obj.renderTarget.setSize(projectW, projectH);
    }

    // Bank crossfade FBOs (full-canvas resolution) — resize in place if
    // they exist so the dual-deck composite still maps 1:1.
    if (this.bankATarget) this.bankATarget.setSize(projectW, projectH);
    if (this.bankBTarget) this.bankBTarget.setSize(projectW, projectH);

    // Per-VJ-layer crossfade FBOs — resize in place too.
    for (const rt of this.vjCrossfadeTargets.values()) {
      rt.setSize(projectW, projectH);
    }
  }

  public getRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /**
   * After a WebGL context loss & restore, the old RenderTarget and material
   * handles point at freed GPU resources — drawing to them emits INVALID_*
   * errors silently. Canvas.svelte already nukes the layer-side caches in its
   * `webglcontextrestored` handler; call this to rebuild the engine-side
   * compositeTarget, tempTarget, effectTargetA/B, effectBlendTarget, and
   * blend materials so the engine is fully functional on the next frame.
   */
  public reinitAfterContextRestore(): void {
    try {
      // Dispose the stale handles (no-op on freed GPU resources but frees JS-side refs).
      try { this.compositeTarget.dispose(); } catch {}
      try { this.tempTarget.dispose(); } catch {}
      try { this.effectTargetA.dispose(); } catch {}
      try { this.effectTargetB.dispose(); } catch {}
      try { this.effectBlendTarget.dispose(); } catch {}

      // Recreate render targets at current project dimensions.
      this.compositeTarget = this.createRenderTarget();
      this.tempTarget = this.createRenderTarget();
      this.effectTargetA = this.createRenderTarget();
      this.effectTargetB = this.createRenderTarget();
      this.effectBlendTarget = this.createRenderTarget();

      // Re-point the output quad at the new composite target so blit to screen works.
      const outMat = this.outputQuad?.material as THREE.ShaderMaterial | undefined;
      if (outMat && outMat.uniforms?.uTexture) {
        outMat.uniforms.uTexture.value = this.compositeTarget.texture;
        outMat.needsUpdate = true;
      }

      // Blend materials reference shader programs that also got invalidated.
      // Dispose and rebuild.
      for (const mat of this.blendMaterials.values()) {
        try { mat.dispose(); } catch {}
      }
      this.blendMaterials.clear();
      this.initBlendMaterials();

      // Re-assert debug flag (cheap idempotent setting).
      this.renderer.debug.checkShaderErrors = true;

      console.log('[RenderEngine] Reinitialised after context restore.');
    } catch (err) {
      console.error('[RenderEngine] reinitAfterContextRestore failed:', err);
    }
  }

  /**
   * Set the renderer reference for edge effects rendering.
   * Called from Canvas.svelte after LinesRenderer is created.
   */
  public setDrawingRenderer(renderer: any): void {
    this.drawingRendererRef = renderer;
  }

  /**
   * Set the DrawingRenderer reference for edge effects with fill/animation support.
   */
  public setShapeRenderer(renderer: any): void {
    this.shapeRendererRef = renderer;
  }

  /**
   * Render edge effects for a layer and composite them onto the provided texture.
   * Uses DrawingRenderer (fill + animation + stroke) when available,
   * falls back to LinesRenderer (stroke-only).
   */
  private renderLayerEdgeEffects(
    sourceTexture: THREE.Texture,
    layer: Layer
  ): THREE.Texture {
    const renderer = this.shapeRendererRef || this.drawingRendererRef;
    if (!layer.edgeEffects?.enabled || layer.edgeEffects.effects.length === 0 || !renderer) {
      return sourceTexture;
    }

    // Get polygon vertices from shape (in UV space 0-1)
    // For layers without a custom shape, use default rectangle edges
    const uvVertices = layer.layerShape
      ? getShapeVertices(layer.layerShape)
      : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    if (uvVertices.length < 3) return sourceTexture;

    // Transform UV-space vertices through the layer's corner warp to screen space (0-1 normalized)
    const corners = layer.corners;
    const screenVertices = uvVertices.map(uv => {
      const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * uv.x;
      const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * uv.x;
      const botX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * uv.x;
      const botY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * uv.x;
      return {
        x: botX + (topX - botX) * uv.y,
        y: botY + (topY - botY) * uv.y,
      };
    });

    // Inset vertices toward the centroid so the stroke renders INSIDE the
    // layer boundary, not centered on it. This means thicker strokes grow
    // inward and the outer edge stays aligned with the layer bounds.
    // Use aspect-corrected inset so the inset looks uniform in pixels on
    // both axes (0-1 normalized coords are stretched on a 16:9 canvas).
    const cx = screenVertices.reduce((s, v) => s + v.x, 0) / screenVertices.length;
    const cy = screenVertices.reduce((s, v) => s + v.y, 0) / screenVertices.length;
    const targetW = this.compositeTarget?.width || 1920;
    const targetH = this.compositeTarget?.height || 1080;
    const insetPx = 5; // pixels of inset
    const insetVertices = screenVertices.map(v => {
      const dx = cx - v.x;
      const dy = cy - v.y;
      // Convert direction to pixel space, normalize, scale by insetPx, convert back
      const dxPx = dx * targetW;
      const dyPx = dy * targetH;
      const lenPx = Math.sqrt(dxPx * dxPx + dyPx * dyPx) || 1;
      return {
        x: v.x + (dxPx / lenPx) * insetPx / targetW,
        y: v.y + (dyPx / lenPx) * insetPx / targetH,
      };
    });

    // Shaders support max 64 custom vertices — downsample if needed
    let vertices: Point2D[];
    if (insetVertices.length <= 64) {
      vertices = insetVertices;
    } else {
      vertices = [];
      const step = insetVertices.length / 64;
      for (let i = 0; i < 64; i++) {
        vertices.push(insetVertices[Math.floor(i * step)]);
      }
    }

    // Create edge effect render target if needed
    if (!this.edgeEffectTarget) {
      this.edgeEffectTarget = this.createRenderTarget();
    }

    let currentTexture = sourceTexture;
    const useDrawingRenderer = !!this.shapeRendererRef;

    for (const effect of layer.edgeEffects.effects) {
      if (!effect.enabled) continue;

      let element: any;

      if (useDrawingRenderer) {
        // Use DrawingRenderer — full fill, animation, and stroke support
        const drawingElement: DrawingElement = {
          id: effect.id,
          name: 'edge-effect',
          shape: {
            id: 'edge-temp',
            type: 'pointClickLine',
            visible: true,
            locked: false,
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
            zIndex: 0,
            points: vertices,
            closed: true,
            cornerStyle: 'sharp',
          } as PointClickLineShape,
          fill: effect.fill,
          stroke: effect.stroke,
          animation: effect.animation,
          warpCorners: createDefaultShapeWarp(),
          warpEnabled: false,
          meshWarp: createDefaultShapeMesh(),
          meshWarpEnabled: false,
          shadowEnabled: false,
          blendMode: effect.blendMode as any ?? 'normal',
          opacity: effect.opacity ?? 1,
        };
        element = drawingElement;
      } else {
        // Fallback: LinesRenderer — stroke only (no fill or animation)
        const lineElement: LineElement = {
          id: effect.id,
          name: 'edge-effect',
          visible: true,
          locked: false,
          zIndex: 0,
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
          shape: {
            type: 'pointClick',
            points: vertices,
            closed: true,
            cornerStyle: 'sharp',
          },
          stroke: effect.stroke as any,
          drawAnimation: { enabled: false, drawProgress: 1, drawSpeed: 1, trailLength: 0, loopMode: 'once', reverse: false, easing: 'linear' },
          warpCorners: createDefaultShapeWarp(),
          warpEnabled: false,
          meshWarp: createDefaultShapeMesh(),
          meshWarpEnabled: false,
          blendMode: effect.blendMode as any ?? 'normal',
          opacity: effect.opacity ?? 1,
        };
        element = lineElement;
      }

      // Render the edge effect to the edge effect target
      const effectTexture = renderer.renderElements(
        [element],
        this.edgeEffectTarget
      );

      // Composite edge effect onto current texture using the effect's blend mode
      // Copy current texture to temp target
      this.swapTargets();
      const tempTex = this.tempTarget.texture;

      // First copy currentTexture to a known target
      const copyMat = this.blendMaterials.get('normal')!;
      copyMat.uniforms.uBase.value = this.createBlackTexture();
      copyMat.uniforms.uLayer.value = currentTexture;
      copyMat.uniforms.uOpacity.value = 1.0;
      this.compositeQuad.material = copyMat;
      this.renderer.setRenderTarget(this.tempTarget);
      this.renderer.render(this.compositeScene, this.camera);

      // Now blend edge effect on top
      const blendMat = this.blendMaterials.get(effect.blendMode) || this.blendMaterials.get('normal')!;
      blendMat.uniforms.uBase.value = this.tempTarget.texture;
      blendMat.uniforms.uLayer.value = effectTexture;
      blendMat.uniforms.uOpacity.value = effect.opacity;
      this.compositeQuad.material = blendMat;

      // Use effectTargetA as output for the blended result
      this.renderer.setRenderTarget(this.effectTargetA);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(this.compositeScene, this.camera);

      currentTexture = this.effectTargetA.texture;
    }

    return currentTexture;
  }

  public getCompositeTexture(): THREE.Texture {
    return this.compositeTarget.texture;
  }

  public dispose(): void {
    this.compositeTarget.dispose();
    this.tempTarget.dispose();
    this.effectTargetA.dispose();
    this.effectTargetB.dispose();
    this.effectBlendTarget.dispose();
    this.blackTexture?.dispose();
    this.maskTarget?.dispose();
    this.maskUnionTarget?.dispose();
    this.maskUnionAccumMaterial?.dispose();
    this.maskApplyMaterial?.dispose();

    for (const material of this.blendMaterials.values()) {
      material.dispose();
    }

    for (const material of this.effectMaterials.values()) {
      material.dispose();
    }
    this.effectMaterials.clear();

    // Dispose mask materials
    for (const material of this.maskMaterials.values()) {
      material.dispose();
    }
    this.maskMaterials.clear();

    for (const obj of this.layerObjects.values()) {
      obj.mesh.geometry.dispose();
      obj.material.dispose();
      obj.renderTarget.dispose();
    }

    // Dispose color textures
    for (const texture of this.colorTextures.values()) {
      texture.dispose();
    }
    this.colorTextures.clear();

    // Dispose transition resources
    this.transitionTarget?.dispose();
    this.transitionMaterial?.dispose();
    this.domeMaterial?.dispose();

    // Dispose VJ A/B crossfade resources
    this.bankATarget?.dispose();
    this.bankBTarget?.dispose();
    this.bankATarget = null;
    this.bankBTarget = null;
    for (const mat of this.crossfadeMaterials.values()) {
      try { mat.dispose(); } catch {}
    }
    this.crossfadeMaterials.clear();
    this.disposeVJCrossfadeTargets();

    // Dispose cached copy objects
    this._copyGeometry.dispose();
    this._copyMaterial.dispose();

    this.renderer.dispose();
  }

  /**
   * Remove effect material when an effect is deleted
   */
  public removeEffectMaterial(effectId: string): void {
    const material = this.effectMaterials.get(effectId);
    if (material) {
      material.dispose();
      this.effectMaterials.delete(effectId);
    }
  }

  /**
   * Start a transition from the current frame to whatever the new layer
   * state will render. Captures the current composite as a snapshot, then
   * blends snapshot ↔ live each frame using one of several transition styles.
   *
   * The snapshot stays still during the transition (the previous preset is
   * already gone from the layer state by the time live frames arrive). To
   * combat the "frozen" look, several transition types animate the snapshot
   * UV (warp, explode, melt, voxelize) so it visually moves while fading.
   */
  public startTransition(durationSeconds: number, type: TransitionType = 'dissolve'): void {
    if (durationSeconds <= 0) return;

    if (!this.transitionTarget) {
      this.transitionTarget = this.createRenderTarget();
      this.transitionScene = new THREE.Scene();
      this.transitionMaterial = new THREE.ShaderMaterial({
        vertexShader: passthroughVertexShader,
        fragmentShader: TRANSITION_FRAGMENT_SHADER,
        uniforms: {
          uSnapshot: { value: null },
          uLive: { value: null },
          uProgress: { value: 0.0 },
          uType: { value: 0 },
          uTime: { value: 0.0 },
        },
        depthTest: false,
        depthWrite: false,
      });
      const geom = new THREE.PlaneGeometry(2, 2);
      this.transitionQuad = new THREE.Mesh(geom, this.transitionMaterial);
      this.transitionScene.add(this.transitionQuad);
    }

    this.transitionTarget.setSize(this.width, this.height);

    // Snapshot the current composite into transitionTarget (cached copy objects).
    this._copyMaterial.map = this.compositeTarget.texture;
    this.renderer.setRenderTarget(this.transitionTarget);
    this.renderer.render(this._copyScene, this.camera);
    this.renderer.setRenderTarget(null);

    this.transitionMaterial!.uniforms.uSnapshot.value = this.transitionTarget.texture;
    this.transitionMaterial!.uniforms.uType.value = TRANSITION_TYPE_INDEX[type] ?? 0;
    this.transitionProgress = 0;
    this.transitionStartTime = performance.now() / 1000;
    this.transitionDuration = durationSeconds;
  }

  public isTransitioning(): boolean {
    return this.transitionProgress < 1;
  }

  // ── VJ A/B crossfader API ──────────────────────────────────────────
  /**
   * Configure the crossfader for this frame. Called once per rAF tick from
   * Canvas.svelte. When `active` is true, render() will partition the
   * incoming layer plan by Layer.bank, render Bank A and Bank B to
   * separate FBOs, then composite via the chosen transition shader.
   *
   * Curve is applied here so the engine sees the same shaped value the
   * UI shows (e.g. constant-power means UI=0.5 → shader-uMix=0.707).
   *
   * `blendMode` ('normal' or one of multiply/screen/add/etc.) selects the
   * A↔B math at the mix point. 'normal' uses the transition shader's
   * output verbatim; any other mode replaces it with a triangular sweep
   * A → blend(A,B) → B as the fader crosses 0..1.
   */
  public setCrossfade(
    active: boolean,
    value: number,
    transitionName: string,
    curve: 'linear' | 'constant-power' | 'sharp-cut' = 'constant-power',
    blendMode: string = 'normal',
  ): void {
    this.crossfadeActive = active;
    this.crossfadeValue = applyFaderCurve(value, curve);
    this.crossfadeTransitionName = transitionName;
    this.crossfadeBlendModeIndex = CROSSFADE_BLEND_MODE_INDEX[blendMode] ?? 0;
  }

  public isCrossfadeActive(): boolean {
    return this.crossfadeActive;
  }

  /** Allocate the bank FBOs the first time the crossfader is enabled.
   *  Same dimensions/format as compositeTarget so the existing layer
   *  blend pipeline composites into them transparently. */
  private ensureBankTargets(): void {
    if (!this.bankATarget) this.bankATarget = this.createRenderTarget();
    if (!this.bankBTarget) this.bankBTarget = this.createRenderTarget();
  }

  /** Lazily compile a transition shader. Materials cached by name —
   *  switching transitions doesn't re-compile, only first-use does. */
  private getCrossfadeMaterial(transitionName: string): THREE.ShaderMaterial {
    let mat = this.crossfadeMaterials.get(transitionName);
    if (mat) return mat;
    const def: TransitionDef = getTransition(transitionName);
    mat = new THREE.ShaderMaterial({
      vertexShader: passthroughVertexShader,
      fragmentShader: def.fragment,
      uniforms: {
        tBankA:     { value: null },
        tBankB:     { value: null },
        uMix:       { value: 0 },
        uTime:      { value: 0 },
        uRes:       { value: new THREE.Vector2(this.width, this.height) },
        uBlendMode: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.crossfadeMaterials.set(transitionName, mat);
    return mat;
  }

  /** Read the bank tag off a render unit (group or layer). */
  private unitBank(unit: RenderUnit): 'A' | 'B' | undefined {
    return unit.kind === 'group' ? unit.group.bank : unit.layer.bank;
  }

  /**
   * Run the layer-composite loop into whatever target this.compositeTarget
   * currently points at. Lifted from render() so the same loop can write
   * into bankATarget / bankBTarget when the crossfader is on.
   *
   * startIdx lets the caller skip the "clear-on-first-unit" behavior of
   * compositeTexture (passing 1 means: "I've already rendered something
   * to this target, just blend on top of it"). Default 0 = first unit
   * clears.
   */
  private renderUnitsToCurrentTarget(units: RenderUnit[], startIdx: number = 0): void {
    let compositeIdx = startIdx;
    for (const unit of units) {
      if (unit.kind === 'group') {
        const groupTexture = this.renderGroupToTexture(unit.group, unit.children);
        if (groupTexture) {
          this.compositeTexture(groupTexture, unit.group.opacity, unit.group.blendMode, compositeIdx === 0);
          compositeIdx++;
        }
        continue;
      }
      const layer = unit.layer;
      const obj = this.getOrCreateLayerObject(layer);
      const layerTexture = this.getLayerTexture(layer, obj);
      if (!layerTexture) continue;
      const finalTexture = this.processLayerPipeline(layer, obj, layerTexture);
      this.compositeTexture(finalTexture, layer.opacity, layer.blendMode, compositeIdx === 0);
      compositeIdx++;
    }
  }

  /**
   * Run the crossfade compositor pass. Reads from bankATarget +
   * bankBTarget, writes to compositeTarget. Skipped if either bank
   * target hasn't been rendered to (e.g. no Bank B clips active).
   */
  private applyBankCrossfade(): void {
    if (!this.crossfadeActive || !this.crossfadeQuad || !this.crossfadeScene) return;
    if (!this.bankATarget || !this.bankBTarget) return;

    const mat = this.getCrossfadeMaterial(this.crossfadeTransitionName);
    mat.uniforms.tBankA.value = this.bankATarget.texture;
    mat.uniforms.tBankB.value = this.bankBTarget.texture;
    mat.uniforms.uMix.value = this.crossfadeValue;
    mat.uniforms.uTime.value = (performance.now() / 1000) - this.crossfadeStartTime;
    mat.uniforms.uBlendMode.value = this.crossfadeBlendModeIndex;
    if (mat.uniforms.uRes.value.x !== this.width || mat.uniforms.uRes.value.y !== this.height) {
      mat.uniforms.uRes.value.set(this.width, this.height);
    }
    this.crossfadeQuad.material = mat;

    // Output the mix into compositeTarget so downstream effects /
    // watermark / dome / final blit all see it as the master composite.
    this.renderer.setRenderTarget(this.compositeTarget);
    this.renderer.clear();
    this.renderer.render(this.crossfadeScene, this.camera);
  }

  /**
   * Lazy-allocate a per-VJ-layer crossfade FBO. Stage-mode injection calls
   * this once per VJ layer index that has BOTH banks active so each mapped
   * Screen sees its own A/B mix instead of just Bank A. Same dimensions
   * as the main composite — Stage layers sample from `.texture` directly.
   *
   * Sized to canvas dimensions; on resize() we dispose all entries so they
   * re-allocate at the new size on next request.
   */
  public getOrCreateVJCrossfadeTarget(vjLayerIndex: number): THREE.WebGLRenderTarget {
    let rt = this.vjCrossfadeTargets.get(vjLayerIndex);
    if (!rt) {
      rt = this.createRenderTarget();
      this.vjCrossfadeTargets.set(vjLayerIndex, rt);
    }
    return rt;
  }

  /**
   * Run the currently-selected transition shader on two arbitrary input
   * textures (typically Bank A and Bank B versions of the same VJ layer)
   * and write the mixed result into `targetRT`. Reuses the same compiled
   * crossfade material the main composite pass uses — switching transitions
   * costs zero recompiles.
   *
   * Returns the same target so callers can chain into texture lookups.
   */
  public renderVJCrossfadeToTarget(
    targetRT: THREE.WebGLRenderTarget,
    textureA: THREE.Texture | null,
    textureB: THREE.Texture | null
  ): THREE.WebGLRenderTarget {
    if (!this.crossfadeQuad || !this.crossfadeScene) return targetRT;
    if (!textureA && !textureB) return targetRT;

    // Single-bank fallback: if either side is missing, just blit the live
    // one — shader can't sample a null texture and we don't want a black
    // frame for layers that only exist on one deck.
    const mat = this.getCrossfadeMaterial(this.crossfadeTransitionName);
    mat.uniforms.tBankA.value = textureA ?? textureB;
    mat.uniforms.tBankB.value = textureB ?? textureA;
    // If only one bank has content, force the mix to whichever side has it
    // so the user sees that bank's clip (otherwise they'd see a half-mix
    // of "this clip" against itself, which produces a flicker on shaders
    // that read uMix for randomized effects).
    let mix = this.crossfadeValue;
    if (!textureA && textureB) mix = 1;
    if (textureA && !textureB) mix = 0;
    mat.uniforms.uMix.value = mix;
    mat.uniforms.uTime.value = (performance.now() / 1000) - this.crossfadeStartTime;
    if (mat.uniforms.uRes.value.x !== this.width || mat.uniforms.uRes.value.y !== this.height) {
      mat.uniforms.uRes.value.set(this.width, this.height);
    }
    this.crossfadeQuad.material = mat;

    this.renderer.setRenderTarget(targetRT);
    this.renderer.clear();
    this.renderer.render(this.crossfadeScene, this.camera);
    return targetRT;
  }

  /** Dispose the per-VJ-layer crossfade targets — called on resize so we
   *  re-allocate at the new canvas size on next render, and on engine
   *  dispose for cleanup. Safe to call when map is empty. */
  private disposeVJCrossfadeTargets(): void {
    for (const rt of this.vjCrossfadeTargets.values()) {
      try { rt.dispose(); } catch {}
    }
    this.vjCrossfadeTargets.clear();
  }

  private applyTransition(): void {
    if (!this.transitionMaterial || !this.transitionScene || this.transitionProgress >= 1) return;

    const now = performance.now() / 1000;
    const elapsed = now - this.transitionStartTime;
    this.transitionProgress = Math.min(1, elapsed / this.transitionDuration);

    // Pick easing per type: directional wipes/wave use linear so the edge
    // moves at constant speed; everything else uses smoothstep for natural feel.
    const t = this.transitionProgress;
    const typeIdx = this.transitionMaterial.uniforms.uType.value as number;
    const linearTypes = new Set([1, 2, 3, 4, 5, 6]); // wipes + wave + iris
    const eased = linearTypes.has(typeIdx) ? t : t * t * (3 - 2 * t);

    this.transitionMaterial.uniforms.uLive.value = this.compositeTarget.texture;
    this.transitionMaterial.uniforms.uProgress.value = eased;
    this.transitionMaterial.uniforms.uTime.value = elapsed;

    this.renderer.setRenderTarget(this.tempTarget);
    this.renderer.render(this.transitionScene, this.camera);

    this.renderer.setRenderTarget(null);
    (this.outputQuad.material as THREE.ShaderMaterial).uniforms.uTexture.value = this.tempTarget.texture;
    this.renderer.render(this.outputScene, this.camera);
  }
}

// ─── Transition shader + type registry ──────────────────────────────────────
// Single fragment shader handles all transition styles via uType branch — keeps
// us at one ShaderMaterial / one program compile. Snapshot is the OLD frame
// frozen at switch time; live is the NEW preset rendered each frame.

export type TransitionType =
  | 'dissolve'    // Crossfade with subtle radial drift to break the frozen-snapshot feel
  | 'wipeUp'      // New emerges from bottom, sweeping up
  | 'wipeDown'    // New emerges from top, sweeping down
  | 'wipeLeft'    // New sweeps in from right edge
  | 'wipeRight'   // New sweeps in from left edge
  | 'wave'        // Sinusoidal vertical wipe (Disney projection-mapping style)
  | 'iris'        // Circular reveal expanding from center
  | 'voxelize'    // Pixel-block reveal — chunks flip from snapshot to live
  | 'warp'        // Snapshot warps outward radially, blending into live
  | 'explode'     // Snapshot fragments fly outward, live fades in beneath
  | 'pixelMelt';  // Snapshot drips/melts down per-column, live revealed above

export const TRANSITION_TYPE_INDEX: Record<TransitionType, number> = {
  dissolve: 0,
  wipeUp: 1,
  wipeDown: 2,
  wipeLeft: 3,
  wipeRight: 4,
  wave: 5,
  iris: 6,
  voxelize: 7,
  warp: 8,
  explode: 9,
  pixelMelt: 10,
};

// Crossfader output blend mode → uBlendMode int. Mirrors the GLSL switch
// in crossfadeTransitions.ts SHARED_HEADER's xfBlend(). 'normal' (0) is
// the no-op pass-through; everything else replaces the transition output
// with a triangular A → blend(A,B) → B sweep.
export const CROSSFADE_BLEND_MODE_INDEX: Record<string, number> = {
  normal: 0,
  multiply: 1,
  screen: 2,
  add: 3,
  difference: 4,
  darken: 5,
  lighten: 6,
  overlay: 7,
  exclusion: 8,
};

const TRANSITION_FRAGMENT_SHADER = `
  uniform sampler2D uSnapshot;
  uniform sampler2D uLive;
  uniform float uProgress;
  uniform int uType;
  uniform float uTime;
  varying vec2 vUv;

  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec4 snap = texture2D(uSnapshot, uv);
    vec4 live = texture2D(uLive, uv);
    vec4 col = snap;

    if (uType == 0) {
      // Dissolve with a gentle radial drift on the snapshot — fights the
      // "freeze" feel without showing layer geometry of the old preset.
      vec2 c = vec2(0.5);
      vec2 drift = (uv - c) * uProgress * 0.06;
      vec4 driftSnap = texture2D(uSnapshot, uv - drift);
      col = mix(driftSnap, live, uProgress);
    }
    else if (uType == 1) {
      // wipeUp: live emerges from bottom (uv.y small in standard UV).
      // Edge moves up from y=0 to y=1 as progress goes 0→1.
      float edge = uProgress;
      float feather = 0.04;
      float reveal = 1.0 - smoothstep(edge - feather, edge, uv.y);
      col = mix(snap, live, reveal);
    }
    else if (uType == 2) {
      // wipeDown: live emerges from top (uv.y large).
      // Edge moves down from y=1 to y=0 as progress goes 0→1.
      float edge = 1.0 - uProgress;
      float feather = 0.04;
      float reveal = smoothstep(edge, edge + feather, uv.y);
      col = mix(snap, live, reveal);
    }
    else if (uType == 3) {
      // wipeLeft: live emerges from left (uv.x small).
      float edge = uProgress;
      float feather = 0.04;
      float reveal = 1.0 - smoothstep(edge - feather, edge, uv.x);
      col = mix(snap, live, reveal);
    }
    else if (uType == 4) {
      // wipeRight: live emerges from right (uv.x large).
      float edge = 1.0 - uProgress;
      float feather = 0.04;
      float reveal = smoothstep(edge, edge + feather, uv.x);
      col = mix(snap, live, reveal);
    }
    else if (uType == 5) {
      // wave: wipeUp-style sweep with sinusoidal wobble — Disney projection style.
      float wobble = 0.06 * sin(uv.x * 14.0 + uProgress * 6.2831);
      float edge = uProgress + wobble;
      float feather = 0.05;
      float reveal = 1.0 - smoothstep(edge - feather, edge, uv.y);
      col = mix(snap, live, reveal);
    }
    else if (uType == 6) {
      // iris: circular reveal from center. Account for aspect via y-stretch.
      vec2 c = vec2(0.5);
      float dist = distance(uv, c);
      float r = uProgress * 0.85;  // 0.85 ≈ corner distance, leaves a soft last reveal
      float feather = 0.05;
      float reveal = 1.0 - smoothstep(r - feather, r, dist);
      col = mix(snap, live, reveal);
    }
    else if (uType == 7) {
      // voxelize: block reveal — each cell flips at its own hash threshold.
      float cells = 36.0;
      vec2 cellId = floor(uv * cells);
      float h = hash21(cellId);
      float reveal = step(h, uProgress);
      // Sample snapshot at cell-center for a chunky pixelated look on remaining cells
      vec2 cellCenter = (cellId + 0.5) / cells;
      vec4 chunkSnap = texture2D(uSnapshot, cellCenter);
      col = mix(chunkSnap, live, reveal);
    }
    else if (uType == 8) {
      // warp: snapshot UVs displace outward radially as transition progresses,
      // creating a feeling of zoom/rush as it fades into the new preset.
      vec2 c = vec2(0.5);
      vec2 dir = uv - c;
      float dist = length(dir);
      vec2 warpedUv = uv + normalize(dir + vec2(0.0001)) * uProgress * dist * 0.6;
      vec4 warpedSnap = texture2D(uSnapshot, warpedUv);
      col = mix(warpedSnap, live, uProgress);
    }
    else if (uType == 9) {
      // explode: snapshot pixel-tiles fly outward from center, live revealed beneath.
      float tiles = 28.0;
      vec2 tileId = floor(uv * tiles) / tiles + 0.5 / tiles;
      vec2 dir = normalize(tileId - vec2(0.5) + vec2(0.0001));
      float h = hash21(tileId * 7.3);
      vec2 offset = dir * uProgress * (0.4 + h * 0.5);
      vec2 sampleUv = uv - offset;
      vec4 fragSnap = texture2D(uSnapshot, sampleUv);
      // If sample wandered off-screen, contribute nothing.
      float inBounds = step(0.0, sampleUv.x) * step(sampleUv.x, 1.0)
                     * step(0.0, sampleUv.y) * step(sampleUv.y, 1.0);
      float snapAlpha = (1.0 - uProgress) * (1.0 - uProgress) * inBounds;
      col = vec4(mix(live.rgb, fragSnap.rgb, snapAlpha), 1.0);
    }
    else if (uType == 10) {
      // pixelMelt: snapshot drips/melts down in vertical columns at varied rates.
      float dripCols = 100.0;
      float colId = floor(uv.x * dripCols);
      float h = hash21(vec2(colId, 7.0));
      float meltStart = h * 0.45;
      float meltAmount = max(0.0, uProgress - meltStart) / max(0.0001, 1.0 - meltStart);
      // Each column shifts down (in UV terms, v decreases since v=0 is bottom)
      vec2 dripUv = vec2(uv.x, uv.y + meltAmount * 0.7);
      vec4 dripSnap = texture2D(uSnapshot, dripUv);
      // Hide snapshot once column has melted past the bottom
      float snapAlpha = (1.0 - smoothstep(0.7, 1.0, meltAmount));
      col = vec4(mix(live.rgb, dripSnap.rgb, snapAlpha), 1.0);
    }

    gl_FragColor = col;
  }
`;

// Texture loading utilities
export async function loadImageTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (texture) => {
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        resolve(texture);
      },
      undefined,
      reject
    );
  });
}

export function createVideoTexture(video: HTMLVideoElement): THREE.VideoTexture {
  const texture = new THREE.VideoTexture(video);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.format = THREE.RGBAFormat;
  return texture;
}

// Create a texture from a canvas (used for Three.js iframe capture)
export function createCanvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.format = THREE.RGBAFormat;
  return texture;
}

// Three.js iframe management - creates iframe and capture canvas
export interface ThreeJSIframeContext {
  iframe: HTMLIFrameElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  updateTexture: () => void;
}

const threejsIframeCache = new Map<string, ThreeJSIframeContext>();

export function createThreeJSIframeContext(id: string, src: string, width = 1920, height = 1080): ThreeJSIframeContext {
  // Check cache first
  const cached = threejsIframeCache.get(id);
  if (cached) {
    return cached;
  }

  // Create hidden iframe
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.width = String(width);
  iframe.height = String(height);
  iframe.style.position = 'absolute';
  iframe.style.left = '-9999px';
  iframe.style.top = '-9999px';
  iframe.style.border = 'none';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  // Create offscreen canvas for texture capture
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Create texture from canvas
  const texture = createCanvasTexture(canvas);

  // Function to update texture from iframe content
  const updateTexture = () => {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (iframeDoc) {
        // Try to get canvas from iframe (Three.js and WebGL pages typically have a canvas)
        const iframeCanvas = iframeDoc.querySelector('canvas') as HTMLCanvasElement;
        if (iframeCanvas && iframeCanvas.width > 0 && iframeCanvas.height > 0) {
          ctx.drawImage(iframeCanvas, 0, 0, width, height);
          texture.needsUpdate = true;
        }
      }
    } catch (e) {
      // Cross-origin errors are expected if iframe is from different origin
      // For same-origin iframes, this should work fine
    }
  };

  const context: ThreeJSIframeContext = {
    iframe,
    canvas,
    ctx,
    texture,
    updateTexture,
  };

  threejsIframeCache.set(id, context);
  return context;
}

export function getThreeJSIframeContext(id: string): ThreeJSIframeContext | undefined {
  return threejsIframeCache.get(id);
}

export function disposeThreeJSIframeContext(id: string): void {
  const context = threejsIframeCache.get(id);
  if (context) {
    context.texture.dispose();
    context.iframe.remove();
    threejsIframeCache.delete(id);
  }
}

export function updateAllThreeJSTextures(): void {
  for (const context of threejsIframeCache.values()) {
    context.updateTexture();
  }
}

// Re-export JS animation functions for convenience
export {
  createJSAnimationContext,
  getJSAnimationContext,
  disposeJSAnimationContext,
  updateAllJSAnimationTextures,
  updateJSAnimationParams,
  hasJSAnimationContext,
  disposeAllJSAnimationContexts,
  type JSAnimationContext
} from './js-animation';
