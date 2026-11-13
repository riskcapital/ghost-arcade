// Mapping templates and the small 3D stages they are drawn on.
//
// Each template is a real object built from boxes (a wall with a window, a door, stacked boxes, a
// house front, a DJ booth, a table with a cake) seen by one camera. The same camera places the
// template's surfaces: a surface is a face of a box, projected to the output frame, so the
// picture lands exactly on the face in the rendered stage. stageRenderer.ts renders the stage
// (for template thumbnails and the preview backdrop) with this camera; nothing here touches the
// GPU, so the geometry is tested on its own.

import { cornerPoints, type Point } from './model';

export type Vec3 = [number, number, number];

/** Surface finishes the stage shader knows. */
export const STAGE_MATERIALS = {
  /** Matte white: the boards, panels and sheets a projector paints. */
  screen: 0,
  /** Painted trim and dark timber. */
  trim: 1,
  /** Black glass. */
  glass: 2,
  /** Black speaker cloth and cabinets. */
  cabinet: 3,
  /** House siding. */
  siding: 4,
  /** Roof shingles. */
  roof: 5,
  /** A warm lamp. Lights itself. */
  lamp: 6,
  /** Linen tablecloth. */
  linen: 7,
  /** Brushed metal (stands, legs). */
  metal: 8,
} as const;
export type StageMaterial = keyof typeof STAGE_MATERIALS;

export type StageBox = {
  at: Vec3;
  half: Vec3;
  /** Turn about the vertical axis, radians. Positive turns the front face to the right. */
  yaw?: number;
  /** Turn about the depth axis, radians (applied before `yaw`). A square at π/4 stands on its point. */
  roll?: number;
  /** Edge rounding in metres. */
  round?: number;
  material: StageMaterial;
};

export type StageScene = {
  /** 'studio': a dim room with a back wall and a polished floor. 'night': outdoors after dark. */
  env: 'studio' | 'night';
  eye: Vec3;
  target: Vec3;
  /** Vertical field of view, degrees. */
  fov: number;
  /** z of the back wall (studio only). */
  wallZ?: number;
  /** The key light: where it hangs and its colour (linear, can exceed 1). */
  key: { at: Vec3; color: Vec3 };
  boxes: StageBox[];
};

export type StageFace = 'front' | 'left' | 'right' | 'top';

export type TemplateSurface = {
  name: string;
  /** A face of one of the scene's boxes, or `quad`: four world points in reading order. */
  box?: number;
  face?: StageFace;
  quad?: [Vec3, Vec3, Vec3, Vec3];
  /** Library shader shown on this surface. */
  shader: string;
};

export type MappingTemplate = {
  id: string;
  name: string;
  /** One line under the thumbnail. */
  blurb: string;
  scene: StageScene;
  surfaces: TemplateSurface[];
};

// ── Camera ─────────────────────────────────────────────────────────────────

export const STAGE_ASPECT = 16 / 9;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export type CameraBasis = { eye: Vec3; forward: Vec3; right: Vec3; up: Vec3; focal: number };

