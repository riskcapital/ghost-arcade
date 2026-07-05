import type { Layer, WarpCorners } from '../types';
import type {
  Stage3DScene,
  Stage3DVenue,
  StageLedScreenNode,
  StagePrimitiveNode,
  Vec3,
} from './types';

type ScreenMount = {
  ledWall: {
    centerX: number;
    centerY: number;
    centerZ: number;
    width: number;
    height: number;
  };
  lockScreenTransforms?: boolean;
  defaultScreenTransform?: {
    position?: Vec3;
    rotation?: Vec3;
    scale?: Vec3;
  };
};

type ScreenPlacement = {
  position: Vec3;
  width: number;
  height: number;
};

export type NativeStageCameraOverride = {
  position: Vec3;
  target: Vec3;
  fov: number;
};

type NativeBridgeOptions = {
  camera?: NativeStageCameraOverride;
  includeVenuePrimitives?: boolean;
};

const NATIVE_AUTO_SCREEN_ID_PREFIX = 'native-auto-screen:';
const NATIVE_VENUE_ID_PREFIX = 'native-venue:';

const SCREEN_MOUNTS: Record<Stage3DVenue, ScreenMount> = {
  empty: {
    ledWall: { centerX: 0, centerY: 7, centerZ: -18, width: 28, height: 12 },
  },
  festival: {
    ledWall: { centerX: 0, centerY: 9.7, centerZ: -14.4, width: 28, height: 15.75 },
  },
  arena: {
    ledWall: { centerX: 0, centerY: 9.9, centerZ: -17.3, width: 26, height: 14.625 },
  },
  club: {
    ledWall: { centerX: 0, centerY: 6.9, centerZ: -21.55, width: 16, height: 9 },
  },
  nightclub: {
    ledWall: { centerX: 0, centerY: 5.2, centerZ: -17.55, width: 13, height: 7.3125 },
  },
  sphere: {
    ledWall: { centerX: 0, centerY: 15.5, centerZ: -48, width: 52, height: 30 },
    lockScreenTransforms: true,
    defaultScreenTransform: {
      position: [0, 1.4382488741229977, 7],
      rotation: [0, 0, 0],
      scale: [1.3762535407255738, 1.3762535407255738, 1.3762535407255738],
    },
  },
};

const DARK_FLOOR = { color: '#090b10', roughness: 0.72, metalness: 0.12 };
const DARK_DECK = { color: '#111419', roughness: 0.7, metalness: 0.2 };
const BLACK_SCENERY = { color: '#000000', roughness: 1, metalness: 0 };
const CLUB_WALL = { color: '#14101a', roughness: 0.92, metalness: 0.05 };

