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
  cameraFov?: number;
  resetCameraOnLoad?: boolean;
  lockScreenTransforms?: boolean;
  lockedSceneryIds?: string[];
  /** Optional default transform for auto-built screen meshes. Sphere
   *  uses this to bake the calibrated dome placement independently of
   *  whichever screen-layer id exists in the current project. */
  defaultScreenTransform?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
  };
  /** Optional venue-specific navigation limits for OrbitControls. */
  cameraBounds?: {
    minX?: number;
    maxX?: number;
    minY?: number;
    maxY?: number;
    minZ?: number;
    maxZ?: number;
    targetMinX?: number;
    targetMaxX?: number;
    targetMinY?: number;
    targetMaxY?: number;
    targetMinZ?: number;
    targetMaxZ?: number;
    minDistance?: number;
    maxDistance?: number;
  };
  /** LED Wall mounting region — auto-built screen meshes map onto this
   *  rectangle in world space. Width/height in meters. */
  ledWall: {
    centerX: number;
    centerY: number;
    centerZ: number;
    width: number;
    height: number;
  };
  /** LED Dome mounting region (sphere venue). When present, auto-built
   *  screens become TRUE spherical sectors on this dome's interior
   *  instead of flat planes on `ledWall`: each screen layer's 2D corner
   *  box maps onto the dome's angular extents (full-canvas screen =
   *  the whole dome; smaller screens tile it in angle space).
   *  Azimuth 0 faces the stage (-Z); the horizontal sweep is centred
   *  on it, so the uncovered gap faces the back of the bowl (+Z) —
   *  same as the real venue. Elevations in degrees above the horizon
   *  through the dome centre (negative dips below, 90 = zenith). */
  ledDome?: {
    centerX: number;
    centerY: number;
    centerZ: number;
    radius: number;
    hSweepDeg: number;
    vStartDeg: number;
    vEndDeg: number;
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

/** Tag an object with a sceneryId so the renderer's raycast picks it
 *  up and the designer tree lists it as a movable/hidable piece. */
function tagged(obj: THREE.Object3D, id: string): THREE.Object3D {
  obj.userData.sceneryId = id;
  return obj;
}

/** Wrap a leaf mesh in a sceneryId-tagged group (groups gizmo-attach
 *  cleanly; bare meshes with shared geometry don't). */
function wrapped(obj: THREE.Object3D, id: string): THREE.Group {
  const g = new THREE.Group();
  g.userData.sceneryId = id;
  g.add(obj);
  return g;
}

/** Stage PAR can — compact fixture for club-scale rigs. Same look as
 *  the festival deck PARs but reusable at any position/aim. */
function makePar(x: number, y: number, z: number, tiltX = -0.5): THREE.Group {
  const g = new THREE.Group();
  const can = mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.42, 12),
    new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.6, metalness: 0.6 }),
  );
  can.rotation.x = tiltX;
  g.add(can);
  const lens = mesh(
    new THREE.CircleGeometry(0.2, 14),
    new THREE.MeshStandardMaterial({ color: 0x06070b, roughness: 0.2, metalness: 0.5 }),
  );
  lens.position.set(0, Math.cos(tiltX) * 0.22, Math.sin(-tiltX) * 0.22);
  lens.rotation.x = tiltX - Math.PI / 2;
  g.add(lens);
  g.position.set(x, y, z);
  return g;
}

/** Festival-style stage deck + polished edge trim, reused by every
 *  venue that has a band/DJ stage so they all share the same premium
 *  finish (dark deck, brushed-metal lip). */
function makeDeck(w: number, d: number, h: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.7, metalness: 0.2 });
  const deck = mesh(new THREE.BoxGeometry(w, h, d), deckMat);
  deck.position.set(0, h / 2, z);
  g.add(deck);
  const edge = mesh(
    new THREE.BoxGeometry(w + 0.2, 0.14, d + 0.2),
    new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.4, metalness: 0.8 }),
  );
  edge.position.set(0, h + 0.07, z);
  g.add(edge);
  return g;
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
  // Length + orientation hints for the atmosphere rig's LED strips.
  g.userData.trussLen = len;
  g.userData.trussVertical = vertical;
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
  // Expose the articulation + rest pose so the atmosphere rig can
  // drive real pan/tilt (and parent beam cones to the head).
  g.userData.moverYoke = yoke;
  g.userData.moverHead = head;
  g.userData.moverRest = { pan, tilt };
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
	    new THREE.PlaneGeometry(42, 24),
	    new THREE.MeshStandardMaterial({
	      color: 0x000000, roughness: 1, metalness: 0,
	      envMapIntensity: 0,
	    }),
	  );
	  backdrop.position.set(0, 12, -16);
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
	  const TRUSS_TOP_Y = 20;       // height of every top chord
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
	      const m = makeMover(sx, 5.2 + i * 5.2, 0, 0.3, sx < 0 ? 0.6 : -0.6);
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
	  stackL.position.set(-17.5, 15.8, 1);
	  stackL.userData.sceneryId = 'pa-L';
	  group.add(stackL);
	  const stackR = buildSpeakerStack();
	  stackR.position.set(17.5, 15.8, 1);
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
	    cameraPosition: [0, 10.5, 44],
	    cameraTarget: [0, 7, -6],
	    ledWall: { centerX: 0, centerY: 9.7, centerZ: -14.4, width: 28, height: 15.75 },
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
  // Walls + ceiling as individual inward-facing planes. The previous
  // BackSide box included a BOTTOM face exactly coplanar with the
  // floor plane — the two z-fought and the whole floor flickered.
  const wmat = new THREE.MeshStandardMaterial({
    color: wallColor, roughness: 0.9, metalness: 0.05,
  });
  const addWall = (pw: number, ph: number, pos: [number, number, number], rotY: number) => {
    const wall = mesh(new THREE.PlaneGeometry(pw, ph), wmat);
    wall.position.set(...pos);
    wall.rotation.y = rotY;
    wall.castShadow = false;
    g.add(wall);
  };
  addWall(w, h, [0, h / 2, -d / 2], 0);            // back
  addWall(w, h, [0, h / 2, d / 2], Math.PI);       // front
  addWall(d, h, [-w / 2, h / 2, 0], Math.PI / 2);  // left
  addWall(d, h, [w / 2, h / 2, 0], -Math.PI / 2);  // right
  const ceiling = mesh(new THREE.PlaneGeometry(w, d), wmat);
  ceiling.position.y = h;
  ceiling.rotation.x = Math.PI / 2;
  ceiling.castShadow = false;
  g.add(ceiling);
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

