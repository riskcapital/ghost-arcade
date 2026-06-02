// Analyzer Lab — multi-panel real-time spectral analyzer plugin.
//
// Inspired by Sonic Visualiser's data-dense academic aesthetic (the
// scrolling spectrogram + chromagram + waveform layout). We don't use
// any of Sonic Visualiser's code (it's GPL'd C++/Qt); this is an
// original Canvas-2D renderer that reads from our existing audio
// analyzer (getLastRawAnalysis() → AudioAnalysis.fftData / waveformData).
//
// Panel layout (top to bottom):
//   1. Spectrogram waterfall — large (60%). FFT magnitude over time,
//      log-frequency Y axis, scrolls left each frame.
//   2. Chromagram — 12-pitch-class energy bars (20%).
//   3. Waveform oscilloscope — time-domain (20%).
// Optional beat-marker overlay flashes vertical lines on detected beats.
//
// Author: Ghost Arcade (original) · inspiration credit: Sonic Visualiser
// (https://www.sonicvisualiser.org, Chris Cannam et al.)

import * as THREE from 'three';
import { getLastRawAnalysis } from '../stores/audio';

export type AnalyzerLabColormap = 'inferno' | 'viridis' | 'magma' | 'coral' | 'ice' | 'mono';
export type AnalyzerLabLayout = 'stack' | 'spectrogram' | 'chromagram' | 'waveform' | 'mirror';
export type AnalyzerLabChromaStyle = 'bars' | 'radial';
export type AnalyzerLabSpectroOrientation = 'horizontal' | 'vertical' | 'radial';
export type AnalyzerLabWaveStyle = 'line' | 'mirror' | 'filled';

export interface AnalyzerLabParams {
  layout: AnalyzerLabLayout;
  colormap: AnalyzerLabColormap;
  spectroGain: number;       // 0..2 — brightness multiplier on dB → color mapping
  spectroMinDb: number;      // -110..-40 — quiet floor (anything below maps to color[0])
  spectroMaxDb: number;      // -40..0 — loud ceiling
  spectroOrientation: AnalyzerLabSpectroOrientation;
  scrollSpeed: number;       // 0.25..4 — columns advanced per frame (effective time scale)
  chromaStyle: AnalyzerLabChromaStyle;
  chromaGlow: number;        // 0..1 — additive glow under chromagram bars
  waveStyle: AnalyzerLabWaveStyle;
  waveLineWidth: number;     // 1..4 — px stroke width of waveform polyline
  showBeats: boolean;        // flash vertical line on each beat onset
  bgAlpha: number;           // 0..1 — background fill alpha (0 = fully transparent)
  showLabels: boolean;       // draw small panel labels + pitch labels (academic vibe)
}

