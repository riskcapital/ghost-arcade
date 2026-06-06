// Venue presets for Ghost Stage. Each venue returns the static scenery
// (decks/truss/PA wings/lighting fixtures/atmospherics) plus an
// `ledWall` mounting region telling the renderer where auto-built LED
// screens (from project.layers) should land in world space.
//
// `festival` is a direct port of the concert-stage.html reference —
// reflective floor, full truss rig, idle LED wall + side strips,
// movinghead arrays, 14 PARs, line-array PA stacks, three-point neutral
// lighting. The other venues (arena/club/nightclub) are looser
// adaptations from the STAGEFORGE designer reference.

import * as THREE from 'three';
import { MAT, buildTruss } from './elementTypes';
import type { Stage3DVenue } from './types';

export interface VenueBuild {
  /** Root group — added to scene; removed on venue swap. */
  group: THREE.Group;
  /** Floor mesh — referenced so the renderer can apply `floorDarkness`
   *  per frame without having to dig through the venue group. */
  floor: THREE.Mesh;
  /** Lights — added at scene level so they affect user elements + LEDs.
   *  Includes baseline intensities the renderer scales via roomIntensity. */
  lights: THREE.Light[];
  /** Baseline intensity for each entry in `lights`, captured at venue
   *  build time. Renderer multiplies these by `lighting.roomIntensity`
   *  every frame, then writes the result back so the UI slider feels
   *  responsive without us re-running the whole build. */
  baselineIntensities: number[];
  /** Primary directional light — exposed so the Lighting panel can
   *  reposition / recolour it without rebuilding the venue. */
  keyLight: THREE.DirectionalLight;
  /** Captured baseline position so resets land on the venue default. */
  keyPositionBaseline: [number, number, number];
  /** Captured baseline colour. */
  keyColorBaseline: number;
  /** Scene background colour. */
  backgroundColor: string;
  fogDensity: number;
  fogColor: string;
  /** Whether the renderer should show the editor grid helper. */
  showGrid: boolean;
  /** Default camera position + target on first load of this venue. */
  cameraPosition: [number, number, number];
  cameraTarget: [number, number, number];
  /** LED Wall mounting region — auto-built screen meshes map onto this
   *  rectangle in world space. Width/height in meters. */
  ledWall: {
    centerX: number;
    centerY: number;
    centerZ: number;
    width: number;
    height: number;
  };
  /** Stage dimensions — used by PA presets to place flown arrays / subs
   *  / point sources sensibly relative to the deck. */
  stageW: number;
  /** Front-of-stage Z (camera-side edge of the deck). */
  frontZ: number;
  /** Subtle bloom strength for this venue (0 = no bloom, ~0.15 = light
   *  glow on emissive lenses). Festival ports the reference HTML which
   *  uses NO bloom — colours hold their saturation. */
  bloomStrength: number;
  /** Tone-mapping exposure — bumped slightly on festival to match the
   *  reference's `renderer.toneMappingExposure = 1.05`. */
  exposure: number;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ── Festival (concert-stage.html port) ─────────────────────────────────

/** Aluminium box-truss — port of concert-stage.html's `makeTruss()`,
 *  matching size (0.55 section) and brace density (~0.85m spacing).
 *  Material tagged via userData.role so the renderer can recolour the
 *  entire rig live from the Lighting panel. */
function festivalTruss(len: number, vertical = false): THREE.Group {
  const g = new THREE.Group();
  const size = 0.55, off = size / 2, r = 0.055;
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.35, metalness: 0.9 });
  trussMat.userData.role = 'truss';
  const chord = new THREE.CylinderGeometry(r, r, len, 8);
  for (const [a, b] of [[off, off], [-off, off], [off, -off], [-off, -off]]) {
    const m = mesh(chord, trussMat);
    m.rotation.z = Math.PI / 2;
    m.position.set(0, b, a);
    g.add(m);
  }
  const n = Math.max(2, Math.round(len / 0.85));
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
      const a = new THREE.Vector3(...p0);
      const b = new THREE.Vector3(...p1);
      const L = a.distanceTo(b);
      const m = mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, L, 6), trussMat);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(m);
    }
  }
  if (vertical) g.rotation.z = Math.PI / 2;
  return g;
}

/** Single moving-head fixture — port of concert-stage.html's
 *  `makeMover()`. Static aim (yoke pan + head tilt). */
