// Wave.js — wrapper around @foobar404/wave (MIT, by Curtis Hutten /
// Austin Michaud). The library ships 10 canvas-2D animation types
// (Wave, Arcs, Circles, Cubes, Flower, Glob, Lines, Shine, Square,
// Turntable) — particle/geometric flavors that don't overlap Milkdrop's
// warp shaders or AudioMotion's spectrum bars.
//
// Ghost Arcade owns none of the rendering — we instantiate Wave on a
// 2D canvas, blit the canvas into the layer's Three.js render target
// each frame, and rebuild the animation when the user picks a new type.
//
// Author: Curtis Hutten · Austin Michaud · https://github.com/foobar404/Wave

import * as THREE from 'three';
import { Wave as WaveJS } from '@foobar404/wave';

export type WaveJSAnimation =
  | 'Wave' | 'Arcs' | 'Circles' | 'Cubes' | 'Flower'
  | 'Glob' | 'Lines' | 'Shine' | 'Square' | 'Turntable';

export interface WaveJSParams {
  animation: WaveJSAnimation;
  sensitivity: number;                // 0.25..6 — gain multiplier applied before the analyser
  lineWidth: number;
  colorA: [number, number, number];   // primary color (or gradient start)
  colorB: [number, number, number];   // gradient end (when useGradient=true)
  useGradient: boolean;
  gradientRotate: number;             // degrees, gradient direction
  glowStrength: number;               // 0..50
  glowColor: [number, number, number];
  bgAlpha: number;                    // 0..1 — clear alpha on the blit pass
  flipY: boolean;
}

const DEFAULT_PARAMS: WaveJSParams = {
  animation: 'Wave',
  sensitivity: 1.5,
  lineWidth: 4,
  colorA: [1.0, 0.42, 0.42],   // coral primary
  colorB: [1.0, 0.55, 0.30],
  useGradient: true,
  gradientRotate: 0,
  glowStrength: 15,
  glowColor: [1.0, 0.42, 0.42],
  bgAlpha: 1.0,
  flipY: false,
};

function rgbToCss(c: [number, number, number]): string {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return `rgb(${r},${g},${b})`;
}

export class WaveJSVisualizer {
  private container: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private analyser: AnalyserNode;
  // Input gain stage sits between the user's source node and our analyser,
  // so the panel sensitivity slider boosts (or attenuates) the actual
  // signal Wave.js sees in its FFT — not just a cosmetic post-multiply.
  private inputGain: GainNode;
  private wave: WaveJS | null = null;
  private texture: THREE.CanvasTexture | null = null;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.MeshBasicMaterial;
  private quad: THREE.Mesh;

  private width: number;
  private height: number;
  private connectedNode: AudioNode | null = null;
  private params: WaveJSParams = { ...DEFAULT_PARAMS };

  // Track what's actually configured on the underlying library so we
  // know when to tear down + rebuild the animation instance (Wave.js
  // animations are constructed with locked options).
  private appliedAnimation: WaveJSAnimation | null = null;
  private appliedStyleKey: string = '';

