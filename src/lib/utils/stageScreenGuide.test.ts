import { describe, expect, it } from 'vitest';
import { createLayer, createMeshGrid } from '../types';
import { stageScreenGuidePath } from './stageScreenGuide';

describe('live stage screen guides', () => {
  it('follows a mesh edge instead of drawing only its corner quad', () => {
    const screen = createLayer('screen-guide', 'Screen', 'screen');
    screen.warpMode = 'mesh';
    screen.meshGrid = createMeshGrid(3, 3);
    screen.meshGrid.points[0][1].y = 0.75;
    const path = stageScreenGuidePath(screen, 100, 100);
    expect(path).toContain('50.00,25.00');
  });

  it('draws a Bezier mesh edge along its curve', () => {
    const screen = createLayer('bezier-guide', 'Screen', 'screen');
    screen.warpMode = 'mesh';
    screen.meshGrid = createMeshGrid(2, 2);
    screen.meshGrid.bezier = true;
    // Both top handles lifted by 0.2: the top edge bows up by 0.15 midway.
    screen.meshGrid.tangents = [
      [{ right: { x: 1 / 3, y: 0.2 } }, { left: { x: -1 / 3, y: 0.2 } }],
      [null, null],
    ];
    const path = stageScreenGuidePath(screen, 100, 100);
    // The top edge's midpoint: y = 1 + 0.75 * 0.2 = 1.15, i.e. 15px above the canvas.
    expect(path).toContain('50.00,-15.00');
    screen.meshGrid.bezier = false;
    expect(stageScreenGuidePath(screen, 100, 100)).toContain('50.00,0.00');
  });

  it('outlines the custom slice instead of its bounding rectangle', () => {
    const screen = createLayer('custom-guide', 'Triangle', 'screen');
    screen.layerShape = {
      type: 'custom', enabled: true,
      params: { customPoints: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }], customClosed: true },
    };
    const path = stageScreenGuidePath(screen, 100, 100);
    expect(path).toContain('50.00,0.00');
    expect(path).not.toContain('100.00,0.00');
  });
});