/** Arena — indoor bowl in an end-stage concert configuration. Raked
 *  lower + upper seating bowls (same stepped-tier builder as the
 *  Sphere) wrap the floor; the stage gets the festival-grade deck,
 *  truss rig with movers, flown line arrays, and a backdrop so the
 *  LED wall reads against a definite surface. */
function buildArena(): VenueBuild {
  const group = new THREE.Group();

  const STAGE_Z = -8;        // deck center
  const BOWL_ARC_Z = -14;    // seating curves around the stage end

  // ── Shell — cylindrical wall + ceiling disk instead of a giant box,
  //    so every sightline ends on a curved arena wall, not a corner. ──
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x0c0f15, roughness: 0.95, metalness: 0.05, side: THREE.BackSide,
  });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(86, 86, 30, 48, 1, true), shellMat);
  shell.position.y = 15;
  shell.castShadow = false;
  shell.receiveShadow = true;
  group.add(shell);
  const ceiling = new THREE.Mesh(
    new THREE.CircleGeometry(86, 48),
    new THREE.MeshStandardMaterial({ color: 0x080a0f, roughness: 1, metalness: 0 }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = 30;
  ceiling.castShadow = false;
  group.add(ceiling);

  const floor = mesh(
    new THREE.CircleGeometry(86, 48),
    new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.55, metalness: 0.25 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ── Seating — lower + upper bowls with a concourse gap, arcing
  //    around the stage so the whole room faces the show. ──
  const lower = buildBowlTier(BOWL_ARC_Z, 30, 0.4, 11, 1.7, 0.78, 78);
  group.add(wrapped(lower, 'bowl-lower'));
  const upperStart = 30 + 11 * 1.7 + 3.2; // concourse walkway between bowls
  const upper = buildBowlTier(BOWL_ARC_Z, upperStart, 0.4 + 11 * 0.78 + 1.6, 12, 1.7, 0.88, 86);
  group.add(wrapped(upper, 'bowl-upper'));

  // ── Stage — festival-grade deck + riser + backdrop ──
  group.add(tagged(makeDeck(32, 16, 1.4, STAGE_Z), 'deck'));
  const riser = mesh(
    new THREE.BoxGeometry(9, 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.7, metalness: 0.2 }),
  );
  riser.position.set(0, 2.0, STAGE_Z - 4);
  group.add(wrapped(riser, 'riser'));
	  const backdrop = mesh(
	    new THREE.PlaneGeometry(40, 23),
	    new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0, envMapIntensity: 0 }),
	  );
	  backdrop.position.set(0, 11.5, STAGE_Z - 9.5);
  backdrop.castShadow = false;
  backdrop.receiveShadow = false;
  group.add(wrapped(backdrop, 'backdrop'));

  // ── Flown rig — front + back trusses over the deck with movers ──
	  const RIG_Y = 20.5;
  const frontTruss = festivalTruss(34);
  frontTruss.position.set(0, RIG_Y, STAGE_Z + 7);
  group.add(tagged(frontTruss, 'truss-front'));
  const backTruss = festivalTruss(34);
  backTruss.position.set(0, RIG_Y, STAGE_Z - 6);
  group.add(tagged(backTruss, 'truss-back'));
  for (let i = 0; i < 7; i++) {
    const m = makeMover(-14 + i * 4.7, RIG_Y - 0.55, STAGE_Z + 7, 0.6, (i - 3) * 0.06);
    m.userData.sceneryId = `mover-front-${i}`;
    group.add(m);
  }
  for (let i = 0; i < 6; i++) {
    const m = makeMover(-12.5 + i * 5, RIG_Y - 0.55, STAGE_Z - 6, -0.5, (i - 2.5) * 0.05);
    m.userData.sceneryId = `mover-back-${i}`;
    group.add(m);
  }

  // ── Flown line arrays L/R + delay hangs over the bowl ──
	  const paL = buildSpeakerStack();
	  paL.position.set(-19, 16.8, STAGE_Z + 9);
	  group.add(tagged(paL, 'pa-L'));
	  const paR = buildSpeakerStack();
	  paR.position.set(19, 16.8, STAGE_Z + 9);
  group.add(tagged(paR, 'pa-R'));
  for (const [sx, id] of [[-26, 'delay-L'], [26, 'delay-R']] as const) {
	    const delay = buildSpeakerStack();
	    delay.scale.setScalar(0.7);
	    delay.position.set(sx, 17.8, 22);
    delay.rotation.y = sx < 0 ? 0.5 : -0.5;
    group.add(tagged(delay, id));
  }

  // ── Lighting — dim house, show-ready ──
  const hemi = new THREE.HemisphereLight(0xa8c0e0, 0x0a0c12, 0.28);
  const ambient = new THREE.AmbientLight(0xffffff, 0.07);
  const key = new THREE.DirectionalLight(0xffffff, 0.65);
  key.position.set(30, 42, 36);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { near: 1, far: 200, left: -80, right: 80, top: 80, bottom: -80 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.2);
  fill.position.set(-50, 28, 20);
  const rim = new THREE.DirectionalLight(0xbfd0ee, 0.16);
  rim.position.set(0, 24, -60);

  const lights = [hemi, ambient, key, fill, rim];
  return {
    group,
    floor,
    lights,
    baselineIntensities: lights.map(l => l.intensity),
    keyLight: key,
    keyPositionBaseline: [key.position.x, key.position.y, key.position.z],
    keyColorBaseline: key.color.getHex(),
    backgroundColor: '#06080c',
    fogDensity: 0.005,
    fogColor: '#06080c',
    showGrid: false,
    // FOH-riser view from the arena floor — over the crowd, full rig
    // and both PA hangs in frame, seating bowls rising at the edges.
    // (Stay inside radius ~28 from the bowl arc center or the camera
    // ends up embedded in the seating tiers.)
	    cameraPosition: [9, 9, 28],
	    cameraTarget: [0, 8, STAGE_Z],
	    ledWall: { centerX: 0, centerY: 9.9, centerZ: STAGE_Z - 9.3, width: 26, height: 14.625 },
    stageW: 32,
    frontZ: STAGE_Z + 8,
    bloomStrength: 0,
    exposure: 1.0,
  };
}

