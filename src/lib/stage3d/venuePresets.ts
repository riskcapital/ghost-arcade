// Venue / stage-base presets for the 3D viewer.
//
// Each preset returns a scenery group (stage deck + truss + walls +
// PA + decorative lighting structure), atmosphere lights, and a
// default camera framing. The renderer adds the LED meshes on top.
//
// Style direction (current): pro production quality. Real trusses,
// PA stacks where they belong, audience risers, ceiling grids — but
// nothing busy enough to distract from the screen content.

import * as THREE from 'three';
import type { Stage3DBasePreset } from './types';

export interface VenueBuildOptions {
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
}

export interface VenueBuildResult {
  group: THREE.Group;
  lights: THREE.Light[];
  cameraPosition?: [number, number, number];
  cameraTarget?: [number, number, number];
  backgroundColor?: string;
  ambientIntensity?: number;
  reflectiveFloor?: boolean;
  fogDensity?: number;
  fogColor?: string;
}

// ── Building-block helpers ───────────────────────────────────────────

const TRUSS_MAT = new THREE.MeshPhysicalMaterial({
  color: 0x2a2a2e,
  roughness: 0.45,
  metalness: 0.92,
  envMapIntensity: 1.4,
});

const SCENERY_DARK_MAT = new THREE.MeshPhysicalMaterial({
  color: 0x09090d,
  roughness: 0.78,
  metalness: 0.3,
  envMapIntensity: 0.55,
});

/** Single horizontal truss bar with internal cross-bracing — reads as
 *  proper aluminium truss at viewing distance without modelling every
 *  brace tube. The bracing is a single thin diagonal mesh repeated
 *  along the length via instancing-equivalent loops. */
function makeTrussBar(length: number, profile = 0.22): THREE.Group {
  const g = new THREE.Group();
  const cord = new THREE.BoxGeometry(length, profile, profile);
  const c1 = new THREE.Mesh(cord, TRUSS_MAT);
  c1.position.set(0, profile / 2, profile / 2);
  g.add(c1);
  const c2 = new THREE.Mesh(cord, TRUSS_MAT);
  c2.position.set(0, profile / 2, -profile / 2);
  g.add(c2);
  const c3 = new THREE.Mesh(cord, TRUSS_MAT);
  c3.position.set(0, -profile / 2, 0);
  g.add(c3);

  // Triangular cross-bracing — short diagonals between the three cords.
  const braceCount = Math.max(4, Math.floor(length / 0.6));
  const braceSpacing = length / braceCount;
  for (let i = 0; i <= braceCount; i++) {
    const x = -length / 2 + i * braceSpacing;
    const brace = new THREE.Mesh(
      new THREE.CylinderGeometry(profile * 0.18, profile * 0.18, profile * 1.5, 6),
      TRUSS_MAT,
    );
    brace.position.set(x, 0, 0);
    brace.rotation.set(0, 0, (i % 2) ? Math.PI / 5 : -Math.PI / 5);
    g.add(brace);
  }
  return g;
}

/** Vertical truss leg — same construction as the horizontal bar, just
 *  oriented vertically. */
function makeTrussLeg(length: number, profile = 0.22): THREE.Group {
  const g = makeTrussBar(length, profile);
  g.rotation.z = Math.PI / 2;
  return g;
}

/** Square truss frame around the rig — top horizontal + verticals at
 *  the four corners + a small downstage cross-tie. */
function makeTrussRig(width: number, height: number, depth: number, profile = 0.22): THREE.Group {
  const g = new THREE.Group();
  // Top front + top back bars
  const front = makeTrussBar(width, profile);
  front.position.set(0, height, depth / 2);
  g.add(front);
  const back = makeTrussBar(width, profile);
  back.position.set(0, height, -depth / 2);
  g.add(back);
  // Top side bars (perpendicular)
  const left = makeTrussBar(depth, profile);
  left.rotation.y = Math.PI / 2;
  left.position.set(-width / 2, height, 0);
  g.add(left);
  const right = makeTrussBar(depth, profile);
  right.rotation.y = Math.PI / 2;
  right.position.set(width / 2, height, 0);
  g.add(right);
  // Four corner verticals
  for (const [x, z] of [[-width / 2, depth / 2], [width / 2, depth / 2], [-width / 2, -depth / 2], [width / 2, -depth / 2]] as const) {
    const leg = makeTrussLeg(height, profile);
    leg.position.set(x, height / 2, z);
    g.add(leg);
  }
  return g;
}

