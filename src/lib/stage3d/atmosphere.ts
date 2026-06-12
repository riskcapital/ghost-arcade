// Atmosphere rig — the "full rock show" layer for Ghost Stage.
//
// Four independently-toggleable elements, all driven by the shared
// Milkdrop-smoothed visual-audio bus so they breathe with the music
// instead of strobing with the meter:
//
//   beams  — volumetric light cones parented to every venue mover's
//            head; the rig drives REAL yoke pan + head tilt so the
//            fixtures visibly perform. Intensity rides the energy,
//            kicks punch it, colors rotate on the beat.
//   lasers — fan units mounted on the rig trusses (deck-mounted when
//            a venue has no trusses, e.g. Sphere). Blade fans breathe
//            with the beat-locked LFO, sweep with energy, sparkle on
//            treble.
//   haze   — thickens the venue's exponential fog toward a show-dense
//            target and fattens beam/laser glow. Smoothing on the
//            density change so toggling feels like a hazer spinning
//            up, not a switch.
//   strips — emissive LED pixel-strips clamped under every horizontal
//            truss chord, hue-cycling and bass-chased.
//
// Everything is built additively on top of the venue group and torn
// down via dispose() on venue swap or toggle-off. Idle (no audio)
// keeps a slow, pretty drift — never dead, never frantic.

import * as THREE from 'three';
import type { VenueBuild } from './venues';
import type { Stage3DAtmosphere } from './types';
import { DEFAULT_ATMOSPHERE } from './types';
import type { VisualAudioState } from '../audio/visualAudio';

/** Show palette — saturated stage colors the beams/strips rotate
 *  through. Order matters: adjacent pairs read well together when
 *  half the rig is one step ahead of the other. */
const SHOW_COLORS = [0x4af2ff, 0xff3df0, 0x8a5cff, 0xffb24d, 0x4dff88, 0xff4d6a];

const BEAM_LENGTH = 24;
const HAZE_FOG_MULT = 2.6;

// ── Volumetric beam material ──────────────────────────────────────────

function makeBeamMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 0.5 },
      uLength: { value: BEAM_LENGTH },
    },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      uniform float uLength;
      void main() {
        // 0 at the fixture, 1 at the far end (geometry spans 0..-L in Y).
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
        // Length fade + view-dependent soft edge: alpha peaks looking
        // THROUGH the cone's center (normal toward camera) and falls
        // to zero at the silhouette — reads as light in haze instead
        // of a solid plastic cone.
        float fade = pow(1.0 - vAlong, 2.0);
        float soft = pow(abs(dot(vNormal, vViewDir)), 1.4);
        gl_FragColor = vec4(uColor, fade * soft * uIntensity);
      }
    `,
  });
}

interface BeamUnit {
  yoke: THREE.Object3D;
  head: THREE.Object3D;
  restPan: number;
  restTilt: number;
  cone: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  phase: number;       // per-fixture animation offset
  colorIdx: number;    // index into SHOW_COLORS
}

interface LaserUnit {
  group: THREE.Group;
  blades: THREE.Mesh[];
  mat: THREE.MeshBasicMaterial;
  phase: number;
  colorIdx: number;
}

interface StripUnit {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  phase: number;
}

export class AtmosphereRig {
  private flags: Stage3DAtmosphere = { ...DEFAULT_ATMOSPHERE };
  private beams: BeamUnit[] = [];
  private lasers: LaserUnit[] = [];
  private strips: StripUnit[] = [];
  private beatLatch = false;
  private hue = 0;
  private elapsed = 0;
  /** Smoothed fog density so haze fades in/out like a real hazer. */
  private fogCurrent: number;

  constructor(
    private scene: THREE.Scene,
    private venue: VenueBuild,
  ) {
    this.fogCurrent = venue.fogDensity;
  }

  setFlags(flags: Stage3DAtmosphere): void {
    if (
      flags.beams === this.flags.beams &&
      flags.lasers === this.flags.lasers &&
      flags.haze === this.flags.haze &&
      flags.strips === this.flags.strips
    ) return;
    if (flags.beams !== this.flags.beams) flags.beams ? this.buildBeams() : this.teardownBeams();
    if (flags.lasers !== this.flags.lasers) flags.lasers ? this.buildLasers() : this.teardownLasers();
    if (flags.strips !== this.flags.strips) flags.strips ? this.buildStrips() : this.teardownStrips();
    this.flags = { ...flags };
  }

  // ── Beams ───────────────────────────────────────────────────────────

  private buildBeams(): void {
    const coneGeo = new THREE.CylinderGeometry(0.09, 2.1, BEAM_LENGTH, 18, 1, true)
      .translate(0, -BEAM_LENGTH / 2, 0);
    let i = 0;
    this.venue.group.traverse(obj => {
      const yoke = obj.userData.moverYoke as THREE.Object3D | undefined;
      const head = obj.userData.moverHead as THREE.Object3D | undefined;
      if (!yoke || !head) return;
      const rest = obj.userData.moverRest as { pan: number; tilt: number };
      const colorIdx = i % SHOW_COLORS.length;
      const mat = makeBeamMaterial(SHOW_COLORS[colorIdx]);
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.castShadow = false;
      cone.receiveShadow = false;
      // Don't let the raycaster see beams — clicking through a beam
      // should still pick the scenery behind it.
      cone.raycast = () => {};
      head.add(cone);
      this.beams.push({
        yoke, head, cone, mat,
        restPan: rest?.pan ?? 0,
        restTilt: rest?.tilt ?? 0.5,
        phase: i * 1.318,
        colorIdx,
      });
      i++;
    });
  }

  private teardownBeams(): void {
    for (const b of this.beams) {
      b.head.remove(b.cone);
      b.mat.dispose();
      // Return the fixture to its venue rest pose.
      b.yoke.rotation.y = b.restPan;
      b.head.rotation.x = b.restTilt;
    }
    this.beams[0]?.cone.geometry.dispose();
    this.beams = [];
  }

  // ── Lasers ──────────────────────────────────────────────────────────

  private buildLasers(): void {
    // Mount points: ends of the highest horizontal truss; deck corners
    // when the venue has no trusses (Sphere).
    const mounts: { pos: THREE.Vector3; aimY: number }[] = [];
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
      const alongX = Math.abs(Math.sin((t as THREE.Group).rotation.y)) < 0.5;
      for (const s of [-1, 1]) {
        const pos = alongX
          ? new THREE.Vector3(wp.x + s * len * 0.38, wp.y - 0.6, wp.z)
          : new THREE.Vector3(wp.x, wp.y - 0.6, wp.z + s * len * 0.38);
        mounts.push({ pos, aimY: 0 });
      }
    } else {
      const fz = this.venue.frontZ;
      const w = this.venue.stageW;
      mounts.push({ pos: new THREE.Vector3(-w * 0.42, 2.4, fz - 1), aimY: 0 });
      mounts.push({ pos: new THREE.Vector3(w * 0.42, 2.4, fz - 1), aimY: 0 });
    }

    const BLADES = 9;
    const LEN = 38;
    const bladeGeo = new THREE.BoxGeometry(0.035, 0.035, LEN).translate(0, 0, LEN / 2);
    mounts.forEach((m, mi) => {
      const colorIdx = (mi * 2 + 1) % SHOW_COLORS.length;
      const mat = new THREE.MeshBasicMaterial({
        color: SHOW_COLORS[colorIdx],
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const group = new THREE.Group();
      group.position.copy(m.pos);
      // Aim out over the audience (+Z), tipped slightly down.
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
      this.lasers.push({ group, blades, mat, phase: mi * 2.4, colorIdx });
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

  // ── LED strips ──────────────────────────────────────────────────────

  private buildStrips(): void {
    let i = 0;
    this.venue.group.traverse(obj => {
      const len = obj.userData.trussLen as number | undefined;
      if (!len || obj.userData.trussVertical) return;
      const mat = new THREE.MeshStandardMaterial({
        color: 0x05060a,
        emissive: SHOW_COLORS[i % SHOW_COLORS.length],
        emissiveIntensity: 0.8,
        roughness: 0.5,
        metalness: 0.1,
      });
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len * 0.96, 0.07, 0.07), mat);
      // Clamp just under the bottom chords, audience side.
      strip.position.set(0, -0.36, 0.3);
      strip.castShadow = false;
      strip.raycast = () => {};
      obj.add(strip);
      this.strips.push({ mesh: strip, mat, phase: i * 0.7 });
      i++;
    });
  }

  private teardownStrips(): void {
    for (const s of this.strips) {
      s.mesh.parent?.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mat.dispose();
    }
    this.strips = [];
  }

  // ── Per-frame drive ─────────────────────────────────────────────────

  update(dt: number, audio: VisualAudioState): void {
    this.elapsed += dt;
    const t = this.elapsed;

    // Idle floor keeps everything alive in silence; energy opens it up.
    const energy = audio.isActive ? audio.energy : 0.12;
    const level = audio.isActive ? audio.level : 0.1;
    const kick = audio.isActive ? audio.kick : 0;
    const treble = audio.isActive ? audio.treble : 0.1;
    const sweep = 0.45 + energy * 1.6;        // global motion speed
    const hazeGlow = this.flags.haze ? 1.35 : 1;

    // Beat rising-edge → rotate the palette.
    const beatHot = audio.isActive && audio.beat > 0.85;
    if (beatHot && !this.beatLatch) {
      this.beatLatch = true;
      for (const b of this.beams) {
        b.colorIdx = (b.colorIdx + 1) % SHOW_COLORS.length;
        (b.mat.uniforms.uColor.value as THREE.Color).setHex(SHOW_COLORS[b.colorIdx]);
      }
      for (const l of this.lasers) {
        l.colorIdx = (l.colorIdx + 1) % SHOW_COLORS.length;
        l.mat.color.setHex(SHOW_COLORS[l.colorIdx]);
      }
    } else if (!beatHot) {
      this.beatLatch = false;
    }

    // Slow hue drift for the strips.
    this.hue = (this.hue + dt * (0.02 + energy * 0.06)) % 1;

    for (const b of this.beams) {
      // Pan/tilt figure-eights around the rest pose — phase-offset per
      // fixture so the rig ripples instead of moving in lockstep.
      b.yoke.rotation.y = b.restPan + Math.sin(t * sweep + b.phase) * 0.7;
      b.head.rotation.x = b.restTilt + Math.sin(t * sweep * 0.63 + b.phase * 1.7) * 0.45;
      b.mat.uniforms.uIntensity.value =
        Math.min(0.85, (0.18 + level * 0.45 + kick * 0.5) * hazeGlow);
    }

    for (const l of this.lasers) {
      // Fan breathes with the beat LFO, whole unit sweeps the room.
      const fan = 0.12 + (audio.isActive ? audio.lfoBeat : (Math.sin(t * 0.5) * 0.5 + 0.5)) * 0.55;
      const n = l.blades.length;
      for (let b = 0; b < n; b++) {
        l.blades[b].rotation.y = (b - (n - 1) / 2) * (fan / (n - 1)) * 2;
      }
      l.group.rotation.y = Math.sin(t * sweep * 0.5 + l.phase) * 0.85;
      l.group.rotation.x = -0.1 + Math.sin(t * sweep * 0.31 + l.phase * 2.1) * 0.12;
      l.mat.opacity = (0.3 + treble * 0.5 + kick * 0.25) * hazeGlow;
    }

    for (const s of this.strips) {
      const pulse = 0.5 + (audio.isActive ? audio.bass : (Math.sin(t * 0.7 + s.phase) * 0.5 + 0.5) * 0.3) * 2.4 + kick * 1.2;
      s.mat.emissiveIntensity = pulse;
      s.mat.emissive.setHSL((this.hue + s.phase * 0.13) % 1, 0.95, 0.55);
    }

    // Haze — ease the fog density toward its target like a hazer
    // filling (or clearing) the room.
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      const target = this.venue.fogDensity * (this.flags.haze ? HAZE_FOG_MULT : 1);
      const alpha = 1 - Math.exp(-dt / 1.2);
      this.fogCurrent += (target - this.fogCurrent) * alpha;
      fog.density = this.fogCurrent;
    }
  }

  dispose(): void {
    this.teardownBeams();
    this.teardownLasers();
    this.teardownStrips();
    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = this.venue.fogDensity;
  }
}