/** Club — a ~1,200-cap live-music room. Proper raised stage with the
 *  festival deck finish, exposed overhead trusses with movers + PARs,
 *  a glowing bar along the left wall, support columns, and a raised
 *  mezzanine with rail across the back — the depth cues that make a
 *  mid-size room read as a real venue instead of a dark box. */
function buildClub(): VenueBuild {
  const group = new THREE.Group();
	  const W = 56, D = 44, H = 15;
  const STAGE_Z = -16;

  const r = room(W, D, H, 0x14101a, 0x0c0a10);
  group.add(r.group);
  group.add(wrapped(backWall(W, H, -(D / 2) + 0.2), 'back-wall'));

  // ── Stage — raised deck + riser, LED wall hangs above the deck ──
  group.add(tagged(makeDeck(22, 9, 1.2, STAGE_Z), 'deck'));
  const riser = mesh(
    new THREE.BoxGeometry(7, 0.9, 4),
    new THREE.MeshStandardMaterial({ color: 0x111419, roughness: 0.7, metalness: 0.2 }),
  );
  riser.position.set(0, 1.65, STAGE_Z - 2);
  group.add(wrapped(riser, 'riser'));

  // ── Overhead rig — stage truss + two room trusses, movers + PARs ──
	  const RIG_Y = H - 1.2;
  const stageTruss = festivalTruss(26);
  stageTruss.position.set(0, RIG_Y, STAGE_Z + 3);
  group.add(tagged(stageTruss, 'truss-stage'));
  const midTruss = festivalTruss(40);
  midTruss.position.set(0, RIG_Y, -2);
  group.add(tagged(midTruss, 'truss-mid'));
  const frontTruss = festivalTruss(40);
  frontTruss.position.set(0, RIG_Y, 10);
  group.add(tagged(frontTruss, 'truss-front'));
  for (let i = 0; i < 5; i++) {
    const m = makeMover(-9 + i * 4.5, RIG_Y - 0.55, STAGE_Z + 3, 0.55, (i - 2) * 0.08);
    m.userData.sceneryId = `mover-stage-${i}`;
    group.add(m);
  }
  for (let i = 0; i < 4; i++) {
    const m = makeMover(-10.5 + i * 7, RIG_Y - 0.55, -2, -0.15, (i - 1.5) * 0.1);
    m.userData.sceneryId = `mover-floor-${i}`;
    group.add(m);
  }
  for (let i = 0; i < 6; i++) {
    const par = makePar(-10 + i * 4, RIG_Y - 0.4, 10, -0.65);
    par.userData.sceneryId = `par-front-${i}`;
    group.add(par);
  }

  // ── Bar along the left wall — counter, glowing service strip,
  //    back-bar shelf with a soft amber wash ──
  const barGroup = new THREE.Group();
  barGroup.userData.sceneryId = 'bar';
  const counter = mesh(
    new THREE.BoxGeometry(2, 1.15, 16),
    new THREE.MeshStandardMaterial({ color: 0x191320, roughness: 0.55, metalness: 0.25 }),
  );
  counter.position.set(-(W / 2) + 3.4, 0.575, 8);
  barGroup.add(counter);
  const barStrip = mesh(
    new THREE.BoxGeometry(0.12, 0.06, 16),
    new THREE.MeshStandardMaterial({
      color: 0x110a16, emissive: 0xffa64d, emissiveIntensity: 1.6, roughness: 0.4,
    }),
  );
  barStrip.position.set(-(W / 2) + 4.42, 1.05, 8);
  barStrip.castShadow = false;
  barGroup.add(barStrip);
  const backBar = mesh(
    new THREE.BoxGeometry(0.5, 2.6, 16),
    new THREE.MeshStandardMaterial({
      color: 0x16101c, roughness: 0.6, metalness: 0.2,
      emissive: 0x462b10, emissiveIntensity: 0.6,
    }),
  );
  backBar.position.set(-(W / 2) + 0.6, 1.8, 8);
  barGroup.add(backBar);
  group.add(barGroup);

  // ── Mezzanine across the back — platform + rail ──
  const mezz = new THREE.Group();
  mezz.userData.sceneryId = 'mezzanine';
  const mezzFloor = mesh(
    new THREE.BoxGeometry(W - 4, 0.5, 6.5),
    new THREE.MeshStandardMaterial({ color: 0x120e18, roughness: 0.8, metalness: 0.1 }),
  );
  mezzFloor.position.set(0, 3.4, (D / 2) - 3.6);
  mezz.add(mezzFloor);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2a3138, roughness: 0.35, metalness: 0.85 });
  const rail = mesh(new THREE.BoxGeometry(W - 4, 0.07, 0.07), railMat);
  rail.position.set(0, 4.6, (D / 2) - 6.8);
  mezz.add(rail);
  for (let i = 0; i <= 12; i++) {
    const post = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 6), railMat);
    post.position.set(-(W - 4) / 2 + (i * (W - 4)) / 12, 4.13, (D / 2) - 6.8);
    mezz.add(post);
  }
  group.add(mezz);

  // ── Support columns — industrial depth cues mid-room ──
  for (const [cx, cz, i] of [[-16, 2, 0], [16, 2, 1], [-16, 14, 2], [16, 14, 3]] as const) {
    const col = mesh(
      new THREE.CylinderGeometry(0.45, 0.45, H, 12),
      new THREE.MeshStandardMaterial({ color: 0x171219, roughness: 0.85, metalness: 0.15 }),
    );
    col.position.set(cx, H / 2, cz);
    group.add(wrapped(col, `column-${i}`));
  }

  // ── Dance floor sheen in front of the stage ──
  const danceFloor = mesh(
    new THREE.PlaneGeometry(24, 16),
    // Soft sheen only — low roughness + high metalness threw a harsh
    // specular hotspot from the key light that read as a glitch.
    new THREE.MeshStandardMaterial({
      color: 0x110d18, roughness: 0.45, metalness: 0.3,
    }),
  );
  danceFloor.rotation.x = -Math.PI / 2;
  danceFloor.position.set(0, 0.05, -2);
  danceFloor.castShadow = false;
  group.add(wrapped(danceFloor, 'dance-floor'));

  // ── Lighting — warm-dark, stage-focused. A notch brighter than the
  //    festival baseline: a small room with bare walls needs its
  //    features (bar, mezzanine, columns) discernible at idle. ──
  const hemi = new THREE.HemisphereLight(0xb8a8d8, 0x0d0a12, 0.34);
  const ambient = new THREE.AmbientLight(0xffffff, 0.09);
  const key = new THREE.DirectionalLight(0xfff2e0, 0.5);
	  key.position.set(14, 22, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { near: 1, far: 100, left: -40, right: 40, top: 40, bottom: -40 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.16);
	  fill.position.set(-22, 18, 8);
	  const rim = new THREE.DirectionalLight(0xb39ddb, 0.14);
	  rim.position.set(0, 16, -26);

  const lights = [hemi, ambient, key, fill, rim];
  return {
    group,
    floor: r.floor,
    lights,
    baselineIntensities: lights.map(l => l.intensity),
    keyLight: key,
    keyPositionBaseline: [key.position.x, key.position.y, key.position.z],
    keyColorBaseline: key.color.getHex(),
    backgroundColor: '#0a0810',
    fogDensity: 0.012,
    fogColor: '#0a0810',
    showGrid: false,
    // Three-quarter house view — stage + LED framed center, bar wall
    // on the left, mezzanine rail catching the edge of frame.
	    cameraPosition: [14, 8.5, 17],
	    cameraTarget: [-2, 4.3, STAGE_Z],
	    ledWall: { centerX: 0, centerY: 6.9, centerZ: -(D / 2) + 0.45, width: 16, height: 9 },
    stageW: 22,
    frontZ: STAGE_Z + 5.5,
    bloomStrength: 0.08,
    exposure: 1.0,
  };
}