function makeMover(x: number, y: number, z: number, tilt = 0.5, pan = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5, metalness: 0.7 });
  const base = mesh(new THREE.BoxGeometry(0.9, 0.4, 0.9), bodyMat);
  g.add(base);
  const yoke = new THREE.Group();
  g.add(yoke);
  const arm = mesh(new THREE.BoxGeometry(1.2, 0.18, 0.18), bodyMat);
  arm.position.y = -0.45;
  yoke.add(arm);
  const head = new THREE.Group();
  head.position.y = -0.55;
  yoke.add(head);
  const can = mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.85, 16), bodyMat);
  can.rotation.x = Math.PI;
  head.add(can);
  const lens = mesh(
    new THREE.CircleGeometry(0.33, 20),
    new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.2, metalness: 0.6 }),
  );
  lens.position.y = -0.45;
  lens.rotation.x = -Math.PI / 2;
  head.add(lens);
  yoke.rotation.y = pan;
  head.rotation.x = tilt;
  return g;
}

/** Flown line-array stack — port of concert-stage.html's `speakerStack()`.
 *  6 cabinets cascading downward with progressive tilt, two cones each.
 *  Used inline by buildFestival and exported for the library's
 *  `linearray` element type so user-placed PA matches venue PA. */
export function buildSpeakerStack(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x070809, roughness: 0.85, metalness: 0.1 });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.5 });
  for (let i = 0; i < 6; i++) {
    const cab = mesh(new THREE.BoxGeometry(3.4, 1.2, 2.2), m);
    cab.position.y = -i * 1.28;
    cab.rotation.x = i * 0.05;
    g.add(cab);
    for (const dx of [-0.8, 0.8]) {
      const cone = mesh(new THREE.CircleGeometry(0.45, 18), coneMat);
      cone.position.set(dx, -i * 1.28, 1.11);
      cone.rotation.x = i * 0.05;
      g.add(cone);
    }
  }
  return g;
}

