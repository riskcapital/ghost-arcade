import { describe, expect, it } from 'vitest';
import { liveColor, matchByName, positionFallback, relink, resolveSource, sanitizeLinks, type AbletonLink, type LiveScene, type LiveTrack } from './abletonLinks';

const scene = (name: string): LiveScene => ({ name, color: 0, queued: false });
const track = (name: string, clips: (string | null)[]): LiveTrack => ({
  name, color: 0, playing: -1, fired: -1, slots: clips.map(c => (c === null ? null : { name: c, color: 0 })),
});

describe('matchByName', () => {
  it('prefers the stored position among duplicates', () => {
    expect(matchByName(['Drop', 'Break', 'Drop'], 'Drop', 2)).toBe(2);
    expect(matchByName(['Drop', 'Break', 'Drop'], 'Drop', 1)).toBe(0);
  });
  it('falls back to the position when the name is gone', () => {
    expect(matchByName(['Intro', 'Big drop'], 'Drop', 1)).toBe(1);
    expect(matchByName(['Intro'], 'Drop', 3)).toBe(-1);
    expect(matchByName(['Intro', 'Big drop'], 'Drop', 1, false)).toBe(-1);
  });
});

describe('relink', () => {
  const sceneLink: AbletonLink = { id: 's', source: { kind: 'scene', scene: 1, name: 'Drop' }, action: { kind: 'snapshot', slot: 2 } };
  const clipLink: AbletonLink = {
    id: 'c', source: { kind: 'clip', track: 0, slot: 1, trackName: 'Keys', name: 'Arp' },
    action: { kind: 'clip', deck: 'A', layer: 1, column: 3 },
  };

  it('follows a scene that moved', () => {
    const [moved] = relink([sceneLink], [scene('Intro'), scene('Build'), scene('Drop')], []).links;
    expect(moved.source).toEqual({ kind: 'scene', scene: 2, name: 'Drop' });
  });

  it('follows a scene that was renamed in place', () => {
    const [renamed] = relink([sceneLink], [scene('Intro'), scene('Drop 2')], []).links;
    expect(renamed.source).toEqual({ kind: 'scene', scene: 1, name: 'Drop 2' });
  });

  it('follows a track and clip that both moved', () => {
    const tracks = [track('Drums', ['Kick']), track('Keys', [null, null, 'Arp'])];
    const [moved] = relink([clipLink], [], tracks).links;
    expect(moved.source).toEqual({ kind: 'clip', track: 1, slot: 2, trackName: 'Keys', name: 'Arp' });
  });

  it('lets go of a deleted scene instead of taking its neighbour', () => {
    const scenes = [scene('Intro'), scene('Break')];
    const result = relink([sceneLink], scenes, [], positionFallback({ scenes: 3, tracks: 0 }, { scenes: 2, tracks: 0 }));
    expect(result.links[0]).toBe(sceneLink);
    expect(result.missing).toEqual(['s']);
  });

  it('keeps a link whose clip was deleted, unchanged', () => {
    expect(resolveSource(clipLink.source, [], [track('Keys', ['Pad'])])).toBeNull();
    const result = relink([clipLink], [], [track('Keys', ['Pad'])]);
    expect(result.links[0]).toBe(clipLink);
    expect(result.missing).toEqual(['c']);
  });
});

describe('sanitizeLinks', () => {
  it('drops malformed links and defaults the deck', () => {
    const links = sanitizeLinks([
      { id: 'a', source: { kind: 'scene', scene: 0, name: 'Intro' }, action: { kind: 'column', column: 2 } },
      { id: 'b', source: { kind: 'scene', scene: -1 }, action: { kind: 'column', column: 2 } },
      { id: 'c', source: { kind: 'clip', track: 1, slot: 0 }, action: { kind: 'unknown' } },
      null,
    ]);
    expect(links).toEqual([{ id: 'a', source: { kind: 'scene', scene: 0, name: 'Intro' }, action: { kind: 'column', deck: 'A', column: 2 } }]);
  });
});

it('formats Live colours as hex', () => {
  expect(liveColor(0xff3a20)).toBe('#ff3a20');
  expect(liveColor(0x0000ff)).toBe('#0000ff');
});
