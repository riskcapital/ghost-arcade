// AudioMotion — wrapper around audioMotion-analyzer by Henrique Vianna.
//
// audioMotion-analyzer (AGPL-3.0) is a polished, dependency-free real-time
// spectrum analyzer. We own none of the rendering — we just instantiate
// the library on an offscreen container, blit its canvas into the layer's
// Three.js RenderTarget, and forward parameter updates.
//
// Author: Henrique Vianna · https://github.com/hvianna/audioMotion-analyzer

import * as THREE from 'three';
import AudioMotionAnalyzer, { type Options as AMOptions } from 'audiomotion-analyzer';

/** Bar render style — only one applies at a time in audiomotion-analyzer
 *  (lumi/alpha/outline/led collide visually). Modeled as a single select
 *  so the UI reflects the underlying mutual-exclusion truth. */
export type AudioMotionBarStyle = 'normal' | 'led' | 'lumi' | 'alpha' | 'outline';

export interface AudioMotionParams {
  mode: number;          // 0=Discrete, 1..8=Octave bands (denser→sparser), 10=Line, 11=Area
  gradient: string;      // built-in name
  radial: boolean;
  barStyle: AudioMotionBarStyle;
  peakLine: boolean;     // continuous peak line — only applies in Line/Area modes
  showPeaks: boolean;    // falling peak indicators — only applies in bar modes, ignored when barStyle='lumi'
  reflexRatio: number;   // 0..0.9
  mirror: number;        // -1, 0, 1 — horizontal mirror
  flipY: boolean;        // vertical flip applied at the blit pass (bars hang from top instead of rising from bottom)
  barSpace: number;      // 0..1
  minFreq: number;       // Hz
  maxFreq: number;       // Hz
  sensitivity: number;   // 0=low, 1=normal, 2=high — maps to (min/max)Decibels presets
  bgAlpha: number;       // 0..1 (transparent background lets layers below show)
  smoothing: number;     // 0..1 (AnalyserNode smoothing)
}

const DEFAULT_PARAMS: AudioMotionParams = {
  mode: 4,
  gradient: 'orangered',  // ships warm/coral hues — pairs with the app palette
  radial: false,
  barStyle: 'normal',
  peakLine: false,
  showPeaks: true,
  reflexRatio: 0,
  mirror: 0,
  flipY: false,
  barSpace: 0.1,
  minFreq: 30,
  maxFreq: 16000,
  sensitivity: 1,
  bgAlpha: 1,
  smoothing: 0.5,
};

/** Map our single barStyle field to the four mutually-exclusive booleans
 *  audiomotion-analyzer actually takes. Exactly one (or none) is true. */
function barStyleToFlags(style: AudioMotionBarStyle) {
  return {
    ledBars:     style === 'led',
    lumiBars:    style === 'lumi',
    alphaBars:   style === 'alpha',
    outlineBars: style === 'outline',
  };
}

// Decibel ranges that audioMotion's built-in "sensitivity" preset uses
// (matches the library's internal thresholds). Exposed here so we can
// drive them from a single 0..2 slider in the panel.
const SENSITIVITY_PRESETS = [
  { min: -70, max:  -20 },   // low
  { min: -85, max:  -25 },   // normal
  { min: -100, max: -30 },   // high
];

export class AudioMotionVisualizer {
  private container: HTMLDivElement;
  private analyzer: AudioMotionAnalyzer | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.MeshBasicMaterial;
  private quad: THREE.Mesh;

  private width: number;
  private height: number;
  private connectedNode: AudioNode | null = null;
  private params: AudioMotionParams = { ...DEFAULT_PARAMS };

