// HandFX — Conducting visuals with your hands.
//
// Modes (selectable in the panel):
//   panel    — White rectangle between the two palms. Pair with the
//              layer's Difference blend mode for the "spread hands and
//              invert what's behind" effect.
//   trails   — PAINT. Each fingertip is a glowing brush. Stroke width
//              rides hand velocity, particles shed along the stroke
//              and drift through a curl-noise flow field. The
//              backbuffer fades slowly so paint LINGERS. Best mode
//              for conducting / drawing.
//   aurora   — INK. Soft alpha blobs spawn at palm + fingertips and
//              drift outward with additive blend. Coloured smoke
//              flowing off your hands.
//   skeleton — Stylised neon-bone skeleton with glowing fingertip
//              dots. Matches MediaPipe's hand topology.
//   bursts   — PINCH SPRAY. Continuous particle spray fires from the
//              pinch point whenever your thumb + index are close.
//              Intensity scales with how tight the pinch is. Released
//              = silent. Good for punctuation without gesture-detector
//              latency.
//
// Responsiveness: an adaptive per-landmark EMA filters tiny jitter but
// passes big motions through nearly unfiltered, so the visual feels
// snappier than raw landmarks AND rock-steady when the hand is still.
// `smoothing` param trades the two (0 = raw, 1 = heavy filtering).
//
// We do NOT stop the MediaPipe worker on dispose — other UI (debug
// overlay, future gesture broadcasters) may be sharing the camera.

import * as THREE from 'three';
import { mediaPipeSource } from '../mediapipe/mediaPipeSource';
import type { SignalFrame } from '../mediapipe/signals';

export type HandFXMode = 'panel' | 'trails' | 'aurora' | 'skeleton' | 'bursts';
export type HandFXColorMode = 'rainbow' | 'coral' | 'white' | 'cyan';

export interface HandFXParams {
  mode: HandFXMode;
  /** Treated as a Start/Stop button. false→true calls
   *  mediaPipeSource.start() (camera-permission prompt on first
   *  activation), true→false releases the camera. Default false. */
  cameraOn: boolean;
  /** 0..1 — adaptive smoothing strength. 0 = raw landmarks (jittery
   *  but maximally responsive), 1 = max smoothing (lazy). Default 0.15
   *  trades a tiny amount of jitter for minimum perceived lag. */
  smoothing: number;
  /** 0..40 — forward prediction window in ms. Extrapolates landmark
   *  position along its smoothed velocity vector to mask camera +
   *  inference latency. Higher values feel snappier but overshoot on
   *  sudden direction changes. 18ms (~1 frame) is the sweet spot. */
  predictMs: number;

  // Panel mode
  panelColor: string;
  panelOpacity: number;
  panelPadding: number;       // 0..0.2 — extra padding beyond palms in uv
  panelCornerRadius: number;  // 0..0.1 — uv units

  // Paint mode (mode === 'trails')
  /** 0.9..0.999 — backbuffer per-frame alpha decay. Higher = paint
   *  lingers longer. 0.985 default reads as "still visible 1-2s later". */
  trailFade: number;
  trailColorMode: HandFXColorMode;
  /** 1..8 — base brushstroke width in px (before velocity scaling). */
  trailThickness: number;
  /** 0..3 — how much hand velocity widens the stroke. */
  trailVelocityScale: number;
  /** 0..2 — number of sparks emitted per unit motion along the stroke. */
  trailSparkDensity: number;
  /** 0..2 — strength of the curl-noise flow field on shed sparks. */
  trailFlowStrength: number;

  // Ink mode (mode === 'aurora')
  /** 10..120 — base blob radius in px. */
  inkSize: number;
  /** 0..1 — per-blob centre alpha. */
  inkOpacity: number;
  inkColorMode: HandFXColorMode;
  /** 0..3 — blob drift speed multiplier. */
  inkDrift: number;

  // Skeleton mode
  skeletonColor: string;
  skeletonGlow: number;       // 0..3

  // Pinch spray mode (mode === 'bursts')
  /** 0.1..3 — particles emitted per frame at maximum pinch. */
  sprayIntensity: number;
  /** 0.05..0.5 — pinch distance (uv-normalised, hand-sized) at which
   *  the spray turns on. Tighter pinch = stronger spray. */
  sprayThreshold: number;
  sprayColorMode: HandFXColorMode;

