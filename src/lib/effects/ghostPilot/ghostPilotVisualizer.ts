// Ghost Pilot — playable, audio-built world you fly with a gamepad.
//
// Design laws (why this isn't a screensaver):
//   1. Audio BUILDS the world; you navigate it. The shader's terrain is
//      driven by bass/mid/treble/energy — the player only moves the
//      camera. Manual control and reactivity never fight because they
//      act on different things (music = geography, you = camera).
//   2. Every input is MUSICAL. Sticks get physics (inertia, banking,
//      damping) so even sloppy input reads like cinematography; buttons
//      are BEAT-QUANTIZED verbs that fire on the next beat, so a verb
//      slammed near the drop lands ON the drop.
//   3. Idle is BEAUTIFUL. Let go and autopilot banks the craft along
//      the canyon on its own — the performer sculpts, not life-supports.
//
// Renders a fullscreen raymarch (canyonShader) into the layer's
// WebGLRenderTarget, so it's a drop-in layer source: it inherits VJ
// mixing, effects, every output transport, Stage 3D LED screens, and
// the Sphere dome.

import * as THREE from 'three';
import { CANYON_VERT, CANYON_FRAG } from './canyonShader';
import { getGamepadState, BTN } from '../../input/gamepad';
import type { AudioAnalysis } from '../../audio/analyzer';

export interface GhostPilotParams {
  sensitivity: number;   // audio drive multiplier 0.25..4
  speedScale: number;    // throttle/cruise multiplier 0.5..2.5
  hueBase: number;       // palette base rotation 0..1
  autopilot: boolean;    // allow idle autopilot takeover
  steerAssist: number;   // 0..1 — how hard banking/yaw couple to steer
}

const DEFAULTS: GhostPilotParams = {
  sensitivity: 1.4,
  speedScale: 1.0,
  hueBase: 0.0,
  autopilot: true,
  steerAssist: 1.0,
};