/** The camera's axes. The stage shader builds its rays from exactly these numbers. */
export function cameraBasis(scene: StageScene): CameraBasis {
  const forward = normalize(sub(scene.target, scene.eye));
  const right = normalize(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  return { eye: scene.eye, forward, right, up, focal: 1 / Math.tan((scene.fov * Math.PI) / 360) };
}

/** Where a world point lands in the 16:9 output frame (0–1, y down). */
export function projectPoint(scene: StageScene, p: Vec3, basis = cameraBasis(scene)): Point {
  const d = sub(p, basis.eye);
  const z = Math.max(1e-4, dot(d, basis.forward));
  const x = ((dot(d, basis.right) / z) * basis.focal) / STAGE_ASPECT;
  const y = (dot(d, basis.up) / z) * basis.focal;
  return { x: (x + 1) / 2, y: (1 - y) / 2 };
}

/** A box-local point turned into the world. */
function boxPoint(box: StageBox, local: Vec3): Vec3 {
  const rc = Math.cos(box.roll ?? 0),
    rs = Math.sin(box.roll ?? 0);
  const x = local[0] * rc - local[1] * rs,
    y = local[0] * rs + local[1] * rc,
    z = local[2];
  const c = Math.cos(box.yaw ?? 0),
    s = Math.sin(box.yaw ?? 0);
  // Positive yaw turns +z (the front) towards +x.
  return [box.at[0] + x * c + z * s, box.at[1] + y, box.at[2] - x * s + z * c];
}

/** A face's corners in reading order as the camera sees them: top-left, top-right, bottom-right, bottom-left. */
export function faceCorners(box: StageBox, face: StageFace): [Vec3, Vec3, Vec3, Vec3] {
  const [x, y, z] = box.half;
  const local: Record<StageFace, [Vec3, Vec3, Vec3, Vec3]> = {
    front: [[-x, y, z], [x, y, z], [x, -y, z], [-x, -y, z]],
    left: [[-x, y, -z], [-x, y, z], [-x, -y, z], [-x, -y, -z]],
    right: [[x, y, z], [x, y, -z], [x, -y, -z], [x, -y, z]],
    top: [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]],
  };
  return local[face].map((p) => boxPoint(box, p)) as [Vec3, Vec3, Vec3, Vec3];
}

/** The world corners of one template surface. */
export function surfaceWorldCorners(template: MappingTemplate, index: number): [Vec3, Vec3, Vec3, Vec3] {
  const surface = template.surfaces[index];
  if (surface.quad) return surface.quad;
  const box = template.scene.boxes[surface.box ?? -1];
  if (!box || !surface.face) throw new Error(`${template.name}: surface ${index + 1} has no face.`);
  return faceCorners(box, surface.face);
}

/** The 3×3 output-frame lattice for one template surface, ready to be a corner-warp surface. */
export function templateSurfacePoints(template: MappingTemplate, index: number): Point[] {
  const basis = cameraBasis(template.scene);
  const [a, b, c, d] = surfaceWorldCorners(template, index).map((p) => projectPoint(template.scene, p, basis));
  return cornerPoints(a, b, c, d);
}

// ── The templates ──────────────────────────────────────────────────────────
//
// Shaders are chosen from the phone-safe library (cheap on the measured GPU cost list) and each
// template uses at most three different ones, so every device tier plays all of them. Faces that
// belong together share a clip, which also shares its render.

const KEY_WARM: Vec3 = [1.5, 1.22, 0.95];
const KEY_COOL: Vec3 = [0.62, 0.74, 1.0];

/** A wall of a house at night with one window: two sheeted sashes between shutters. */
const WINDOW: MappingTemplate = {
  id: 'window',
  name: 'Window',
  blurb: 'Two sashes and their shutters',
  scene: {
    env: 'night',
    eye: [0.35, 1.25, 3.7],
    target: [0, 1.5, 0],
    fov: 38,
    key: { at: [1.6, 2.6, 2.2], color: KEY_COOL },
    boxes: [
      { at: [0, 1.6, -0.12], half: [3.4, 2.2, 0.1], material: 'siding' },
      // Frame and sill.
      { at: [0, 2.32, -0.0], half: [0.66, 0.06, 0.05], material: 'trim' },
      { at: [0, 0.68, 0.02], half: [0.74, 0.045, 0.09], material: 'trim' },
      { at: [-0.62, 1.5, -0.0], half: [0.05, 0.78, 0.05], material: 'trim' },
      { at: [0.62, 1.5, -0.0], half: [0.05, 0.78, 0.05], material: 'trim' },
      { at: [0, 1.5, -0.005], half: [0.58, 0.035, 0.04], material: 'trim' },
      // The two sashes, each covered by a white sheet.
      { at: [0, 1.895, -0.02], half: [0.57, 0.36, 0.01], material: 'screen' },
      { at: [0, 1.105, -0.02], half: [0.57, 0.36, 0.01], material: 'screen' },
      // Shutters.
      { at: [-0.93, 1.5, -0.0], half: [0.24, 0.8, 0.025], material: 'screen' },
      { at: [0.93, 1.5, -0.0], half: [0.24, 0.8, 0.025], material: 'screen' },
      // A porch lamp beside the window.
      { at: [1.55, 1.95, 0.02], half: [0.06, 0.1, 0.06], round: 0.02, material: 'lamp' },
    ],
  },
  surfaces: [
    { name: 'Upper sash', box: 6, face: 'front', shader: 'room-aurora-curtains' },
    { name: 'Lower sash', box: 7, face: 'front', shader: 'room-jellyfish-float' },
    { name: 'Left shutter', box: 8, face: 'front', shader: 'room-ember-drift' },
    { name: 'Right shutter', box: 9, face: 'front', shader: 'room-ember-drift' },
  ],
};

