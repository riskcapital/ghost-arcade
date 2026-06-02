// Milkdrop Visualizer — Butterchurn-backed Milkdrop renderer that blits into
// a Three.js render target so it composes with the existing layer pipeline.
//
// Butterchurn owns its own canvas + WebGL context and writes pixels there
// each frame. We mirror that canvas as a THREE.CanvasTexture and draw it
// onto the supplied WebGLRenderTarget through a single fullscreen quad
// pass — one extra draw call per frame, perceptually free at 1080p.
//
// Audio: butterchurn.connectAudio(node) takes any AudioNode. We use the
// existing AudioAnalyzer's source node so we share one stream/context across
// the app. For multi-stem routing we feed a custom GainNode mix instead;
// see milkdropStemRouter.ts (added later).

import * as THREE from 'three';
// Butterchurn ships as UMD; Vite's CJS interop gives us the default export.
import butterchurn from 'butterchurn';

export interface MilkdropVisualizerOptions {
  width: number;
  height: number;
  pixelRatio?: number;   // 0.5–2, defaults to 1
  meshSize?: number;     // butterchurn warp-mesh resolution (default 48)
  textureRatio?: number; // internal FBO scale (default 1)
}

export interface MilkdropPresetEntry {
  name: string;
  preset: any;           // opaque butterchurn preset object
}

export class MilkdropVisualizer {
  private canvas: HTMLCanvasElement;
  private audioCtx: AudioContext;
  private visualizer: any;
  private texture: THREE.CanvasTexture;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.MeshBasicMaterial;
  private quad: THREE.Mesh;

  private width: number;
  private height: number;
  private pixelRatio: number;
  private meshSize: number;
  private connectedNode: AudioNode | null = null;
  private currentPresetName: string | null = null;

  constructor(audioCtx: AudioContext, opts: MilkdropVisualizerOptions) {
    this.audioCtx = audioCtx;
    this.width = opts.width;
    this.height = opts.height;
    this.pixelRatio = opts.pixelRatio ?? 1;
    this.meshSize = opts.meshSize ?? 48;

    // Butterchurn requires a real HTMLCanvasElement (it reads
    // canvas.getContext('webgl2') internally). We attach it offscreen so
    // it's a live element but invisible to the user — it never reaches the
    // DOM tree the user sees.
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);

    console.log('[Milkdrop] createVisualizer', { w: this.canvas.width, h: this.canvas.height, meshSize: this.meshSize, audioCtxState: this.audioCtx.state });
    this.visualizer = butterchurn.createVisualizer(this.audioCtx, this.canvas, {
      width: this.canvas.width,
      height: this.canvas.height,
      pixelRatio: 1,                     // butterchurn applies pixelRatio internally; we've already baked it into canvas size
      textureRatio: opts.textureRatio ?? 1,
      meshWidth: this.meshSize,
      meshHeight: Math.round(this.meshSize * (this.height / this.width)),
    });
    console.log('[Milkdrop] visualizer created', !!this.visualizer);

    // Blit pipeline: a fullscreen quad textured with butterchurn's canvas.
    // Using a CanvasTexture is the cheapest cross-context path — the
    // browser's GL driver does a single texSubImage2D each time we mark
    // needsUpdate = true.
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;          // butterchurn's GL output is already top-down once we sample it

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
  }

  /** Optional — fluid/particles classes have this hook; we keep parity. */
  init(_renderer: THREE.WebGLRenderer): void { /* nothing — created lazily in ctor */ }

  /** Replace the audio source feeding butterchurn. Pass null to detach. */
  connectAudio(node: AudioNode | null): void {
    if (this.connectedNode === node) return;
    if (this.connectedNode) {
      try { this.visualizer.disconnectAudio(this.connectedNode); } catch {}
    }
    this.connectedNode = node;
    if (node) {
      try { this.visualizer.connectAudio(node); } catch (e) {
        console.warn('[Milkdrop] connectAudio failed', e);
        this.connectedNode = null;
      }
    }
  }

  /** Load a butterchurn preset with optional crossfade. */
  loadPreset(name: string, preset: any, blendTimeSeconds: number = 0): void {
    if (!preset) return;
    try {
      this.visualizer.loadPreset(preset, blendTimeSeconds);
      this.currentPresetName = name;
      console.log('[Milkdrop] loadPreset OK:', name, 'blend=', blendTimeSeconds);
    } catch (e) {
      console.warn('[Milkdrop] loadPreset failed for', name, e);
    }
  }

  getCurrentPresetName(): string | null {
    return this.currentPresetName;
  }

  /**
   * Set butterchurn's internal audio gain multiplier. Butterchurn exposes
   * `audio.sampleLevel` (a per-buffer multiplier applied before its FFT).
   * Pumping this above 1.0 makes quiet sources reach into the preset's
   * "loud" reactivity ranges, which is what most VJs want from a mix
   * source.
   */
  setSensitivity(gain: number): void {
    try {
      // Butterchurn keeps the audio processor on `visualizer.audio`; the
      // field name has been stable across 2.x but guard anyway.
      if (this.visualizer?.audio) {
        this.visualizer.audio.sampleLevel = Math.max(0, gain);
      }
    } catch { /* non-fatal */ }
  }

  resize(width: number, height: number, pixelRatio?: number): void {
    if (pixelRatio !== undefined) this.pixelRatio = pixelRatio;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    const cw = Math.round(width * this.pixelRatio);
    const ch = Math.round(height * this.pixelRatio);
    this.canvas.width = cw;
    this.canvas.height = ch;
    try {
      this.visualizer.setRendererSize(cw, ch);
    } catch (e) {
      console.warn('[Milkdrop] setRendererSize failed', e);
    }
  }

  /**
   * Step + render in one call: butterchurn's render() advances and draws to
   * its own canvas, then we blit through the fullscreen quad into the
   * supplied Three.js render target.
   */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    // Drive butterchurn one frame
    try {
      this.visualizer.render();
    } catch (e) {
      // A bad preset (uncommon — community-contributed equations) can throw
      // mid-frame; swallow so we keep showing the last good frame instead
      // of black-flashing the entire layer stack.
      console.warn('[Milkdrop] render frame failed', e);
    }

    // Re-upload the canvas pixels to the Three.js texture
    this.texture.needsUpdate = true;

    // Blit into the layer's render target
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prevTarget);
  }

  /** Returns the live butterchurn canvas — useful for diagnostic snapshots. */
  getCanvas(): HTMLCanvasElement { return this.canvas; }

  dispose(): void {
    if (this.connectedNode) {
      try { this.visualizer.disconnectAudio(this.connectedNode); } catch {}
      this.connectedNode = null;
    }
    try { this.visualizer = null; } catch {}
    this.texture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    // Drop the canvas — letting it fall out of scope releases its WebGL
    // context after the GC + a tick. Some browsers are lazy about that,
    // so explicitly lose the context first to free GPU memory promptly.
    try {
      const gl = this.canvas.getContext('webgl2') || this.canvas.getContext('webgl');
      (gl as any)?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    } catch {}
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
