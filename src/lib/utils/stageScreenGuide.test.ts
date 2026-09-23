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