/** A front door with a pilaster each side and a lintel above. */
const DOORWAY: MappingTemplate = {
  id: 'doorway',
  name: 'Doorway',
  blurb: 'Door, pilasters and lintel',
  scene: {
    env: 'night',
    eye: [-0.45, 1.35, 4.3],
    target: [0, 1.42, 0],
    fov: 42,
    key: { at: [-1.2, 3.0, 2.4], color: KEY_WARM },
    boxes: [
      { at: [0, 1.7, -0.14], half: [3.6, 2.4, 0.1], material: 'siding' },
      // Step.
      { at: [0, 0.07, 0.32], half: [1.05, 0.07, 0.42], material: 'trim' },
      // Door.
      { at: [0, 1.2, -0.02], half: [0.46, 1.06, 0.03], material: 'screen' },
      // Pilasters.
      { at: [-0.72, 1.28, 0.02], half: [0.15, 1.14, 0.08], material: 'screen' },
      { at: [0.72, 1.28, 0.02], half: [0.15, 1.14, 0.08], material: 'screen' },
      // Lintel.
      { at: [0, 2.58, 0.04], half: [0.98, 0.16, 0.1], material: 'screen' },
      // Cornice.
      { at: [0, 2.79, 0.07], half: [1.06, 0.05, 0.13], material: 'trim' },
      // Handle.
      { at: [0.33, 1.15, 0.03], half: [0.025, 0.025, 0.04], round: 0.02, material: 'metal' },
    ],
  },
  surfaces: [
    { name: 'Door', box: 2, face: 'front', shader: 'desktop:cube shaders/ROOM_13_PortalVortex.fs' },
    { name: 'Left pilaster', box: 3, face: 'front', shader: 'desktop:SM-DigitalRain.fs' },
    { name: 'Right pilaster', box: 4, face: 'front', shader: 'desktop:SM-DigitalRain.fs' },
    { name: 'Lintel', box: 5, face: 'front', shader: 'desktop:DM-SpectrumWaves.fs' },
  ],
};

/** Three white boxes, stacked, in a dim room: the first-run demo. */
const BOXES: MappingTemplate = {
  id: 'boxes',
  name: 'Stacked boxes',
  blurb: 'Three boxes, five faces',
  scene: {
    env: 'studio',
    eye: [0.15, 1.12, 3.9],
    target: [-0.02, 0.7, 0],
    fov: 34,
    wallZ: -1.7,
    key: { at: [1.8, 3.4, 2.6], color: KEY_WARM },
    boxes: [
      { at: [-0.5, 0.42, 0], half: [0.42, 0.42, 0.42], yaw: 0.5, round: 0.012, material: 'screen' },
      { at: [0.56, 0.32, 0.22], half: [0.32, 0.32, 0.32], yaw: -0.42, round: 0.012, material: 'screen' },
      { at: [-0.42, 1.11, -0.04], half: [0.27, 0.27, 0.27], yaw: -0.2, round: 0.012, material: 'screen' },
    ],
  },
  surfaces: [
    { name: 'Big box front', box: 0, face: 'front', shader: 'featured-lumenveil' },
    { name: 'Big box side', box: 0, face: 'left', shader: 'desktop:91_StainedGlass.fs' },
    { name: 'Small box front', box: 1, face: 'front', shader: 'desktop:SM-EdgePlasma.fs' },
    { name: 'Small box side', box: 1, face: 'right', shader: 'desktop:91_StainedGlass.fs' },
    { name: 'Top box front', box: 2, face: 'front', shader: 'desktop:SM-EdgePlasma.fs' },
  ],
};

