// Hydra — wrapper around hydra-synth (AGPL, by Olivia Jack).
//
// hydra-synth is a live-codeable functional video synth in the spirit
// of analog video synthesizers. We host it on an offscreen canvas,
// blit its output into the layer's Three.js render target, and run
// hand-curated sketches as "presets."
//
// Audio integration: we disable hydra's built-in mic capture
// (`detectAudio: false` would normally leave `synth.a` undefined) and
// stub `synth.a` ourselves with the same shape sketches expect — a
// 4-element `fft` array. Each frame we pull from the shared audio
// analyzer and populate that array, so `() => a.fft[1]` in a sketch
// reads our app's audio without hydra opening a separate input.
//
// Author: Olivia Jack · https://github.com/ojack/hydra

import * as THREE from 'three';
import HydraSynth from 'hydra-synth';
import type { AudioAnalysis } from '../audio/analyzer';

export interface HydraParams {
  sketchCode: string;        // the active sketch source
  sketchName: string;        // for reporting back to the store
  sensitivity: number;       // multiplier on audio data before sketches see it
  bgAlpha: number;
}

const DEFAULT_PARAMS: HydraParams = {
  sketchCode: 'osc(20, 0.1, 1.4).rotate(0.1).out()',
  sketchName: 'Welcome',
  sensitivity: 1.5,
  bgAlpha: 1.0,
};

/** Hand-rolled stub for the `synth.a` field hydra sketches reference.
 *  We feed it from the app's existing analyzer each frame instead of
 *  letting hydra spin up its own getUserMedia + Meyda analyser. */
function makeAudioStub(numBins: number = 4) {
  const fft = new Array(numBins).fill(0);
  const bins = new Array(numBins).fill(0);
  return {
    fft,
    bins,
    vol: 0,
    setBins: (n: number) => {
      fft.length = n; bins.length = n;
      for (let i = 0; i < n; i++) { fft[i] ??= 0; bins[i] ??= 0; }
    },
    setSmooth: (_: number) => {},
    setCutoff: (_: number) => {},
    setScale:  (_: number) => {},
    setMax:    (_: number) => {},
    show: () => {},
    hide: () => {},
  };
}

export class HydraVisualizer {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private hydra: any;
  private audioStub: ReturnType<typeof makeAudioStub>;

  private texture: THREE.CanvasTexture;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.MeshBasicMaterial;
  private quad: THREE.Mesh;

  private width: number;
  private height: number;
  private params: HydraParams = { ...DEFAULT_PARAMS };
  // `new Function(...)` returns the broad `Function` type — keeping the
  // same here so TS doesn't complain about the assignment site below.
  private compiledSketch: Function | null = null;
  private appliedSketch: string = '';
  private synthKeys: string[] = [];
  private synthVals: any[] = [];

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.container = document.createElement('div');
    this.container.style.cssText = 'position:absolute; top:-99999px; left:-99999px; pointer-events:none;';
    document.body.appendChild(this.container);

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.container.appendChild(this.canvas);

    this.hydra = new HydraSynth({
      canvas: this.canvas,
      width, height,
      detectAudio: false,
      makeGlobal: false,
      enableStreamCapture: false,
      autoLoop: true,  // hydra drives its own RAF that calls render()
    });

    // Replace the missing audio object (hydra leaves it undefined when
    // detectAudio is off) with our shared-analyser stub.
    this.audioStub = makeAudioStub(4);
    this.hydra.synth.a = this.audioStub;

    // Snapshot the synth namespace so we can compile sketches against it
    // without exposing globals or using `with`. This freezes the function
    // list at construction time — fine because hydra's API is stable.
    this.synthKeys = Object.keys(this.hydra.synth);
    this.synthVals = this.synthKeys.map(k => this.hydra.synth[k]);

    // Blit pipeline
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.flipY = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    // Boot with the default sketch
    this.compileSketch(this.params.sketchCode);
  }

  init(_renderer: THREE.WebGLRenderer): void { /* nothing extra */ }

  setParams(p: Partial<HydraParams>): void {
    Object.assign(this.params, p);
    if (p.sketchCode !== undefined && p.sketchCode !== this.appliedSketch) {
      this.compileSketch(this.params.sketchCode);
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    try { this.hydra.setResolution(width, height); } catch {}
  }

  /**
   * Feed the audio stub from the latest AudioAnalysis (or zero it when no
   * audio is running). Hydra's render loop is already ticking via its own
   * RAF; we only need to keep `a.fft` fresh and blit each frame.
   */
  step(_dt: number, audio: AudioAnalysis | null): void {
    const k = this.params.sensitivity;
    if (audio?.bands) {
      const b = audio.bands;
      // 4 bins map to: sub+bass / lowMid+mid / highMid+treble / air
      this.audioStub.fft[0] = Math.min(1, (b.sub + b.bass) * 0.5 * k);
      this.audioStub.fft[1] = Math.min(1, (b.lowMid + b.mid) * 0.5 * k);
      this.audioStub.fft[2] = Math.min(1, (b.highMid + b.treble) * 0.5 * k);
      this.audioStub.fft[3] = Math.min(1, b.air * k);
      this.audioStub.bins = this.audioStub.fft.slice();
      this.audioStub.vol = (audio.amplitude ?? 0) * k;
    } else {
      for (let i = 0; i < this.audioStub.fft.length; i++) this.audioStub.fft[i] = 0;
      this.audioStub.vol = 0;
    }
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    this.texture.needsUpdate = true;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
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
    try { this.hydra.hush?.(); } catch {}
    try { this.hydra = null; } catch {}
    this.texture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
    try { this.canvas.remove(); } catch {}
    try { this.container.remove(); } catch {}
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private compileSketch(code: string): void {
    if (!this.hydra) return;
    // First clear any running outputs; bad sketches that throw shouldn't
    // leave the previous one half-broken.
    try { this.hydra.hush?.(); } catch {}
    try {
      // Build a function that takes every synth key (including `time`,
      // already provided by hydra on its synth instance) as a parameter
      // — no `with`, no global pollution. Strict mode forbids duplicate
      // parameter names, which is why we don't pass `time` separately.
      const fn = new Function(...this.synthKeys, `"use strict";\n${code}`);
      this.compiledSketch = fn;
      this.appliedSketch = code;
      // Invoke immediately so the sketch wires up its output chain
      this.runSketch();
    } catch (e) {
      console.warn('[Hydra] sketch compile/run failed', e);
      this.compiledSketch = null;
      this.appliedSketch = '';
    }
  }

  private runSketch(): void {
    if (!this.compiledSketch || !this.hydra) return;
    try {
      this.compiledSketch.call(null, ...this.synthVals);
    } catch (e) {
      console.warn('[Hydra] sketch runtime error', e);
    }
  }
}
