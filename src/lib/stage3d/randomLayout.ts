// Procedural stage-layout generator. Each invocation picks one of
// several "vibe" strategies (mainstage / club / arena-fan / minimal /
// stack) and randomises within sensible bounds so the result still
// looks like a real stage rather than a chaotic LED soup.
//
// The generator returns a fully populated `Stage3DScene` ready to drop
// into `stage3dScene.loadScene(...)`. Camera and platform are sized to
// frame whatever was generated.

import type { Stage3DScene, StageLedScreenNode, Vec3 } from './types';

type Vibe = 'mainstage' | 'fan' | 'tower' | 'club-wrap' | 'minimal';

const VIBE_NAMES: Record<Vibe, string[]> = {
  mainstage: ['Mainstage', 'Hero Backdrop', 'Festival Pit', 'Headliner Rig'],
  fan: ['Arc Fan', 'Curved Spread', 'Wave Crown', 'Halo Rig'],
  tower: ['Stack Tower', 'Column Forest', 'Vertical Maze', 'Tetris Wall'],
  'club-wrap': ['Club Wrap', 'Booth Cage', 'DJ Vortex', 'Cyber Pulpit'],
  minimal: ['Solo Wall', 'Pure Plane', 'Single Pillar', 'Hero Only'],
};

const ACCENT_COLORS = ['#FF8577', '#BB86FC', '#69F0AE', '#FFC857', '#FF6E8E', '#7EC8E3'];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

interface ScreenSpec {
  position: Vec3;
  rotation: Vec3;
  width: number;
  height: number;
  curvature: number;
  brightness: number;
  frameDepth: number;
  name: string;
}

function makeScreen(spec: ScreenSpec): StageLedScreenNode {
  return {
    id: uid('led'),
    name: spec.name,
    type: 'led-screen',
    position: spec.position,
    rotation: spec.rotation,
    scale: [1, 1, 1],
    visible: true,
    width: spec.width,
    height: spec.height,
    curvature: spec.curvature,
    finish: 'led',
    frameDepth: spec.frameDepth,
    source: 'auto',
    brightness: spec.brightness,
    showPixels: false,
  };
}

// ── Vibe generators ─────────────────────────────────────────────────

/** Wide curved hero wall behind + side stacks angled toward the audience.
 *  Symmetric across the Z axis — left and right walls mirror each other. */
function genMainstage(): ScreenSpec[] {
  const heroW = rand(16, 24);
  const heroH = rand(5, 8);
  const heroY = rand(4, 6);
  const heroZ = -rand(6, 9);
  const stackW = rand(2.5, 4);
  const stackH = rand(5, 8);
  const stackY = stackH / 2 + rand(1, 2);
  const stackZ = -rand(5, 7);
  const stackOffset = heroW / 2 + rand(2, 4);
  const stackYaw = Math.PI / rand(5, 8);
  const front = Math.random() < 0.5;
  const frontH = rand(0.8, 1.2);
  return [
    {
      position: [0, heroY, heroZ],
      rotation: [0, 0, 0],
      width: heroW,
      height: heroH,
      curvature: -rand(0.02, 0.07),
      brightness: rand(1.4, 1.9),
      frameDepth: 0.35,
      name: 'Hero Backdrop',
    },
    {
      position: [-stackOffset, stackY, stackZ],
      rotation: [0, stackYaw, 0],
      width: stackW,
      height: stackH,
      curvature: 0,
      brightness: rand(1.4, 1.8),
      frameDepth: 0.3,
      name: 'Left Stack',
    },
    {
      position: [stackOffset, stackY, stackZ],
      rotation: [0, -stackYaw, 0],
      width: stackW,
      height: stackH,
      curvature: 0,
      brightness: rand(1.4, 1.8),
      frameDepth: 0.3,
      name: 'Right Stack',
    },
    ...(front ? [{
      position: [0, rand(0.6, 1.0), rand(1, 2)] as Vec3,
      rotation: [0, 0, 0] as Vec3,
      width: heroW * 0.9,
      height: frontH,
      curvature: 0,
      brightness: rand(1.3, 1.7),
      frameDepth: 0.12,
      name: 'Front Strip',
    }] : []),
  ];
}