  // Global
  bgAlpha: number;            // 0..1 — bg fill alpha (0 = transparent over other layers)
  showHelp: boolean;          // overlay status text when no hands / camera off
  /** Render the live camera feed underneath the hand effects. Useful
   *  for setup ("are you in frame?") and for stage VJ moments where
   *  the performer is visible behind their own paint. Mirrored to
   *  match the landmark coord space when the source is mirrored. */
  showCamera: boolean;
  /** 0..1 — camera-feed opacity. Multiplies the video before any
   *  hand effects composite on top. */
  cameraOpacity: number;
}

const DEFAULT_PARAMS: HandFXParams = {
  mode: 'trails',
  cameraOn: false,
  smoothing: 0.15,
  predictMs: 18,
  panelColor: '#FFFFFF',
  panelOpacity: 1.0,
  panelPadding: 0.04,
  panelCornerRadius: 0.02,
  trailFade: 0.985,
  trailColorMode: 'rainbow',
  trailThickness: 3,
  trailVelocityScale: 1.5,
  trailSparkDensity: 0.5,
  trailFlowStrength: 0.7,
  inkSize: 55,
  inkOpacity: 0.28,
  inkColorMode: 'coral',
  inkDrift: 1.0,
  skeletonColor: '#FF6B6B',
  skeletonGlow: 1.5,
  sprayIntensity: 1.5,
  sprayThreshold: 0.25,
  sprayColorMode: 'rainbow',
  bgAlpha: 0.0,
  showHelp: true,
  showCamera: false,
  cameraOpacity: 0.5,
};

// MediaPipe hand topology — same 20 edges the debug overlay uses.
const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],            // Thumb
  [0, 5], [5, 6], [6, 7], [7, 8],            // Index
  [5, 9], [9, 10], [10, 11], [11, 12],       // Middle
  [9, 13], [13, 14], [14, 15], [15, 16],     // Ring
  [13, 17], [17, 18], [18, 19], [19, 20],    // Pinky
  [0, 17],                                    // Palm base
];
// Five fingertip landmark indices.
const FINGERTIPS = [4, 8, 12, 16, 20];
// Per-fingertip hue (0..1) for the 'rainbow' color mode. Picked to spread
// across the wheel without two neighbours stealing each other's identity:
// thumb=warm red, index=orange, middle=magenta, ring=cyan, pinky=green.
const FINGER_HUES = [0.02, 0.10, 0.86, 0.55, 0.32];

const SIDES = ['Left', 'Right'] as const;
type Side = (typeof SIDES)[number];

// Per-hand per-fingertip trail state: previous on-screen position +
// time. -1 means "not seen since reset" — used to skip the first stroke
// after a hand re-enters frame so we don't draw a spurious huge line
// from the last known position to the new one.
interface FingerTrailState {
  prevX: number;
  prevY: number;
  prevTime: number;
}

// Smoothing state per landmark per hand. 21 landmarks × 2 hands = 42
// entries, cheap. vx/vy track smoothed velocity in uv/sec so we can
// forward-predict the next ~20ms to mask camera + inference latency.
interface SmoothState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  lastTime: number;
}

class FxParticle {
  x = 0; y = 0;
  vx = 0; vy = 0;
  life = 1;        // 0..1, decays
  decay = 0.012;   // per-frame
  hue = 0;         // 0..1 (-1 = white sentinel)
  size = 3;
}