function buildFestival(): VenueBuild {
  const group = new THREE.Group();

  // Helper to wrap a leaf mesh in a sceneryId-tagged group so the
  // renderer can find it via raycast and the user can move / scale /
  // delete each piece individually. Mover, truss and speakerStack
  // already return groups so they get their sceneryId set directly.
  const tag = (obj: THREE.Object3D, id: string): THREE.Object3D => {
    obj.userData.sceneryId = id;
    return obj;
  };
  const wrap = (mesh: THREE.Object3D, id: string): THREE.Group => {
    const g = new THREE.Group();
    g.userData.sceneryId = id;
    g.add(mesh);
    return g;
  };

  // ── Floor — static dark plane (Reflector dropped for perf) ──
  const floor = mesh(
    new THREE.PlaneGeometry(220, 220),
    new THREE.MeshStandardMaterial({ color: 0x0a0c12, roughness: 0.55, metalness: 0.25 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  // Floor stays tag-less — deleting / moving it isn't useful and would
  // expose the void below the stage. Keep it as venue background.
  group.add(floor);

  // ── Black backdrop behind the stage ──
  const backdrop = mesh(
    new THREE.PlaneGeometry(42, 20),
    new THREE.MeshStandardMaterial({
      color: 0x000000, roughness: 1, metalness: 0,
      envMapIntensity: 0,
    }),
  );
  backdrop.position.set(0, 10, -16);
  backdrop.castShadow = false;
  backdrop.receiveShadow = false;
  group.add(wrap(tag(backdrop, 'backdrop'), 'backdrop'));

  // ── Stage deck + drum riser ──
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.7, metalness: 0.2 });
  const deckGroup = new THREE.Group();
  deckGroup.userData.sceneryId = 'deck';
  const deck = mesh(new THREE.BoxGeometry(36, 1.4, 18), deckMat);
  deck.position.set(0, 0.7, -6);
  deckGroup.add(deck);
  const deckEdge = mesh(
    new THREE.BoxGeometry(36.2, 0.16, 18.2),
    new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.4, metalness: 0.8 }),
  );
  deckEdge.position.set(0, 1.42, -6);
  deckGroup.add(deckEdge);
  group.add(deckGroup);
  const riser = mesh(new THREE.BoxGeometry(10, 1.2, 7), deckMat);
  riser.position.set(0, 2.0, -9);
  group.add(wrap(tag(riser, 'riser'), 'riser'));

  // ── Truss rig (cleaned up so chords actually meet) ──
  //
  // Geometry plan: all overhead trusses share a top-chord height of
  // y = TRUSS_TOP_Y. The vertical towers extend from y=0 to y=TRUSS_TOP_Y
  // so the OVERHEAD truss top-chord meets the TOWER top-chord at the
  // same y. The horizontal trusses overlap by ~0.3m at the corners with
  // the towers + side beams, which hides the joins from any angle.
  //
  // Front + back towers share X positions so the side-beams run straight
  // along the venue's left/right edges and the perpendicular trusses
  // (front/back/mid) land on the same X.
  const TRUSS_TOP_Y = 16;       // height of every top chord
  const TRUSS_HALF = 0.275;     // half of the 0.55m section
  const OVERHEAD_Y = TRUSS_TOP_Y - TRUSS_HALF; // truss CENTER for top chord to sit at TRUSS_TOP_Y
  const TOWER_LEN = TRUSS_TOP_Y;
  const TOWER_Y = TOWER_LEN / 2;
  const TOWER_X = 19;
  const FRONT_Z = 2;
  const BACK_Z = -15;
  const MID_Z = (FRONT_Z + BACK_Z) / 2; // -6.5
  const TRUSS_LEN = TOWER_X * 2;        // 38m — chord centers land exactly at the tower centers
  const SIDE_BEAM_LEN = FRONT_Z - BACK_Z; // 17m

  // Front truss (over downstage)
  const frontTruss = festivalTruss(TRUSS_LEN);
  frontTruss.position.set(0, OVERHEAD_Y, FRONT_Z);
  frontTruss.userData.sceneryId = 'truss-front';
  group.add(frontTruss);
  // Back truss (over upstage, behind the LED wall area)
  const backTruss = festivalTruss(TRUSS_LEN);
  backTruss.position.set(0, OVERHEAD_Y, BACK_Z);
  backTruss.userData.sceneryId = 'truss-back';
  group.add(backTruss);
  // Mid truss (centred between front and back)
  const midTruss = festivalTruss(TRUSS_LEN);
  midTruss.position.set(0, OVERHEAD_Y, MID_Z);
  midTruss.userData.sceneryId = 'truss-mid';
  group.add(midTruss);
  // Four vertical towers (front-L/R, back-L/R) — all same length so
  // their tops land on TRUSS_TOP_Y.
  for (const sx of [-TOWER_X, TOWER_X]) {
    const sideTag = sx < 0 ? 'L' : 'R';
    const towerF = festivalTruss(TOWER_LEN, true);
    towerF.position.set(sx, TOWER_Y, FRONT_Z);
    towerF.userData.sceneryId = `tower-front-${sideTag}`;
    group.add(towerF);
    const towerB = festivalTruss(TOWER_LEN, true);
    towerB.position.set(sx, TOWER_Y, BACK_Z);
    towerB.userData.sceneryId = `tower-back-${sideTag}`;
    group.add(towerB);
  }
  // Side beams along L/R, joining the front + back tower tops
  for (const sx of [-TOWER_X, TOWER_X]) {
    const sideTag = sx < 0 ? 'L' : 'R';
    const beam = festivalTruss(SIDE_BEAM_LEN);
    beam.rotation.y = Math.PI / 2;
    beam.position.set(sx, OVERHEAD_Y, MID_Z);
    beam.userData.sceneryId = `beam-${sideTag}`;
    group.add(beam);
  }

  // ── Moving-head fixtures: front 8, back 7, side towers 6 ──
  // Each mover gets its own sceneryId so the user can pick / move /
  // delete individual fixtures.
  for (let i = 0; i < 8; i++) {
    const m = makeMover(-16 + i * 4.6, TRUSS_TOP_Y - 0.55, FRONT_Z, 0.6, (i - 3.5) * 0.06);
    m.userData.sceneryId = `mover-front-${i}`;
    group.add(m);
  }
  for (let i = 0; i < 7; i++) {
    const m = makeMover(-15 + i * 5, TRUSS_TOP_Y - 0.55, BACK_Z, -0.5, (i - 3) * 0.05);
    m.userData.sceneryId = `mover-back-${i}`;
    group.add(m);
  }
  for (const sx of [-TOWER_X, TOWER_X]) {
    const sideTag = sx < 0 ? 'L' : 'R';
    for (let i = 0; i < 3; i++) {
      const m = makeMover(sx, 4.5 + i * 4.5, 0, 0.3, sx < 0 ? 0.6 : -0.6);
      m.userData.sceneryId = `mover-side-${sideTag}-${i}`;
      group.add(m);
    }
  }

  // ── 14 PARs along the deck front (each a pickable unit) ──
  for (let i = 0; i < 14; i++) {
    const px = -16 + (i / 13) * 32;
    const parGroup = new THREE.Group();
    parGroup.userData.sceneryId = `par-${i}`;
    const par = mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.5, 12),
      new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.6, metalness: 0.6 }),
    );
    par.position.set(px, 1.55, -13.4);
    par.rotation.x = -0.5;
    parGroup.add(par);
    const lens = mesh(
      new THREE.CircleGeometry(0.26, 16),
      new THREE.MeshStandardMaterial({ color: 0x06070b, roughness: 0.2, metalness: 0.5 }),
    );
    lens.position.set(px, 1.75, -13.0);
    lens.rotation.x = -2.1;
    parGroup.add(lens);
    group.add(parGroup);
  }

  // ── Line-array stacks L/R ──
  const stackL = buildSpeakerStack();
  stackL.position.set(-17.5, 12.5, 1);
  stackL.userData.sceneryId = 'pa-L';
  group.add(stackL);
  const stackR = buildSpeakerStack();
  stackR.position.set(17.5, 12.5, 1);
  stackR.userData.sceneryId = 'pa-R';
  group.add(stackR);

  // ── Lighting (neutral studio fill from the reference) ──
  // Festival baseline is intentionally dim so the LEDs read as bright
  // emissive. Room slider can boost from here when the user wants to
  // see the scenery itself instead of "screens-in-the-dark".
  const hemi = new THREE.HemisphereLight(0xa8c0e0, 0x0a0c12, 0.35);
  const ambient = new THREE.AmbientLight(0xffffff, 0.08);
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(18, 34, 24);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { near: 1, far: 120, left: -45, right: 45, top: 45, bottom: -45 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.25);
  fill.position.set(-28, 18, 16);
  const rim = new THREE.DirectionalLight(0xbfd0ee, 0.2);
  rim.position.set(0, 22, -40);

  const lights = [hemi, ambient, key, fill, rim];
  return {
    group,
    floor,
    lights,
    baselineIntensities: lights.map(l => l.intensity),
    keyLight: key,
    keyPositionBaseline: [key.position.x, key.position.y, key.position.z],
    keyColorBaseline: key.color.getHex(),
    backgroundColor: '#05060a',
    fogDensity: 0.012,
    fogColor: '#05060a',
    showGrid: false,
    cameraPosition: [0, 9, 42],
    cameraTarget: [0, 6, -6],
    ledWall: { centerX: 0, centerY: 9.4, centerZ: -14.4, width: 28, height: 15.7 },
    stageW: 36,
    frontZ: 3,
    bloomStrength: 0,
    exposure: 1.05,
  };
}