/** Fan of N screens arranged in an arc behind the artist, all facing
 *  inward toward the camera at the front-of-house position. */
function genFan(): ScreenSpec[] {
  const count = Math.floor(rand(5, 9));
  const arcRadius = rand(8, 13);
  const arcStart = -Math.PI / 2 + rand(0.3, 0.6);
  const arcEnd = -Math.PI / 2 - rand(0.3, 0.6);
  const w = rand(2.5, 4);
  const h = rand(4, 6.5);
  const baseY = h / 2 + rand(0.5, 1.5);
  const out: ScreenSpec[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const angle = arcStart + (arcEnd - arcStart) * t;
    const x = Math.cos(angle) * arcRadius;
    const z = Math.sin(angle) * arcRadius;
    // Face origin: rotate so the screen normal points to (0,0,0)
    const yaw = Math.atan2(x, z) + Math.PI;
    out.push({
      position: [x, baseY + Math.sin(t * Math.PI) * rand(0, 1.5), z],
      rotation: [0, yaw, 0],
      width: w,
      height: h,
      curvature: 0,
      brightness: rand(1.4, 1.8),
      frameDepth: 0.25,
      name: `Fan ${i + 1}`,
    });
  }
  return out;
}

/** Cluster of vertical columns at varied heights, mirrored around the
 *  Z axis. Generates HALF the columns (one side), then mirrors each
 *  one to the opposite x. Odd counts get a center column. */
function genTower(): ScreenSpec[] {
  const half = Math.floor(rand(3, 5));
  const includeCenter = Math.random() < 0.5;
  const totalCount = half * 2 + (includeCenter ? 1 : 0);
  const span = rand(12, 18);
  const stride = span / (totalCount + 1);
  const z = -rand(5, 7.5);
  const out: ScreenSpec[] = [];
  if (includeCenter) {
    const w = rand(1.4, 2.8);
    const h = rand(3.5, 8.5);
    out.push({
      position: [0, h / 2 + rand(0.3, 1.6), z],
      rotation: [0, 0, 0],
      width: w,
      height: h,
      curvature: 0,
      brightness: rand(1.3, 1.9),
      frameDepth: 0.25,
      name: 'Col C',
    });
  }
  for (let i = 0; i < half; i++) {
    // Per-pair parameters — both sides share these so the layout reads
    // as a mirror, not as two unrelated halves stitched together.
    const w = rand(1.4, 2.8);
    const h = rand(3.5, 8.5);
    const yJitter = rand(0.3, 1.6);
    const x = (includeCenter ? stride * (i + 1) : stride * (i + 0.5) + stride / 2);
    out.push({
      position: [-x, h / 2 + yJitter, z],
      rotation: [0, 0, 0],
      width: w,
      height: h,
      curvature: 0,
      brightness: rand(1.3, 1.9),
      frameDepth: 0.25,
      name: `Col L${i + 1}`,
    });
    out.push({
      position: [x, h / 2 + yJitter, z],
      rotation: [0, 0, 0],
      width: w,
      height: h,
      curvature: 0,
      brightness: rand(1.3, 1.9),
      frameDepth: 0.25,
      name: `Col R${i + 1}`,
    });
  }
  return out;
}

/** Tight wrap: short curved booth front + tall backdrop + ceiling
 *  strip + two pillar screens. */