/** Nightclub — an intimate underground electronic room. The DJ booth
 *  is the focal point (raised platform, console, glowing booth front,
 *  sub stacks flanking), with the LED wall directly behind it. Mirror
 *  ball over the dance floor, banquette seating along the side walls,
 *  a back bar with amber glow, and dense laser-ready haze. */
function buildNightclub(): VenueBuild {
  const group = new THREE.Group();
	  const W = 40, D = 36, H = 12;
  const BOOTH_Z = -13;

  const r = room(W, D, H, 0x110a16, 0x0a070e);
  group.add(r.group);
  group.add(wrapped(backWall(W, H, -(D / 2) + 0.2), 'back-wall'));

  // ── DJ booth — the centerpiece ──
  const booth = new THREE.Group();
  booth.userData.sceneryId = 'dj-booth';
  const boothMat = new THREE.MeshStandardMaterial({ color: 0x101319, roughness: 0.7, metalness: 0.2 });
  const plinth = mesh(new THREE.BoxGeometry(9, 0.7, 4), boothMat);
  plinth.position.set(0, 0.35, BOOTH_Z);
  booth.add(plinth);
  // Console desk on the plinth
  const desk = mesh(new THREE.BoxGeometry(5.2, 1.05, 1.5), boothMat);
  desk.position.set(0, 1.225, BOOTH_Z + 0.6);
  booth.add(desk);
  const deskTop = mesh(
    new THREE.BoxGeometry(5.3, 0.07, 1.6),
    new THREE.MeshStandardMaterial({ color: 0x262c36, roughness: 0.35, metalness: 0.85 }),
  );
  deskTop.position.set(0, 1.79, BOOTH_Z + 0.6);
  booth.add(deskTop);
  // Glowing booth front — the classic club cue
  const boothFront = mesh(
    new THREE.PlaneGeometry(5.2, 0.95),
    new THREE.MeshStandardMaterial({
      color: 0x0a0710, emissive: 0x8a2be2, emissiveIntensity: 1.1, roughness: 0.5,
    }),
  );
  boothFront.position.set(0, 1.25, BOOTH_Z + 1.42);
  boothFront.castShadow = false;
  booth.add(boothFront);
  // Monitor wedges either side of the desk
  for (const dx of [-3.3, 3.3]) {
    const wedge = mesh(new THREE.BoxGeometry(1, 0.8, 0.9), boothMat);
    wedge.position.set(dx, 1.1, BOOTH_Z + 0.6);
    wedge.rotation.z = dx < 0 ? 0.18 : -0.18;
    booth.add(wedge);
  }
  group.add(booth);

  // ── Sub stacks flanking the booth ──
  const subMat = new THREE.MeshStandardMaterial({ color: 0x070809, roughness: 0.85, metalness: 0.1 });
  const subConeMat = new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.5 });
  for (const [sx, id] of [[-6.5, 'subs-L'], [6.5, 'subs-R']] as const) {
    const stack = new THREE.Group();
    stack.userData.sceneryId = id;
    for (let i = 0; i < 2; i++) {
      const sub = mesh(new THREE.BoxGeometry(1.7, 1.1, 1.5), subMat);
      sub.position.set(sx, 0.55 + i * 1.15, BOOTH_Z);
      stack.add(sub);
      const cone = mesh(new THREE.CircleGeometry(0.42, 18), subConeMat);
      cone.position.set(sx, 0.55 + i * 1.15, BOOTH_Z + 0.76);
      stack.add(cone);
    }
    group.add(stack);
  }

  // ── Dance floor — reflective slab with a cool under-glow ──
  const danceFloor = mesh(
    new THREE.PlaneGeometry(18, 16),
    new THREE.MeshStandardMaterial({
      color: 0x161028, roughness: 0.22, metalness: 0.55,
      emissive: 0x10081f, emissiveIntensity: 0.35,
    }),
  );
  danceFloor.rotation.x = -Math.PI / 2;
  danceFloor.position.set(0, 0.05, -1);
  danceFloor.castShadow = false;
  group.add(wrapped(danceFloor, 'dance-floor'));

  // ── Mirror ball over the floor — faceted, catches the movers ──
  const ballGroup = new THREE.Group();
  ballGroup.userData.sceneryId = 'mirror-ball';
  const wire = mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x222630, roughness: 0.5, metalness: 0.8 }),
  );
  wire.position.set(0, H - 0.6, -1);
  wire.castShadow = false;
  ballGroup.add(wire);
  const ball = mesh(
    new THREE.IcosahedronGeometry(0.8, 1),
    new THREE.MeshStandardMaterial({
      color: 0xd8e2f0, roughness: 0.12, metalness: 1.0, flatShading: true,
      emissive: 0x39414f, emissiveIntensity: 0.5,
    }),
  );
  ball.position.set(0, H - 2.0, -1);
  ballGroup.add(ball);
  group.add(ballGroup);

  // ── Overhead rig — two trusses with floor-aimed movers + booth PARs ──
	  const RIG_Y = H - 1.1;
  const boothTruss = festivalTruss(20);
  boothTruss.position.set(0, RIG_Y, BOOTH_Z + 4);
  group.add(tagged(boothTruss, 'truss-booth'));
  const floorTruss = festivalTruss(26);
  floorTruss.position.set(0, RIG_Y, 4);
  group.add(tagged(floorTruss, 'truss-floor'));
  for (let i = 0; i < 4; i++) {
    const m = makeMover(-7.5 + i * 5, RIG_Y - 0.55, 4, -0.25, (i - 1.5) * 0.12);
    m.userData.sceneryId = `mover-floor-${i}`;
    group.add(m);
  }
  for (let i = 0; i < 3; i++) {
    const m = makeMover(-5 + i * 5, RIG_Y - 0.55, BOOTH_Z + 4, 0.5, (i - 1) * 0.1);
    m.userData.sceneryId = `mover-booth-${i}`;
    group.add(m);
  }
  for (let i = 0; i < 4; i++) {
    const par = makePar(-4.5 + i * 3, RIG_Y - 0.4, BOOTH_Z + 4.4, -0.8);
    par.userData.sceneryId = `par-booth-${i}`;
    group.add(par);
  }

  // ── Banquette seating along both side walls ──
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1c0f14, roughness: 0.9, metalness: 0.02 });
  for (const [sx, id] of [[-(W / 2) + 1.6, 'banquette-L'], [(W / 2) - 1.6, 'banquette-R']] as const) {
    const bq = new THREE.Group();
    bq.userData.sceneryId = id;
    const seat = mesh(new THREE.BoxGeometry(1.9, 0.55, 14), seatMat);
    seat.position.set(sx, 0.275, -1);
    bq.add(seat);
    const backRest = mesh(new THREE.BoxGeometry(0.45, 1.5, 14), seatMat);
    backRest.position.set(sx < 0 ? sx - 0.72 : sx + 0.72, 0.75, -1);
    bq.add(backRest);
    group.add(bq);
  }

  // ── Back bar with amber glow strip ──
  const barGroup = new THREE.Group();
  barGroup.userData.sceneryId = 'bar';
  const counter = mesh(
    new THREE.BoxGeometry(12, 1.1, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x191320, roughness: 0.55, metalness: 0.25 }),
  );
  counter.position.set(0, 0.55, (D / 2) - 2.6);
  barGroup.add(counter);
  const barStrip = mesh(
    new THREE.BoxGeometry(12, 0.06, 0.12),
    new THREE.MeshStandardMaterial({
      color: 0x110a16, emissive: 0xffa64d, emissiveIntensity: 1.5, roughness: 0.4,
    }),
  );
  barStrip.position.set(0, 1.02, (D / 2) - 3.48);
  barStrip.castShadow = false;
  barGroup.add(barStrip);
  group.add(barGroup);

  // ── Lighting — near-dark; the booth glow + LEDs carry the room ──
  const hemi = new THREE.HemisphereLight(0x9d8fc8, 0x0a070e, 0.16);
  const ambient = new THREE.AmbientLight(0xffffff, 0.04);
  const key = new THREE.DirectionalLight(0xe8d8ff, 0.32);
	  key.position.set(8, 18, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { near: 1, far: 60, left: -30, right: 30, top: 30, bottom: -30 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.1);
	  fill.position.set(-16, 13, 5);

  const lights = [hemi, ambient, key, fill];
  return {
    group,
    floor: r.floor,
    lights,
    baselineIntensities: lights.map(l => l.intensity),
    keyLight: key,
    keyPositionBaseline: [key.position.x, key.position.y, key.position.z],
    keyColorBaseline: key.color.getHex(),
    backgroundColor: '#070509',
    fogDensity: 0.022,
    fogColor: '#070509',
    showGrid: false,
    // Eye-level from the dance floor, booth + wall framed center.
	    cameraPosition: [6, 4, 10],
	    cameraTarget: [0, 3, BOOTH_Z],
	    ledWall: { centerX: 0, centerY: 5.2, centerZ: -(D / 2) + 0.45, width: 13, height: 7.3125 },
    stageW: 14,
    frontZ: BOOTH_Z + 3,
    bloomStrength: 0.12,
    exposure: 1.0,
  };
}

