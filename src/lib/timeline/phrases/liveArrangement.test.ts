/**
 * Sections ↔ Live's locators: locators become sections (named, kinds from
 * the names, settings of same-named sections kept), sections become
 * locators at their starts, the bar offset moves both, and the round trip
 * through the Ghost Arcade script (on a fake Live) gives the same sections
 * back.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createTempoMap } from '../../show/tempoMap';
import type { TimelineSection } from '../sections/sectionModel';
import { kindFromName, liveToShowSeconds, locatorsFromSections, sameSpans, sectionsFromLocators, showToLiveQuarters } from './liveArrangement';

const map = createTempoMap(120, 0); // a bar is 2 s, 4 quarters
const sec = (id: string, name: string, start: number, end: number, extra: Partial<TimelineSection> = {}): TimelineSection =>
  ({ id, name, color: '#5b8def', start, end, action: 'through', ...extra });

describe('Live locators → sections', () => {
  it('each locator starts a section up to the next; the last runs to the end of the Timeline', () => {
    const out = sectionsFromLocators(
      [{ name: 'Intro', time: 0 }, { name: 'Build', time: 32 }, { name: 'Drop 1', time: 48 }, { name: 'Outro', time: 80 }],
      map, 0, [], 60,
    );
    expect(out.map((s) => [s.name, s.start, s.end, s.kind])).toEqual([
      ['Intro', 0, 16, 'intro'],
      ['Build', 16, 24, 'build'],
      ['Drop 1', 24, 40, 'drop'],
      ['Outro', 40, 60, 'outro'],
    ]);
  });

  it('without a Timeline length the last section is 8 bars; the bar offset moves them', () => {
    const out = sectionsFromLocators([{ name: 'A', time: 0 }], map, 2, [], 0);
    expect([out[0].start, out[0].end]).toEqual([4, 20]);
    expect(out[0].kind).toBeUndefined();
  });

  it("a section with a locator's name keeps its settings and moves; others outside them stay", () => {
    const existing = [
      sec('keep', 'Drop 1', 30, 38, { action: 'vamp', color: '#123456', phrase: { end: 'loop' }, liveScene: { scene: 2, name: 'Drop' } }),
      sec('early', 'Pre', 0, 4),
      sec('gone', 'Old', 20, 26),
    ];
    const out = sectionsFromLocators([{ name: 'Verse', time: 16 }, { name: 'Drop 1', time: 48 }], map, 0, existing, 40);
    expect(out.map((s) => s.id)).toEqual(['early', expect.any(String), 'keep']);
    expect(out[2]).toMatchObject({ id: 'keep', start: 24, end: 40, action: 'vamp', color: '#123456', phrase: { end: 'loop' }, liveScene: { scene: 2, name: 'Drop' } });
    expect(out[1]).toMatchObject({ name: 'Verse', start: 8, end: 24, kind: 'verse' });
  });

  it('kinds from names', () => {
    expect(kindFromName('Breakdown')).toBe('breakdown');
    expect(kindFromName('Pre-chorus')).toBe('build');
    expect(kindFromName('Chorus 2')).toBe('drop');
    expect(kindFromName('Section 7')).toBeUndefined();
  });
});

describe('sections → Live locators', () => {
  it("each section's name at its start in Live's beats; before Live's bar 1 is left out", () => {
    const sections = [sec('a', 'Intro', 0, 16), sec('b', 'Drop', 16, 32)];
    expect(locatorsFromSections(sections, map, 0)).toEqual([{ name: 'Intro', beat: 0 }, { name: 'Drop', beat: 32 }]);
    // Live's bar 1 on Timeline bar 5 (8 s): Intro is before it.
    expect(locatorsFromSections(sections, map, 4)).toEqual([{ name: 'Drop', beat: 16 }]);
    expect(showToLiveQuarters(map, 16, 4)).toBeCloseTo(16, 6);
    expect(liveToShowSeconds(map, 16, 4)).toBeCloseTo(16, 6);
  });

  it('round trip through the Ghost Arcade script on a fake Live gives the same sections back', () => {
    const sections = [sec('a', 'Intro', 0, 16), sec('b', 'Build', 16, 24), sec('c', 'Drop', 24, 40)];
    const items = locatorsFromSections(sections, map, 0);
    const root = path.resolve(__dirname, '../../../..');
    let out: string;
    try {
      out = execFileSync('python3', [
        path.join(root, 'tests/ableton/liveScriptHarness.py'),
        path.join(root, 'ableton/GhostArcade/GhostArcade.py'),
        JSON.stringify([{ t: 'set_locators', id: 1, items }]),
        '--stopped', '--cues', JSON.stringify([['Build', 40]]),
      ], { encoding: 'utf8' });
    } catch {
      return; // no Python here
    }
    const cues = (JSON.parse(out).cues as [string, number][]).map(([name, time]) => ({ name, time }));
    const back = sectionsFromLocators(cues, map, 0, sections, 40);
    expect(sameSpans(back, sections)).toBe(true);
    expect(back.map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });
});
