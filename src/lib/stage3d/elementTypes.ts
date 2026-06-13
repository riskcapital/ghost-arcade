// Stage 3D element-type registry — the parametric library of trusses,
// lights, speakers, and decks that the user places by hand.
//
// Ported from the STAGEFORGE reference HTML. LED screens / projection
// scrims are deliberately NOT here: those auto-sync from the project's
// screen layers via Apply Stage and render through Stage3DRenderer's
// LED pipeline.
//
// Each entry's `build()` returns an array of THREE.Object3D that
// becomes the children of the element's wrapping THREE.Group (the same
// group that carries position/rotation/scale).

import * as THREE from 'three';
import type { UserStageElement } from './types';
import { buildPixelStrip } from './atmosphere';

/** A single tweakable field — translates 1:1 into an inspector control. */
export interface ElementField {
  k: string;
  l: string;
  type?: 'range' | 'color';
  min?: number;
  max?: number;
  step?: number;
  int?: boolean;
}

export interface ElementTypeDef {
  group: 'Stage' | 'Lighting' | 'Audio';
  label: string;
  icon: string;
  defaults: Record<string, number | string>;
  fields: ElementField[];
  build(p: Record<string, any>): THREE.Object3D[];
}

// ── Shared material helpers ─────────────────────────────────────────────

export const MAT = {
  metal:     () => new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.95 }),
  darkMetal: () => new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5,  metalness: 0.7 }),
  deck:      () => new THREE.MeshStandardMaterial({ color: 0x161a20, roughness: 0.7,  metalness: 0.2 }),
  cab:       () => new THREE.MeshStandardMaterial({ color: 0x080a0c, roughness: 0.85, metalness: 0.1 }),
  cone:      () => new THREE.MeshStandardMaterial({ color: 0x1b1e24, roughness: 0.5,  metalness: 0.3 }),
  trim:      (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.6 }),
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Box-truss segment along the X axis (length × 0.5m square section).
 *  Material tagged via userData.role so Stage3DRenderer's truss colour
 *  override can recolour all trusses (venue scenery AND user-placed
 *  library elements) in one pass. */
export function buildTruss(len: number): THREE.Group {
  const g = new THREE.Group();
  const size = 0.5;
  const off = size / 2;
  const r = 0.05;
  const m = MAT.metal();
  m.userData.role = 'truss';
  const chord = new THREE.CylinderGeometry(r, r, len, 8);
  for (const [a, b] of [[off, off], [-off, off], [off, -off], [-off, -off]]) {
    const c = mesh(chord, m);
    c.rotation.z = Math.PI / 2;
    c.position.set(0, b, a);
    g.add(c);
  }
  const n = Math.max(2, Math.round(len / 0.8));
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const x0 = -len / 2 + i * step;
    const x1 = x0 + step;
    const segs: [[number, number, number], [number, number, number]][] = [
      [[x0, off, off],  [x1, -off, off]],
      [[x0, -off, -off],[x1, off, -off]],
      [[x0, off, off],  [x1, off, -off]],
      [[x0, -off, off], [x1, -off, -off]],
    ];
    for (const [p0, p1] of segs) {
      const A = new THREE.Vector3(...p0);
      const B = new THREE.Vector3(...p1);
      const L = A.distanceTo(B);
      const b = mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, L, 6), m);
      b.position.copy(A).lerp(B, 0.5);
      b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      g.add(b);
    }
  }
  return g;
}

/** Single moving-head fixture — base + yoke + head with a glowing lens. */
function fixture(color: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  const dm = MAT.darkMetal();
  g.add(mesh(new THREE.BoxGeometry(0.7, 0.34, 0.7), dm));
  const yoke = new THREE.Group();
  g.add(yoke);
  const head = new THREE.Group();
  head.position.y = -0.5;
  yoke.add(head);
  head.add(mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.7, 16), dm));
  const lens = mesh(
    new THREE.CircleGeometry(0.28, 18),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6, roughness: 0.3 }),
  );
  lens.position.y = -0.36;
  lens.rotation.x = -Math.PI / 2;
  head.add(lens);
  head.rotation.x = 0.5;
  return g;
}

// ── Type registry ───────────────────────────────────────────────────────