const VENUE_PRIMITIVES: Record<Stage3DVenue, Array<Omit<StagePrimitiveNode, 'visible' | 'locked' | 'type'>>> = {
  empty: [
    primitiveSpec('floor', 'Floor', [0, -0.05, 0], [0, 0, 0], [90, 0.1, 90], DARK_FLOOR),
  ],
  festival: [
    primitiveSpec('floor', 'Festival Floor', [0, -0.05, 0], [0, 0, 0], [220, 0.1, 220], DARK_FLOOR),
    primitiveSpec('deck', 'Festival Deck', [0, 0.7, -6], [0, 0, 0], [36, 1.4, 18], DARK_DECK),
    primitiveSpec('riser', 'Drum Riser', [0, 2, -9], [0, 0, 0], [10, 1.2, 7], DARK_DECK),
    primitiveSpec('backdrop', 'Black Backdrop', [0, 12, -16], [0, 0, 0], [42, 24, 0.08], BLACK_SCENERY),
  ],
  arena: [
    primitiveSpec('floor', 'Arena Floor', [0, -0.05, 0], [0, 0, 0], [172, 0.1, 172], DARK_FLOOR),
    primitiveSpec('deck', 'Arena Deck', [0, 0.7, -8], [0, 0, 0], [32, 1.4, 16], DARK_DECK),
    primitiveSpec('riser', 'Arena Riser', [0, 2, -12], [0, 0, 0], [9, 1.2, 6], DARK_DECK),
    primitiveSpec('backdrop', 'Arena Backdrop', [0, 11.5, -17.5], [0, 0, 0], [40, 23, 0.08], BLACK_SCENERY),
  ],
  club: [
    primitiveSpec('floor', 'Club Floor', [0, -0.05, 0], [0, 0, 0], [56, 0.1, 44], DARK_FLOOR),
    primitiveSpec('back-wall', 'Club Back Wall', [0, 7.5, -21.8], [0, 0, 0], [56, 15, 0.08], CLUB_WALL),
    primitiveSpec('deck', 'Club Deck', [0, 0.6, -16], [0, 0, 0], [22, 1.2, 9], DARK_DECK),
    primitiveSpec('riser', 'Club Riser', [0, 1.65, -18], [0, 0, 0], [7, 0.9, 4], DARK_DECK),
  ],
  nightclub: [
    primitiveSpec('floor', 'Nightclub Floor', [0, -0.05, 0], [0, 0, 0], [40, 0.1, 36], DARK_FLOOR),
    primitiveSpec('back-wall', 'Nightclub Back Wall', [0, 6, -17.8], [0, 0, 0], [40, 12, 0.08], BLACK_SCENERY),
    primitiveSpec('booth', 'DJ Booth', [0, 0.35, -13], [0, 0, 0], [9, 0.7, 4], DARK_DECK),
    primitiveSpec('desk', 'DJ Desk', [0, 1.225, -12.4], [0, 0, 0], [5.2, 1.05, 1.5], DARK_DECK),
  ],
  sphere: [
    primitiveSpec('floor', 'Sphere Floor', [0, -0.05, 0], [0, 0, 0], [84, 0.1, 84], DARK_FLOOR),
    primitiveSpec('stage', 'Sphere Stage', [0, 0.62, -62.80007943796692], [0, 0, 0], [22, 1.1, 9.5], DARK_DECK),
  ],
};