/** Hanging spotlight fixture — short cylinder body + a glowing emissive
 *  cap that bloom will tighten into a flare. Hung from a truss
 *  attachment point. */
function makeSpotFixture(color: number): THREE.Group {
  const g = new THREE.Group();
  // Yoke (the U-bracket holding the fixture)
  const yoke = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.025, 6, 12, Math.PI),
    SCENERY_DARK_MAT,
  );
  yoke.rotation.x = -Math.PI / 2;
  yoke.position.y = 0;
  g.add(yoke);
  // Body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.18, 0.32, 12),
    SCENERY_DARK_MAT,
  );
  body.position.y = -0.18;
  g.add(body);
  // Glowing lens
  const lens = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 24),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.8,
      toneMapped: false,
    }),
  );
  lens.position.y = -0.35;
  lens.rotation.x = -Math.PI / 2;
  g.add(lens);
  return g;
}

/** Tall PA cabinet stack — 4 boxes vertically, slightly angled forward
 *  at the bottom. Reads as a stack of 18" subs / mids. */
function makeSpeakerStack(boxes = 4, boxH = 0.7): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < boxes; i++) {
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, boxH * 0.96, 0.62),
      SCENERY_DARK_MAT.clone(),
    );
    cab.position.y = boxH * (i + 0.5);
    // Tilt-in slightly so the stack faces toward the audience
    cab.rotation.x = -0.04;
    g.add(cab);

    // Speaker driver cone hint — a flat dark disc on the front face
    const cone = new THREE.Mesh(
      new THREE.CircleGeometry(boxH * 0.32, 18),
      new THREE.MeshStandardMaterial({ color: 0x05050a, roughness: 0.6 }),
    );
    cone.position.set(0, boxH * (i + 0.5), 0.315);
    g.add(cone);
  }
  return g;
}

/** Line array — N angled cabinets hung in a J-curve from a hang point. */
function makeLineArray(cabs = 8, cabH = 0.45): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < cabs; i++) {
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, cabH * 0.9, 0.42),
      SCENERY_DARK_MAT.clone(),
    );
    const t = i / Math.max(1, cabs - 1);
    cab.position.y = -i * cabH;
    cab.position.z = t * 0.4;
    cab.rotation.x = -t * 0.22;
    g.add(cab);
  }
  return g;
}

/** Tiered audience riser — gradually elevated platforms. */
function makeAudienceRisers(width: number, depth: number, tiers = 4): THREE.Group {
  const g = new THREE.Group();
  const tierD = depth / tiers;
  for (let i = 0; i < tiers; i++) {
    const tier = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.32 * (i + 1), tierD * 0.94),
      SCENERY_DARK_MAT.clone(),
    );
    tier.position.y = 0.32 * (i + 1) / 2;
    tier.position.z = i * tierD + tierD / 2;
    g.add(tier);
  }
  return g;
}

/** Stage stairs at the front of the deck. */
function makeStairs(width: number, riseHeight: number, steps = 4): THREE.Group {
  const g = new THREE.Group();
  const tread = riseHeight / steps;
  const depth = 0.32;
  for (let i = 0; i < steps; i++) {
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(width, tread, depth),
      new THREE.MeshPhysicalMaterial({
        color: 0x161620,
        roughness: 0.78,
        metalness: 0.14,
        envMapIntensity: 0.5,
      }),
    );
    step.position.y = (i + 0.5) * tread;
    step.position.z = (steps - i) * depth * 0.5;
    g.add(step);
  }
  return g;
}

/** Stage deck — fat wide rectangular platform underneath the rig. */
function makeStageDeck(width: number, depth: number, height: number, frontZ: number, params: {
  topColor: string;
  skirtColor: string;
  edgeColor: string;
  edgeIntensity: number;
}): { group: THREE.Group; topY: number; centerZ: number } {
  const g = new THREE.Group();
  const centerZ = frontZ - depth / 2;

  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.4, height, depth + 0.4),
    new THREE.MeshPhysicalMaterial({
      color: params.skirtColor,
      roughness: 0.95,
      metalness: 0.05,
      envMapIntensity: 0.4,
    }),
  );
  skirt.position.set(0, height / 2 - 0.02, centerZ);
  skirt.receiveShadow = true;
  g.add(skirt);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.05, depth),
    new THREE.MeshPhysicalMaterial({
      color: params.topColor,
      roughness: 0.6,
      metalness: 0.16,
      envMapIntensity: 0.55,
    }),
  );
  top.position.set(0, height + 0.025, centerZ);
  top.receiveShadow = true;
  top.castShadow = true;
  g.add(top);

  // Emissive edge strip along the front of the deck
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.98, 0.04, 0.05),
    new THREE.MeshStandardMaterial({
      color: params.edgeColor,
      emissive: params.edgeColor,
      emissiveIntensity: params.edgeIntensity,
      toneMapped: false,
    }),
  );
  edge.position.set(0, height + 0.02, frontZ + 0.025);
  g.add(edge);

  return { group: g, topY: height + 0.05, centerZ };
}