  constructor(audioCtx: AudioContext, width: number, height: number) {
    this.width = width;
    this.height = height;

    // We manage our own AnalyserNode and pass it to Wave.js, which lets
    // us late-attach a source node after the visualizer is constructed
    // — Wave.js's own constructor wouldn't otherwise accept this flow.
    // A GainNode in front of the analyser gives us a real sensitivity
    // knob (multiplies the signal before FFT, not after rendering).
    this.analyser = audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.5;
    this.inputGain = audioCtx.createGain();
    this.inputGain.gain.value = this.params.sensitivity;
    this.inputGain.connect(this.analyser);

    // Wave.js draws to a real <canvas>. Detached but DOM-attached so
    // measurements work — the canvas never needs to be visible to us.
    this.container = document.createElement('div');
    this.container.style.cssText = 'position:absolute; top:-99999px; left:-99999px; pointer-events:none;';
    document.body.appendChild(this.container);

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.container.appendChild(this.canvas);

    this.wave = new WaveJS(this.analyser, this.canvas, true);
    this.buildAnimation();

    // Blit pipeline
    this.texture = new THREE.CanvasTexture(this.canvas);
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

  init(_renderer: THREE.WebGLRenderer): void { /* nothing */ }

  /** Attach a Web Audio source. Late-attach is fine — Wave.js reads
   *  from our managed analyser; connecting another node to our input
   *  gain stage is enough. No library API call needed. */
  connectAudio(node: AudioNode | null): void {
    if (this.connectedNode === node) return;
    if (this.connectedNode) {
      try { this.connectedNode.disconnect(this.inputGain); } catch {}
    }
    this.connectedNode = node;
    if (node) {
      try { node.connect(this.inputGain); } catch (e) {
        console.warn('[WaveJS] failed to connect source to gain stage', e);
        this.connectedNode = null;
      }
    }
  }

  setParams(p: Partial<WaveJSParams>): void {
    const prevFlipY = this.params.flipY;
    Object.assign(this.params, p);

    if (this.texture && this.params.flipY !== prevFlipY) {
      this.texture.flipY = this.params.flipY;
      this.texture.needsUpdate = true;
    }

    // Live-update the input gain so the sensitivity slider feels instant.
    // setTargetAtTime gives a 30ms ramp — eliminates the audible (and
    // visible) click when the user drags the slider quickly.
    if (this.inputGain) {
      const now = this.inputGain.context.currentTime;
      try { this.inputGain.gain.setTargetAtTime(this.params.sensitivity, now, 0.03); } catch {}
    }

    // Detect whether anything that requires re-instantiating the
    // animation instance has changed. Wave.js doesn't expose a live
    // setOptions on individual animations — we rebuild on change.
    const styleKey = JSON.stringify({
      lw: this.params.lineWidth,
      cA: this.params.colorA,
      cB: this.params.colorB,
      gr: this.params.useGradient,
      gd: this.params.gradientRotate,
      gs: this.params.glowStrength,
      gc: this.params.glowColor,
    });
    if (this.params.animation !== this.appliedAnimation || styleKey !== this.appliedStyleKey) {
      this.buildAnimation();
      this.appliedAnimation = this.params.animation;
      this.appliedStyleKey = styleKey;
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    if (this.texture) this.texture.needsUpdate = true;
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
    if (this.connectedNode) {
      try { this.connectedNode.disconnect(this.inputGain); } catch {}
      this.connectedNode = null;
    }
    try { this.inputGain.disconnect(); } catch {}
    if (this.wave) {
      try { this.wave.clearAnimations(); } catch {}
      this.wave = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    this.material.dispose();
    this.quad.geometry.dispose();
    try { this.canvas.remove(); } catch {}
    try { this.container.remove(); } catch {}
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private buildAnimation(): void {
    if (!this.wave) return;
    this.wave.clearAnimations();

    const lineColor = this.params.useGradient
      ? { gradient: [rgbToCss(this.params.colorA), rgbToCss(this.params.colorB)], rotate: this.params.gradientRotate }
      : rgbToCss(this.params.colorA);
    const fillColor = lineColor;
    const glow = this.params.glowStrength > 0
      ? { strength: this.params.glowStrength, color: rgbToCss(this.params.glowColor) }
      : undefined;

    const Cls = (this.wave as any).animations[this.params.animation];
    if (!Cls) {
      console.warn('[WaveJS] unknown animation type:', this.params.animation);
      return;
    }

    // Each animation accepts a different options shape; passing all of
    // these is safe — unknown keys are ignored by the library.
    const opts: any = {
      lineColor,
      lineWidth: this.params.lineWidth,
      fillColor,
      glow,
      rounded: true,
    };

    try {
      this.wave.addAnimation(new Cls(opts));
    } catch (e) {
      console.warn('[WaveJS] failed to add animation', this.params.animation, e);
    }
  }
}