type VerbKind = 'pulse' | 'flip' | 'bloom' | 'dive';
const VERB_BUTTONS: { btn: number; kind: VerbKind; cost: number }[] = [
  { btn: BTN.A, kind: 'pulse', cost: 0.0 },
  { btn: BTN.X, kind: 'bloom', cost: 0.0 },
  { btn: BTN.B, kind: 'flip',  cost: 0.4 },
  { btn: BTN.Y, kind: 'dive',  cost: 0.35 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Frame-rate-independent damping toward a target (k = responsiveness). */
const damp = (cur: number, target: number, k: number, dt: number) =>
  lerp(cur, target, 1 - Math.exp(-k * dt));

export class GhostPilotVisualizer {
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private params: GhostPilotParams = { ...DEFAULTS };

  // ── Camera physics state ──
  private posX = 0;
  private posY = 2.6;
  private posZ = 0;
  private velX = 0;
  private speed = 14;
  private yaw = 0;
  private pitch = 0;
  private roll = 0;

  // ── Smoothed audio ──
  private sBass = 0; private sMid = 0; private sTreble = 0; private sLevel = 0;
  private energy = 0;

  // ── Verb state ──
  private hue = 0;
  private flip = 0;          // current 0..1
  private flipTarget = 0;
  private bloom = 0;         // decays
  private dive = 0;          // decays
  private pulseZ = -1;       // world z of ring (-1 inactive)
  private pulseStr = 0;
  private lastPressCounts: number[] = [];
  private pending: VerbKind | null = null;
  private pendingAtMs = 0;
  private lastBeat = false;

  // ── Autopilot ──
  private idleTime = 0;
  private autoBlend = 0;     // 0 = manual, 1 = full autopilot

  private timeSec = 0;

  constructor(private width: number, private height: number) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: CANYON_VERT,
      fragmentShader: CANYON_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uResolution: { value: new THREE.Vector2(width, height) },
        uTime: { value: 0 },
        uCamPos: { value: new THREE.Vector3() },
        uCamFwd: { value: new THREE.Vector3(0, 0, 1) },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uTanHalfFov: { value: Math.tan((65 * Math.PI / 180) / 2) },
        uBass: { value: 0 }, uMid: { value: 0 }, uTreble: { value: 0 },
        uEnergy: { value: 0 }, uLevel: { value: 0 },
        uHue: { value: 0 }, uFlip: { value: 0 }, uBloom: { value: 0 },
        uPulseZ: { value: -1 }, uPulseStr: { value: 0 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    // Debug hook — last-constructed pilot instance, for telemetry probes
    // and (later) a HUD overlay.
    try { (window as any).__ghostPilot = this; } catch { /* sealed */ }
  }

  init(_renderer: THREE.WebGLRenderer): void { /* nothing GPU-stateful yet */ }

  resize(width: number, height: number): void {
    this.width = width; this.height = height;
    this.material.uniforms.uResolution.value.set(width, height);
  }

  setParams(p: Partial<GhostPilotParams>): void {
    Object.assign(this.params, p);
  }

  /** Inspect state for the HUD / tests. */
  getTelemetry() {
    return {
      posX: this.posX, posZ: this.posZ, speed: this.speed,
      energy: this.energy, autoBlend: this.autoBlend,
      flip: this.flip, bloom: this.bloom, dive: this.dive,
      pulseActive: this.pulseZ > 0,
    };
  }

  // ── Per-frame update ────────────────────────────────────────────────

  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, audio: AudioAnalysis | null, deltaTime: number): void {
    const dt = clamp(deltaTime > 0 ? deltaTime : 0.016, 0.001, 0.05);
    this.timeSec += dt;

    this.updateAudio(audio, dt);
    this.updateInputAndPhysics(audio, dt);
    this.updateVerbs(audio, dt);
    this.writeUniforms();

    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(null);
  }

  private updateAudio(audio: AudioAnalysis | null, dt: number): void {
    const sens = this.params.sensitivity;
    const bass = audio ? (audio.bands.bass + audio.bands.sub) * 0.5 * sens : 0;
    const mid = audio ? audio.bands.mid * sens : 0;
    const treble = audio ? (audio.bands.treble + audio.bands.air) * 0.5 * sens : 0;
    const level = audio ? audio.amplitude * sens : 0;
    // Asymmetric smoothing — fast attack (punch lands), slow release
    // (no flicker). "Anticipate, don't twitch."
    const atk = 1 - Math.exp(-22 * dt);
    const rel = 1 - Math.exp(-4 * dt);
    this.sBass = bass > this.sBass ? lerp(this.sBass, bass, atk) : lerp(this.sBass, bass, rel);
    this.sMid = mid > this.sMid ? lerp(this.sMid, mid, atk) : lerp(this.sMid, mid, rel);
    this.sTreble = treble > this.sTreble ? lerp(this.sTreble, treble, atk) : lerp(this.sTreble, treble, rel);
    this.sLevel = damp(this.sLevel, level, 8, dt);
    // Energy charges from sustained loudness, slow natural bleed.
    this.energy = clamp(this.energy + level * dt * 0.22 - dt * 0.02, 0, 1);
    // Palette drifts with energy + a slow base rotation.
    this.hue = (this.params.hueBase + this.timeSec * 0.01 + this.energy * 0.15) % 1;
  }

  private updateInputAndPhysics(audio: AudioAnalysis | null, dt: number): void {
    const gp = getGamepadState();
    const sa = this.params.steerAssist;

    // Detect manual activity to arm / disarm autopilot.
    const activity = Math.abs(gp.lx) + Math.abs(gp.ly) + Math.abs(gp.rx) + Math.abs(gp.ry) + gp.lt + gp.rt;
    if (activity > 0.08) this.idleTime = 0; else this.idleTime += dt;
    const wantAuto = this.params.autopilot && this.idleTime > 1.5;
    this.autoBlend = damp(this.autoBlend, wantAuto ? 1 : 0, wantAuto ? 0.6 : 3, dt);

    // Autopilot inputs: lazy S-curve down the canyon, easy cruise.
    const autoSteer = Math.sin(this.timeSec * 0.27) * 0.55 + Math.sin(this.timeSec * 0.11) * 0.25;
    const steer = lerp(gp.lx, autoSteer, this.autoBlend);
    const throttle = lerp(gp.rt, 0.25, this.autoBlend);
    const brake = lerp(gp.lt, 0, this.autoBlend);

    // Throttle → forward speed. Drops let you punch it.
    const cruise = 14 * this.params.speedScale;
    const targetSpeed = clamp(cruise + throttle * 42 * this.params.speedScale - brake * 12, 3, 90);
    this.speed = damp(this.speed, targetSpeed * (1 + this.dive * 0.6), 2.2, dt);

    // Lateral steer with inertia + damping → momentum, not teleport.
    // A gentle centering spring always pulls back toward the valley
    // middle so the craft never drifts into a wall and gets buried; the
    // player steers AGAINST it. Keeps idle/autopilot flight in the open.
    this.velX += steer * 52 * dt;
    this.velX += -this.posX * 2.6 * dt;        // centering spring
    this.velX *= Math.exp(-2.6 * dt);
    this.posX = clamp(this.posX + this.velX * dt, -3.4, 3.4);
    // Hard stop at the navigable edge (walls tower just beyond).
    if (Math.abs(this.posX) >= 3.4) this.velX *= -0.25;

    // Banking from lateral velocity + steer — the camera leans into turns.
    const targetRoll = clamp(-(this.velX * 0.045 + steer * 0.35 * sa), -0.7, 0.7);
    this.roll = damp(this.roll, targetRoll, 6, dt);

    // Pitch: a slight downward bias frames the floor + walls rushing by
    // (instead of staring at open sky ahead); left-stick Y + right-stick
    // Y look on top, plus the dive plunge.
    const targetPitch = -0.12 + lerp(gp.ly, 0, this.autoBlend) * 0.32 + gp.ry * 0.4 - this.dive * 0.5;
    this.pitch = damp(this.pitch, targetPitch, 5, dt);

    // Yaw: steer coupling + right-stick X free-look.
    const targetYaw = steer * 0.18 * sa + gp.rx * 0.55;
    this.yaw = damp(this.yaw, targetYaw, 5, dt);

    // Advance through the world.
    this.posZ += this.speed * dt;

    // Altitude: steady cruise height in the valley + bass bob + a little
    // climb when pitching up. Fixed altitude (not terrain-following) so
    // the walls tower around you without JS/GLSL height parity headaches.
    const bob = this.sBass * 0.7;
    const baseAlt = 1.9 + bob + Math.max(0, this.pitch) * 2.0;
    this.posY = damp(this.posY, baseAlt, 4, dt);
  }

  private updateVerbs(audio: AudioAnalysis | null, dt: number): void {
    const gp = getGamepadState();
    if (this.lastPressCounts.length === 0) this.lastPressCounts = [...gp.pressCounts];

    // Queue a verb on a fresh button press (latest press wins).
    for (const v of VERB_BUTTONS) {
      const c = gp.pressCounts[v.btn] ?? 0;
      if (c > (this.lastPressCounts[v.btn] ?? 0)) {
        this.pending = v.kind;
        this.pendingAtMs = this.timeSec * 1000;
      }
      this.lastPressCounts[v.btn] = c;
    }

    // Fire the pending verb ON THE NEXT BEAT (the whole point — it lands
    // musically). Fallback: fire after ~half a beat if no onset arrives
    // so it never feels stuck on quiet passages.
    if (this.pending) {
      const beatNow = !!audio?.beat?.isBeat;
      const beatOnset = beatNow && !this.lastBeat;
      const bpm = audio?.bpm && audio.bpm > 0 ? audio.bpm : 120;
      const halfBeatMs = (60000 / bpm) * 0.5;
      const waited = this.timeSec * 1000 - this.pendingAtMs;
      if (beatOnset || waited > Math.max(halfBeatMs, 320)) {
        this.fireVerb(this.pending);
        this.pending = null;
      }
    }
    this.lastBeat = !!audio?.beat?.isBeat;

    // Decay envelopes.
    this.flip = damp(this.flip, this.flipTarget, 8, dt);
    this.bloom = Math.max(0, this.bloom - dt / 1.4);
    this.dive = Math.max(0, this.dive - dt / 0.8);
    if (this.pulseZ > 0) {
      this.pulseZ += (this.speed + 40) * dt;     // ring races down-canyon
      this.pulseStr = Math.max(0, this.pulseStr - dt / 1.6);
      if (this.pulseStr <= 0) this.pulseZ = -1;
    }
  }

  private fireVerb(kind: VerbKind): void {
    const def = VERB_BUTTONS.find(v => v.kind === kind);
    const cost = def?.cost ?? 0;
    if (cost > 0 && this.energy < cost) {
      // Not enough charge — fizzle to a small bloom so the press still
      // registers visually instead of silently dropping.
      this.bloom = Math.max(this.bloom, 0.25);
      return;
    }
    this.energy = clamp(this.energy - cost, 0, 1);
    switch (kind) {
      case 'pulse':
        this.pulseZ = this.posZ + 4;
        this.pulseStr = 1;
        break;
      case 'flip':
        this.flipTarget = this.flipTarget > 0.5 ? 0 : 1;
        break;
      case 'bloom':
        this.bloom = 1;
        break;
      case 'dive':
        this.dive = 1;
        this.bloom = Math.max(this.bloom, 0.5);
        break;
    }
  }

  private writeUniforms(): void {
    const u = this.material.uniforms;
    // Build the camera basis from yaw/pitch/roll. Forward starts down
    // +Z; yaw rotates around Y, pitch around the local right axis, roll
    // tilts right/up around forward.
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // Forward
    const fwd = new THREE.Vector3(sy * cp, sp, cy * cp).normalize();
    // Right (before roll) = forward × worldUp
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    // Apply roll: rotate right/up around forward.
    const cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    const rolledRight = right.clone().multiplyScalar(cr).addScaledVector(up, sr);
    const rolledUp = up.clone().multiplyScalar(cr).addScaledVector(right, -sr);

    (u.uCamPos.value as THREE.Vector3).set(this.posX, this.posY, this.posZ);
    (u.uCamFwd.value as THREE.Vector3).copy(fwd);
    (u.uCamRight.value as THREE.Vector3).copy(rolledRight);
    (u.uCamUp.value as THREE.Vector3).copy(rolledUp);
    u.uTanHalfFov.value = Math.tan(((65 + this.dive * 22) * Math.PI / 180) / 2);

    u.uTime.value = this.timeSec;
    u.uBass.value = this.sBass;
    u.uMid.value = this.sMid;
    u.uTreble.value = this.sTreble;
    u.uLevel.value = this.sLevel;
    u.uEnergy.value = this.energy;
    u.uHue.value = this.hue;
    u.uFlip.value = this.flip;
    u.uBloom.value = this.bloom;
    u.uPulseZ.value = this.pulseZ;
    u.uPulseStr.value = this.pulseStr;
  }

  dispose(): void {
    try { this.quad.geometry.dispose(); } catch {}
    try { this.material.dispose(); } catch {}
  }
}
