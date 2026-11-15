import { describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

const projectState = writable<{ id: string; layers: unknown[] }>({ id: 'p1', layers: [] });
vi.mock('../../../stores/layers', () => ({ project: projectState }));

const {
  FOLDS_CAP,
  FOLDS_KEY,
  NO_FOLDS,
  askForRow,
  askedRows,
  foldStep,
  parseFoldChoices,
  rememberFolds,
  rowPresence,
  sectionFolds,
  sendFold,
  stageSummary,
} = await import('./rowSections');

const none = { presets: 0, looks: 0, looksLines: 0, screenfx: 0, effects: 0, ledRows: 0, camera: 0, groupRows: 0, controlLines: 0 };
const NAMES = { presets: 'Presets', looks: 'Looks', screenfx: 'Screen FX', effects: 'Effects', leds: 'LEDs', camera: 'Camera' };

describe('section folds', () => {
  it('toggle, open and fold each section on its own; a no-op returns the same state', () => {
    const a = foldStep(NO_FOLDS, { kind: 'toggle', id: 'audio' });
    expect(a).toEqual({ ...NO_FOLDS, audio: true });
    expect(foldStep(a, { kind: 'toggle', id: 'audio' })).toEqual(NO_FOLDS);
    expect(foldStep(a, { kind: 'fold', id: 'audio' })).toBe(a);
    expect(foldStep(a, { kind: 'open', id: 'stage' })).toBe(a);
    expect(foldStep(a, { kind: 'fold', id: 'control' })).toEqual({ ...NO_FOLDS, audio: true, control: true });
  });

  it('are kept per project, newest last, at most FOLDS_CAP projects', () => {
    let list = rememberFolds([], 'a', { ...NO_FOLDS, audio: true });
    list = rememberFolds(list, 'b', NO_FOLDS);
    list = rememberFolds(list, 'a', { ...NO_FOLDS, stage: true });
    expect(list.map(([id]) => id)).toEqual(['b', 'a']);
    expect(list[1][1].stage).toBe(true);
    let many: ReturnType<typeof rememberFolds> = [];
    for (let i = 0; i < FOLDS_CAP + 10; i++) many = rememberFolds(many, `p${i}`, NO_FOLDS);
    expect(many).toHaveLength(FOLDS_CAP);
    expect(many[0][0]).toBe('p10');
  });

  it('read back from storage, skipping anything broken', () => {
    expect(parseFoldChoices(JSON.stringify([['a', { audio: true, junk: 1 }], ['b', 'x'], [3, {}]]))).toEqual([['a', { ...NO_FOLDS, audio: true }]]);
    expect(parseFoldChoices('{nope')).toEqual([]);
    expect(parseFoldChoices(null)).toEqual([]);
  });

  it('follow the open project and are saved for it', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } });
    projectState.set({ id: 'p1', layers: [] });
    sendFold({ kind: 'fold', id: 'stage' });
    expect(get(sectionFolds).stage).toBe(true);
    expect(JSON.parse(store[FOLDS_KEY])).toEqual([['p1', { ...NO_FOLDS, stage: true }]]);
    projectState.set({ id: 'p2', layers: [] });
    expect(get(sectionFolds)).toEqual(NO_FOLDS);
    projectState.set({ id: 'p1', layers: [] });
    expect(get(sectionFolds).stage).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('rows appear when used', () => {
  it('hides empty special rows, and the Stage & FX, Groups and Control sections with nothing in them', () => {
    const p = rowPresence(none, new Set(), false);
    expect(p).toEqual({ presets: false, looks: false, screenfx: false, effects: false, leds: false, camera: false, stage: false, groups: false, control: false });
  });

  it('shows a row once it holds something (a look line keeps the Looks row), and its section with it', () => {
    const p = rowPresence({ ...none, looksLines: 1, screenfx: 2, controlLines: 1, groupRows: 2 }, new Set(), false);
    expect(p).toMatchObject({ looks: true, screenfx: true, effects: false, stage: true, groups: true, control: true });
    expect(stageSummary(p, NAMES)).toBe('Looks, Screen FX');
  });

  it('shows a row "+ Row" asked for while it is still empty', () => {
    expect(rowPresence(none, new Set(['presets', 'camera']), false)).toMatchObject({ presets: true, camera: true, stage: true, looks: false });
    askForRow('effects');
    askForRow('effects');
    expect([...get(askedRows)]).toEqual(['effects']);
  });

  it('"Show every row" shows them all, except LEDs without a controller (they have no rows to show)', () => {
    const p = rowPresence(none, new Set(), true);
    expect(p).toMatchObject({ presets: true, looks: true, screenfx: true, effects: true, camera: true, stage: true, control: true, leds: false });
    expect(rowPresence({ ...none, ledRows: 2 }, new Set(), false)).toMatchObject({ leds: true, stage: true });
  });
});
