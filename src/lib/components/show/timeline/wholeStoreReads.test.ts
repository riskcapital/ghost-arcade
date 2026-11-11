import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The show store publishes a new state every playhead frame. A tray part
 * that reads `$showTimeline` re-runs on every one of them; the where band
 * redrew its whole canvas (thousands of fills) each frame while a show
 * played. These read slices (timelineSlices.ts) instead.
 */
const PARTS = ['WhereBand', 'WhereStageHighlight', 'WhereEditor', 'LedRowLanes', 'LedRowHeaders', 'LineRecordControls'];

describe('Timeline tray parts do not follow every playhead frame', () => {
  for (const name of PARTS) {
    it(`${name} reads the show through slices`, () => {
      const source = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'show', 'timeline', `${name}.svelte`), 'utf8');
      const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/\$showTimeline\b/);
      expect(code).toMatch(/showSlice\(/);
    });
  }
});
