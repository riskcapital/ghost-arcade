import { describe, expect, it } from 'vitest';
import type { Layer } from '../types';
import { buildNativeStage3DScene, nativeStageScreenPlacement } from './nativeSceneBridge';
import type { Stage3DScene } from './types';

function screenLayer(id: string, corners = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 1 },
  bottomRight: { x: 1, y: 1 },
}): Layer {
  return {
    id,
    name: id,
    type: 'screen',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    source: null,
    linesContent: null,
    svgContent: null,
    colorContent: null,
    lightPaintingContent: null,
    advLightPaintingContent: null,
    textContent: null,
    splatContent: null,
    model3dContent: null,
    pixelFXContent: null,
    gpuLayerContent: null,
    arcadeContent: null,
    position: { x: 0.5, y: 0.5 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    flipH: false,
    flipV: false,
    warpMode: 'corners',
    corners,
    meshGrid: null,
    mask: null,
    cropRegion: null,
    layerShape: null,
    effects: [],
    edgeEffects: null,
  } as Layer;
}

function scene(overrides: Stage3DScene['screenOverrides'] = {}): Stage3DScene {
  return {
    id: 'stage',
    name: 'Stage',
    schemaVersion: 1,
    environment: {
      background: '#000000',
      ambient: 0.2,
      showGround: true,
      groundColor: '#111111',
    },
    camera: {
      position: [0, 1, 2],
      target: [0, 0, 0],
      fov: 50,
    },
    nodes: [],
    lightingCueId: null,
    venue: 'festival',
    screenOverrides: overrides,
  };
}

describe('native Stage3D scene bridge', () => {
  it('maps screen-layer corners onto the festival native led wall', () => {
    const placement = nativeStageScreenPlacement(screenLayer('screen-1'), {
      centerX: 0,
      centerY: 9.7,
      centerZ: -14.4,
      width: 28,
      height: 15.75,
    });

    expect(placement).toEqual({
      position: [0, 9.7, -14.3],
      width: 28,
      height: 15.75,
    });
  });

  it('adds native led-screen nodes with user overrides and reel camera', () => {
    const nativeScene = buildNativeStage3DScene(
      scene({
        'screen-1': {
          position: [1, 2, 3],
          rotation: [0.1, 0.2, 0.3],
          scale: [1.5, 1, 1],
          brightness: 2.4,
          displayFit: 'cover',
          edgeEffect: 'pixel-grid',
        },
      }),
      [screenLayer('screen-1')],
      { camera: { position: [4, 5, 6], target: [7, 8, 9], fov: 71 } },
    );

    expect(nativeScene.camera).toMatchObject({
      position: [4, 5, 6],
      target: [7, 8, 9],
      fov: 71,
    });
    expect(nativeScene.nodes).toHaveLength(1);
    expect(nativeScene.nodes[0]).toMatchObject({
      id: 'native-auto-screen:screen-1',
      type: 'led-screen',
      source: 'screen-1',
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [1.5, 1, 1],
      brightness: 2.4,
      displayFit: 'cover',
      edgeEffect: 'pixel-grid',
      showPixels: true,
    });
  });

  it('does not duplicate screens already represented by saved nodes', () => {
    const current = scene();
    current.nodes = [{
      id: 'saved-screen',
      name: 'Saved Screen',
      type: 'led-screen',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      visible: true,
      width: 2,
      height: 1,
      curvature: 0,
      finish: 'led',
      frameDepth: 0.08,
      source: 'screen-1',
      brightness: 1,
      showPixels: false,
    }];

    const nativeScene = buildNativeStage3DScene(current, [screenLayer('screen-1')]);
    expect(nativeScene.nodes).toHaveLength(1);
    expect(nativeScene.nodes[0].id).toBe('saved-screen');
  });
});