// ── Other venues (looser stylings) ─────────────────────────────────────

/** Build a 6-sided enclosure for arena / club / nightclub. Returns the
 *  floor mesh separately so the renderer can darken it via the lighting
 *  override slider. The remaining 5 walls live on the returned group. */
function room(w: number, d: number, h: number, wallColor: number, floorColor: number): {
  group: THREE.Group;
  floor: THREE.Mesh;
} {
  const g = new THREE.Group();
  const floor = mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ color: floorColor, roughness: 0.6, metalness: 0.25 }),
  );
  floor.rotation.x = -Math.PI / 2;
  g.add(floor);
  const wmat = new THREE.MeshStandardMaterial({
    color: wallColor, roughness: 0.9, metalness: 0.05, side: THREE.BackSide,
  });
  const walls = mesh(new THREE.BoxGeometry(w, h, d), wmat);
  walls.position.y = h / 2;
  walls.castShadow = false;
  g.add(walls);
  return { group: g, floor };
}

/** Solid back wall for venues — sits behind the LED Wall area so the
 *  user's screens read against a definite surface rather than open
 *  scenery. Width × height in meters, positioned at world Z. */
function backWall(w: number, h: number, z: number): THREE.Mesh {
  const wall = mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ color: 0x070b12, roughness: 0.95, metalness: 0.05 }),
  );
  wall.position.set(0, h / 2, z);
  return wall;
}