// ── Sphere (immersive dome — Las Vegas Sphere-style) ───────────────────

/**
 * One seating tier: a stepped arc band (riser face + tread per row),
 * built as a single BufferGeometry so a whole tier is one draw call.
 * Rows curve around `arcCenter` (the stage), opening toward +Z, with
 * 3°-wide aisle gaps splitting the arc into 4 seating sections.
 */
function buildBowlTier(
  arcCenterZ: number,
  startRadius: number,
  startY: number,
  rows: number,
  rowDepth: number,
  rowRise: number,
  arcHalfDeg: number,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const aisleDeg = 3;
  const sections = 4;
  const sectionDeg = (arcHalfDeg * 2 - aisleDeg * (sections - 1)) / sections;
  const segsPerSection = 12;

  const pushQuadStrip = (
    a0: number, a1: number,
    rInner: number, rOuter: number,
    yLow: number, yHigh: number,
  ) => {
    // One row = riser face (vertical, at rInner) + tread (horizontal,
    // rInner→rOuter at yHigh). Both share the arc tessellation.
    for (const [ra, rb, ya, yb] of [
      [rInner, rInner, yLow, yHigh],   // riser
      [rInner, rOuter, yHigh, yHigh],  // tread
    ] as const) {
      const base = positions.length / 3;
      for (let s = 0; s <= segsPerSection; s++) {
        const az = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * s) / segsPerSection);
        const sin = Math.sin(az), cos = Math.cos(az);
        positions.push(ra * sin, ya, arcCenterZ + ra * cos);
        positions.push(rb * sin, yb, arcCenterZ + rb * cos);
      }
      for (let s = 0; s < segsPerSection; s++) {
        const i = base + s * 2;
        indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
  };

  for (let row = 0; row < rows; row++) {
    const rIn = startRadius + row * rowDepth;
    const yLow = startY + row * rowRise;
    for (let sec = 0; sec < sections; sec++) {
      const a0 = -arcHalfDeg + sec * (sectionDeg + aisleDeg);
      pushQuadStrip(a0, a0 + sectionDeg, rIn, rIn + rowDepth, yLow, yLow + rowRise);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const m = mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x191c24, roughness: 0.92, metalness: 0.05,
  }));
  m.castShadow = false; // 4 tiers × full arc would dominate the shadow map
  return m;
}

