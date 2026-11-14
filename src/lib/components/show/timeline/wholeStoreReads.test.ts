import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The show store publishes a new state every playhead frame. A tray part
 * that reads `$showTimeline` re-runs on every one of them; the where band
 * redrew its whole canvas (thousands of fills) each frame while a show
 * played. These read slices (timelineSlices.ts) instead.
 */
const PARTS = ['WhereBand', 'WhereStageHighlight', 'WhereEditor', 'WherePatternEditor', 'LedRowLanes', 'LedRowHeaders', 'LineRecordControls'].map((name) => `show/timeline/${name}`);
/** Panels outside the tray that read the show too (zone actions). */
const PANELS = ['show/ShowActionPicker', 'studio/InteractiveZonePanel'];

describe('Timeline tray parts do not follow every playhead frame', () => {
  for (const path of [...PARTS, ...PANELS]) {
    const name = path.split('/').pop();
    it(`${name} reads the show through slices`, () => {
      const source = readFileSync(join(process.cwd(), 'src', 'lib', 'components', `${path}.svelte`), 'utf8');
      const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/\$showTimeline\b/);
      expect(code).toMatch(/showSlice\(/);
    });
  }
});