// ── Per-preset builders ────────────────────────────────────────────────

function buildFestival(opts: VenueBuildOptions): VenueBuildResult {
  const g = new THREE.Group();
  const ledW = Math.max(8, opts.bounds.maxX - opts.bounds.minX);
  const ledH = Math.max(4, opts.bounds.maxY);
  const stageFrontZ = opts.bounds.maxZ + 2;
  const stageDepth = Math.max(5, (opts.bounds.maxZ - opts.bounds.minZ) + 4);
  const stageWidth = ledW + 5;
  const stageHeight = 0.9;

  const deck = makeStageDeck(stageWidth, stageDepth, stageHeight, stageFrontZ, {
    topColor: '#0a0a10',
    skirtColor: '#15101a',
    edgeColor: '#FF8577',
    edgeIntensity: 1.4,
  });
  g.add(deck.group);

  // Square truss rig framing the rig area
  const trussY = ledH + 1.8;
  const trussW = ledW + 3.2;
  const trussD = Math.min(stageDepth - 1, 5.5);
  const truss = makeTrussRig(trussW, trussY, trussD);
  truss.position.set(0, 0, deck.centerZ);
  g.add(truss);

  // 8 spot fixtures across the front truss bar
  const lights: THREE.Light[] = [];
  for (let i = 0; i < 8; i++) {
    const t = (i + 0.5) / 8;
    const x = -trussW / 2 + 0.4 + t * (trussW - 0.8);
    const fixt = makeSpotFixture(0xffd5b8);
    fixt.position.set(x, trussY - 0.05, deck.centerZ + trussD / 2);
    g.add(fixt);
    const spot = new THREE.SpotLight(0xffe1c8, 14, 30, Math.PI / 11, 0.65, 1.6);
    spot.position.set(x, trussY - 0.3, deck.centerZ + trussD / 2);
    spot.target.position.set(x * 0.4, stageHeight + 0.5, deck.centerZ + 1.0);
    lights.push(spot);
    lights.push(spot.target as any);
  }

  // Side speaker stacks — flanking the deck
  const stackOffset = stageWidth / 2 + 1.0;
  const stackL = makeSpeakerStack(5, 0.65);
  stackL.position.set(-stackOffset, stageHeight + 0.05, stageFrontZ - 0.6);
  g.add(stackL);
  const stackR = makeSpeakerStack(5, 0.65);
  stackR.position.set(stackOffset, stageHeight + 0.05, stageFrontZ - 0.6);
  g.add(stackR);

  // Line array hanging from the front truss corners (compact)
  const arrayL = makeLineArray(7, 0.42);
  arrayL.position.set(-trussW / 2 - 0.6, trussY - 0.4, deck.centerZ + trussD / 2);
  g.add(arrayL);
  const arrayR = makeLineArray(7, 0.42);
  arrayR.position.set(trussW / 2 + 0.6, trussY - 0.4, deck.centerZ + trussD / 2);
  g.add(arrayR);

  // Stage stairs leading up to deck front
  const stairs = makeStairs(stageWidth * 0.4, stageHeight, 4);
  stairs.position.set(0, 0, stageFrontZ + 0.2);
  g.add(stairs);

  // Soft top key
  const top = new THREE.DirectionalLight(0xffe4d0, 0.5);
  top.position.set(0, trussY + 6, deck.centerZ + 4);
  lights.push(top);

  return {
    group: g,
    lights,
    cameraPosition: [0, Math.max(5, ledH * 0.7), Math.max(16, ledW * 1.0)],
    cameraTarget: [0, ledH * 0.45, deck.centerZ],
    backgroundColor: '#04050b',
    ambientIntensity: 0.18,
    fogDensity: 0.014,
    fogColor: '#06070f',
  };
}