function buildBowlTierShell(
  arcCenterZ: number,
  startRadius: number,
  startY: number,
  rows: number,
  rowDepth: number,
  rowRise: number,
  arcHalfDeg: number,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const segments = Math.max(32, Math.ceil(arcHalfDeg * 0.7));
  const innerR = Math.max(0.1, startRadius - 0.28);
  const outerR = startRadius + rows * rowDepth + 0.45;
  const yFront = Math.max(0.08, startY - 0.18);
  const yBack = startY + rows * rowRise + 0.28;
  const yFloor = 0.02;

  for (let s = 0; s <= segments; s++) {
    const az = THREE.MathUtils.degToRad(-arcHalfDeg + (arcHalfDeg * 2 * s) / segments);
    const sin = Math.sin(az), cos = Math.cos(az);
    positions.push(innerR * sin, yFloor, arcCenterZ + innerR * cos);
    positions.push(outerR * sin, yFloor, arcCenterZ + outerR * cos);
    positions.push(innerR * sin, yFront, arcCenterZ + innerR * cos);
    positions.push(outerR * sin, yBack, arcCenterZ + outerR * cos);
  }

  for (let s = 0; s < segments; s++) {
    const i = s * 4;
    const n = i + 4;
    // Sloped structural mass under the seating rake.
    indices.push(i + 2, i + 3, n + 2, i + 3, n + 3, n + 2);
    // Front and back walls make the tier read as a solid black riser.
    indices.push(i, n, i + 2, n, n + 2, i + 2);
    indices.push(i + 1, i + 3, n + 1, i + 3, n + 3, n + 1);
    // Bottom cap prevents see-through angles from low camera positions.
    indices.push(i, i + 1, n, i + 1, n + 1, n);
  }
  const last = segments * 4;
  indices.push(0, 2, 1, 1, 2, 3);
  indices.push(last, last + 1, last + 2, last + 1, last + 3, last + 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const shell = mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x020305,
    roughness: 0.86,
    metalness: 0.08,
    side: THREE.DoubleSide,
  }));
  shell.castShadow = false;
  return shell;
}