export class HandFXVisualizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  // Trails-mode persistent backbuffer (faded each frame, additively
  // drawn into).
  private trailBuf: HTMLCanvasElement;
  private trailCtx: CanvasRenderingContext2D;

  private texture: THREE.CanvasTexture;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private material: THREE.MeshBasicMaterial;
  private quad: THREE.Mesh;

  private width: number;
  private height: number;
  private params: HandFXParams = { ...DEFAULT_PARAMS };

  // Latest landmark frame from MediaPipe (null until a hand is seen).
  private frame: SignalFrame | null = null;
  private unsubscribe: (() => void) | null = null;

  // Particles (used by paint sparks + pinch spray).
  private particles: FxParticle[] = [];

  // Per-side per-fingertip stroke state for the paint mode.
  private fingerTrails: Record<Side, FingerTrailState[]> = {
    Left:  FINGERTIPS.map(() => ({ prevX: -1, prevY: -1, prevTime: 0 })),
    Right: FINGERTIPS.map(() => ({ prevX: -1, prevY: -1, prevTime: 0 })),
  };

  // Smoothed landmarks. Keyed `${side}-${landmarkIdx}` so a hand
  // disappearing and reappearing on the same side stays smooth.
  private smoothStates: Map<string, SmoothState> = new Map();

  // Render-loop clock for the curl-noise flow field.
  private lastFrameTime = 0;

  // Camera state. cameraStarting prevents double-start while the
  // permission prompt is open or the worker is still initialising.
  // cameraAttempted gates retry after a failed start: without it, the
  // setParams call on every render frame would see effectSource's
  // cameraOn=true and trigger start() → fail → retry forever, which
  // shows up as the macOS camera indicator strobing on and off.
  private cameraStarting = false;
  private cameraAttempted = false;
  private cameraError: string | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;

    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvas.style.cssText = 'position:absolute;top:-99999px;left:-99999px;pointer-events:none;';
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;

    this.trailBuf = document.createElement('canvas');
    this.trailBuf.width = width;
    this.trailBuf.height = height;
    this.trailCtx = this.trailBuf.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    // 2D canvas is Y-down (origin top-left); Three's default UVs assume
    // Y-up. flipY=true tells Three to flip the texture during upload so
    // canvas y=0 lands at clip y=+1 (top of view) — without it, MediaPipe
    // landmarks drawn at the user's hand position render upside-down.
    // The other Canvas-textured visualizers (hydra, audiomotion) get
    // away with flipY=false because they render via WebGL, which is
    // already Y-up.
    this.texture.flipY = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false, depthWrite: false });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);

    this.unsubscribe = mediaPipeSource.subscribe((f) => { this.frame = f; });
  }

  init(_renderer: THREE.WebGLRenderer): void { /* nothing extra */ }

  setParams(p: Partial<HandFXParams>): void {
    const prevCamera = this.params.cameraOn;
    Object.assign(this.params, p);
    // Camera On toggle acts as Start/Stop. We compare against the prior
    // value so re-applying the same param block per frame is a no-op.
    if (this.params.cameraOn && !prevCamera) {
      // Off → On: user activated the camera. Triggers permission prompt
      // on first activation. cameraAttempted suppresses the implicit
      // per-frame retry after a failure — the user must toggle off then
      // on again to retry, which avoids strobing the camera indicator.
      if (!mediaPipeSource.isRunning() && !this.cameraStarting && !this.cameraAttempted) {
        this.cameraStarting = true;
        this.cameraAttempted = true;
        this.cameraError = null;
        mediaPipeSource.start()
          .then(() => { this.cameraStarting = false; })
          .catch((e) => {
            this.cameraStarting = false;
            this.cameraError = e?.message ?? String(e);
            console.warn('[HandFX] camera start failed:', e);
          });
      }
    } else if (!this.params.cameraOn && prevCamera) {
      // On → Off: release the camera. Clear cameraAttempted so the
      // next Off → On transition is allowed to start a fresh attempt.
      this.cameraAttempted = false;
      mediaPipeSource.stop().catch(() => {});
    }
  }

  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.trailBuf.width !== width || this.trailBuf.height !== height) {
      this.trailBuf.width = width;
      this.trailBuf.height = height;
    }
  }

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget): void {
    this._draw();
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
    try { this.unsubscribe?.(); } catch {}
    try { this.canvas.remove(); } catch {}
    this.texture.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }

  // ─── Drawing ──────────────────────────────────────────────────────

  private _draw(): void {
    const ctx = this.ctx;
    const w = this.width, h = this.height;
    const now = performance.now();
    const dt = Math.min(50, Math.max(1, now - this.lastFrameTime));  // ms, clamped to avoid huge jumps
    this.lastFrameTime = now;

    // For trails mode we fade the trail buffer instead of clearing the
    // main canvas — that's what makes paint linger. We still want to
    // refresh the main canvas's background (clear OR camera OR bgAlpha
    // fill) every frame because the trail buffer gets blitted on top.
    if (this.params.mode === 'trails') {
      this._fadeTrailBuffer();
    }
    if (this.params.showCamera) {
      this._drawCameraBackground();
    } else if (this.params.mode !== 'trails') {
      // _fadeTrailBuffer already painted the main canvas — only the
      // non-trails branch needs to clear/fill here.
      if (this.params.bgAlpha > 0.001) {
        ctx.globalAlpha = this.params.bgAlpha;
        ctx.fillStyle = '#08080d';
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1.0;
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    }

    // Smooth landmarks BEFORE drawing — reset state for hands that
    // dropped out so reappearance doesn't lerp from a stale position.
    const rawHands = this.frame?.hands ?? [];
    const hands = this._smoothFrame(rawHands);
    const cameraOn = mediaPipeSource.isRunning();
    const noHands = hands.length === 0;

    // Reset stroke trail state for hands that aren't visible this
    // frame so the next time they appear we don't draw a huge stroke
    // from where they were last seen to where they are now.
    const activeSides = new Set(hands.map(h => h.handedness as Side));
    for (const side of SIDES) {
      if (!activeSides.has(side)) {
        for (const fs of this.fingerTrails[side]) {
          fs.prevX = -1; fs.prevY = -1;
        }
      }
    }

    // No on-canvas status text. The HandFX visualizer renders into the
    // composited output / projection — anything we draw here shows up
    // on the projector. Camera/hand state is communicated through the
    // panel UI (Camera toggle, settings) instead.

    switch (this.params.mode) {
      case 'panel':    this._drawPanel(hands); break;
      case 'trails':   this._drawPaint(hands, now, dt); break;
      case 'aurora':   this._drawInk(hands, now, dt); break;
      case 'skeleton': this._drawSkeleton(hands); break;
      case 'bursts':   this._drawPinchSpray(hands, now, dt); break;
    }
  }

  /** Locate the left and right hand landmark arrays. handedness from
   *  MediaPipe is the user's perspective when mirror=true. */
  private _byHand(hands: SignalFrame['hands']): {
    left: { x: number; y: number; z: number }[] | null;
    right: { x: number; y: number; z: number }[] | null;
  } {
    let left = null, right = null;
    for (const h of hands) {
      if (h.handedness === 'Left') left = h.landmarks;
      else if (h.handedness === 'Right') right = h.landmarks;
    }
    return { left, right };
  }

  /** Average landmarks 0, 5, 9, 13, 17 → palm center (same convention
   *  used in signals.ts). Returns null if landmarks empty. */
  private _palmCenter(lm: { x: number; y: number }[] | null): { x: number; y: number } | null {
    if (!lm) return null;
    const idx = [0, 5, 9, 13, 17];
    let ax = 0, ay = 0;
    for (const i of idx) { ax += lm[i].x; ay += lm[i].y; }
    return { x: ax / idx.length, y: ay / idx.length };
  }

  // ── SMOOTHING ────────────────────────────────────────────────────
  // Adaptive EMA: alpha increases with motion. Tiny motions are heavily
  // filtered (kills jitter); large motions pass through nearly raw
  // (snappy). The user param `smoothing` 0..1 sets the floor.
  private _smoothFrame(hands: SignalFrame['hands']): SignalFrame['hands'] {
    // Drop smooth state for hands not in this frame so reappearance
    // doesn't lerp from a stale point.
    const activeSides = new Set(hands.map(h => h.handedness as Side));
    for (const side of SIDES) {
      if (!activeSides.has(side)) {
        for (let i = 0; i < 21; i++) this.smoothStates.delete(`${side}-${i}`);
      }
    }
    const baseAlpha = Math.max(0, Math.min(1, 1 - this.params.smoothing));
    const now = performance.now();
    const predictMs = Math.max(0, Math.min(40, this.params.predictMs));
    return hands.map(h => ({
      ...h,
      landmarks: h.landmarks.map((lm, i) =>
        this._smooth(h.handedness, i, lm, baseAlpha, now, predictMs)
      ),
    }));
  }

  private _smooth(side: string, idx: number, raw: { x: number; y: number; z: number }, baseAlpha: number, now: number, predictMs: number): { x: number; y: number; z: number } {
    const key = `${side}-${idx}`;
    let s = this.smoothStates.get(key);
    if (!s) {
      s = { x: raw.x, y: raw.y, z: raw.z, vx: 0, vy: 0, lastTime: now };
      this.smoothStates.set(key, s);
      return raw;
    }

    // Smooth position. Adaptive alpha: at zero motion the filter is
    // tight (baseAlpha); at large motion it fully releases. 30× scaling
    // means a 3% uv jump per frame is enough to bypass the filter.
    const rawDx = raw.x - s.x;
    const rawDy = raw.y - s.y;
    const motion = Math.hypot(rawDx, rawDy);
    const alpha = Math.min(1, baseAlpha + motion * 30);

    // Velocity in uv/sec from raw delta over the elapsed time, then EMA
    // so it's smooth enough to extrapolate from. We use the raw delta
    // (not the smoothed step) because velocity should reflect the
    // hand's actual motion, not the filter's catch-up speed.
    const dt = Math.max(1, now - s.lastTime);  // ms
    const instVx = (rawDx / dt) * 1000;
    const instVy = (rawDy / dt) * 1000;
    const vAlpha = 0.45;
    s.vx = s.vx * (1 - vAlpha) + instVx * vAlpha;
    s.vy = s.vy * (1 - vAlpha) + instVy * vAlpha;
    s.lastTime = now;

    s.x += rawDx * alpha;
    s.y += rawDy * alpha;
    s.z += (raw.z - s.z) * alpha;

    if (predictMs <= 0) {
      return { x: s.x, y: s.y, z: s.z };
    }

    // Forward-predict along smoothed velocity. Cap the extrapolation
    // step at 1.5× the actual per-frame motion so we don't fling the
    // marker past the hand when motion reverses or the hand stops.
    const stepX = s.vx * (predictMs / 1000);
    const stepY = s.vy * (predictMs / 1000);
    const cap = Math.max(0.002, motion * 1.5);  // floor avoids zero-cap on dead-still hands
    const len = Math.hypot(stepX, stepY) || 1;
    const scale = Math.min(1, cap / len);
    return {
      x: s.x + stepX * scale,
      y: s.y + stepY * scale,
      z: s.z,
    };
  }

  // ── CAMERA BACKGROUND ─────────────────────────────────────────────
  // Draw the live video into the main canvas at the requested opacity.
  // Mirrors horizontally when the source is in mirror mode so the user's
  // hand visually lines up with the landmark-driven effects (the source
  // mirrors when sending frames to inference, but the <video> element
  // itself is not flipped).
  private _drawCameraBackground(): void {
    const video = mediaPipeSource.getVideoElement();
    const ctx = this.ctx;
    const w = this.width, h = this.height;

    // Clear first so transparent regions don't show stale paint when
    // camera goes away mid-frame.
    ctx.clearRect(0, 0, w, h);

    if (!video || video.readyState < 2 || video.videoWidth === 0) return;

    const op = Math.max(0, Math.min(1, this.params.cameraOpacity));
    if (op <= 0.001) return;

    ctx.save();
    ctx.globalAlpha = op;
    if (mediaPipeSource.getOpts().mirror) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    // object-fit:cover style — crop to fill, preserve aspect.
    const vw = video.videoWidth, vh = video.videoHeight;
    const srcAspect = vw / vh, dstAspect = w / h;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (srcAspect > dstAspect) {
      // source is wider — crop horizontally
      sw = vh * dstAspect;
      sx = (vw - sw) * 0.5;
    } else {
      sh = vw / dstAspect;
      sy = (vh - sh) * 0.5;
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();
    ctx.globalAlpha = 1.0;
  }

  // ── PANEL MODE ────────────────────────────────────────────────────
  private _drawPanel(hands: SignalFrame['hands']): void {
    const { left, right } = this._byHand(hands);
    const pL = this._palmCenter(left);
    const pR = this._palmCenter(right);
    if (!pL || !pR) return;

    const ctx = this.ctx;
    const w = this.width, h = this.height;

    // Bounding rect of the two palms (uv space), expanded by panelPadding.
    const pad = this.params.panelPadding;
    const x0u = Math.min(pL.x, pR.x) - pad;
    const x1u = Math.max(pL.x, pR.x) + pad;
    const y0u = Math.min(pL.y, pR.y) - pad;
    const y1u = Math.max(pL.y, pR.y) + pad;

    // Clamp to canvas
    const x = Math.max(0, x0u) * w;
    const y = Math.max(0, y0u) * h;
    const rw = Math.max(0, Math.min(1, x1u) - Math.max(0, x0u)) * w;
    const rh = Math.max(0, Math.min(1, y1u) - Math.max(0, y0u)) * h;
    if (rw < 4 || rh < 4) return;

    const r = Math.min(rw, rh) * 0.5 * Math.min(1, this.params.panelCornerRadius * 10);
    ctx.fillStyle = this.params.panelColor;
    ctx.globalAlpha = this.params.panelOpacity;
    this._roundRect(ctx, x, y, rw, rh, r);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // ── PAINT MODE (was TRAILS) ────────────────────────────────────────
  // Velocity-driven brushstrokes from each fingertip + sparks emitted
  // along the stroke that drift through a curl-noise flow field. The
  // backbuffer fades slowly so paint lingers; high trailFade values
  // (0.98+) read as "still hanging in the air".
  private _fadeTrailBuffer(): void {
    // destination-in with a translucent black multiplies the trail
    // buffer's alpha by trailFade each frame → exponential decay.
    this.trailCtx.globalCompositeOperation = 'destination-in';
    this.trailCtx.fillStyle = `rgba(0, 0, 0, ${this.params.trailFade})`;
    this.trailCtx.fillRect(0, 0, this.trailBuf.width, this.trailBuf.height);
    this.trailCtx.globalCompositeOperation = 'source-over';
    // Composite the bg onto the main canvas (transparent under
    // unless bgAlpha > 0).
    if (this.params.bgAlpha > 0.001) {
      this.ctx.globalAlpha = this.params.bgAlpha;
      this.ctx.fillStyle = '#08080d';
      this.ctx.fillRect(0, 0, this.width, this.height);
      this.ctx.globalAlpha = 1.0;
    } else {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  private _drawPaint(hands: SignalFrame['hands'], now: number, _dt: number): void {
    const w = this.width, h = this.height;
    const tctx = this.trailCtx;

    // ── Brushstrokes from each fingertip ──
    tctx.globalCompositeOperation = 'lighter';
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';

    for (const hand of hands) {
      const side = hand.handedness as Side;
      const states = this.fingerTrails[side];
      if (!states) continue;
      const lm = hand.landmarks;

      for (let ftIdx = 0; ftIdx < FINGERTIPS.length; ftIdx++) {
        const ft = lm[FINGERTIPS[ftIdx]];
        const x = ft.x * w, y = ft.y * h;
        const st = states[ftIdx];

        if (st.prevX < 0) {
          st.prevX = x; st.prevY = y; st.prevTime = now;
          continue;
        }

        const dx = x - st.prevX;
        const dy = y - st.prevY;
        const segLen = Math.hypot(dx, dy);
        // Velocity in px/ms → modulates stroke width.
        const tdelta = Math.max(1, now - st.prevTime);
        const vel = segLen / tdelta;

        const hue = this._colorHue(this.params.trailColorMode, ftIdx, now);
        const baseW = this.params.trailThickness;
        const w0 = baseW + vel * 8 * this.params.trailVelocityScale;
        const layers = 3;  // outer glow → core
        for (let L = 0; L < layers; L++) {
          const widthMul = 1 + (layers - L - 1) * 2.5;  // outer wider
          const alpha = (0.25 / (layers - L)) + (L === layers - 1 ? 0.55 : 0);
          tctx.strokeStyle = this._rgbaFromHue(hue, alpha);
          tctx.lineWidth = w0 * widthMul;
          tctx.beginPath();
          tctx.moveTo(st.prevX, st.prevY);
          tctx.lineTo(x, y);
          tctx.stroke();
        }

        // ── Sparks along the stroke ──
        // Particle count proportional to motion AND density param.
        const sparkCount = Math.floor(segLen * this.params.trailSparkDensity * 0.4);
        for (let s = 0; s < sparkCount; s++) {
          const t = Math.random();
          const sx = st.prevX + dx * t + (Math.random() - 0.5) * 4;
          const sy = st.prevY + dy * t + (Math.random() - 0.5) * 4;
          const p = new FxParticle();
          p.x = sx; p.y = sy;
          // Inherit a fraction of hand velocity so sparks fly in the
          // direction the brush is moving.
          const inherit = 0.4;
          p.vx = (dx / tdelta) * inherit * (0.6 + Math.random() * 0.8);
          p.vy = (dy / tdelta) * inherit * (0.6 + Math.random() * 0.8);
          // Plus a small random kick perpendicular for spread.
          const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * Math.PI * 0.6;
          const kick = 0.4 + Math.random() * 0.8;
          p.vx += Math.cos(ang) * kick;
          p.vy += Math.sin(ang) * kick;
          p.life = 1.0;
          p.decay = 0.005 + Math.random() * 0.008;
          p.hue = hue;
          p.size = baseW * (0.5 + Math.random() * 0.8);
          this.particles.push(p);
        }

        st.prevX = x; st.prevY = y; st.prevTime = now;
      }
    }
    tctx.globalCompositeOperation = 'source-over';

    // ── Update + draw sparks through curl-flow field ──
    this._updateAndDrawSparks(tctx, now, this.params.trailFlowStrength);

    // Cap particle count to prevent runaway memory + draw cost.
    if (this.particles.length > 4000) this.particles.splice(0, this.particles.length - 4000);

    // Blit trail buffer onto main canvas.
    this.ctx.drawImage(this.trailBuf, 0, 0);
  }

  /** Cheap pseudo-curl flow field. Not true Perlin curl noise (no
   *  gradient sampling); the sine/cosine mix is enough to produce
   *  swirling, organic-looking drift without sharp directions. */
  private _curl(x: number, y: number, t: number): [number, number] {
    const nx = Math.sin(x * 0.008 + t * 0.0011) + Math.cos(y * 0.011 + t * 0.0007);
    const ny = Math.cos(x * 0.013 - t * 0.0009) - Math.sin(y * 0.009 + t * 0.0013);
    return [nx, ny];
  }

  private _updateAndDrawSparks(tctx: CanvasRenderingContext2D, now: number, flowStrength: number): void {
    tctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      // Curl flow drift — small per-frame nudge, accumulates into
      // organic meandering paths.
      const [cx, cy] = this._curl(p.x, p.y, now);
      p.vx += cx * 0.06 * flowStrength;
      p.vy += cy * 0.06 * flowStrength;
      // Drag — keeps the field from runaway.
      p.vx *= 0.985;
      p.vy *= 0.985;
      // Slight upward bias so sparks rise like embers.
      p.vy -= 0.04 * flowStrength;

      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }

      const a = p.life;
      tctx.fillStyle = this._rgbaFromHue(p.hue, a);
      tctx.beginPath();
      tctx.arc(p.x, p.y, p.size * (0.5 + a * 0.5), 0, Math.PI * 2);
      tctx.fill();
    }
    tctx.globalCompositeOperation = 'source-over';
  }

  // ── INK MODE (was AURORA) ──────────────────────────────────────────
  // Soft alpha blobs spawn at palm + fingertip positions and drift
  // outward (radial from palm center) with additive blend. Reads as
  // coloured smoke flowing off the hands — distinct from skeleton.
  private _drawInk(hands: SignalFrame['hands'], now: number, _dt: number): void {
    const ctx = this.ctx;
    const w = this.width, h = this.height;

    // Spawn ink blobs each frame at the fingertips + palm center.
    for (const hand of hands) {
      const lm = hand.landmarks;
      const palm = this._palmCenter(lm);
      const sources: { x: number; y: number; ftIdx: number }[] = [];
      if (palm) sources.push({ x: palm.x * w, y: palm.y * h, ftIdx: -1 });
      for (let i = 0; i < FINGERTIPS.length; i++) {
        const t = lm[FINGERTIPS[i]];
        sources.push({ x: t.x * w, y: t.y * h, ftIdx: i });
      }

      for (const src of sources) {
        const p = new FxParticle();
        p.x = src.x + (Math.random() - 0.5) * 8;
        p.y = src.y + (Math.random() - 0.5) * 8;
        const ang = Math.random() * Math.PI * 2;
        const spd = (0.5 + Math.random() * 1.5) * this.params.inkDrift;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd - 0.4 * this.params.inkDrift;  // float upward
        p.life = 1.0;
        p.decay = 0.006 + Math.random() * 0.008;
        const ftIdx = src.ftIdx >= 0 ? src.ftIdx : Math.floor(Math.random() * 5);
        p.hue = this._colorHue(this.params.inkColorMode, ftIdx, now);
        p.size = this.params.inkSize * (0.6 + Math.random() * 0.8);
        this.particles.push(p);
      }
    }

    // Update + draw blobs additively. Use radial gradient for soft
    // edges — that's what gives the ink/smoke look vs. hard circles.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      // Drift with mild curl + upward float.
      const [cx, cy] = this._curl(p.x, p.y, now);
      p.vx += cx * 0.04;
      p.vy += cy * 0.04;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.vy -= 0.05 * this.params.inkDrift;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }

      const r = p.size * (0.5 + (1 - p.life) * 0.8);  // grow as it ages
      const [rr, gg, bb] = hsvToRgb(p.hue, 0.7, 1.0);
      const cell = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      const centerAlpha = this.params.inkOpacity * p.life;
      cell.addColorStop(0, `rgba(${rr | 0}, ${gg | 0}, ${bb | 0}, ${centerAlpha})`);
      cell.addColorStop(1, `rgba(${rr | 0}, ${gg | 0}, ${bb | 0}, 0)`);
      ctx.fillStyle = cell;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  // ── SKELETON MODE ─────────────────────────────────────────────────
  private _drawSkeleton(hands: SignalFrame['hands']): void {
    const ctx = this.ctx;
    const w = this.width, h = this.height;

    for (const hand of hands) {
      const lm = hand.landmarks;
      const glowLayers = Math.max(1, Math.round(this.params.skeletonGlow * 2));

      ctx.globalCompositeOperation = 'lighter';
      for (let L = 0; L < glowLayers; L++) {
        const widthMul = 1 + (glowLayers - L - 1) * 1.5;
        const alpha = 0.30 / (glowLayers - L);
        ctx.strokeStyle = hexWithAlpha(this.params.skeletonColor, alpha);
        ctx.lineWidth = 2 * widthMul;
        ctx.beginPath();
        for (const [a, b] of HAND_CONNECTIONS) {
          ctx.moveTo(lm[a].x * w, lm[a].y * h);
          ctx.lineTo(lm[b].x * w, lm[b].y * h);
        }
        ctx.stroke();
      }
      // Landmark dots + soft halo on fingertips so the user can read
      // which tip is which while painting.
      for (let i = 0; i < lm.length; i++) {
        const x = lm[i].x * w, y = lm[i].y * h;
        const isFt = FINGERTIPS.includes(i);
        const isWrist = i === 0;
        const r = isWrist ? 6 : (isFt ? 4 : 2.5);
        if (isFt) {
          const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
          halo.addColorStop(0, hexWithAlpha(this.params.skeletonColor, 0.5));
          halo.addColorStop(1, hexWithAlpha(this.params.skeletonColor, 0));
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, y, r * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = this.params.skeletonColor;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ── PINCH SPRAY MODE (was BURSTS) ──────────────────────────────────
  // While the user's thumb + index tip are within sprayThreshold (uv,
  // normalised to hand size), continuously emit particles at the pinch
  // point. Tighter pinch = stronger spray. No gesture detection lag.
  private _drawPinchSpray(hands: SignalFrame['hands'], now: number, _dt: number): void {
    const ctx = this.ctx;
    const w = this.width, h = this.height;

    for (const hand of hands) {
      const lm = hand.landmarks;
      // Pinch distance in uv, hand-size normalised so it's depth-invariant.
      const thumb = lm[4];
      const index = lm[8];
      const wristToMcp = Math.hypot(lm[0].x - lm[9].x, lm[0].y - lm[9].y);
      const handSize = Math.max(0.04, wristToMcp);
      const pinchRaw = Math.hypot(thumb.x - index.x, thumb.y - index.y);
      const pinchNorm = pinchRaw / (handSize * 1.2);  // ~1 at fully open

      if (pinchNorm > this.params.sprayThreshold) continue;

      // Strength curve: 0 at threshold → 1 at perfect pinch.
      const strength = 1 - (pinchNorm / this.params.sprayThreshold);
      const count = Math.max(1, Math.round(strength * this.params.sprayIntensity * 6));

      // Pinch point = midpoint of thumb and index tip.
      const cx = ((thumb.x + index.x) * 0.5) * w;
      const cy = ((thumb.y + index.y) * 0.5) * h;
      // Spray direction: away from palm center.
      const palm = this._palmCenter(lm);
      let dirX = 0, dirY = -1;
      if (palm) {
        const px = palm.x * w, py = palm.y * h;
        const ddx = cx - px, ddy = cy - py;
        const dlen = Math.hypot(ddx, ddy);
        if (dlen > 1) { dirX = ddx / dlen; dirY = ddy / dlen; }
      }

      for (let i = 0; i < count; i++) {
        const p = new FxParticle();
        const spread = (Math.random() - 0.5) * 0.8;  // ±0.4 rad cone
        const baseAng = Math.atan2(dirY, dirX) + spread;
        const spd = (3 + Math.random() * 6) * (0.5 + strength * 0.5);
        p.x = cx; p.y = cy;
        p.vx = Math.cos(baseAng) * spd;
        p.vy = Math.sin(baseAng) * spd;
        p.life = 1.0;
        p.decay = 0.012 + Math.random() * 0.012;
        p.hue = this._colorHue(this.params.sprayColorMode, i % 5, now);
        p.size = 2.5 + Math.random() * 2.5;
        this.particles.push(p);
      }
    }

    // Update + draw particles additively.
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.05;  // mild gravity for spray
      p.vx *= 0.995;
      p.vy *= 0.995;
      p.life -= p.decay;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      const a = p.life;
      ctx.fillStyle = this._rgbaFromHue(p.hue, a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (this.particles.length > 3000) this.particles.splice(0, this.particles.length - 3000);
  }

  // ── Helpers ───────────────────────────────────────────────────────

  /** Pick a hue 0..1 based on color mode + finger index. Returns -1
   *  as a sentinel for 'white' (caller must handle). */
  private _colorHue(mode: HandFXColorMode, ftIdx: number, now: number): number {
    switch (mode) {
      case 'rainbow':
        // Per-finger hue, gently animated over time so the palette
        // breathes without losing per-finger identity.
        return (FINGER_HUES[ftIdx % 5] + now * 0.00003) % 1;
      case 'coral':
        return (0.95 + (ftIdx * 0.015)) % 1;
      case 'cyan':
        return (0.50 + (ftIdx * 0.015)) % 1;
      case 'white':
      default:
        return -1;
    }
  }

  /** Convert (hue or -1 sentinel) + alpha → rgba() string. */
  private _rgbaFromHue(hue: number, alpha: number): string {
    if (hue < 0) return `rgba(255, 255, 255, ${alpha})`;
    const [r, g, b] = hsvToRgb(hue, 0.85, 1.0);
    return `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${alpha})`;
  }

  private _roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

}

// ─── helpers (file-scoped) ────────────────────────────────────────────

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0, g = 0, b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [r * 255, g * 255, b * 255];
}

function hexWithAlpha(hex: string, alpha: number): string {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return `rgba(255, 255, 255, ${alpha})`;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
