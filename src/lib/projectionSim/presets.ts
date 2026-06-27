import type { ProjectionSimObject, ProjectionSimProjector, ProjectionSimScene, ProjectionSimVec3 } from './types';
import { createProjectionSimScene, makeProjectionSimPrimitive, makeProjectionSimProjector, type ProjectionSimPrimitiveKind } from './types';

export interface ProjectionSimPreset {
  id: string;
  name: string;
  description: string;
  build: () => ProjectionSimScene;
}

type ObjectPatch = Partial<Omit<ProjectionSimObject, 'id' | 'type' | 'primitive'>>;

function makeScene(name: string): ProjectionSimScene {
  const scene = createProjectionSimScene(name);
  scene.name = name;
  scene.id = `psim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  scene.environment = {
    ...scene.environment,
    background: '#040507',
    ambient: 0.18,
    roomExposure: 1.0,
    surfaceStyle: 'light-gray',
    floorColor: '#111318',
    showGrid: true,
    shadows: true,
  };
  return scene;
}

function singleProjector(name: string, position: ProjectionSimVec3, target: ProjectionSimVec3, fov = 38): ProjectionSimProjector {
  const projector = makeProjectionSimProjector(name, position, target);
  projector.fov = fov;
  projector.intensity = 3.2;
  projector.opacity = 1;
  projector.source = 'master';
  projector.crop = [0, 0, 1, 1];
  projector.edgeBlend = [0, 0, 0, 0];
  projector.showFrustum = true;
  return projector;
}

function obj(
  primitive: ProjectionSimPrimitiveKind,
  name: string,
  position: ProjectionSimVec3,
  scale: ProjectionSimVec3,
  color = '#cfd3d6',
  patch: ObjectPatch = {},
): ProjectionSimObject {
  return {
    ...makeProjectionSimPrimitive(primitive, name, position, scale, color),
    ...patch,
  };
}

function box(name: string, position: ProjectionSimVec3, scale: ProjectionSimVec3, color = '#cfd3d6', patch?: ObjectPatch): ProjectionSimObject {
  return obj('box', name, position, scale, color, patch);
}

function column(name: string, position: ProjectionSimVec3, scale: ProjectionSimVec3, color = '#dad7cd', patch?: ObjectPatch): ProjectionSimObject {
  return obj('column', name, position, scale, color, patch);
}

function pyramid(name: string, position: ProjectionSimVec3, scale: ProjectionSimVec3, color = '#d8d5cc', patch?: ObjectPatch): ProjectionSimObject {
  return obj('pyramid', name, position, scale, color, patch);
}

function setRot<T extends { rotation: ProjectionSimVec3 }>(object: T, rotation: ProjectionSimVec3): T {
  object.rotation = rotation;
  return object;
}

function clonePresetScene(scene: ProjectionSimScene): ProjectionSimScene {
  return JSON.parse(JSON.stringify(scene)) as ProjectionSimScene;
}

const DEFAULT_CUBE_PYRAMID_SCENE: ProjectionSimScene = {
  id: 'psim-default-cube-pyramid',
  name: 'Isometric Cube Pyramid',
  schemaVersion: 1,
  environment: {
    background: '#040507',
    ambient: 0.18,
    roomExposure: 1,
    surfaceStyle: 'light-gray',
    floorColor: '#111318',
    showGrid: true,
    shadows: true,
    shadowStrength: 1,
  },
  camera: {
    position: [5.6, 4.1, 6.6],
    target: [0, 1.55, -0.75],
    fov: 48,
  },
  objects: [
    {
      id: 'psobj-default-cube-1',
      name: 'Pyramid cube 1',
      type: 'primitive',
      primitive: 'box',
      position: [0.105, 0.6, -1.005],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#d9ddd8',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-2',
      name: 'Pyramid cube 2',
      type: 'primitive',
      primitive: 'box',
      position: [0.25, 0.6, -2.35],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#cbd1d4',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-3',
      name: 'Pyramid cube 3',
      type: 'primitive',
      primitive: 'box',
      position: [0.854, 0.6, -1.683],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#bcc4c8',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-4',
      name: 'Pyramid cube 4',
      type: 'primitive',
      primitive: 'box',
      position: [1.539, 0.6, -0.94],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#d9ddd8',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-5',
      name: 'Pyramid cube 5',
      type: 'primitive',
      primitive: 'box',
      position: [-0.566, 0.6, -1.747],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#cbd1d4',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-6',
      name: 'Pyramid cube 6',
      type: 'primitive',
      primitive: 'box',
      position: [-1.308, 0.6, -1.076],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#bcc4c8',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-7',
      name: 'Pyramid cube 7',
      type: 'primitive',
      primitive: 'box',
      position: [0.854, 1.6, -1.683],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#d9ddd8',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-8',
      name: 'Pyramid cube 8',
      type: 'primitive',
      primitive: 'box',
      position: [0.258, 1.61, -2.357],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#cbd1d4',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-9',
      name: 'Pyramid cube 9',
      type: 'primitive',
      primitive: 'box',
      position: [-0.559, 1.6, -1.753],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#bcc4c8',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
    {
      id: 'psobj-default-cube-10',
      name: 'Pyramid cube 10',
      type: 'primitive',
      primitive: 'box',
      position: [0.25, 2.61, -2.35],
      rotation: [0, 0.735, 0],
      scale: [1.01, 1.01, 1.01],
      color: '#d9ddd8',
      roughness: 0.82,
      visible: true,
      locked: false,
      castShadow: true,
      receiveProjection: true,
    },
  ],
  projectors: [
    {
      id: 'psproj-default-center',
      name: 'Center Projector',
      enabled: true,
      locked: false,
      position: [0, 3.8, 7.2],
      target: [0, 1.55, -0.75],
      fov: 34,
      aspect: 16 / 9,
      intensity: 3.2,
      opacity: 1,
      color: '#ffffff',
      source: 'master',
      sliceId: null,
      crop: [0, 0, 1, 1],
      edgeBlend: [0, 0, 0, 0],
      showFrustum: true,
    },
  ],
};

function addWindowGrid(
  objects: ProjectionSimObject[],
  opts: {
    prefix: string;
    cols: number;
    rows: number;
    startX: number;
    startY: number;
    stepX: number;
    stepY: number;
    z: number;
    windowSize?: [number, number];
    trimColor?: string;
    recessColor?: string;
  },
): void {
  const [w, h] = opts.windowSize ?? [0.52, 0.62];
  for (let row = 0; row < opts.rows; row++) {
    for (let col = 0; col < opts.cols; col++) {
      const x = opts.startX + col * opts.stepX;
      const y = opts.startY + row * opts.stepY;
      objects.push(box(`${opts.prefix} window ${row + 1}.${col + 1} recess`, [x, y, opts.z + 0.03], [w, h, 0.08], opts.recessColor ?? '#2c323a'));
      objects.push(box(`${opts.prefix} window ${row + 1}.${col + 1} trim top`, [x, y + h * 0.54, opts.z + 0.08], [w + 0.18, 0.055, 0.08], opts.trimColor ?? '#e0ded8'));
      objects.push(box(`${opts.prefix} window ${row + 1}.${col + 1} trim bottom`, [x, y - h * 0.54, opts.z + 0.08], [w + 0.18, 0.055, 0.08], opts.trimColor ?? '#e0ded8'));
      objects.push(box(`${opts.prefix} window ${row + 1}.${col + 1} mullion`, [x, y, opts.z + 0.1], [0.045, h + 0.05, 0.06], opts.trimColor ?? '#d7d5cf'));
    }
  }
}

function cubePyramid(): ProjectionSimScene {
  return clonePresetScene(DEFAULT_CUBE_PYRAMID_SCENE);
}

function museumFacade(): ProjectionSimScene {
  const scene = makeScene('Museum Facade');
  scene.camera.position = [10.8, 6.4, 12.4];
  scene.camera.target = [0, 3.05, -0.15];
  scene.projectors = [
    singleProjector('Center Projector', [0, 5.25, 11.3], [0, 3.0, -0.05], 39),
  ];

  const objects: ProjectionSimObject[] = [
    box('Rear limestone wall', [0, 3.15, -0.42], [11.7, 5.35, 0.7], '#c8c6bd'),
    box('Left facade wing', [-6.45, 2.55, -0.25], [1.65, 4.2, 0.95], '#b9b8b1'),
    box('Right facade wing', [6.45, 2.55, -0.25], [1.65, 4.2, 0.95], '#b9b8b1'),
    box('Main entablature', [0, 5.72, -0.08], [12.45, 0.55, 1.15], '#d6d3ca'),
    box('Upper cornice lip', [0, 6.08, 0.02], [12.85, 0.22, 1.32], '#ebe8dc'),
    pyramid('Triangular pediment', [0, 6.72, -0.06], [10.85, 1.3, 1.15], '#d9d6cc'),
    box('Pediment relief block', [0, 6.45, 0.48], [3.2, 0.28, 0.08], '#aba9a2'),
    box('Ground plinth', [0, 0.42, 0.64], [13.2, 0.84, 1.95], '#a8a59d'),
    box('Lower step 1', [0, 0.18, 1.55], [14.1, 0.22, 2.1], '#8f918e'),
    box('Lower step 2', [0, 0.02, 2.32], [14.8, 0.18, 1.45], '#7e8384'),
    box('Central door recess', [0, 1.55, 0.06], [1.95, 2.25, 0.24], '#2f343b'),
    box('Door lintel', [0, 2.75, 0.22], [2.35, 0.24, 0.18], '#e0ddd3'),
  ];

  for (let i = 0; i < 7; i++) {
    const x = -4.5 + i * 1.5;
    objects.push(column(`Fluted column ${i + 1}`, [x, 2.85, 0.28], [0.54, 4.65, 0.54], '#dedbd0'));
    objects.push(box(`Column ${i + 1} vertical shadow groove`, [x + 0.23, 2.85, 0.62], [0.045, 3.72, 0.08], '#8f938f'));
    objects.push(box(`Column ${i + 1} base block`, [x, 0.62, 0.37], [0.92, 0.3, 0.92], '#cbc8be'));
  }

  addWindowGrid(objects, {
    prefix: 'museum wing',
    cols: 2,
    rows: 2,
    startX: -6.45,
    startY: 1.65,
    stepX: 12.9,
    stepY: 1.18,
    z: 0.33,
    windowSize: [0.58, 0.68],
  });

  scene.objects = objects;
  return scene;
}

function fragmentedCubes(): ProjectionSimScene {
  const scene = makeScene('Fragmented Cube Wall');
  scene.environment.roomExposure = 0.85;
  scene.camera.position = [9.4, 5.7, 11.4];
  scene.camera.target = [0.15, 3.0, 0.12];
  scene.projectors = [
    singleProjector('Center Projector', [0, 4.85, 10.8], [0, 3.05, 0.05], 43),
  ];

  const objects: ProjectionSimObject[] = [
    box('Low stage base', [0, 0.24, -0.35], [9.65, 0.48, 1.2], '#8f8c82', { receiveProjection: false }),
  ];

  const unit = 0.82;
  const rows = [
    '11110111111',
    '11100110111',
    '01110111110',
    '01101101110',
    '11110110111',
    '01111011110',
    '00110010100',
  ];
  const depths = [0.78, 1.08, 1.36, 0.92, 1.58, 1.18, 0.84];
  rows.forEach((row, rowIndex) => {
    for (let col = 0; col < row.length; col++) {
      if (row[col] !== '1') continue;
      const x = (col - (row.length - 1) / 2) * unit;
      const y = 0.48 + rowIndex * unit + unit / 2;
      const depth = depths[(rowIndex * 3 + col) % depths.length];
      const z = -0.18 + depth * 0.5 + (((rowIndex + col) % 4) - 1.5) * 0.035;
      const color = (rowIndex + col) % 3 === 0 ? '#d8d2c3' : (rowIndex + col) % 3 === 1 ? '#cfc7b8' : '#e1dccf';
      objects.push(box(`Fragment cube ${rowIndex + 1}.${col + 1}`, [x, y, z], [unit * 0.98, unit * 0.98, depth], color));
    }
  });

  const accentBlocks: ProjectionSimObject[] = [
    box('Left upper bridge', [-2.85, 5.2, 0.34], [2.6, 0.72, 1.18], '#cfc8ba'),
    box('Center upper bridge', [0.85, 5.65, 0.28], [2.15, 0.78, 1.08], '#d8d1c4'),
    box('Right tower cap', [3.85, 5.7, 0.24], [0.92, 2.3, 1.05], '#d4cbbc'),
    box('Left tower cap', [-3.7, 4.85, 0.14], [0.86, 1.65, 1.1], '#ddd6ca'),
    box('Deep lower left pocket', [-3.72, 1.28, 0.84], [0.88, 1.02, 1.52], '#bcb4a4'),
    box('Deep lower center pocket', [-0.35, 1.2, 0.92], [0.9, 1.12, 1.72], '#cbc3b2'),
    box('Deep lower right pocket', [3.08, 1.35, 0.86], [0.95, 1.18, 1.55], '#c3b9a8'),
    box('Central screen face', [0.8, 2.88, 1.02], [2.05, 1.72, 0.16], '#b8bbb4'),
    box('Central screen left edge', [-0.26, 2.88, 1.12], [0.08, 1.86, 0.16], '#f0eadc'),
    box('Central screen right edge', [1.86, 2.88, 1.12], [0.08, 1.86, 0.16], '#f0eadc'),
    box('Central screen top edge', [0.8, 3.84, 1.12], [2.2, 0.08, 0.16], '#f0eadc'),
    box('Central screen bottom edge', [0.8, 1.92, 1.12], [2.2, 0.08, 0.16], '#f0eadc'),
  ];
  accentBlocks.forEach((block, index) => {
    if (index < 7) setRot(block, [0, ((index % 3) - 1) * 0.035, 0]);
    objects.push(block);
  });

  scene.objects = objects;
  return scene;
}

export const PROJECTION_SIM_PRESETS: ProjectionSimPreset[] = [
  { id: 'cube-pyramid', name: 'Isometric Cube Pyramid', description: 'Ten touching cubes in a 6/3/1 isometric mapping stack.', build: cubePyramid },
  { id: 'museum-facade', name: 'Museum Facade', description: 'A single-projector neoclassical facade with columns, steps, pediment, windows, and recesses.', build: museumFacade },
  { id: 'isam-cubes', name: 'Fragmented Cube Wall', description: 'A single-projector sculptural wall of staggered matte cubes with voids and a central panel.', build: fragmentedCubes },
];

export function buildProjectionSimPreset(id: string): ProjectionSimScene | null {
  return PROJECTION_SIM_PRESETS.find((preset) => preset.id === id)?.build() ?? null;
}