function buildArena(opts: VenueBuildOptions): VenueBuildResult {
  const g = new THREE.Group();
  const ledW = Math.max(10, opts.bounds.maxX - opts.bounds.minX);
  const ledH = Math.max(5, opts.bounds.maxY);
  const stageFrontZ = opts.bounds.maxZ + 2.5;
  const stageDepth = Math.max(5.5, (opts.bounds.maxZ - opts.bounds.minZ) + 4.5);
  const stageWidth = ledW + 6;
  const stageHeight = 1.1;

  const deck = makeStageDeck(stageWidth, stageDepth, stageHeight, stageFrontZ, {
    topColor: '#06060c',
    skirtColor: '#0c0c14',
    edgeColor: '#69F0AE',
    edgeIntensity: 1.0,
  });
  g.add(deck.group);

  // Overhead grid truss — 3 horizontal bars + 4 vertical bars forming
  // a 12-cell grid. Bigger / more impressive than a simple frame.
  const trussY = ledH + 3;
  const gridW = ledW + 8;
  const gridD = stageDepth - 0.5;
  for (let i = 0; i < 4; i++) {
    const bar = makeTrussBar(gridW, 0.18);
    bar.position.set(0, trussY, deck.centerZ - gridD / 2 + (i * gridD) / 3);
    g.add(bar);
  }
  for (let j = 0; j < 5; j++) {
    const bar = makeTrussBar(gridD, 0.18);
    bar.rotation.y = Math.PI / 2;
    bar.position.set(-gridW / 2 + (j * gridW) / 4, trussY, deck.centerZ);
    g.add(bar);
  }
  // 4 corner verticals to hold up the grid
  for (const [x, z] of [[-gridW / 2, deck.centerZ - gridD / 2], [gridW / 2, deck.centerZ - gridD / 2], [-gridW / 2, deck.centerZ + gridD / 2], [gridW / 2, deck.centerZ + gridD / 2]] as const) {
    const leg = makeTrussLeg(trussY, 0.18);
    leg.position.set(x, trussY / 2, z);
    g.add(leg);
  }

  // 12 spotlight fixtures hanging in a grid pattern
  const lights: THREE.Light[] = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const x = -gridW / 2 + 1.5 + col * (gridW - 3) / 3;
      const z = deck.centerZ - gridD / 2 + 1.5 + row * (gridD - 3) / 2;
      const fixt = makeSpotFixture(0xfff2e6);
      fixt.position.set(x, trussY - 0.1, z);
      g.add(fixt);
      const spot = new THREE.SpotLight(0xfff0e0, 9, 22, Math.PI / 12, 0.7, 1.7);
      spot.position.set(x, trussY - 0.35, z);
      spot.target.position.set(x * 0.3, stageHeight + 0.3, z + 1.5);
      lights.push(spot);
      lights.push(spot.target as any);
    }
  }

  // Audience riser hint visible BEHIND the camera (toward +Z)
  const risers = makeAudienceRisers(gridW * 1.1, 5, 4);
  risers.position.set(0, 0, stageFrontZ + 4);
  g.add(risers);

  return {
    group: g,
    lights,
    cameraPosition: [0, Math.max(5, ledH * 0.65), Math.max(18, ledW * 1.05)],
    cameraTarget: [0, ledH * 0.5, deck.centerZ],
    backgroundColor: '#03050a',
    ambientIntensity: 0.22,
    fogDensity: 0.01,
    fogColor: '#05080e',
  };
}

