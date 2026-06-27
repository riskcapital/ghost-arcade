// Atmosphere rig + show director — the "full rock show" layer.
//
// Not lights flying around: a lighting-designer brain that runs
// designed LOOKS and advances them musically.
//
//   • Palette comes from the SCREENS. The renderer feeds the live
//     average color of the LED content; the director builds a stage
//     palette from it (saturated primary + complement + accent), so
//     when the user fires a new clip the whole rig re-colors with it.
//   • Looks are designed patterns — unison sweeps, mirrored
//     alternates, center-out fans, chases, kick-gated punches, quiet
//     searchlights — with fixture colors assigned by position, not
//     random per-head rainbow.
//   • The director advances looks on musical phrases (every 16
//     detected beats), picks looks that match the current energy,
//     and jumps immediately when the screen content changes — like
//     an LD calling cues off the video feed.
//   • Color changes ease over ~⅓s (real fixtures cross-fade; they
//     don't snap), beam intensity rides the smoothed energy bus,
//     kicks punch, silence falls back to a slow searchlight idle.
//
// Elements (independently toggleable, persisted per scene):
//   beams — volumetric cones on every venue mover, real yoke/head drive
//   lasers — blade fans on the rig, look-aware behavior
//   haze  — fog eases toward show density, fattens all glow
//   strips — venue truss pixel-strips (segmented: fill/chase/flash)
//
// Plus: user-placed `ledstrip` library elements (any position, with
// their own mode/glow/speed params) animate through the same director
// whenever the rig is ticking — palette-synced when their Sync param
// is on.

import * as THREE from 'three';
import type { VenueBuild } from './venues';
import type { Stage3DAtmosphere } from './types';
import { DEFAULT_ATMOSPHERE } from './types';
import type { VisualAudioState } from '../audio/visualAudio';

const BEAM_LENGTH = 24;
const MAX_BEAM_UNITS = 32;
const HAZE_FOG_MULT = 2.6;
const PHRASE_BEATS = 16;
const STRIP_SEGS = 24;

// ── Looks — the designed cue list ─────────────────────────────────────

type LookName = 'searchlight' | 'unison' | 'alternate' | 'fan' | 'chase' | 'punch';

interface LookDef {
  name: LookName;
  /** Energy band (smoothed 0..1) this look suits. The director only
   *  calls cues that fit the music's current intensity. */
  energy: [number, number];
  /** Venue strip behavior while this look runs. */
  strip: 'fill' | 'chase' | 'pulse' | 'kickflash';
  /** Laser behavior. */
  laser: 'off' | 'sweep' | 'strobe';
}

const LOOKS: LookDef[] = [
  { name: 'searchlight', energy: [0, 0.3],    strip: 'pulse',     laser: 'off' },
  { name: 'unison',      energy: [0.1, 0.6],  strip: 'fill',      laser: 'sweep' },
  { name: 'alternate',   energy: [0.25, 0.8], strip: 'fill',      laser: 'sweep' },
  { name: 'fan',         energy: [0.25, 0.85], strip: 'fill',     laser: 'sweep' },
  { name: 'chase',       energy: [0.4, 1],    strip: 'chase',     laser: 'sweep' },
  { name: 'punch',       energy: [0.55, 1],   strip: 'kickflash', laser: 'strobe' },
];

// ── Volumetric beam material ──────────────────────────────────────────

function makeBeamMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: color.clone() },
      uIntensity: { value: 0.5 },
      uLength: { value: BEAM_LENGTH },
    },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      uniform float uLength;
      void main() {
        vAlong = -position.y / uLength;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      uniform vec3 uColor;
      uniform float uIntensity;
      void main() {
        float fade = pow(1.0 - vAlong, 2.0);
        float soft = pow(abs(dot(vNormal, vViewDir)), 1.4);
        gl_FragColor = vec4(uColor, fade * soft * uIntensity);
      }
    `,
  });
}

// ── Pixel-strip mesh (one draw call, per-segment vertex colors) ───────

export interface PixelStrip {
  mesh: THREE.Mesh;
  colors: THREE.BufferAttribute;
  segs: number;
  phase: number;
}

/** Build a single-mesh LED pixel strip along local X: `segs` quads with
 *  per-vertex colors the animator rewrites each frame. MeshBasic so the
 *  pixels read as emitters regardless of room light; values above 1
 *  push into bloom where the venue has it. */
export function buildPixelStrip(len: number, segs: number, thickness = 0.09): PixelStrip {
  const positions: number[] = [];
  const indices: number[] = [];
  const segW = (len / segs) * 0.82;       // gap between pixels
  const pitch = len / segs;
  for (let i = 0; i < segs; i++) {
    const cx = -len / 2 + (i + 0.5) * pitch;
    const base = i * 4;
    positions.push(
      cx - segW / 2, -thickness / 2, 0,
      cx + segW / 2, -thickness / 2, 0,
      cx + segW / 2, thickness / 2, 0,
      cx - segW / 2, thickness / 2, 0,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const colors = new THREE.Float32BufferAttribute(new Float32Array(segs * 4 * 3), 3);
  geo.setAttribute('color', colors);
  geo.setIndex(indices);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.raycast = () => {};
  return { mesh, colors: colors as THREE.BufferAttribute, segs, phase: 0 };
}

/** Write one segment's color (all 4 verts). */
function setSeg(strip: PixelStrip, i: number, c: THREE.Color, scale: number) {
  const a = strip.colors;
  const r = c.r * scale, g = c.g * scale, b = c.b * scale;
  for (let v = 0; v < 4; v++) a.setXYZ(i * 4 + v, r, g, b);
}

// ── Unit records ──────────────────────────────────────────────────────

interface BeamUnit {
  yoke: THREE.Object3D;
  head: THREE.Object3D;
  restPan: number;
  restTilt: number;
  cone: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  /** Eased color — lerped toward the look's assignment per frame. */
  colorTarget: THREE.Color;
  /** Stable rig position index (sorted by world X) so patterns read
   *  spatially: fan from center, chase left→right, alternate odd/even. */
  rigIndex: number;
  phase: number;
}

interface LaserUnit {
  group: THREE.Group;
  blades: THREE.Mesh[];
  mat: THREE.MeshBasicMaterial;
  colorTarget: THREE.Color;
  phase: number;
}

/** A user-placed `ledstrip` element discovered in the scene. */
export interface UserStripAnim {
  strip: PixelStrip;
  mode: number;      // 0 fill · 1 chase · 2 pulse · 3 solid
  glow: number;
  speed: number;
  sync: boolean;
  timing?: string;
  base: THREE.Color;
}

export class AtmosphereRig {
  private flags: Stage3DAtmosphere = { ...DEFAULT_ATMOSPHERE };
  private fixtureRoots: THREE.Object3D[] = [];
  private fixtureRootSig = '';
  private beams: BeamUnit[] = [];
  private lasers: LaserUnit[] = [];
  private strips: PixelStrip[] = [];
  private userStrips: UserStripAnim[] = [];

  // ── Director state ──
  private look: LookDef = LOOKS[1];
  private beatLatch = false;
  private beatCount = 0;
  private energyEma = 0.2;
  private elapsed = 0;
  private fogCurrent: number;
  /** Stage palette: [primary, secondary, accent, wash]. */
  private palette = [
    new THREE.Color(0x4af2ff),
    new THREE.Color(0xff3df0),
    new THREE.Color(0x8a5cff),
    new THREE.Color(0x32404f),
  ];
  private contentColor = new THREE.Color(0x4af2ff);
  private paletteDirty = false;

  constructor(
    private scene: THREE.Scene,
    private venue: VenueBuild,
  ) {
    this.fogCurrent = venue.fogDensity;
  }

  // ── Director inputs ─────────────────────────────────────────────────

  /** Feed the live average color of the screen content (from the
   *  renderer's per-LED readback). The director rebuilds the stage
   *  palette when it drifts meaningfully. */
  setContentColor(c: THREE.Color): void {
    if (c.r + c.g + c.b < 0.02) return; // black frame — keep current palette
    const hslA = { h: 0, s: 0, l: 0 };
    const hslB = { h: 0, s: 0, l: 0 };
    this.contentColor.getHSL(hslA);
    c.getHSL(hslB);
    const dh = Math.min(Math.abs(hslA.h - hslB.h), 1 - Math.abs(hslA.h - hslB.h));
    this.contentColor.copy(c);
    if (dh > 0.08 || this.paletteDirty) this.rebuildPalette();
  }

  /** Screen content changed (new clip / shader fired) — call a new cue
   *  immediately, like an LD reacting to the video feed. */
  notifyContentChange(): void {
    this.paletteDirty = true;
    this.advancePhrase();
  }

  private rebuildPalette(): void {
    this.paletteDirty = false;
    const hsl = { h: 0, s: 0, l: 0 };
    this.contentColor.getHSL(hsl);
    // Stage-ify the content color: keep its hue, force show-grade
    // saturation and a lifted lightness so beams stay vivid even when
    // the source frame is murky.
    const h = hsl.h;
    const s = Math.max(0.75, hsl.s);
    this.palette[0].setHSL(h, s, 0.55);                       // primary
    this.palette[1].setHSL((h + 0.5) % 1, s, 0.55);           // complement
    this.palette[2].setHSL((h + 0.09) % 1, s, 0.66);          // accent
    this.palette[3].setHSL(h, 0.25, 0.45);                    // wash
  }

  private advancePhrase(): void {
    const fits = LOOKS.filter(l =>
      l.name !== this.look.name &&
      this.energyEma >= l.energy[0] && this.energyEma <= l.energy[1],
    );
    const pool = fits.length ? fits : LOOKS.filter(l => l.name !== this.look.name);
    // Deterministic-ish rotation: pick by beat count so the cue list
    // feels intentional rather than dice-rolled.
    this.look = pool[this.beatCount % pool.length];
  }

  /** Color slot for a beam under the current look, by rig position. */
  private beamColor(rigIndex: number, n: number): THREE.Color {
    const [primary, secondary, accent, wash] = this.paletteFor('beam');
    const lookName = this.flags.beamPattern === 'auto' ? this.look.name : this.flags.beamPattern;
    switch (lookName) {
      case 'searchlight': return wash;
      case 'unison': return primary;
      case 'alternate': return rigIndex % 2 === 0 ? primary : secondary;
      case 'fan': {
        const center = (n - 1) / 2;
        if (Math.abs(rigIndex - center) < 0.6) return accent;
        return rigIndex < center ? primary : secondary;
      }
      case 'chase': return [primary, accent, secondary][rigIndex % 3];
      case 'punch': return accent;
    }
  }

  setFlags(flags: Stage3DAtmosphere): void {
    const next = { ...DEFAULT_ATMOSPHERE, ...flags };
    if (next.beams !== this.flags.beams) next.beams ? this.buildBeams() : this.teardownBeams();
    if (next.lasers !== this.flags.lasers) next.lasers ? this.buildLasers() : this.teardownLasers();
    if (next.strips !== this.flags.strips) next.strips ? this.buildStrips() : this.teardownStrips();
    this.flags = next;
  }

  /** Replace the set of user-placed ledstrip elements (renderer calls
   *  this whenever the element set / params change). */
  setUserStrips(strips: UserStripAnim[]): void {
    this.userStrips = strips;
  }

  /** Replace the user-placed fixture roots that participate in beams.
   *  If Beams is already live, rebuild immediately so newly-added
   *  movers light up without toggling the FX off/on. */
  setFixtureRoots(roots: THREE.Object3D[]): void {
    const sig = roots.map(r => r.uuid).join('|');
    if (sig === this.fixtureRootSig) return;
    this.fixtureRootSig = sig;
    this.fixtureRoots = roots;
    if (this.flags.beams) {
      this.teardownBeams();
      this.buildBeams();
    }
  }

  private paletteFor(kind: 'beam' | 'laser'): THREE.Color[] {
    const palette = kind === 'beam' ? this.flags.beamPalette : this.flags.laserPalette;
    const custom = new THREE.Color(kind === 'beam' ? this.flags.beamColor : this.flags.laserColor);
    const wash = custom.clone().lerp(new THREE.Color(0xffffff), 0.35).multiplyScalar(0.45);
    switch (palette) {
      case 'screen':
        return this.palette;
      case 'custom': {
        const hsl = { h: 0, s: 0, l: 0 };
        custom.getHSL(hsl);
        return [
          custom.clone(),
          new THREE.Color().setHSL((hsl.h + 0.5) % 1, Math.max(0.75, hsl.s), 0.56),
          new THREE.Color().setHSL((hsl.h + 0.1) % 1, Math.max(0.75, hsl.s), 0.64),
          wash,
        ];
      }
      case 'cyan-magenta':
        return [
          new THREE.Color('#4af2ff'),
          new THREE.Color('#ff3df0'),
          new THREE.Color('#8a5cff'),
          new THREE.Color('#32404f'),
        ];
      case 'amber-blue':
        return [
          new THREE.Color('#ffb648'),
          new THREE.Color('#3478ff'),
          new THREE.Color('#fff0b8'),
          new THREE.Color('#403b2f'),
        ];
      case 'rainbow':
        return [
          new THREE.Color('#ff3864'),
          new THREE.Color('#28f0ff'),
          new THREE.Color('#b4ff37'),
          new THREE.Color('#4f375f'),
        ];
      case 'white':
        return [
          new THREE.Color('#ffffff'),
          new THREE.Color('#d8f7ff'),
          new THREE.Color('#fff0cf'),
          new THREE.Color('#4c535c'),
        ];
    }
    return this.palette;
  }

  // ── Builders / teardown ─────────────────────────────────────────────

  private buildBeams(): void {
    const coneGeo = new THREE.CylinderGeometry(0.09, 2.1, BEAM_LENGTH, 10, 1, true)
      .translate(0, -BEAM_LENGTH / 2, 0);
    const found: { obj: THREE.Object3D; x: number }[] = [];
    const scanRoot = (root: THREE.Object3D) => {
      root.traverse(obj => {
        if (obj.userData.moverYoke && obj.userData.moverHead) {
          found.push({ obj, x: obj.getWorldPosition(new THREE.Vector3()).x });
        }
      });
    };
    scanRoot(this.venue.group);
    for (const root of this.fixtureRoots) scanRoot(root);
    // Sort by world X so rigIndex maps to physical left→right order —
    // fans open from center, chases run across the rig.
    found.sort((a, b) => a.x - b.x);
    const picked: { obj: THREE.Object3D; x: number }[] = found.length <= MAX_BEAM_UNITS
      ? found
      : Array.from({ length: MAX_BEAM_UNITS }, (_, i) =>
          found[Math.min(found.length - 1, Math.round(i * (found.length - 1) / Math.max(1, MAX_BEAM_UNITS - 1)))]!,
        );
    if (picked.length === 0) {
      coneGeo.dispose();
      return;
    }
    picked.forEach(({ obj }, i) => {
      const yoke = obj.userData.moverYoke as THREE.Object3D;
      const head = obj.userData.moverHead as THREE.Object3D;
      const rest = obj.userData.moverRest as { pan: number; tilt: number };
      const color = this.palette[0].clone();
      const mat = makeBeamMaterial(color);
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.castShadow = false;
      cone.receiveShadow = false;
      cone.raycast = () => {};
      head.add(cone);
      this.beams.push({
        yoke, head, cone, mat,
        restPan: rest?.pan ?? 0,
        restTilt: rest?.tilt ?? 0.5,
        colorTarget: color.clone(),
        rigIndex: i,
        phase: i * 0.55,
      });
    });
  }

  private teardownBeams(): void {
    for (const b of this.beams) {
      b.head.remove(b.cone);
      b.mat.dispose();
      b.yoke.rotation.y = b.restPan;
      b.head.rotation.x = b.restTilt;
    }
    this.beams[0]?.cone.geometry.dispose();
    this.beams = [];
  }

  private buildLasers(): void {
    const mounts: THREE.Vector3[] = [];
    let bestTruss: THREE.Object3D | null = null;
    let bestY = -Infinity;
    this.venue.group.traverse(obj => {
      const len = obj.userData.trussLen as number | undefined;
      if (!len || obj.userData.trussVertical) return;
      const wp = obj.getWorldPosition(new THREE.Vector3());
      if (wp.y > bestY) { bestY = wp.y; bestTruss = obj; }
    });
    if (bestTruss) {
      const t = bestTruss as THREE.Object3D;
      const len = t.userData.trussLen as number;
      const wp = t.getWorldPosition(new THREE.Vector3());
      const alongX = Math.abs(Math.sin(t.rotation.y)) < 0.5;
      for (const s of [-1, 1]) {
        mounts.push(alongX
          ? new THREE.Vector3(wp.x + s * len * 0.38, wp.y - 0.6, wp.z)
          : new THREE.Vector3(wp.x, wp.y - 0.6, wp.z + s * len * 0.38));
      }
    } else {
      const fz = this.venue.frontZ;
      const w = this.venue.stageW;
      mounts.push(new THREE.Vector3(-w * 0.42, 2.4, fz - 1));
      mounts.push(new THREE.Vector3(w * 0.42, 2.4, fz - 1));
    }

    const BLADES = 9;
    const LEN = 38;
    const bladeGeo = new THREE.BoxGeometry(0.035, 0.035, LEN).translate(0, 0, LEN / 2);
    mounts.forEach((pos, mi) => {
      const color = this.palette[1].clone();
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const group = new THREE.Group();
      group.position.copy(pos);
      group.rotation.x = -0.1;
      const blades: THREE.Mesh[] = [];
      for (let b = 0; b < BLADES; b++) {
        const blade = new THREE.Mesh(bladeGeo, mat);
        blade.castShadow = false;
        blade.raycast = () => {};
        group.add(blade);
        blades.push(blade);
      }
      this.scene.add(group);
      this.lasers.push({ group, blades, mat, colorTarget: color.clone(), phase: mi * 2.4 });
    });
  }

  private teardownLasers(): void {
    for (const l of this.lasers) {
      this.scene.remove(l.group);
      l.mat.dispose();
    }
    this.lasers[0]?.blades[0]?.geometry.dispose();
    this.lasers = [];
  }

  private buildStrips(): void {
    let i = 0;
    this.venue.group.traverse(obj => {
      const len = obj.userData.trussLen as number | undefined;
      if (!len || obj.userData.trussVertical) return;
      const strip = buildPixelStrip(len * 0.96, STRIP_SEGS);
      strip.phase = i * 0.7;
      strip.mesh.position.set(0, -0.36, 0.31);
      obj.add(strip.mesh);
      this.strips.push(strip);
      i++;
    });
  }

  private teardownStrips(): void {
    for (const s of this.strips) {
      s.mesh.parent?.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
    }
    this.strips = [];
  }

  // ── Strip pattern writer (shared by venue + user strips) ────────────

  private writeStrip(
    strip: PixelStrip,
    mode: 'fill' | 'chase' | 'pulse' | 'kickflash' | 'solid',
    color: THREE.Color,
    altColor: THREE.Color,
    audio: { beat: number; bass: number; kick: number },
    t: number,
    speed: number,
    glow: number,
  ): void {
    const n = strip.segs;
    const dim = 0.045;
    switch (mode) {
      case 'fill': {
        // Beat envelope fills from the CENTER outward — the classic
        // "meter" look, symmetric so it reads from anywhere.
        const fill = Math.max(0.06, audio.beat) * (n / 2);
        const center = (n - 1) / 2;
        for (let i = 0; i < n; i++) {
          const d = Math.abs(i - center);
          const lit = THREE.MathUtils.clamp(fill - d + 0.5, 0, 1);
          setSeg(strip, i, color, dim + lit * glow * (0.9 + audio.bass * 0.8));
        }
        break;
      }
      case 'chase': {
        const head = ((t * speed * 6 + strip.phase * n) % n + n) % n;
        for (let i = 0; i < n; i++) {
          let d = Math.abs(i - head);
          d = Math.min(d, n - d);
          const lit = Math.max(0, 1 - d / 2.4);
          setSeg(strip, i, d < 1.2 ? color : altColor, dim + lit * lit * glow * 1.4);
        }
        break;
      }
      case 'pulse': {
        const v = dim + (0.18 + audio.bass * 1.4) * glow;
        for (let i = 0; i < n; i++) setSeg(strip, i, color, v);
        break;
      }
      case 'kickflash': {
        const v = dim + audio.kick * 2.4 * glow;
        for (let i = 0; i < n; i++) setSeg(strip, i, i % 2 === 0 ? color : altColor, v);
        break;
      }
      case 'solid': {
        for (let i = 0; i < n; i++) setSeg(strip, i, color, glow);
        break;
      }
    }
    strip.colors.needsUpdate = true;
  }

  // ── Per-frame drive ─────────────────────────────────────────────────

  update(dt: number, audio: VisualAudioState, absoluteTimeSeconds?: number): void {
    if (typeof absoluteTimeSeconds === 'number' && Number.isFinite(absoluteTimeSeconds)) {
      this.elapsed = Math.max(0, absoluteTimeSeconds);
    } else {
      this.elapsed += dt;
    }
    const t = this.elapsed;

    const active = audio.isActive;
    const energy = active ? audio.energy : 0.1;
    const level = active ? audio.level : 0.08;
    const kick = active ? audio.kick : 0;
    const treble = active ? audio.treble : 0.08;
    const beatEnv = active ? audio.beat : (Math.sin(t * 0.5) * 0.5 + 0.5) * 0.25;
    const bass = active ? audio.bass : 0.12;
    const beamBrightness = Math.max(0, this.flags.beamBrightness ?? 1);
    const laserBrightness = Math.max(0, this.flags.laserBrightness ?? 1);
    const stripBrightness = Math.max(0, this.flags.stripBrightness ?? 1);
    const hazeAmount = Math.max(0.1, this.flags.hazeDensity ?? 1);
    const hazeGlow = this.flags.haze ? 1 + 0.3 * hazeAmount : 1;

    // Energy EMA for look selection (~2s window).
    this.energyEma += (energy - this.energyEma) * (1 - Math.exp(-dt / 2));

    // Beat counting → phrase advancement (16 beats ≈ 4 bars in 4/4).
    const beatHot = active && audio.beat > 0.85;
    if (beatHot && !this.beatLatch) {
      this.beatLatch = true;
      this.beatCount++;
      if (this.beatCount % PHRASE_BEATS === 0) this.advancePhrase();
    } else if (!beatHot) {
      this.beatLatch = false;
    }
    // Silence → settle into the searchlight idle.
    if (!active && this.look.name !== 'searchlight') this.look = LOOKS[0];

    const colorEase = 1 - Math.exp(-dt / 0.35);
    const sweep = 0.4 + energy * 1.5;
    const look = this.flags.beamPattern === 'auto' ? this.look.name : this.flags.beamPattern;
    const n = Math.max(1, this.beams.length);

    // ── Beams ──
    for (const b of this.beams) {
      const i = b.rigIndex;
      let pan = b.restPan;
      let tilt = b.restTilt;
      let inten = 0.18 + level * 0.45 + kick * 0.5;
      switch (look) {
        case 'searchlight':
          pan += Math.sin(t * 0.28 + b.phase) * 0.9;
          tilt += Math.sin(t * 0.2 + b.phase * 1.7) * 0.3;
          inten *= 0.55;
          break;
        case 'unison':
          pan += Math.sin(t * sweep) * 0.55;
          tilt += Math.sin(t * sweep * 0.5) * 0.3;
          break;
        case 'alternate': {
          const sign = i % 2 === 0 ? 1 : -1;
          pan += sign * Math.sin(t * sweep) * 0.6;
          tilt += sign * Math.cos(t * sweep * 0.63) * 0.32;
          break;
        }
        case 'fan': {
          const off = (i - (n - 1) / 2) / Math.max(1, n / 2);
          pan += off * (0.3 + 0.4 * (Math.sin(t * sweep * 0.55) * 0.5 + 0.5));
          tilt += Math.sin(t * sweep * 0.4) * 0.22;
          break;
        }
        case 'chase': {
          pan += Math.sin(t * 0.5 + b.phase) * 0.35;
          tilt += Math.cos(t * 0.4 + b.phase) * 0.2;
          const pulse = Math.max(0, Math.sin(t * sweep * 2.2 - i * 0.9));
          inten *= 0.22 + pulse * pulse * 1.1;
          break;
        }
        case 'punch':
          tilt = b.restTilt + 0.45;
          pan += Math.sin(t * 0.3 + b.phase) * 0.12;
          inten = 0.1 + kick * 1.5;
          break;
      }
      b.yoke.rotation.y = pan;
      b.head.rotation.x = tilt;
      const beamLevel = Math.min(1.25, inten * hazeGlow * beamBrightness);
      b.mat.uniforms.uIntensity.value = Math.min(0.95, beamLevel);
      b.colorTarget.copy(this.beamColor(i, n));
      (b.mat.uniforms.uColor.value as THREE.Color).lerp(b.colorTarget, colorEase);
    }

    // ── Lasers ──
    const laserPalette = this.paletteFor('laser');
    const forcedLaser = this.flags.laserPattern;
    for (const l of this.lasers) {
      const mode = forcedLaser === 'auto'
        ? this.look.laser
        : forcedLaser === 'fan'
          ? 'sweep'
          : forcedLaser;
      const fanBase = forcedLaser === 'fan' ? 0.42 : 0.12;
      const fanRange = forcedLaser === 'fan' ? 0.72 : 0.55;
      const fan = fanBase + (active ? audio.lfoBeat : (Math.sin(t * 0.5) * 0.5 + 0.5)) * fanRange;
      const bn = l.blades.length;
      for (let b = 0; b < bn; b++) {
        l.blades[b].rotation.y = (b - (bn - 1) / 2) * (fan / (bn - 1)) * 2;
      }
      l.group.rotation.y = Math.sin(t * sweep * 0.5 + l.phase) * (forcedLaser === 'fan' ? 0.38 : 0.85);
      l.group.rotation.x = -0.1 + Math.sin(t * sweep * 0.31 + l.phase * 2.1) * 0.12;
      let op = 0.28 + treble * 0.45 + kick * 0.2;
      if (mode === 'off') op = 0.05;
      if (mode === 'strobe') op = 0.06 + kick * 0.9;
      l.mat.opacity = Math.min(0.92, op * hazeGlow * laserBrightness);
      l.colorTarget.copy(laserPalette[1]);
      l.mat.color.lerp(l.colorTarget, colorEase);
    }

    // ── Venue strips ──
    const stripAudio = { beat: beatEnv, bass, kick };
    const stripMode = this.flags.stripPattern === 'auto' ? this.look.strip : this.flags.stripPattern;
    this.strips.forEach((s, si) => {
      const color = si % 2 === 0 ? this.palette[0] : this.palette[2];
      const alt = this.palette[1];
      this.writeStrip(s, stripMode, color, alt, stripAudio, t, 1, 1.6 * hazeGlow * stripBrightness);
    });

    // ── User-placed ledstrip elements ──
    const MODES = ['fill', 'chase', 'pulse', 'solid'] as const;
    for (const u of this.userStrips) {
      const color = u.sync ? this.palette[0] : u.base;
      const alt = u.sync ? this.palette[1] : u.base;
      const stripTime = u.timing === 'bpm' && active && audio.bpm > 0
        ? t * (audio.bpm / 60)
        : u.timing === 'audio'
          ? t * (0.35 + bass * 2.2 + beatEnv)
          : t;
      this.writeStrip(u.strip, MODES[u.mode] ?? 'fill', color, alt, stripAudio, stripTime, u.speed, u.glow * hazeGlow * stripBrightness);
    }

    // ── Haze ──
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      const target = this.venue.fogDensity * (this.flags.haze ? HAZE_FOG_MULT * hazeAmount : 1);
      const alpha = 1 - Math.exp(-dt / 1.2);
      this.fogCurrent += (target - this.fogCurrent) * alpha;
      fog.density = this.fogCurrent;
    }
  }

  dispose(): void {
    this.teardownBeams();
    this.teardownLasers();
    this.teardownStrips();
    this.userStrips = [];
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = this.venue.fogDensity;
  }
}