export const ELEMENT_TYPES: Record<string, ElementTypeDef> = {
  truss: {
    group: 'Stage', label: 'Box Truss', icon: '═',
    defaults: { len: 16 },
    fields: [{ k: 'len', l: 'Length', min: 2, max: 48, step: 0.5 }],
    build(p) { return [buildTruss(p.len)]; },
  },

  tower: {
    group: 'Stage', label: 'Truss Tower', icon: '║',
    defaults: { h: 14 },
    fields: [{ k: 'h', l: 'Height', min: 3, max: 30, step: 0.5 }],
    build(p) {
      const t = buildTruss(p.h);
      t.rotation.z = Math.PI / 2;
      t.position.y = p.h / 2;
      const base = mesh(new THREE.BoxGeometry(2, 0.4, 2), MAT.darkMetal());
      base.position.y = 0.2;
      return [t, base];
    },
  },

  deck: {
    group: 'Stage', label: 'Stage Deck', icon: '▭',
    defaults: { w: 24, d: 14, h: 1.4 },
    fields: [
      { k: 'w', l: 'Width', min: 2, max: 60, step: 0.5 },
      { k: 'd', l: 'Depth', min: 2, max: 40, step: 0.5 },
      { k: 'h', l: 'Height', min: 0.4, max: 4, step: 0.1 },
    ],
    build(p) {
      const top = mesh(new THREE.BoxGeometry(p.w, p.h, p.d), MAT.deck());
      top.position.y = p.h / 2;
      const skirt = mesh(
        new THREE.BoxGeometry(p.w + 0.1, p.h * 0.9, p.d + 0.1),
        new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.9 }),
      );
      skirt.position.y = p.h * 0.45;
      const edge = mesh(new THREE.BoxGeometry(p.w + 0.2, 0.12, p.d + 0.2), MAT.metal());
      edge.position.y = p.h + 0.05;
      return [skirt, top, edge];
    },
  },

  riser: {
    group: 'Stage', label: 'Drum / Sub Riser', icon: '◰',
    defaults: { w: 8, d: 6, h: 1.0 },
    fields: [
      { k: 'w', l: 'Width', min: 2, max: 20, step: 0.5 },
      { k: 'd', l: 'Depth', min: 2, max: 16, step: 0.5 },
      { k: 'h', l: 'Height', min: 0.3, max: 3, step: 0.1 },
    ],
    build(p) {
      const top = mesh(new THREE.BoxGeometry(p.w, p.h, p.d), MAT.deck());
      top.position.y = p.h / 2;
      const edge = mesh(new THREE.BoxGeometry(p.w + 0.15, 0.1, p.d + 0.15), MAT.trim(0x2c333c));
      edge.position.y = p.h + 0.05;
      return [top, edge];
    },
  },

  stairs: {
    group: 'Stage', label: 'Stairs', icon: '◢',
    defaults: { steps: 5, w: 4, h: 1.4 },
    fields: [
      { k: 'steps', l: 'Steps', min: 2, max: 14, step: 1, int: true },
      { k: 'w', l: 'Width', min: 1, max: 10, step: 0.5 },
      { k: 'h', l: 'Rise To', min: 0.5, max: 4, step: 0.1 },
    ],
    build(p) {
      const out: THREE.Object3D[] = [];
      const rise = p.h / p.steps;
      const run = 0.35;
      for (let i = 0; i < p.steps; i++) {
        const s = mesh(new THREE.BoxGeometry(p.w, rise, run), MAT.deck());
        s.position.set(0, rise * (i + 0.5), -i * run);
        out.push(s);
      }
      return out;
    },
  },

  djbooth: {
    group: 'Stage', label: 'DJ Booth', icon: '◫',
    defaults: { w: 5, d: 2.4, color: '#1c2230' },
    fields: [
      { k: 'w', l: 'Width', min: 2, max: 12, step: 0.5 },
      { k: 'd', l: 'Depth', min: 1, max: 6, step: 0.5 },
      { k: 'color', l: 'Facade', type: 'color' },
    ],
    build(p) {
      const body = mesh(new THREE.BoxGeometry(p.w, 1.1, p.d), MAT.cab());
      body.position.y = 0.55;
      const facade = mesh(
        new THREE.BoxGeometry(p.w + 0.06, 1.0, 0.08),
        new THREE.MeshStandardMaterial({ color: p.color, emissive: p.color, emissiveIntensity: 0.25, roughness: 0.5 }),
      );
      facade.position.set(0, 0.55, p.d / 2 + 0.04);
      const top = mesh(new THREE.BoxGeometry(p.w, 0.08, p.d), MAT.darkMetal());
      top.position.y = 1.14;
      return [body, facade, top];
    },
  },

  barrier: {
    group: 'Stage', label: 'Crowd Barrier', icon: '╪',
    defaults: { len: 14 },
    fields: [{ k: 'len', l: 'Length', min: 2, max: 40, step: 0.5 }],
    build(p) {
      const out: THREE.Object3D[] = [];
      const n = Math.max(1, Math.round(p.len / 2));
      const m = MAT.metal();
      const rail = mesh(new THREE.CylinderGeometry(0.05, 0.05, p.len, 8), m);
      rail.rotation.z = Math.PI / 2;
      rail.position.y = 1.05;
      out.push(rail);
      for (let i = 0; i <= n; i++) {
        const x = -p.len / 2 + i * (p.len / n);
        const post = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), m);
        post.position.set(x, 0.55, 0);
        out.push(post);
        const foot = mesh(new THREE.BoxGeometry(0.5, 0.05, 1.2), m);
        foot.position.set(x, 0.03, 0);
        out.push(foot);
      }
      return out;
    },
  },

  movinghead: {
    group: 'Lighting', label: 'Moving Head', icon: '✦',
    defaults: { color: '#4af2ff' },
    fields: [{ k: 'color', l: 'Beam Color', type: 'color' }],
    build(p) { return [fixture(new THREE.Color(p.color))]; },
  },

  ledstrip: {
    group: 'Lighting', label: 'LED Strip', icon: '▬',
    defaults: { len: 12, pixels: 24, color: '#4af2ff', mode: 0, glow: 1.6, speed: 1, sync: 1 },
    fields: [
      { k: 'len', l: 'Length', min: 1, max: 40, step: 0.5 },
      { k: 'pixels', l: 'Pixels', min: 8, max: 64, step: 1, int: true },
      { k: 'color', l: 'Color', type: 'color' },
      { k: 'mode', l: 'Mode — 0 Fill · 1 Chase · 2 Pulse · 3 Solid', min: 0, max: 3, step: 1, int: true },
      { k: 'glow', l: 'Glow', min: 0.2, max: 4, step: 0.1 },
      { k: 'speed', l: 'Chase Speed', min: 0.1, max: 4, step: 0.05 },
      { k: 'sync', l: 'Sync to Show Palette — 0 Off · 1 On', min: 0, max: 1, step: 1, int: true },
    ],
    build(p) {
      // Channel rail + single-mesh pixel strip. The animation metadata
      // rides on the holder group's userData; Stage3DRenderer collects
      // these and hands them to the AtmosphereRig, which drives the
      // pixels every frame (beat-fill / chase / pulse / solid),
      // palette-synced to the show when `sync` is on.
      const out: THREE.Object3D[] = [];
      const rail = mesh(new THREE.BoxGeometry(p.len, 0.05, 0.08), MAT.darkMetal());
      rail.position.z = -0.05;
      out.push(rail);
      const strip = buildPixelStrip(p.len * 0.98, Math.round(p.pixels));
      const base = new THREE.Color(p.color);
      // Pre-light the pixels so the strip reads before the rig ticks
      // (and in scenes where the atmosphere layer is idle).
      for (let i = 0; i < strip.segs; i++) {
        for (let v = 0; v < 4; v++) {
          strip.colors.setXYZ(i * 4 + v, base.r * p.glow * 0.5, base.g * p.glow * 0.5, base.b * p.glow * 0.5);
        }
      }
      strip.colors.needsUpdate = true;
      const holder = new THREE.Group();
      holder.add(strip.mesh);
      holder.userData.ledStripAnim = {
        strip,
        mode: Math.round(p.mode),
        glow: p.glow,
        speed: p.speed,
        sync: Math.round(p.sync) === 1,
        base,
      };
      out.push(holder);
      return out;
    },
  },

  lightbar: {
    group: 'Lighting', label: 'Lighting Bar', icon: '≣',
    defaults: { count: 6, len: 14, color: '#ff5cb8' },
    fields: [
      { k: 'count', l: 'Fixtures', min: 1, max: 16, step: 1, int: true },
      { k: 'len', l: 'Bar Length', min: 2, max: 40, step: 0.5 },
      { k: 'color', l: 'Beam Color', type: 'color' },
    ],
    build(p) {
      const out: THREE.Object3D[] = [buildTruss(p.len)];
      const c = new THREE.Color(p.color);
      for (let i = 0; i < p.count; i++) {
        const f = fixture(c);
        f.position.set(-p.len / 2 + (i + 0.5) * (p.len / p.count), -0.45, 0);
        out.push(f);
      }
      return out;
    },
  },

  parbar: {
    group: 'Lighting', label: 'PAR Wash Bar', icon: '⋯',
    defaults: { count: 8, len: 14, color: '#ffb648' },
    fields: [
      { k: 'count', l: 'PARs', min: 1, max: 18, step: 1, int: true },
      { k: 'len', l: 'Bar Length', min: 2, max: 40, step: 0.5 },
      { k: 'color', l: 'Color', type: 'color' },
    ],
    build(p) {
      const out: THREE.Object3D[] = [];
      const bar = mesh(new THREE.CylinderGeometry(0.06, 0.06, p.len, 8), MAT.metal());
      bar.rotation.z = Math.PI / 2;
      out.push(bar);
      const c = new THREE.Color(p.color);
      for (let i = 0; i < p.count; i++) {
        const x = -p.len / 2 + (i + 0.5) * (p.len / p.count);
        const can = mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.42, 12), MAT.darkMetal());
        can.position.set(x, -0.3, 0);
        can.rotation.x = Math.PI / 2;
        out.push(can);
        const lens = mesh(
          new THREE.CircleGeometry(0.2, 14),
          new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.5, roughness: 0.3 }),
        );
        lens.position.set(x, -0.3, 0.22);
        out.push(lens);
      }
      return out;
    },
  },

  blinder: {
    group: 'Lighting', label: 'Blinder Array', icon: '☷',
    defaults: { cols: 4, rows: 2, color: '#fff4d6' },
    fields: [
      { k: 'cols', l: 'Columns', min: 1, max: 8, step: 1, int: true },
      { k: 'rows', l: 'Rows', min: 1, max: 4, step: 1, int: true },
      { k: 'color', l: 'Lamp', type: 'color' },
    ],
    build(p) {
      const out: THREE.Object3D[] = [];
      const c = new THREE.Color(p.color);
      const cell = 0.6;
      const w = p.cols * cell;
      const h = p.rows * cell;
      const frame = mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.25), MAT.darkMetal());
      out.push(frame);
      for (let y = 0; y < p.rows; y++)
        for (let x = 0; x < p.cols; x++) {
          const lamp = mesh(
            new THREE.CircleGeometry(cell * 0.42, 12),
            new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8, roughness: 0.4 }),
          );
          lamp.position.set(-w / 2 + (x + 0.5) * cell, -h / 2 + (y + 0.5) * cell, 0.14);
          out.push(lamp);
        }
      return out;
    },
  },

  linearray: {
    group: 'Audio', label: 'Line Array Hang', icon: '❰',
    defaults: { boxes: 6, splay: 3 },
    fields: [
      { k: 'boxes', l: 'Cabinets', min: 2, max: 18, step: 1, int: true },
      { k: 'splay', l: 'Splay °', min: 0, max: 8, step: 0.5 },
    ],
    build(p) {
      // Ported from concert-stage.html `speakerStack()` — substantial
      // cabinets (3.4×1.2×2.2m) with progressive forward tilt and twin
      // cones per cab. Flybar across the top so it visually hangs.
      const out: THREE.Object3D[] = [];
      const cabMat = new THREE.MeshStandardMaterial({ color: 0x070809, roughness: 0.85, metalness: 0.1 });
      const coneMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.5 });
      const flybar = mesh(new THREE.BoxGeometry(3.8, 0.18, 2.4), MAT.metal());
      flybar.position.y = 0.5;
      out.push(flybar);
      for (let i = 0; i < p.boxes; i++) {
        const tilt = i * THREE.MathUtils.degToRad(p.splay);
        const cab = mesh(new THREE.BoxGeometry(3.4, 1.2, 2.2), cabMat);
        cab.position.set(0, -i * 1.28, 0);
        cab.rotation.x = tilt;
        out.push(cab);
        for (const dx of [-0.8, 0.8]) {
          const cone = mesh(new THREE.CircleGeometry(0.45, 18), coneMat);
          cone.position.set(dx, -i * 1.28, 1.11);
          cone.rotation.x = tilt;
          out.push(cone);
        }
      }
      return out;
    },
  },

  subarray: {
    group: 'Audio', label: 'Subwoofer Array', icon: '▤',
    defaults: { count: 4, stack: 1 },
    fields: [
      { k: 'count', l: 'Cabinets', min: 1, max: 12, step: 1, int: true },
      { k: 'stack', l: 'Stack High', min: 1, max: 4, step: 1, int: true },
    ],
    build(p) {
      const out: THREE.Object3D[] = [];
      const cw = 2.2;
      const ch = 1.4;
      const cd = 2.6;
      for (let i = 0; i < p.count; i++)
        for (let s = 0; s < p.stack; s++) {
          const box = mesh(new THREE.BoxGeometry(cw - 0.05, ch - 0.05, cd), MAT.cab());
          box.position.set(-(p.count - 1) * cw / 2 + i * cw, ch / 2 + s * ch, 0);
          out.push(box);
          const port = mesh(new THREE.CircleGeometry(0.5, 18), MAT.cone());
          port.position.set(box.position.x, box.position.y, cd / 2 + 0.01);
          out.push(port);
        }
      return out;
    },
  },

  pointsource: {
    group: 'Audio', label: 'Point-Source on Stand', icon: '◭',
    defaults: { sub: 1 },
    fields: [{ k: 'sub', l: 'With Sub (1/0)', min: 0, max: 1, step: 1, int: true }],
    build(p) {
      const out: THREE.Object3D[] = [];
      const pole = mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 10), MAT.darkMetal());
      pole.position.y = 1.2;
      out.push(pole);
      const tri = mesh(new THREE.CylinderGeometry(0.02, 0.6, 0.1, 10), MAT.darkMetal());
      tri.position.y = 0.05;
      out.push(tri);
      const top = mesh(new THREE.BoxGeometry(0.9, 1.3, 0.9), MAT.cab());
      top.position.set(0, 2.6, 0);
      top.rotation.x = 0.25;
      out.push(top);
      const cone = mesh(new THREE.CircleGeometry(0.32, 16), MAT.cone());
      cone.position.set(0, 2.6, 0.46);
      cone.rotation.x = 0.25;
      out.push(cone);
      if (p.sub) {
        const sub = mesh(new THREE.BoxGeometry(1.4, 1.5, 1.6), MAT.cab());
        sub.position.y = 0.75;
        out.push(sub);
      }
      return out;
    },
  },
};

export function elementDefaults(type: string): Record<string, number | string> {
  return { ...(ELEMENT_TYPES[type]?.defaults ?? {}) };
}

export function makeUserElement(type: string, params: Record<string, number | string> = {}): UserStageElement {
  return {
    id: `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    params: { ...elementDefaults(type), ...params },
    position: [0, 0, 0],
    rotationY: 0,
    scale: 1,
  };
}

/** Build the THREE.Group for an element (placement + children). The
 *  caller adds the returned group to the scene and tracks it. */
export function buildUserElement(el: UserStageElement): THREE.Group {
  const def = ELEMENT_TYPES[el.type];
  const wrap = new THREE.Group();
  wrap.position.set(el.position[0], el.position[1], el.position[2]);
  wrap.rotation.y = el.rotationY;
  wrap.scale.setScalar(el.scale);
  wrap.userData = { kind: 'user-element', elementId: el.id, elementType: el.type };
  if (!def) return wrap;
  def.build(el.params).forEach(c => wrap.add(c));
  return wrap;
}
