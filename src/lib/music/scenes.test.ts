import { describe, expect, it } from 'vitest';
import { createPattern, starterPattern, toggleStep } from './drumPattern';
import {
  captureScene,
  dominantColumn,
  nextSceneName,
  normalizeScene,
  sceneLaunchActions,
  type MusicScene,
  type PlayingNow,
} from './scenes';

const playing = (over: Partial<PlayingNow> = {}): PlayingNow => ({
  pattern: starterPattern(),
  beat: true,
  takeId: 'loop-a',
  vjColumn: 2,
  ...over,
});

describe('scenes', () => {
  it('captures what is playing, with its own copy of the beat', () => {
    const now = playing();
    const scene = captureScene('s1', 'Arrival', now);
    expect(scene).toEqual({ id: 's1', name: 'Arrival', pattern: now.pattern, beat: true, takeId: 'loop-a', vjColumn: 2 });
    expect(scene.pattern).not.toBe(now.pattern);
  });

  it('launching only changes what differs, so a shared beat keeps running', () => {
    const scene = captureScene('s1', 'Arrival', playing());
    expect(sceneLaunchActions(scene, playing(), new Set(['loop-a']))).toEqual([]);

    const other = captureScene('s2', 'Breath', playing({ beat: false, takeId: 'loop-b', vjColumn: 5 }));
    expect(sceneLaunchActions(other, playing(), new Set(['loop-a', 'loop-b']))).toEqual([
      { kind: 'beat', play: false },
      { kind: 'take', takeId: 'loop-b' },
      { kind: 'visuals', column: 5 },
    ]);
  });

  it('loads a different beat pattern', () => {
    const changed = toggleStep(starterPattern(), 'crash', 0);
    const scene = captureScene('s', 'Peak', playing({ pattern: changed }));
    expect(sceneLaunchActions(scene, playing(), new Set(['loop-a']))).toEqual([{ kind: 'pattern', pattern: changed }]);
  });

  it('stops a loop whose take was deleted rather than failing', () => {
    const scene = captureScene('s', 'Drift', playing({ takeId: 'gone' }));
    expect(sceneLaunchActions(scene, playing(), new Set(['loop-a']))).toEqual([{ kind: 'take', takeId: null }]);
  });

  it('leaves the visuals alone when the scene has no column', () => {
    const scene = { ...captureScene('s', 'Break', playing()), vjColumn: null };
    expect(sceneLaunchActions(scene, playing({ vjColumn: 7 }), new Set(['loop-a']))).toEqual([]);
  });

  it('picks the column most layers are playing', () => {
    expect(dominantColumn([2, 2, 5, null])).toBe(2);
    expect(dominantColumn([4, 1])).toBe(1);
    expect(dominantColumn([null, undefined])).toBeNull();
  });

  it('names new scenes from a list, then by number', () => {
    expect(nextSceneName([])).toBe('Arrival');
    const s = (name: string): MusicScene => ({ id: name, name, pattern: null, beat: false, takeId: null, vjColumn: null });
    expect(nextSceneName([s('Arrival')])).toBe('Breath');
    const all = ['Arrival', 'Breath', 'Bloom', 'Drift', 'Release', 'Dawn', 'Pressure', 'Peak', 'Break', 'Return'].map(s);
    expect(nextSceneName(all)).toBe('Scene 11');
  });

  it('reads a saved scene back safely', () => {
    expect(normalizeScene({ id: 'x', name: '  ', pattern: { steps: 8 }, beat: 'yes', vjColumn: -1 })).toEqual({
      id: 'x', name: 'Scene', pattern: createPattern(8), beat: false, takeId: null, vjColumn: null,
    });
    expect(normalizeScene({ id: 'y', vjColumn: 0, takeId: 't' })).toMatchObject({ vjColumn: 0, takeId: 't' });
    expect(normalizeScene({ name: 'no id' })).toBeNull();
  });
});
