import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The show store publishes a new state every playhead frame. A tray part
 * that reads `$showTimeline` re-runs on every one of them; the where band
 * redrew its whole canvas (thousands of fills) each frame while a show
 * played. These read slices (timelineSlices.ts) instead.
 */
const PARTS = [
  'WhereBand', 'WhereStageHighlight', 'WhereEditor', 'WherePatternEditor', 'LedRowLanes', 'LedRowHeaders', 'LineRecordControls',
  'ShowTrackHeaders', 'ShowTrackLanes', 'ShowTakeoverHatch',
  // The redesigned Timeline: toolbar, side column, rows, band and Perform.
  'TimelineToolbar', 'TimelineSide', 'ShowTrackHeader', 'ShowClipInspector', 'LinePointInfo', 'StageFxRowHeaders',
  'sound/SoundRowHeaders', 'sound/SoundRowLanes', 'sections/SectionLane', 'sections/SectionsLiveMenu', 'perform/PerformPanel',
].map((name) => `show/timeline/${name}`);
/** New Timeline parts that do not read the show at all: they must not start to follow every frame. */
const NO_SHOW = ['TlPopover', 'OutputButton', 'AddRowMenu', 'RowSectionHeader', 'RowSectionLane', 'TimelineIcon'].map((name) => `show/timeline/${name}`);
/** Panels outside the tray that read the show too (zone actions). */
const PANELS = ['show/ShowActionPicker', 'studio/InteractiveZonePanel'];

/** Comments out, strings kept (an accept list like 'audio/*' is not a comment). */
function stripComments(source: string): string {
  return source.replace(/^\s*\/\*[\s\S]*?\*\//gm, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('Timeline tray parts do not follow every playhead frame', () => {
  for (const path of NO_SHOW) {
    const name = path.split('/').pop();
    it(`${name} never reads the whole show`, () => {
      const source = readFileSync(join(process.cwd(), 'src', 'lib', 'components', `${path}.svelte`), 'utf8');
      const code = stripComments(source);
      expect(code).not.toMatch(/\$showTimeline\b/);
    });
  }
  for (const path of [...PARTS, ...PANELS]) {
    const name = path.split('/').pop();
    it(`${name} reads the show through slices`, () => {
      const source = readFileSync(join(process.cwd(), 'src', 'lib', 'components', `${path}.svelte`), 'utf8');
      const code = stripComments(source);
      expect(code).not.toMatch(/\$showTimeline\b/);
      expect(code).toMatch(/showSlice\(/);
    });
  }
});