  constructor(audioCtx: AudioContext, width: number, height: number) {
    this.width = width;
    this.height = height;

    // AudioMotion appends its own <canvas> into a container element. We
    // make one detached from the DOM tree — the library doesn't need
    // visibility, only a valid element to insert into.
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:absolute; top:-99999px; left:-99999px; width:' + width + 'px; height:' + height + 'px; pointer-events:none;';
    // It DOES need to be in the DOM for some measurements; attach to body
    // out-of-frame so display:none doesn't zero-out its dimensions.
    document.body.appendChild(this.container);

    this.analyzer = new AudioMotionAnalyzer(this.container, {
      audioCtx,
      width,
      height,
      useCanvas: true,
      // CRITICAL: do NOT route the analyser's internal audio chain
      // back to the speakers. By default audiomotion-analyzer
      // connects to `audioCtx.destination` so the source plays
      // through it — fine for a "play this file and visualise it"
      // standalone app, fatal when the input IS system loopback
      // (BlackHole / `audio: 'loopback'`) because the analyser's
      // output is re-captured by the loopback creating runaway
      // feedback. We only ever want the FFT data, never playback.
      connectSpeakers: false,
      volume: 0,
      // Pass through initial params
      mode: this.params.mode,
      gradient: this.params.gradient,
      radial: this.params.radial,
      ...barStyleToFlags(this.params.barStyle),
      peakLine: this.params.peakLine,
      showPeaks: this.params.showPeaks,
      reflexRatio: this.params.reflexRatio,
      mirror: this.params.mirror,
      barSpace: this.params.barSpace,
      minFreq: this.params.minFreq,
      maxFreq: this.params.maxFreq,
      bgAlpha: this.params.bgAlpha,
      smoothing: this.params.smoothing,
      ...this._sensitivityOpts(this.params.sensitivity),
      // Note: audioMotion will manage its own RAF; we read its canvas each frame.
    } as AMOptions);

    // Blit pipeline. flipY is toggled per-frame from the user param —
    // initial state mirrors the default. THREE re-uploads when flipY
    // changes, but only on the next needsUpdate cycle.
    const amCanvas = this.analyzer.canvas as HTMLCanvasElement;
    this.texture = new THREE.CanvasTexture(amCanvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = this.params.flipY;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
  }

  init(_renderer: THREE.WebGLRenderer): void { /* nothing extra */ }

  connectAudio(node: AudioNode | null): void {
    if (!this.analyzer) return;
    if (this.connectedNode === node) return;
    if (this.connectedNode) {
      try { this.analyzer.disconnectInput(this.connectedNode); } catch {}
    }
    this.connectedNode = node;
    if (node) {
      try { this.analyzer.connectInput(node); } catch (e) {
        console.warn('[AudioMotion] connectInput failed', e);
        this.connectedNode = null;
      }
    }
  }

  setParams(p: Partial<AudioMotionParams>): void {
    if (!this.analyzer) return;
    const prevFlipY = this.params.flipY;
    Object.assign(this.params, p);

    // Push vertical flip into the blit texture so the change applies on
    // the next frame's upload. flipY only re-uploads the data after
    // needsUpdate is set, which we already do in render().
    if (this.texture && this.params.flipY !== prevFlipY) {
      this.texture.flipY = this.params.flipY;
      this.texture.needsUpdate = true;
    }

    // setOptions only takes keys that changed (cheaper) but the lib
    // handles full re-application fine — pass the union.
    const opts: AMOptions = {
      mode: this.params.mode,
      gradient: this.params.gradient,
      radial: this.params.radial,
      ...barStyleToFlags(this.params.barStyle),
      peakLine: this.params.peakLine,
      showPeaks: this.params.showPeaks,
      reflexRatio: this.params.reflexRatio,
      mirror: this.params.mirror,
      barSpace: this.params.barSpace,
      minFreq: this.params.minFreq,
      maxFreq: this.params.maxFreq,
      bgAlpha: this.params.bgAlpha,
      smoothing: this.params.smoothing,
      ...this._sensitivityOpts(this.params.sensitivity),
    };
    try { this.analyzer.setOptions(opts); } catch (e) { console.warn('[AudioMotion] setOptions failed', e); }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    if (this.analyzer) {
      try { this.analyzer.setCanvasSize(width, height); } catch {
        // Older API uses setOptions
        try { this.analyzer.setOptions({ width, height } as AMOptions); } catch {}
      }
    }
    this.container.style.width = width + 'px';
    this.container.style.height = height + 'px';
  }

  /**
   * The library has its own internal RAF that draws into its canvas; we
   * don't drive a step here. render() just blits the latest canvas
   * pixels into the layer's render target.
   */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    if (this.texture) this.texture.needsUpdate = true;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    // Clear transparent so compositing sees the alpha
    const prevClear = new THREE.Color();
    const prevAlpha = renderer.getClearAlpha();
    renderer.getClearColor(prevClear);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.setRenderTarget(prev);
  }

  dispose(): void {
    if (this.connectedNode && this.analyzer) {
      try { this.analyzer.disconnectInput(this.connectedNode); } catch {}
      this.connectedNode = null;
    }
    if (this.analyzer) {
      try { (this.analyzer as any).destroy?.(); } catch {}
      this.analyzer = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    this.material.dispose();
    this.quad.geometry.dispose();
    try { this.container.remove(); } catch {}
  }

  private _sensitivityOpts(level: number): Partial<AMOptions> {
    const idx = Math.max(0, Math.min(2, Math.round(level)));
    const p = SENSITIVITY_PRESETS[idx];
    return { minDecibels: p.min, maxDecibels: p.max };
  }
}
