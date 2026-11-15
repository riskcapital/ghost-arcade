import { describe, expect, it } from 'vitest';
import { BASIC_TOOLS, motionToolsFor, withTool } from './motionTool';
import { WORLD_TOOLS } from './desktopCapabilities';

describe('camera motion as a touch tool', () => {
  it('offers the world tools only with the world on a desktop that acts on them', () => {
    expect(motionToolsFor(false, WORLD_TOOLS)).toEqual(BASIC_TOOLS);
    expect(motionToolsFor(true, undefined)).toEqual(BASIC_TOOLS);
    expect(motionToolsFor(true, WORLD_TOOLS)).toEqual(WORLD_TOOLS);
    expect(motionToolsFor(true, WORLD_TOOLS)).toHaveLength(7);
  });
  it('sends Attract as 1.2 did (no mode) and any other tool as its mode', () => {
    const seen = [{ id: 'camera-motion', point: { x: 0.4, y: 0.6 }, strength: 0.5 }];
    expect(withTool(seen, 'attract')).toBe(seen);
    expect(withTool(seen, 'throw')).toEqual([{ ...seen[0], mode: 'throw' }]);
    expect(withTool(seen, 'vortex')[0].mode).toBe('vortex');
    expect(withTool([], 'ignite')).toEqual([]);
  });
});