function primitiveSpec(
  id: string,
  name: string,
  position: Vec3,
  rotation: Vec3,
  dimensions: Vec3,
  material: StagePrimitiveNode['material'],
): Omit<StagePrimitiveNode, 'visible' | 'locked' | 'type'> {
  return {
    id: `${NATIVE_VENUE_ID_PREFIX}${id}`,
    name,
    position,
    rotation,
    scale: [1, 1, 1],
    geometry: 'box',
    dimensions,
    material,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nativeAutoScreenId(layerId: string): string {
  return `${NATIVE_AUTO_SCREEN_ID_PREFIX}${layerId}`;
}

function layerCorners(layer: Layer): WarpCorners | null {
  const corners = layer.corners;
  if (!corners) return null;
  const values = [
    corners.topLeft?.x,
    corners.topLeft?.y,
    corners.topRight?.x,
    corners.topRight?.y,
    corners.bottomLeft?.x,
    corners.bottomLeft?.y,
    corners.bottomRight?.x,
    corners.bottomRight?.y,
  ];
  return values.every(Number.isFinite) ? corners : null;
}

export function nativeStageScreenPlacement(layer: Layer, mount: ScreenMount['ledWall']): ScreenPlacement | null {
  const corners = layerCorners(layer);
  if (!corners) return null;
  const xs = [corners.topLeft.x, corners.topRight.x, corners.bottomLeft.x, corners.bottomRight.x];
  const ys = [corners.topLeft.y, corners.topRight.y, corners.bottomLeft.y, corners.bottomRight.y];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const width = Math.max(0.1, maxX - minX) * mount.width;
  const height = Math.max(0.1, maxY - minY) * mount.height;

  return {
    position: [
      mount.centerX + (cx - 0.5) * mount.width,
      mount.centerY + (0.5 - cy) * mount.height,
      mount.centerZ + 0.1,
    ],
    width,
    height,
  };
}

function collectNodeKeys(nodes: Stage3DScene['nodes'] | undefined, keys = {
  ids: new Set<string>(),
  ledScreens: new Set<string>(),
}): { ids: Set<string>; ledScreens: Set<string> } {
  if (!Array.isArray(nodes)) return keys;
  for (const node of nodes) {
    keys.ids.add(node.id);
    if (node.type === 'led-screen') {
      keys.ledScreens.add(`id:${node.id}`);
      keys.ledScreens.add(`source:${node.source}`);
    }
    if (node.type === 'group') collectNodeKeys(node.children, keys);
  }
  return keys;
}

function nativeVenuePrimitiveNodes(venue: Stage3DVenue, existingIds: Set<string>): StagePrimitiveNode[] {
  const specs = VENUE_PRIMITIVES[venue] ?? VENUE_PRIMITIVES.festival;
  const nodes: StagePrimitiveNode[] = [];
  for (const spec of specs) {
    if (existingIds.has(spec.id)) continue;
    existingIds.add(spec.id);
    nodes.push({
      ...cloneJson(spec),
      type: 'primitive',
      visible: true,
      locked: true,
    });
  }
  return nodes;
}

function screenNodeForLayer(
  layer: Layer,
  scene: Stage3DScene,
  mount: ScreenMount,
): StageLedScreenNode | null {
  const placement = nativeStageScreenPlacement(layer, mount.ledWall);
  if (!placement) return null;
  const override = scene.screenOverrides?.[layer.id] ?? {};
  const locked = !!mount.lockScreenTransforms;
  const defaults = mount.defaultScreenTransform ?? {};
  const position = locked
    ? (defaults.position ?? placement.position)
    : (override.position ?? placement.position);
  const rotation = locked
    ? (defaults.rotation ?? [0, 0, 0])
    : (override.rotation ?? [0, 0, 0]);
  const scale = locked
    ? (defaults.scale ?? [1, 1, 1])
    : (override.scale ?? [1, 1, 1]);

  return {
    id: nativeAutoScreenId(layer.id),
    name: layer.name || 'Screen',
    type: 'led-screen',
    position: [...position],
    rotation: [...rotation],
    scale: [...scale],
    visible: true,
    locked: true,
    width: placement.width,
    height: placement.height,
    curvature: locked ? 0 : (override.curvature ?? 0),
    finish: override.finish ?? 'led',
    frameDepth: override.frameDepth ?? 0.08,
    source: layer.id,
    brightness: override.brightness ?? 1,
    showPixels: (override.edgeEffect ?? 'none') === 'pixel-grid',
    displayFit: override.displayFit ?? 'stretch',
    edgeEffect: override.edgeEffect ?? 'none',
  };
}

export function buildNativeStage3DScene(
  scene: Stage3DScene,
  layers: readonly Layer[],
  options: NativeBridgeOptions = {},
): Stage3DScene {
  const nativeScene = cloneJson(scene);
  if (options.camera) {
    nativeScene.camera = {
      ...(nativeScene.camera ?? {}),
      position: [...options.camera.position],
      target: [...options.camera.target],
      fov: options.camera.fov,
    };
  }

  const venue = (nativeScene.venue ?? 'festival') as Stage3DVenue;
  const mount = SCREEN_MOUNTS[venue] ?? SCREEN_MOUNTS.festival;
  const keys = collectNodeKeys(nativeScene.nodes);
  const autoScreens: StageLedScreenNode[] = [];

  for (const layer of layers) {
    if (layer.type !== 'screen' || layer.visible === false) continue;
    if (keys.ledScreens.has(`id:${nativeAutoScreenId(layer.id)}`) || keys.ledScreens.has(`source:${layer.id}`)) continue;
    const screenNode = screenNodeForLayer(layer, nativeScene, mount);
    if (!screenNode) continue;
    keys.ids.add(screenNode.id);
    keys.ledScreens.add(`id:${screenNode.id}`);
    keys.ledScreens.add(`source:${screenNode.source}`);
    autoScreens.push(screenNode);
  }

  const venuePrimitives = options.includeVenuePrimitives === false
    ? []
    : nativeVenuePrimitiveNodes(venue, keys.ids);
  if (venuePrimitives.length > 0 || autoScreens.length > 0) {
    nativeScene.nodes = [...(nativeScene.nodes ?? []), ...venuePrimitives, ...autoScreens];
  }
  return nativeScene;
}