/** A house front at night: siding, gable, garage door and front door. */
const FACADE: MappingTemplate = (() => {
  const wallTop = 2.6,
    gable = 1.55,
    z = 0.005;
  return {
    id: 'facade',
    name: 'House front',
    blurb: 'Wall, gable, garage and door',
    scene: {
      env: 'night',
      eye: [0.6, 1.5, 8.6],
      target: [0, 1.95, 0],
      fov: 34,
      key: { at: [3.5, 5.5, 6.0], color: KEY_COOL },
      boxes: [
        // Walls.
        { at: [0, wallTop / 2, -0.2], half: [3.1, wallTop / 2, 0.2], material: 'screen' },
        // Gable: a square turned on its point; its lower half sits inside the wall.
        { at: [0, wallTop, -0.2], half: [gable / Math.SQRT2, gable / Math.SQRT2, 0.2], roll: Math.PI / 4, material: 'screen' },
        // Roof slopes either side of the gable.
        { at: [-2.05, wallTop + 0.42, -0.6], half: [1.25, 0.06, 0.62], round: 0.01, material: 'roof' },
        { at: [2.05, wallTop + 0.42, -0.6], half: [1.25, 0.06, 0.62], round: 0.01, material: 'roof' },
        // Garage door and front door.
        { at: [-1.55, 1.02, 0.02], half: [1.05, 1.02, 0.03], material: 'screen' },
        { at: [1.25, 1.0, 0.02], half: [0.42, 1.0, 0.03], material: 'screen' },
        // Window beside the door, lit from inside.
        { at: [2.45, 1.45, 0.01], half: [0.36, 0.42, 0.02], material: 'lamp' },
        { at: [2.45, 1.45, 0.025], half: [0.4, 0.46, 0.012], material: 'trim' },
        // Trim under the eaves.
        { at: [0, wallTop - 0.04, 0.03], half: [3.15, 0.05, 0.04], material: 'trim' },
        // Driveway.
        { at: [-1.55, 0.005, 2.6], half: [1.2, 0.005, 2.6], material: 'cabinet' },
      ],
    },
    surfaces: [
      {
        name: 'Wall',
        quad: [
          [-3.1, wallTop - 0.1, z],
          [3.1, wallTop - 0.1, z],
          [3.1, 0, z],
          [-3.1, 0, z],
        ],
        shader: 'desktop:SM-BrickCollapse.fs',
      },
      {
        name: 'Gable',
        quad: [
          [-0.06, wallTop + gable, z],
          [0.06, wallTop + gable, z],
          [gable, wallTop, z],
          [-gable, wallTop, z],
        ],
        shader: 'desktop:91_StainedGlass.fs',
      },
      { name: 'Garage door', box: 4, face: 'front', shader: 'desktop:SM-LiquidFill.fs' },
      { name: 'Front door', box: 5, face: 'front', shader: 'desktop:91_StainedGlass.fs' },
    ],
  } satisfies MappingTemplate;
})();