const DEFAULT_PARAMS: AnalyzerLabParams = {
  layout: 'stack',
  colormap: 'inferno',
  spectroGain: 1.0,
  spectroMinDb: -85,
  spectroMaxDb: -25,
  spectroOrientation: 'horizontal',
  scrollSpeed: 1.0,
  chromaStyle: 'bars',
  chromaGlow: 0.5,
  waveStyle: 'line',
  waveLineWidth: 1.5,
  showBeats: true,
  bgAlpha: 1.0,
  showLabels: true,
};

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// ─── Color LUTs ───────────────────────────────────────────────────────
// Each LUT maps t∈[0,1] → [r,g,b] each 0..255. Coarse 8-stop gradients
// are interpolated linearly to keep memory small and the look smooth.
type Stop = [number, number, number];
const STOPS: Record<AnalyzerLabColormap, Stop[]> = {
  // Classic black-violet-orange-yellow-white
  inferno: [[0,0,4],[40,11,84],[101,21,110],[159,42,99],[212,72,66],[245,125,21],[250,193,39],[252,255,164]],
  // Black-blue-green-yellow
  viridis: [[68,1,84],[71,44,122],[59,81,139],[44,113,142],[33,144,141],[39,173,129],[92,200,99],[253,231,37]],
  // Black-purple-pink-yellow (similar to inferno but pinker)
  magma:   [[0,0,4],[28,16,68],[79,18,123],[129,37,129],[181,54,122],[229,80,100],[251,135,97],[252,253,191]],
  // Ghost Arcade brand: black → coral → pink → off-white
  coral:   [[5,0,16],[55,8,40],[120,30,70],[190,55,90],[235,105,90],[255,170,140],[255,210,200],[255,240,235]],
  // Cold: black → deep blue → cyan → white
  ice:     [[0,0,15],[10,20,60],[20,60,110],[30,110,160],[50,170,210],[120,210,240],[200,240,250],[255,255,255]],
  // Plain monochrome white-on-black
  mono:    [[0,0,0],[32,32,32],[64,64,64],[96,96,96],[128,128,128],[170,170,170],[210,210,210],[255,255,255]],
};
function sampleLUT(cm: AnalyzerLabColormap, t: number): [number, number, number] {
  const s = STOPS[cm];
  if (t <= 0) return s[0];
  if (t >= 1) return s[s.length - 1];
  const f = t * (s.length - 1);
  const i = Math.floor(f);
  const k = f - i;
  const a = s[i], b = s[i + 1];
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

export class AnalyzerLabVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  // Scrolling spectrogram is rendered into this offscreen canvas;
  // each frame we drawImage(spectro, -1, 0) to shift left then draw a
  // single column on the right. Cheaper than re-rendering all history.
  private spectro: HTMLCanvasElement;
  private spectroCtx: CanvasRenderingContext2D;
  // Sample-rate cache for accurate frequency→pitch math. Falls back
  // to 44.1kHz if the analyzer hasn't reported one yet.
  private sampleRate = 44100;

  private texture: THREE.CanvasTexture;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.MeshBasicMaterial;
  private quad: THREE.Mesh;

  private width: number;
  private height: number;
  private params: AnalyzerLabParams = { ...DEFAULT_PARAMS };

  // Beat-onset edge detector — flash decays over a few frames.
  private prevBeat = false;
  private beatFlash = 0;   // 1.0 at onset, decays toward 0
  // Accumulator for fractional scroll speeds (e.g. 0.5 = advance 1 col
  // every other frame).
  private scrollAcc = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText = 'position:absolute;top:-99999px;left:-99999px;pointer-events:none;';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    // Spectrogram offscreen — sized to the spectrogram panel rect.
    // Reallocated on resize.
    this.spectro = document.createElement('canvas');
    this.spectro.width = Math.max(64, width);
    this.spectro.height = Math.max(32, Math.floor(height * 0.6));
    this.spectroCtx = this.spectro.getContext('2d')!;

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
  }

  init(_renderer: THREE.WebGLRenderer): void { /* nothing extra */ }

  setParams(p: Partial<AnalyzerLabParams>): void {
    Object.assign(this.params, p);
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    // Reallocate spectrogram offscreen — keep its size matched so the
    // waterfall sharpens on resize instead of stretching/blurring.
    const spW = Math.max(64, width);
    const spH = Math.max(32, Math.floor(height * 0.6));
    if (this.spectro.width !== spW || this.spectro.height !== spH) {
      this.spectro.width = spW;
      this.spectro.height = spH;
    }
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    const analysis = getLastRawAnalysis();
    this._draw(analysis);
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
    try { this.canvas.remove(); } catch {}
    this.texture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }

  // ── Internals ─────────────────────────────────────────────────────

  private _draw(analysis: ReturnType<typeof getLastRawAnalysis>): void {
    const ctx = this.ctx;
    const w = this.width, h = this.height;

    // Background — alpha-controlled so the analyzer can sit on top of
    // other layers when bgAlpha < 1.
    if (this.params.bgAlpha > 0.001) {
      ctx.globalAlpha = this.params.bgAlpha;
      ctx.fillStyle = '#06070a';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1.0;
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    // Beat flash detector — rising-edge on analysis.beat.isBeat
    const beatOn = !!analysis?.beat?.isBeat;
    if (beatOn && !this.prevBeat) this.beatFlash = 1.0;
    this.prevBeat = beatOn;
    this.beatFlash *= 0.86;

    // Always advance the spectrogram offscreen — even when not visible
    // in the current layout, this keeps the waterfall continuous when
    // the user toggles back to a spectro layout. Cheap.
    this._advanceSpectrogram(analysis);

    // Dispatch by layout
    switch (this.params.layout) {
      case 'spectrogram': this._drawSpectrogram(0, 0, w, h); break;
      case 'chromagram':  this._drawChromagram(analysis, 0, 0, w, h); break;
      case 'waveform':    this._drawWaveform(analysis, 0, 0, w, h); break;
      case 'mirror':      this._drawSpectroMirror(0, 0, w, h); break;
      case 'stack':
      default: {
        const spectroH = Math.floor(h * 0.6);
        const chromaH = Math.floor(h * 0.2);
        const waveH = h - spectroH - chromaH;
        const spectroY = 0;
        const chromaY = spectroH;
        const waveY = spectroH + chromaH;
        this._drawSpectrogram(0, spectroY, w, spectroH);
        this._drawChromagram(analysis, 0, chromaY, w, chromaH);
        this._drawWaveform(analysis, 0, waveY, w, waveH);

        // Panel separator lines (subtle)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, chromaY + 0.5);  ctx.lineTo(w, chromaY + 0.5);
        ctx.moveTo(0, waveY + 0.5);    ctx.lineTo(w, waveY + 0.5);
        ctx.stroke();

        if (this.params.showLabels) {
          ctx.fillStyle = 'rgba(220,220,220,0.55)';
          ctx.font = '10px "SF Mono", "Menlo", "Consolas", monospace';
          ctx.textBaseline = 'top';
          ctx.textAlign = 'left';
          ctx.fillText('SPECTROGRAM', 6, spectroY + 4);
          ctx.fillText('CHROMAGRAM',  6, chromaY + 4);
          ctx.fillText('WAVEFORM',    6, waveY + 4);
        }
        break;
      }
    }

    // BPM in corner always (academic vibe)
    if (this.params.showLabels && analysis && analysis.bpm > 0) {
      ctx.fillStyle = 'rgba(220,220,220,0.55)';
      ctx.font = '10px "SF Mono", "Menlo", "Consolas", monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round(analysis.bpm)} BPM`, w - 6, 4);
      ctx.textAlign = 'left';
    }
  }

  /** Shift the spectrogram offscreen one (or more) columns left and
   *  draw the new FFT column on the right. Called every frame so the
   *  waterfall stays continuous across layout switches. */
  private _advanceSpectrogram(analysis: ReturnType<typeof getLastRawAnalysis>): void {
    const fft = analysis?.fftData;
    this.scrollAcc += Math.max(0.01, this.params.scrollSpeed);
    const cols = Math.floor(this.scrollAcc);
    this.scrollAcc -= cols;
    if (cols <= 0) return;
    this.spectroCtx.drawImage(this.spectro, -cols, 0);
    this.spectroCtx.fillStyle = '#06070a';
    this.spectroCtx.fillRect(this.spectro.width - cols, 0, cols, this.spectro.height);
    if (fft && fft.length > 0) {
      const startX = this.spectro.width - cols;
      for (let c = 0; c < cols; c++) {
        this._drawSpectroColumn(startX + c, 1, fft);
      }
    }
  }

  /** Draw the spectrogram into a panel rect. Dispatches on orientation:
   *  - horizontal: time scrolls left, freq up (classic Sonic Visualiser)
   *  - vertical:   time scrolls up, freq across (rain-like)
   *  - radial:     time as angle around center, freq as radius (radar) */
  private _drawSpectrogram(x: number, y: number, w: number, h: number): void {
    const ori = this.params.spectroOrientation;
    if (ori === 'radial') {
      this._drawSpectroRadial(x, y, w, h);
    } else if (ori === 'vertical') {
      // Blit the offscreen rotated 90°. drawImage with rotation via the
      // context transform is cheap on every backend.
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(x + w * 0.5, y + h * 0.5);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(this.spectro, 0, 0, this.spectro.width, this.spectro.height, -h * 0.5, -w * 0.5, h, w);
      ctx.restore();
    } else {
      // horizontal — default
      this.ctx.drawImage(this.spectro, 0, 0, this.spectro.width, this.spectro.height, x, y, w, h);
    }

    // Beat flash overlay (right edge for horizontal; top for vertical)
    if (this.params.showBeats && this.beatFlash > 0.02) {
      this.ctx.fillStyle = `rgba(255, 255, 255, ${this.beatFlash * 0.5})`;
      if (ori === 'vertical')      this.ctx.fillRect(x, y, w, 2);
      else if (ori === 'horizontal') this.ctx.fillRect(x + w - 2, y, 2, h);
      else                           {  // radial: pulse a thin ring
        const cx = x + w * 0.5, cy = y + h * 0.5;
        const rad = Math.min(w, h) * 0.5 - 4;
        this.ctx.beginPath();
        this.ctx.lineWidth = 2;
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${this.beatFlash * 0.5})`;
        this.ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        this.ctx.stroke();
      }
    }
  }

  /** Radial spectrogram — pulls from the same scrolling offscreen as
   *  horizontal. Each angle around the circle samples a column from
   *  the offscreen (right edge = "now", wrapping leftward = the past).
   *  The radius from inner→outer maps from low→high frequency. */
  private _drawSpectroRadial(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const outerR = Math.min(w, h) * 0.5 - 6;
    const innerR = outerR * 0.20;
    // Sample N angles around the circle; per angle draw a thin wedge
    // by transforming + drawing a 1-column slice of the offscreen.
    const N = 180;  // half-degree precision
    const dA = (Math.PI * 2) / N;
    const sw = this.spectro.width;
    const sh = this.spectro.height;
    for (let i = 0; i < N; i++) {
      // 0 = newest (right edge of offscreen); N-1 = oldest (left edge)
      const colX = Math.max(0, sw - 1 - Math.floor((i / N) * sw));
      const angle = i * dA - Math.PI / 2;  // start straight up
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      // Draw the single offscreen column scaled into a radial slice.
      // Width slightly > arc-width so neighbours overlap (no gaps).
      const arcW = Math.max(1, outerR * dA * 1.15);
      ctx.drawImage(this.spectro, colX, 0, 1, sh, -arcW * 0.5, innerR, arcW, outerR - innerR);
      ctx.restore();
    }
    // Central inner-disc cap so the middle reads as a "core" not a hole.
    ctx.fillStyle = '#06070a';
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Mirror layout: top half = spectrogram, bottom half = same flipped
   *  vertically. Reads like a butterfly / Rorschach. */
  private _drawSpectroMirror(x: number, y: number, w: number, h: number): void {
    const halfH = Math.floor(h * 0.5);
    // Top half — normal
    this.ctx.drawImage(this.spectro, 0, 0, this.spectro.width, this.spectro.height, x, y, w, halfH);
    // Bottom half — vertically flipped
    this.ctx.save();
    this.ctx.translate(x, y + h);
    this.ctx.scale(1, -1);
    this.ctx.drawImage(this.spectro, 0, 0, this.spectro.width, this.spectro.height, 0, 0, w, halfH);
    this.ctx.restore();
    // Thin centerline
    this.ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(x, y + halfH + 0.5);
    this.ctx.lineTo(x + w, y + halfH + 0.5);
    this.ctx.stroke();
  }

  /** Draw one vertical column of the spectrogram. Logarithmic Y so bass
   *  takes more of the panel than treble — matches musical perception
   *  and the Sonic Visualiser default. */
  private _drawSpectroColumn(colX: number, colW: number, fft: Float32Array): void {
    const ctx = this.spectroCtx;
    const h = this.spectro.height;
    const N = fft.length;
    const nyquist = this.sampleRate * 0.5;
    const minF = 30;        // ~A0
    const maxF = nyquist;
    const logMin = Math.log(minF);
    const logMax = Math.log(maxF);
    const minDb = this.params.spectroMinDb;
    const maxDb = this.params.spectroMaxDb;
    const dbRange = Math.max(1, maxDb - minDb);
    const gain = this.params.spectroGain;
    const cm = this.params.colormap;

    // For each pixel row in the panel, find the FFT bin that maps to
    // that row's frequency (log scale) and pick the magnitude there.
    // Sample 2-3 bins around target for smoother gradients.
    for (let py = 0; py < h; py++) {
      // py=0 → top → high frequency. py=h-1 → bottom → low.
      const tNorm = py / (h - 1);       // 0..1 top→bottom
      const logF = logMax - (logMax - logMin) * tNorm;  // high→low
      const f = Math.exp(logF);
      const binF = f / nyquist * N;
      const i0 = Math.max(0, Math.min(N - 1, Math.floor(binF)));
      const i1 = Math.max(0, Math.min(N - 1, i0 + 1));
      const k = binF - i0;
      const db = fft[i0] * (1 - k) + fft[i1] * k;  // linear interp in dB
      const t = Math.max(0, Math.min(1, (db - minDb) / dbRange)) * gain;
      const tC = Math.max(0, Math.min(1, t));
      const [r, g, b] = sampleLUT(cm, tC);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(colX, py, colW, 1);
    }
  }

  /** Chromagram — fold every FFT bin into one of 12 pitch classes and
   *  sum the magnitudes. Dispatches on chromaStyle: 'bars' or 'radial'. */
  private _drawChromagram(analysis: ReturnType<typeof getLastRawAnalysis>, x: number, y: number, w: number, h: number): void {
    const fft = analysis?.fftData;
    if (!fft || fft.length === 0) return;
    const buckets = this._computeChroma(fft);
    if (this.params.chromaStyle === 'radial') {
      this._drawChromaRadial(buckets, x, y, w, h);
    } else {
      this._drawChromaBars(buckets, x, y, w, h);
    }
  }

  /** Compute the 12-pitch-class chroma vector from an FFT frame. */
  private _computeChroma(fft: Float32Array): Float32Array {
    const N = fft.length;
    const nyquist = this.sampleRate * 0.5;
    const minDb = this.params.spectroMinDb;
    const maxDb = this.params.spectroMaxDb;
    const dbRange = Math.max(1, maxDb - minDb);
    const buckets = new Float32Array(12);
    const counts = new Float32Array(12);
    for (let i = 1; i < N; i++) {
      const f = (i / N) * nyquist;
      if (f < 65 || f > 4000) continue;  // ~C2..C8 musical range
      const midi = 12 * Math.log2(f / 440) + 69;
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      const mag = Math.max(0, Math.min(1, (fft[i] - minDb) / dbRange));
      buckets[pc] += mag;
      counts[pc]++;
    }
    for (let p = 0; p < 12; p++) {
      if (counts[p] > 0) buckets[p] /= counts[p];
    }
    return buckets;
  }

  private _drawChromaBars(buckets: Float32Array, x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const cm = this.params.colormap;
    const padX = 8;
    const padTop = this.params.showLabels ? 18 : 4;
    const padBot = this.params.showLabels ? 14 : 4;
    const barAreaW = w - padX * 2;
    const barAreaH = h - padTop - padBot;
    const barGap = 2;
    const barW = (barAreaW - barGap * 11) / 12;

    for (let p = 0; p < 12; p++) {
      const v = Math.max(0, Math.min(1, buckets[p]));
      const bh = v * barAreaH;
      const bx = x + padX + p * (barW + barGap);
      const by = y + padTop + (barAreaH - bh);
      const [r, g, b] = sampleLUT(cm, 0.3 + v * 0.7);

      if (this.params.chromaGlow > 0.01 && v > 0.02) {
        ctx.fillStyle = `rgba(${r | 0},${g | 0},${b | 0}, ${0.25 * this.params.chromaGlow})`;
        ctx.fillRect(bx - 2, y + padTop, barW + 4, barAreaH);
      }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(bx, by, barW, bh);

      if (this.params.showLabels) {
        ctx.fillStyle = 'rgba(220,220,220,0.65)';
        ctx.font = '9px "SF Mono", "Menlo", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(PITCH_NAMES[p], bx + barW * 0.5, y + h - 2);
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  /** Radial chromagram — 12 wedges arranged as a clock face. Bar length
   *  = pitch energy. Looks like a tuning compass / pitch wheel. */
  private _drawChromaRadial(buckets: Float32Array, x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const cm = this.params.colormap;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const outerR = Math.min(w, h) * 0.5 - 14;
    const innerR = outerR * 0.30;
    const wedge = (Math.PI * 2) / 12;
    const labelR = outerR + 8;

    // Background ring
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
    ctx.stroke();

    for (let p = 0; p < 12; p++) {
      const v = Math.max(0, Math.min(1, buckets[p]));
      const a0 = p * wedge - Math.PI / 2;     // start at top (C = 12 o'clock)
      const a1 = a0 + wedge;
      const aMid = a0 + wedge * 0.5;
      const r = innerR + (outerR - innerR) * v;
      const [cR, cG, cB] = sampleLUT(cm, 0.3 + v * 0.7);

      // Glow underlay
      if (this.params.chromaGlow > 0.01 && v > 0.02) {
        ctx.fillStyle = `rgba(${cR | 0},${cG | 0},${cB | 0}, ${0.20 * this.params.chromaGlow})`;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, outerR, a0, a1);
        ctx.closePath();
        ctx.fill();
      }

      // The wedge bar — pie slice from inner ring to v*outer
      ctx.fillStyle = `rgb(${cR | 0},${cG | 0},${cB | 0})`;
      ctx.beginPath();
      ctx.arc(cx, cy, innerR, a0, a1);
      ctx.arc(cx, cy, r, a1, a0, true);
      ctx.closePath();
      ctx.fill();

      // Pitch label
      if (this.params.showLabels) {
        const lx = cx + Math.cos(aMid) * labelR;
        const ly = cy + Math.sin(aMid) * labelR;
        ctx.fillStyle = 'rgba(220,220,220,0.7)';
        ctx.font = '10px "SF Mono", "Menlo", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(PITCH_NAMES[p], lx, ly);
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  private _drawWaveform(analysis: ReturnType<typeof getLastRawAnalysis>, x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    const wf = analysis?.waveformData;
    const midY = y + h * 0.5;
    const style = this.params.waveStyle;

    // Center line (always drawn — gives the panel a reference even on silence)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, midY + 0.5);
    ctx.lineTo(x + w, midY + 0.5);
    ctx.stroke();

    if (!wf || wf.length === 0) return;

    const [r, g, b] = sampleLUT(this.params.colormap, 0.7);
    const stroke = `rgb(${r | 0},${g | 0},${b | 0})`;
    const fillFaint = `rgba(${r | 0},${g | 0},${b | 0}, 0.35)`;
    const step = wf.length / w;
    const amp = h * 0.42;
    const sampleAt = (i: number) => wf[Math.min(wf.length - 1, Math.floor(i * step))];

    if (style === 'filled') {
      // Area between waveform line and center, filled.
      ctx.fillStyle = fillFaint;
      ctx.beginPath();
      ctx.moveTo(x, midY);
      for (let i = 0; i < w; i++) {
        ctx.lineTo(x + i, midY - sampleAt(i) * amp);
      }
      ctx.lineTo(x + w - 1, midY);
      ctx.closePath();
      ctx.fill();
    }

    // The waveform line itself — always drawn over the fill so the edge stays crisp.
    ctx.strokeStyle = stroke;
    ctx.lineWidth = this.params.waveLineWidth;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < w; i++) {
      const px = x + i;
      const py = midY - sampleAt(i) * amp;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    if (style === 'mirror') {
      // Symmetric reflection below the center line.
      ctx.beginPath();
      for (let i = 0; i < w; i++) {
        const px = x + i;
        const py = midY + sampleAt(i) * amp;  // flipped sign
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }
}