function buildArcBand(
  arcCenterZ: number,
  radius: number,
  y: number,
  height: number,
  depth: number,
  arcHalfDeg: number,
  material: THREE.Material,
): THREE.Mesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const segments = Math.max(36, Math.ceil(arcHalfDeg * 0.75));
  const innerR = radius;
  const outerR = radius + depth;
  const y0 = y;
  const y1 = y + height;

  for (let s = 0; s <= segments; s++) {
    const az = THREE.MathUtils.degToRad(-arcHalfDeg + (arcHalfDeg * 2 * s) / segments);
    const sin = Math.sin(az), cos = Math.cos(az);
    positions.push(innerR * sin, y0, arcCenterZ + innerR * cos);
    positions.push(outerR * sin, y0, arcCenterZ + outerR * cos);
    positions.push(innerR * sin, y1, arcCenterZ + innerR * cos);
    positions.push(outerR * sin, y1, arcCenterZ + outerR * cos);
  }

  for (let s = 0; s < segments; s++) {
    const i = s * 4;
    const n = i + 4;
    indices.push(i, i + 2, n, i + 2, n + 2, n); // inner face
    indices.push(i + 1, n + 1, i + 3, i + 3, n + 1, n + 3); // outer face
    indices.push(i + 2, i + 3, n + 2, i + 3, n + 3, n + 2); // top
    indices.push(i, n, i + 1, i + 1, n, n + 1); // bottom
  }
  const last = segments * 4;
  indices.push(0, 1, 2, 1, 3, 2);
  indices.push(last, last + 2, last + 1, last + 1, last + 2, last + 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  if (!Array.isArray(material)) {
    material.side = THREE.DoubleSide;
    material.needsUpdate = true;
  }
  const band = mesh(geo, material);
  band.castShadow = false;
  return band;
}