function buildClub(opts: VenueBuildOptions): VenueBuildResult {
  const g = new THREE.Group();
  const ledW = Math.max(6, opts.bounds.maxX - opts.bounds.minX);
  const ledH = Math.max(3, opts.bounds.maxY);
  const stageFrontZ = opts.bounds.maxZ + 1.5;
  const stageDepth = Math.max(3.5, (opts.bounds.maxZ - opts.bounds.minZ) + 2.8);
  const stageWidth = ledW + 3;
  const stageHeight = 0.6;

  const deck = makeStageDeck(stageWidth, stageDepth, stageHeight, stageFrontZ, {
    topColor: '#0a0410',
    skirtColor: '#160a1c',
    edgeColor: '#BB86FC',
    edgeIntensity: 2.0,
  });
  g.add(deck.group);

  // Low ceiling — emissive bars in a row, intimate club vibe
  const ceilingY = Math.max(4.5, ledH + 1.4);
  for (let i = 0; i < 8; i++) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(ledW + 2, 0.08, 0.14),
      new THREE.MeshStandardMaterial({
        color: 0xa468ff,
        emissive: 0xa468ff,
        emissiveIntensity: 1.6,
        toneMapped: false,
      }),
    );
    bar.position.set(0, ceilingY, deck.centerZ - stageDepth / 2 + 0.5 + i * (stageDepth - 1) / 7);
    g.add(bar);
  }

  // Side pillars flanking the rig — give the room walls a presence
  for (const sx of [-stageWidth / 2 - 0.4, stageWidth / 2 + 0.4]) {
    const pillar = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, ceilingY, 0.45),
      new THREE.MeshPhysicalMaterial({
        color: 0x080810,
        roughness: 0.42,
        metalness: 0.68,
        envMapIntensity: 1.1,
      }),
    );
    pillar.position.set(sx, ceilingY / 2, deck.centerZ);
    g.add(pillar);
    // Subtle emissive strip running up the inside face of each pillar
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, ceilingY * 0.85, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0xff6ec8,
        emissive: 0xff6ec8,
        emissiveIntensity: 1.4,
        toneMapped: false,
      }),
    );
    strip.position.set(sx + (sx < 0 ? 0.22 : -0.22), ceilingY * 0.5, deck.centerZ);
    g.add(strip);
  }

  // Small DJ-monitor PA — discreet, tucked at the stage edge
  const stackL = makeSpeakerStack(2, 0.55);
  stackL.position.set(-stageWidth / 2 + 0.5, stageHeight + 0.05, stageFrontZ - 0.6);
  g.add(stackL);
  const stackR = makeSpeakerStack(2, 0.55);
  stackR.position.set(stageWidth / 2 - 0.5, stageHeight + 0.05, stageFrontZ - 0.6);
  g.add(stackR);

  // Magenta + cyan accent point lights — give the polished floor real
  // colour to reflect.
  const lights: THREE.Light[] = [];
  const colors = [0xff4dd2, 0x4dd2ff, 0xa468ff];
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6;
    const x = -ledW / 2 + t * ledW;
    const point = new THREE.PointLight(colors[i % colors.length], 4, 12, 1.6);
    point.position.set(x, ceilingY - 0.4, deck.centerZ + 1.5);
    lights.push(point);
  }

  return {
    group: g,
    lights,
    cameraPosition: [0, Math.max(3.5, ledH * 0.7), Math.max(12, ledW * 1.3)],
    cameraTarget: [0, ledH * 0.45, deck.centerZ],
    backgroundColor: '#05030a',
    ambientIntensity: 0.16,
    reflectiveFloor: true,
    fogDensity: 0.024,
    fogColor: '#0a0418',
  };
}

function buildConference(opts: VenueBuildOptions): VenueBuildResult {
  const g = new THREE.Group();
  const ledW = Math.max(10, opts.bounds.maxX - opts.bounds.minX);
  const ledH = Math.max(4, opts.bounds.maxY);
  const stageFrontZ = opts.bounds.maxZ + 2.5;
  const stageDepth = Math.max(5, (opts.bounds.maxZ - opts.bounds.minZ) + 4);
  const stageWidth = ledW + 5;
  const stageHeight = 0.85;

  const deck = makeStageDeck(stageWidth, stageDepth, stageHeight, stageFrontZ, {
    topColor: '#0a0a10',
    skirtColor: '#12121c',
    edgeColor: '#E5EDFF',
    edgeIntensity: 0.85,
  });
  g.add(deck.group);

  // Clean grid ceiling — emissive panels in a 6×4 grid
  const ceilingY = Math.max(7, ledH + 2.2);
  const cellsX = 6, cellsZ = 4;
  const ceilingW = ledW + 6;
  const ceilingD = stageDepth;
  const cellW = ceilingW / cellsX;
  const cellD = ceilingD / cellsZ;
  for (let r = 0; r < cellsZ; r++) {
    for (let c = 0; c < cellsX; c++) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(cellW * 0.9, 0.06, cellD * 0.9),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: 0xe5edff,
          emissiveIntensity: 0.55,
          roughness: 0.6,
          metalness: 0.1,
          toneMapped: false,
        }),
      );
      panel.position.set(
        -ceilingW / 2 + (c + 0.5) * cellW,
        ceilingY,
        deck.centerZ - ceilingD / 2 + (r + 0.5) * cellD,
      );
      g.add(panel);
    }
  }
  // Subtle audience riser well behind the camera
  const risers = makeAudienceRisers(ceilingW * 1.05, 4, 4);
  risers.position.set(0, 0, stageFrontZ + 3.5);
  g.add(risers);
  // Stage stairs
  const stairs = makeStairs(stageWidth * 0.42, stageHeight, 3);
  stairs.position.set(0, 0, stageFrontZ + 0.2);
  g.add(stairs);

  const lights: THREE.Light[] = [];
  const top = new THREE.DirectionalLight(0xfff5ec, 0.55);
  top.position.set(0, ceilingY + 4, deck.centerZ + 3);
  lights.push(top);
  const hemi = new THREE.HemisphereLight(0xfff8ee, 0x101018, 0.32);
  lights.push(hemi);

  return {
    group: g,
    lights,
    cameraPosition: [0, Math.max(5, ledH * 0.7), Math.max(17, ledW * 1.1)],
    cameraTarget: [0, ledH * 0.45, deck.centerZ],
    backgroundColor: '#0a0c12',
    ambientIntensity: 0.28,
    reflectiveFloor: true,
    fogDensity: 0.006,
    fogColor: '#0c0e16',
  };
}