function buildArena(): VenueBuild {
  const group = new THREE.Group();
  const r = room(180, 180, 55, 0x0d1016, 0x0a0c10);
  group.add(r.group);
  group.add(backWall(60, 30, -11));
  const sm = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.9 });
  for (let ri = 0; ri < 3; ri++) {
    const ring = mesh(new THREE.TorusGeometry(60 + ri * 12, 5, 4, 40), sm);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 4 + ri * 4;
    ring.scale.z = 0.4;
    group.add(ring);
  }

  // Simple deck so the LED wall hangs over something.
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.7, metalness: 0.2 });
  const deck = mesh(new THREE.BoxGeometry(30, 1.4, 14), deckMat);
  deck.position.set(0, 0.7, -4);
  group.add(deck);

  const hemi = new THREE.HemisphereLight(0xbcd0ee, 0x10131a, 0.3);
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(40, 70, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { near: 1, far: 200, left: -80, right: 80, top: 80, bottom: -80 });
  key.shadow.camera.updateProjectionMatrix();
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.22);
  fill.position.set(-50, 30, 20);

  const lights = [hemi, key, fill];
  return {
    group,
    floor: r.floor,
    lights,
    baselineIntensities: lights.map(l => l.intensity),
    keyLight: key,
    keyPositionBaseline: [key.position.x, key.position.y, key.position.z],
    keyColorBaseline: key.color.getHex(),
    backgroundColor: '#07090d',
    fogDensity: 0.006,
    fogColor: '#07090d',
    showGrid: true,
    cameraPosition: [28, 22, 40],
    cameraTarget: [0, 4, -2],
    ledWall: { centerX: 0, centerY: 7.5, centerZ: -9, width: 22, height: 12 },
    stageW: 30,
    frontZ: 6,
    bloomStrength: 0,
    exposure: 1.0,
  };
}

function buildClub(): VenueBuild {
  const group = new THREE.Group();
  const r = room(64, 52, 15, 0x140f1a, 0x0c0a10);
  group.add(r.group);
  group.add(backWall(40, 14, -17));
  for (let i = -1; i <= 1; i++) {
    const t = buildTruss(60);
    t.position.set(0, 13.5, i * 14);
    group.add(t);
  }
  const bar = mesh(
    new THREE.BoxGeometry(18, 1.2, 2),
    new THREE.MeshStandardMaterial({ color: 0x1a1420, roughness: 0.7 }),
  );
  bar.position.set(-20, 0.6, 18);
  group.add(bar);

  const hemi = new THREE.HemisphereLight(0xbcd0ee, 0x10131a, 0.28);
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(20, 30, 20);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { near: 1, far: 100, left: -40, right: 40, top: 40, bottom: -40 });
  key.shadow.camera.updateProjectionMatrix();
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.18);
  fill.position.set(-30, 20, 10);

  const lights = [hemi, key, fill];
  return {
    group,
    floor: r.floor,
    lights,
    baselineIntensities: lights.map(l => l.intensity),
    keyLight: key,
    keyPositionBaseline: [key.position.x, key.position.y, key.position.z],
    keyColorBaseline: key.color.getHex(),
    backgroundColor: '#0a0810',
    fogDensity: 0.011,
    fogColor: '#0a0810',
    showGrid: true,
    cameraPosition: [22, 14, 24],
    cameraTarget: [0, 3, -10],
    ledWall: { centerX: 0, centerY: 4.5, centerZ: -15, width: 12, height: 7 },
    stageW: 18,
    frontZ: 5,
    bloomStrength: 0,
    exposure: 1.0,
  };
}

function buildNightclub(): VenueBuild {
  const group = new THREE.Group();
  const r = room(46, 42, 9.5, 0x110a16, 0x0a070e);
  group.add(r.group);
  group.add(backWall(34, 9, -17.5));
  for (let i = -2; i <= 2; i++) {
    const t = buildTruss(44);
    t.position.set(0, 8.6, i * 8);
    group.add(t);
  }
  for (let i = -2; i <= 2; i++) {
    const t = buildTruss(40);
    t.rotation.y = Math.PI / 2;
    t.position.set(i * 9, 8.6, 0);
    group.add(t);
  }
  const danceFloor = mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({
      color: 0x1a1130, roughness: 0.3, metalness: 0.5, emissive: 0x140a26, emissiveIntensity: 0.3,
    }),
  );
  danceFloor.rotation.x = -Math.PI / 2;
  danceFloor.position.set(0, 0.02, 4);
  group.add(danceFloor);

  const hemi = new THREE.HemisphereLight(0xbcd0ee, 0x10131a, 0.18);
  const key = new THREE.DirectionalLight(0xffffff, 0.4);
  key.position.set(10, 20, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { near: 1, far: 60, left: -30, right: 30, top: 30, bottom: -30 });
  key.shadow.camera.updateProjectionMatrix();
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.14);
  fill.position.set(-20, 15, 5);

  const lights = [hemi, key, fill];
  return {
    group,
    floor: r.floor,
    lights,
    baselineIntensities: lights.map(l => l.intensity),
    keyLight: key,
    keyPositionBaseline: [key.position.x, key.position.y, key.position.z],
    keyColorBaseline: key.color.getHex(),
    backgroundColor: '#070509',
    fogDensity: 0.02,
    fogColor: '#070509',
    showGrid: false,
    cameraPosition: [16, 10, 18],
    cameraTarget: [0, 2, -8],
    ledWall: { centerX: 0, centerY: 3.5, centerZ: -16, width: 10, height: 5.5 },
    stageW: 14,
    frontZ: 4,
    bloomStrength: 0,
    exposure: 1.0,
  };
}