function genClubWrap(): ScreenSpec[] {
  return [
    {
      position: [0, rand(1.3, 1.7), -rand(1.6, 2.4)],
      rotation: [0, 0, 0],
      width: rand(6, 8),
      height: rand(1.3, 1.8),
      curvature: -rand(0.08, 0.14),
      brightness: rand(1.7, 2.1),
      frameDepth: 0.25,
      name: 'Booth Wrap',
    },
    {
      position: [0, rand(2.8, 3.4), -rand(3.5, 5)],
      rotation: [0, 0, 0],
      width: rand(7, 9),
      height: rand(2.8, 3.5),
      curvature: -rand(0.02, 0.06),
      brightness: rand(1.5, 1.9),
      frameDepth: 0.3,
      name: 'Backdrop',
    },
    {
      position: [0, rand(4, 5), rand(0.5, 1.5)],
      rotation: [Math.PI / rand(2.1, 2.5), 0, 0],
      width: rand(7, 9),
      height: rand(1.0, 1.5),
      curvature: 0,
      brightness: rand(1.2, 1.6),
      frameDepth: 0.15,
      name: 'Ceiling Strip',
    },
    {
      position: [-rand(5, 6.5), rand(2.3, 2.8), 0],
      rotation: [0, Math.PI / rand(3.5, 4.5), 0],
      width: rand(1.2, 1.8),
      height: rand(4, 5.5),
      curvature: 0,
      brightness: rand(1.3, 1.6),
      frameDepth: 0.2,
      name: 'Pillar Left',
    },
    {
      position: [rand(5, 6.5), rand(2.3, 2.8), 0],
      rotation: [0, -Math.PI / rand(3.5, 4.5), 0],
      width: rand(1.2, 1.8),
      height: rand(4, 5.5),
      curvature: 0,
      brightness: rand(1.3, 1.6),
      frameDepth: 0.2,
      name: 'Pillar Right',
    },
  ];
}

/** Single hero wall — centred on Z axis for a symmetric front view. */
function genMinimal(): ScreenSpec[] {
  return [
    {
      position: [0, rand(4, 6), -rand(4, 7)],
      rotation: [0, 0, 0],
      width: rand(14, 22),
      height: rand(7, 11),
      curvature: Math.random() < 0.5 ? 0 : -rand(0.02, 0.06),
      brightness: rand(1.5, 2.0),
      frameDepth: rand(0.3, 0.5),
      name: 'Solo Wall',
    },
  ];
}

const GENERATORS: Record<Vibe, () => ScreenSpec[]> = {
  mainstage: genMainstage,
  fan: genFan,
  tower: genTower,
  'club-wrap': genClubWrap,
  minimal: genMinimal,
};

// ── Public entry ────────────────────────────────────────────────────

export function generateRandomScene(opts?: { vibe?: Vibe; seed?: number }): Stage3DScene {
  const vibe: Vibe = opts?.vibe ?? pick(['mainstage', 'fan', 'tower', 'club-wrap', 'minimal']);
  const specs = GENERATORS[vibe]();

  // Compute scene bounds to size the platform + camera to fit.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  for (const s of specs) {
    minX = Math.min(minX, s.position[0] - s.width / 2);
    maxX = Math.max(maxX, s.position[0] + s.width / 2);
    minZ = Math.min(minZ, s.position[2] - 0.5);
    maxZ = Math.max(maxZ, s.position[2] + 0.5);
    maxY = Math.max(maxY, s.position[1] + s.height / 2);
  }
  // Pad bounds a little so the platform extends past the outermost screen.
  const platformW = Math.max(6, (maxX - minX) + rand(2, 5));
  const platformD = Math.max(3, (maxZ - minZ) + rand(2, 4));
  const platformY = Math.max(0.5, rand(0.6, 1.4));
  const platformCenterZ = (minZ + maxZ) / 2;
  const accent = pick(ACCENT_COLORS);

  const cameraDistance = Math.max(12, (maxX - minX) * 0.9);
  const cameraY = Math.max(5, maxY * 0.7);

  return {
    id: uid('random'),
    name: pick(VIBE_NAMES[vibe]),
    schemaVersion: 1,
    environment: {
      background: pick(['#03050d', '#05060a', '#04030c', '#070410']),
      ambient: rand(0.18, 0.4),
      showGround: true,
      groundColor: pick(['#0e1018', '#100815', '#12101a', '#0a0a14']),
    },
    platform: {
      enabled: true,
      position: [0, 0, platformCenterZ],
      width: platformW,
      height: platformY,
      depth: platformD,
      topColor: '#0a0a0e',
      skirtColor: '#15141c',
      underglow: { enabled: Math.random() < 0.75, color: accent, intensity: rand(1.2, 2.4) },
      bevelSize: rand(0.1, 0.25),
    },
    camera: {
      position: [0, cameraY, cameraDistance + rand(2, 6)],
      target: [0, maxY * 0.4, platformCenterZ],
      fov: rand(48, 58),
    },
    nodes: specs.map(makeScreen),
    lightingCueId: null,
    meta: { category: 'random', vibe },
  };
}
