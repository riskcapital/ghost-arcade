import type { Layer, WarpCorners } from '../types';
import type {
  Stage3DScene,
  Stage3DVenue,
  StageLedScreenNode,
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

const NATIVE_AUTO_SCREEN_ID_PREFIX = 'native-auto-screen:';

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

function collectLedScreenKeys(nodes: Stage3DScene['nodes'] | undefined, keys = new Set<string>()): Set<string> {
  if (!Array.isArray(nodes)) return keys;
  for (const node of nodes) {
    if (node.type === 'led-screen') {
      keys.add(`id:${node.id}`);
      keys.add(`source:${node.source}`);
    }
    if (node.type === 'group') collectLedScreenKeys(node.children, keys);
  }
  return keys;
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
  options: { camera?: NativeStageCameraOverride } = {},
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
  const existing = collectLedScreenKeys(nativeScene.nodes);
  const autoScreens: StageLedScreenNode[] = [];

  for (const layer of layers) {
    if (layer.type !== 'screen' || layer.visible === false) continue;
    if (existing.has(`id:${nativeAutoScreenId(layer.id)}`) || existing.has(`source:${layer.id}`)) continue;
    const screenNode = screenNodeForLayer(layer, nativeScene, mount);
    if (!screenNode) continue;
    existing.add(`id:${screenNode.id}`);
    existing.add(`source:${screenNode.source}`);
    autoScreens.push(screenNode);
  }

  if (autoScreens.length > 0) {
    nativeScene.nodes = [...(nativeScene.nodes ?? []), ...autoScreens];
  }
  return nativeScene;
}