const BUILDERS: Record<Stage3DVenue, () => VenueBuild> = {
  festival: buildFestival,
  arena: buildArena,
  club: buildClub,
  nightclub: buildNightclub,
};

export function buildVenue(name: Stage3DVenue): VenueBuild {
  return (BUILDERS[name] ?? BUILDERS.festival)();
}

// ── PA presets ─────────────────────────────────────────────────────────

import { makeUserElement } from './elementTypes';
import type { UserStageElement } from './types';

export type PAPreset = 'linearray' | 'festivalpa' | 'groundstack' | 'club' | 'nightclub';

export function paPresetElements(kind: PAPreset, venue: VenueBuild): UserStageElement[] {
  const W = venue.stageW;
  const fz = venue.frontZ;
  const out: UserStageElement[] = [];
  const place = (el: UserStageElement, pos: [number, number, number], rotY = 0): UserStageElement => {
    el.position = pos;
    el.rotationY = rotY;
    return el;
  };
  if (kind === 'linearray') {
    out.push(place(makeUserElement('linearray', { boxes: 6, splay: 3 }), [-(W / 2 + 3), 14, fz]));
    out.push(place(makeUserElement('linearray', { boxes: 6, splay: 3 }), [ (W / 2 + 3), 14, fz]));
  } else if (kind === 'festivalpa') {
    out.push(place(makeUserElement('linearray', { boxes: 8, splay: 2.5 }), [-(W / 2 + 4), 17, fz]));
    out.push(place(makeUserElement('linearray', { boxes: 8, splay: 2.5 }), [ (W / 2 + 4), 17, fz]));
    out.push(place(makeUserElement('subarray',  { count: 6, stack: 1 }),    [-8, 0, fz + 1]));
    out.push(place(makeUserElement('subarray',  { count: 6, stack: 1 }),    [ 8, 0, fz + 1]));
    out.push(place(makeUserElement('tower',     { h: 16 }),                 [-(W / 2 + 18), 0, fz + 30]));
    out.push(place(makeUserElement('tower',     { h: 16 }),                 [ (W / 2 + 18), 0, fz + 30]));
  } else if (kind === 'groundstack') {
    out.push(place(makeUserElement('subarray',    { count: 2, stack: 1 }), [-(W / 2 + 2), 0,   fz]));
    out.push(place(makeUserElement('subarray',    { count: 2, stack: 1 }), [ (W / 2 + 2), 0,   fz]));
    out.push(place(makeUserElement('pointsource', { sub: 0 }),             [-(W / 2 + 2), 2.8, fz]));
    out.push(place(makeUserElement('pointsource', { sub: 0 }),             [ (W / 2 + 2), 2.8, fz]));
  } else if (kind === 'club') {
    out.push(place(makeUserElement('pointsource', { sub: 1 }), [-(W / 2 + 2), 0, fz]));
    out.push(place(makeUserElement('pointsource', { sub: 1 }), [ (W / 2 + 2), 0, fz]));
  } else if (kind === 'nightclub') {
    out.push(place(makeUserElement('subarray',    { count: 2, stack: 2 }), [-7, 0, -12]));
    out.push(place(makeUserElement('subarray',    { count: 2, stack: 2 }), [ 7, 0, -12]));
    out.push(place(makeUserElement('pointsource', { sub: 0 }),             [-9, 0,  -2]));
    out.push(place(makeUserElement('pointsource', { sub: 0 }),             [ 9, 0,  -2]));
    out.push(place(makeUserElement('pointsource', { sub: 0 }),             [-9, 0,  10]));
    out.push(place(makeUserElement('pointsource', { sub: 0 }),             [ 9, 0,  10]));
  }
  return out;
}