/** A DJ booth with a backdrop screen and a speaker each side. */
const DJ: MappingTemplate = {
  id: 'dj-booth',
  name: 'DJ booth',
  blurb: 'Booth front, backdrop, speakers',
  scene: {
    env: 'studio',
    eye: [0, 1.45, 6.0],
    target: [0, 1.25, 0],
    fov: 36,
    wallZ: -1.3,
    key: { at: [-2.2, 4.0, 3.2], color: KEY_WARM },
    boxes: [
      // Booth.
      { at: [0, 0.56, 0.5], half: [1.05, 0.56, 0.36], round: 0.01, material: 'screen' },
      // Decks on top.
      { at: [-0.45, 1.15, 0.42], half: [0.28, 0.035, 0.2], round: 0.01, material: 'cabinet' },
      { at: [0.45, 1.15, 0.42], half: [0.28, 0.035, 0.2], round: 0.01, material: 'cabinet' },
      { at: [0, 1.15, 0.42], half: [0.12, 0.04, 0.18], round: 0.01, material: 'metal' },
      // Backdrop screen on the wall.
      { at: [0, 2.2, -1.22], half: [1.75, 0.72, 0.03], material: 'screen' },
      // Speakers on stands.
      { at: [-1.9, 1.35, 0.25], half: [0.3, 0.46, 0.28], round: 0.015, material: 'screen' },
      { at: [1.9, 1.35, 0.25], half: [0.3, 0.46, 0.28], round: 0.015, material: 'screen' },
      { at: [-1.9, 0.45, 0.25], half: [0.025, 0.45, 0.025], material: 'metal' },
      { at: [1.9, 0.45, 0.25], half: [0.025, 0.45, 0.025], material: 'metal' },
    ],
  },
  surfaces: [
    { name: 'Booth front', box: 0, face: 'front', shader: 'desktop:98_LEDMatrix.fs' },
    { name: 'Backdrop', box: 4, face: 'front', shader: 'desktop:DM-SpectrumWaves.fs' },
    { name: 'Left speaker', box: 5, face: 'front', shader: 'desktop:SM-ConcentricEcho.fs' },
    { name: 'Right speaker', box: 6, face: 'front', shader: 'desktop:SM-ConcentricEcho.fs' },
  ],
};

/** A clothed table with a two-tier square cake. */
const TABLE: MappingTemplate = {
  id: 'table-cake',
  name: 'Table and cake',
  blurb: 'Tablecloth and two cake tiers',
  scene: {
    env: 'studio',
    eye: [0.5, 1.4, 3.0],
    target: [0, 0.68, 0],
    fov: 38,
    wallZ: -1.5,
    key: { at: [1.4, 3.2, 2.2], color: KEY_WARM },
    boxes: [
      // Table, clothed to the floor.
      { at: [0, 0.38, 0], half: [1.15, 0.38, 0.5], round: 0.01, material: 'screen' },
      // Cake tiers, turned a little.
      { at: [0, 0.9, 0], half: [0.3, 0.14, 0.3], yaw: 0.55, round: 0.012, material: 'screen' },
      { at: [0, 1.16, 0], half: [0.2, 0.12, 0.2], yaw: 0.55, round: 0.01, material: 'screen' },
      // Cake board.
      { at: [0, 0.765, 0], half: [0.38, 0.006, 0.38], yaw: 0.55, material: 'metal' },
    ],
  },
  surfaces: [
    { name: 'Tablecloth', box: 0, face: 'front', shader: 'dm-neon-lines' },
    { name: 'Lower tier front', box: 1, face: 'front', shader: 'desktop:93_MosaicTiles.fs' },
    { name: 'Lower tier side', box: 1, face: 'left', shader: 'desktop:93_MosaicTiles.fs' },
    { name: 'Upper tier front', box: 2, face: 'front', shader: 'desktop:17_IridescentPebbles.fs' },
    { name: 'Upper tier side', box: 2, face: 'left', shader: 'desktop:17_IridescentPebbles.fs' },
  ],
};

/** Gallery order. */
export const MAPPING_TEMPLATES: MappingTemplate[] = [BOXES, WINDOW, DOORWAY, FACADE, DJ, TABLE];

export const findTemplate = (id: string | undefined) => MAPPING_TEMPLATES.find((t) => t.id === id);

/** The template the first run opens on. Its biggest face plays the deck, so launching a pad shows there. */
export const DEMO_TEMPLATE_ID = 'boxes';