function buildEmpty(opts: VenueBuildOptions): VenueBuildResult {
  const g = new THREE.Group();
  const ledH = Math.max(3, opts.bounds.maxY);
  const ledW = Math.max(6, opts.bounds.maxX - opts.bounds.minX);
  const stageFrontZ = opts.bounds.maxZ + 1.5;
  const stageDepth = Math.max(4, (opts.bounds.maxZ - opts.bounds.minZ) + 3);
  const stageWidth = ledW + 4;
  const stageHeight = 0.65;

  const deck = makeStageDeck(stageWidth, stageDepth, stageHeight, stageFrontZ, {
    topColor: '#0a0a10',
    skirtColor: '#0e0e16',
    edgeColor: '#3a3a48',
    edgeIntensity: 0.3,
  });
  g.add(deck.group);

  const lights: THREE.Light[] = [];
  const top = new THREE.DirectionalLight(0xffffff, 0.5);
  top.position.set(0, ledH + 5, deck.centerZ + 3);
  lights.push(top);
  return {
    group: g,
    lights,
    cameraPosition: [0, Math.max(4, ledH * 0.65), Math.max(14, ledW * 1.15)],
    cameraTarget: [0, ledH * 0.5, deck.centerZ],
    backgroundColor: '#06070b',
    ambientIntensity: 0.3,
    fogDensity: 0.008,
    fogColor: '#070811',
  };
}

// ── Dispatch ───────────────────────────────────────────────────────────

export interface VenuePresetEntry {
  id: Stage3DBasePreset;
  label: string;
  tagline: string;
  gradient: [string, string];
  build: (opts: VenueBuildOptions) => VenueBuildResult;
}

export const VENUE_PRESETS: VenuePresetEntry[] = [
  {
    id: 'festival',
    label: 'Festival',
    tagline: 'Truss rig + side stacks + line array + stairs',
    gradient: ['#FF8577', '#BB86FC'],
    build: buildFestival,
  },
  {
    id: 'arena',
    label: 'Arena',
    tagline: 'Overhead truss grid + spot rig + audience riser',
    gradient: ['#1A5C8E', '#69F0AE'],
    build: buildArena,
  },
  {
    id: 'club',
    label: 'Club',
    tagline: 'Low ceiling + side pillars + mirror floor',
    gradient: ['#5A1A8E', '#FF6E6E'],
    build: buildClub,
  },
  {
    id: 'conference',
    label: 'Conference',
    tagline: 'Grid ceiling panels + mirror floor + clean key',
    gradient: ['#1A2A5A', '#E5EDFF'],
    build: buildConference,
  },
  {
    id: 'empty',
    label: 'Empty',
    tagline: 'Just the stage deck. Maximum focus on the screens.',
    gradient: ['#1c1c24', '#3a3a48'],
    build: buildEmpty,
  },
];

export function buildVenuePreset(id: Stage3DBasePreset, opts: VenueBuildOptions): VenueBuildResult {
  const entry = VENUE_PRESETS.find(p => p.id === id);
  if (!entry) return buildEmpty(opts);
  return entry.build(opts);
}