function buildSphere(): VenueBuild {
  const group = new THREE.Group();
  const wrap = (obj: THREE.Object3D, id: string): THREE.Group => {
    const g = new THREE.Group();
    g.userData.sceneryId = id;
    g.add(obj);
    return g;
  };

  // Proportions scaled from Sphere's broad, low spherical shell and
  // 240-foot interior media plane: wide immersive dome, compact stage,
  // steep one-directional seating bowl.
  const DOME = { centerX: 0, centerY: 9, centerZ: 7, radius: 58, hSweepDeg: 190, vStartDeg: 0, vEndDeg: 88 };
  const DOME_SCREEN_TRANSFORM = {
    position: [0, 1.4382488741229977, 7] as [number, number, number],
    rotation: [0, 0, 0] as [number, number, number],
    scale: [1.3762535407255738, 1.3762535407255738, 1.3762535407255738] as [number, number, number],
  };
  const STAGE_Z = -48;       // low stage island tight to the dome's -Z rim
  const STAGE_OFFSET_Z = -14.800079437966918;
  const BOWL_ARC_Z = -34;    // bowl rows curve around the stage

  // ── Floor — dark disk under the whole bowl ──
  const floor = mesh(
    new THREE.CircleGeometry(84, 80),
    new THREE.MeshStandardMaterial({ color: 0x07080d, roughness: 0.7, metalness: 0.15 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // ── Stage — wide low platform, deliberately understated (the screen
  //    is the scenery; the real venue's stage reads as an island) ──
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x101319, roughness: 0.7, metalness: 0.2 });
  const stageGroup = new THREE.Group();
  stageGroup.userData.sceneryId = 'stage';
  const deck = mesh(new THREE.BoxGeometry(22, 1.1, 9.5), deckMat);
  deck.position.set(0, 0.62, STAGE_Z);
  stageGroup.add(deck);
  const deckEdge = mesh(
    new THREE.BoxGeometry(22.2, 0.12, 9.7),
    new THREE.MeshStandardMaterial({ color: 0x262c36, roughness: 0.4, metalness: 0.8 }),
  );
  deckEdge.position.set(0, 1.2, STAGE_Z);
  stageGroup.add(deckEdge);
  stageGroup.position.set(0, 0, STAGE_OFFSET_Z);
  group.add(stageGroup);

  // ── Seating bowl — 4 steeply-raked one-directional tiers (~26° rake,
  //    everyone faces the stage; NOT 360°), widening as they climb so
  //    the upper tiers wrap further around. The bowl is fixed venue
  //    architecture, not an editable scenery piece. ──
  const tiers: { rows: number; arcHalf: number }[] = [
    { rows: 8, arcHalf: 47 },
    { rows: 8, arcHalf: 54 },
    { rows: 7, arcHalf: 60 },
    { rows: 6, arcHalf: 64 },
  ];
  const rowDepth = 1.45;
  const rowRise = 0.9;
  let tierRadius = 12.4;
  let tierY = 0.3;
  tiers.forEach((t, i) => {
    const tierGroup = new THREE.Group();
    tierGroup.add(buildBowlTierShell(BOWL_ARC_Z, tierRadius, tierY, t.rows, rowDepth, rowRise, t.arcHalf + 1.2));
    tierGroup.add(buildBowlTier(BOWL_ARC_Z, tierRadius, tierY, t.rows, rowDepth, rowRise, t.arcHalf));
    group.add(tierGroup);

    const endRadius = tierRadius + t.rows * rowDepth;
    if (i === 1 || i === 2) {
      const suiteMat = new THREE.MeshStandardMaterial({
        color: 0x030407,
        roughness: 0.38,
        metalness: 0.55,
        emissive: 0x07101c,
        emissiveIntensity: 0.16,
      });
      const suite = buildArcBand(BOWL_ARC_Z, endRadius + 0.7, tierY + t.rows * rowRise + 0.2, 1.05, 1.15, t.arcHalf + 4, suiteMat);
      group.add(suite);
    }

    const railMat = new THREE.MeshBasicMaterial({ color: 0x1d2632, transparent: true, opacity: 0.72 });
    const rail = buildArcBand(BOWL_ARC_Z, tierRadius + 0.15, tierY + 0.06, 0.07, 0.18, t.arcHalf, railMat);
    group.add(rail);

    // Cross-aisles between tiers: Sphere reads as stacked dark balcony
    // levels, not an open scaffold.
    tierRadius += t.rows * rowDepth + 2.05;
    tierY += t.rows * rowRise + 0.32;
  });

  // ── Lighting — very dim baseline: the dome IS the lighting rig.
  //    No trusses, no PA, no movers (audio hides behind the screen in
  //    the real venue; everything scenic is pixels). ──
  const hemi = new THREE.HemisphereLight(0x8fa6c8, 0x05060a, 0.22);
  const ambient = new THREE.AmbientLight(0xffffff, 0.05);
  const key = new THREE.DirectionalLight(0xffffff, 0.4);
  key.position.set(14, 40, 30);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { near: 1, far: 160, left: -70, right: 70, top: 70, bottom: -70 });
  key.shadow.camera.updateProjectionMatrix();
  const fill = new THREE.DirectionalLight(0x9fb4d8, 0.12);
  fill.position.set(-30, 24, 20);

  const lights = [hemi, ambient, key, fill];
  return {
    group,
    floor,
    lights,
    baselineIntensities: lights.map(l => l.intensity),
    keyLight: key,
    keyPositionBaseline: [key.position.x, key.position.y, key.position.z],
    keyColorBaseline: key.color.getHex(),
    backgroundColor: '#04050a',
    fogDensity: 0.0035,
    fogColor: '#04050a',
    showGrid: false,
    // Audience default view: upper bowl looking down at the stage and
    // up into the dome face — the "whoa" reveal.
    cameraPosition: [0, 18, 40],
    cameraTarget: [0, 20, -45],
    cameraFov: 99,
    resetCameraOnLoad: true,
    lockScreenTransforms: true,
    lockedSceneryIds: ['stage'],
    defaultScreenTransform: DOME_SCREEN_TRANSFORM,
    cameraBounds: {
      minX: -72,
      maxX: 72,
      minY: 2.2,
      maxY: 70,
      minZ: -52,
      maxZ: 82,
      targetMinX: -58,
      targetMaxX: 58,
      targetMinY: 1.3,
      targetMaxY: 56,
      targetMinZ: -48,
      targetMaxZ: 38,
      minDistance: 4,
      maxDistance: 150,
    },
    // ledWall kept as a fallback rectangle (chord plane of the dome's
    // lower band) for anything that still reads it; auto screens use
    // ledDome below.
    ledWall: { centerX: 0, centerY: 15.5, centerZ: -48, width: 52, height: 30 },
    ledDome: DOME,
    stageW: 22,
    frontZ: STAGE_OFFSET_Z + STAGE_Z + 5.5,
    bloomStrength: 0.12,
    exposure: 1.0,
  };
}

const BUILDERS: Record<Stage3DVenue, () => VenueBuild> = {
  festival: buildFestival,
  arena: buildArena,
  club: buildClub,
  nightclub: buildNightclub,
  sphere: buildSphere,
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
