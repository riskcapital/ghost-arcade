import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { linesStore, linesDrawingModeForTool } from './lines';

describe('line editor tool transitions', () => {
  it('leaves drawing mode when the toolbox selects Select / Edit Points', () => {
    for (const drawing of ['freehand', 'pointClick'] as const) {
      linesStore.setToolMode(drawing);
      expect(linesDrawingModeForTool(get(linesStore).toolMode)).toBe(drawing);
      linesStore.setToolMode('select');
      expect(linesDrawingModeForTool(get(linesStore).toolMode)).toBe('none');
    }
  });
  it('accepts the legacy idle mode and rejects unknown drawing tools', () => {
    for (const mode of ['none', undefined, null, 'invalid']) {
      expect(linesDrawingModeForTool(mode)).toBe('none');
    }
  });
});
