import { describe, expect, it } from 'vitest';
import { autoMapTargets, MAIN_OUTPUT_ID } from './screenOutputStatus';

describe('auto map with one projector', () => {
  const screen = { id: 's1', name: 'Screen 1', width: 1920, height: 1080, region: { x: 0, y: 0, width: 0.5, height: 1 } };
  it('maps the main output when no Screen is open, at its own size', () => {
    expect(autoMapTargets([], { width: 3840, height: 2160 }, true)).toEqual([{ id: MAIN_OUTPUT_ID, name: 'Main output', width: 3840, height: 2160, region: { x: 0, y: 0, width: 1, height: 1 } }]);
  });
  it('leaves several projectors to the Screens that are open', () => {
    expect(autoMapTargets([screen], { width: 3840, height: 2160 }, true)).toEqual([screen]);
  });
  it('offers nothing while the main output is closed', () => {
    expect(autoMapTargets([], { width: 1920, height: 1080 }, false)).toEqual([]);
    expect(autoMapTargets([], null, true)).toEqual([]);
  });
});
