/**
 * The ✦ Auto show dialog's state: every transition, a stale token changes
 * nothing, a throw anywhere ends in an error with Try again (never stuck on
 * "reading" or with its buttons off), a stale draft is worked out again
 * instead of laid down, Shuffle after an undo goes back to Build, and Close
 * or a new project stops what is waiting.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AutoShowPrep, AutoShowPrepResult } from '../../../../timeline/autoshow/autoShowRuntime';
import type { DraftCommitResult, ScorePrep, ScorePrepResult } from '../../../../timeline/score/scoreRuntime';
import {
  RESET_MESSAGE, THROW_MESSAGE, UNDONE_NOTE, autoShowTransition, createAutoShowFlow,
  type AutoShowFlowDeps, type AutoShowFlowEvent, type AutoShowFlowState, type AutoShowShown,
} from './autoShowFlow';

const prep = (over: Partial<AutoShowPrep> = {}) => ({
  style: 'driving', source: 'builtin', libraryVideos: 0, timings: { analysisMs: 100, draftMs: 10 },
  structure: { sections: [{ start: 0 }] }, track: { name: 'Song.wav', startTime: 0 }, draft: { adds: ['x'], skips: [], plan: [] }, reading: { style: 'driving' },
  ...over,
}) as unknown as AutoShowPrep;
const scorePrep = (tag = 's') => ({ tag, structure: { sections: [] }, track: { startTime: 0 }, draft: { adds: ['look'], skips: [] } }) as unknown as ScorePrep;

const P = prep();
const SP = scorePrep();
const shownOf = (over: Partial<AutoShowShown> = {}): AutoShowShown => ({ prep: P, content: 'builtin', scorePrep: null, note: null, ...over });

describe('the transition function', () => {
  const ready: AutoShowFlowState = { kind: 'ready', ...shownOf() };
  const cases: Array<[string, AutoShowFlowState, AutoShowFlowEvent, AutoShowFlowState['kind']]> = [
    ['idle → reading', { kind: 'idle' }, { type: 'read', token: 1 }, 'reading'],
    ['reading → ready', { kind: 'reading', token: 1 }, { type: 'read-ok', token: 1, prep: P, content: 'builtin' }, 'ready'],
    ['reading → error', { kind: 'reading', token: 1 }, { type: 'fail', token: 1, message: 'm', canRetry: true }, 'error'],
    ['ready → redrafting', ready, { type: 'redraft', token: 2 }, 'redrafting'],
    ['redrafting → ready', { kind: 'redrafting', token: 2, ...shownOf() }, { type: 'redraft-ok', token: 2, prep: P, content: 'both', scorePrep: null }, 'ready'],
    ['redrafting → error', { kind: 'redrafting', token: 2, ...shownOf() }, { type: 'fail', token: 2, message: 'm', canRetry: false }, 'error'],
    ['ready → building', ready, { type: 'build', token: 3 }, 'building'],
    ['building → done', { kind: 'building', token: 3, ...shownOf() }, { type: 'built', token: 3, builtMs: 5 }, 'done'],
    ['building → ready (worked out again)', { kind: 'building', token: 3, ...shownOf() }, { type: 'rebuilt', token: 3, prep: P, scorePrep: null, note: 'n' }, 'ready'],
    ['building → error', { kind: 'building', token: 3, ...shownOf() }, { type: 'fail', token: 3, message: 'm', canRetry: false }, 'error'],
    ['done → shuffling', { kind: 'done', builtMs: 5, ...shownOf() }, { type: 'shuffle', token: 4 }, 'shuffling'],
    ['shuffling → done', { kind: 'shuffling', token: 4, builtMs: 5, ...shownOf() }, { type: 'shuffled', token: 4, prep: P, scorePrep: null }, 'done'],
    ['shuffling → ready (undone)', { kind: 'shuffling', token: 4, builtMs: 5, ...shownOf() }, { type: 'undone', token: 4, prep: P, scorePrep: null, note: 'u' }, 'ready'],
    ['shuffling → error', { kind: 'shuffling', token: 4, builtMs: 5, ...shownOf() }, { type: 'fail', token: 4, message: 'm', canRetry: false }, 'error'],
    ['error (retry) → reading', { kind: 'error', message: 'm', canRetry: true, prep: null }, { type: 'read', token: 5 }, 'reading'],
    ['reset while reading → error', { kind: 'reading', token: 1 }, { type: 'reset' }, 'error'],
    ['reset while ready → error', ready, { type: 'reset' }, 'error'],
    ['reset while building → error', { kind: 'building', token: 3, ...shownOf() }, { type: 'reset' }, 'error'],
    ['reset when done → closed', { kind: 'done', builtMs: 5, ...shownOf() }, { type: 'reset' }, 'closed'],
    ['reset while shuffling → closed', { kind: 'shuffling', token: 4, builtMs: 5, ...shownOf() }, { type: 'reset' }, 'closed'],
    ['close from anything → closed', { kind: 'redrafting', token: 2, ...shownOf() }, { type: 'close' }, 'closed'],
  ];
  for (const [name, from, event, to] of cases) {
    it(name, () => expect(autoShowTransition(from, event).kind).toBe(to));
  }

  it('leaves the state as it is for an event that does not fit, or a stale token', () => {
    const notNow: Array<[AutoShowFlowState, AutoShowFlowEvent]> = [
      [{ kind: 'reading', token: 1 }, { type: 'read-ok', token: 9, prep: P, content: 'builtin' }],
      [{ kind: 'reading', token: 1 }, { type: 'build', token: 2 }],
      [{ kind: 'redrafting', token: 2, ...shownOf() }, { type: 'redraft', token: 3 }],
      [{ kind: 'redrafting', token: 2, ...shownOf() }, { type: 'build', token: 3 }],
      [{ kind: 'building', token: 3, ...shownOf() }, { type: 'built', token: 2, builtMs: 1 }],
      [{ kind: 'building', token: 3, ...shownOf() }, { type: 'shuffle', token: 4 }],
      [{ kind: 'ready', ...shownOf() }, { type: 'shuffle', token: 4 }],
      [{ kind: 'ready', ...shownOf() }, { type: 'fail', token: 4, message: 'm', canRetry: true }],
      [{ kind: 'done', builtMs: 1, ...shownOf() }, { type: 'build', token: 4 }],
      [{ kind: 'error', message: 'm', canRetry: false, prep: null }, { type: 'read', token: 4 }],
      [{ kind: 'error', message: 'm', canRetry: true, prep: null }, { type: 'reset' }],
      [{ kind: 'closed' }, { type: 'read', token: 4 }],
      [{ kind: 'closed' }, { type: 'reset' }],
    ];
    for (const [from, event] of notNow) expect(autoShowTransition(from, event)).toBe(from);
  });

  it('keeps what it shows through the steps, and the note only until the next step', () => {
    const r = autoShowTransition({ kind: 'building', token: 3, ...shownOf({ content: 'both' }) }, { type: 'rebuilt', token: 3, prep: P, scorePrep: null, note: 'changed' });
    expect(r).toMatchObject({ kind: 'ready', content: 'both', note: 'changed' });
    expect(autoShowTransition(r, { type: 'redraft', token: 4 })).toMatchObject({ kind: 'redrafting', note: null });
    const err = autoShowTransition({ kind: 'ready', ...shownOf() }, { type: 'reset' });
    expect(err).toMatchObject({ kind: 'error', message: RESET_MESSAGE, canRetry: true, prep: P });
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function fakeDeps(over: Partial<AutoShowFlowDeps> = {}) {
  let resetListener: (() => void) | null = null;
  const signals: AbortSignal[] = [];
  const deps: AutoShowFlowDeps = {
    prepare: vi.fn(async (signal: AbortSignal): Promise<AutoShowPrepResult> => { signals.push(signal); return { ok: true, prep: P }; }),
    redraft: vi.fn(async (p: AutoShowPrep, change: object, signal: AbortSignal) => { signals.push(signal); return { ...p, ...change } as AutoShowPrep; }),
    commit: vi.fn((): DraftCommitResult => ({ ok: true })),
    shuffle: vi.fn(async (): Promise<AutoShowPrepResult> => ({ ok: true, prep: prep({ style: 'hard' }) })),
    prepareScore: vi.fn(async (): Promise<ScorePrepResult> => ({ ok: true, prep: SP })),
    commitScore: vi.fn((): DraftCommitResult => ({ ok: true })),
    shuffleScore: vi.fn(async (): Promise<ScorePrepResult> => ({ ok: true, prep: scorePrep('shuffled') })),
    playFromTop: vi.fn(),
    release: vi.fn(),
    onReset: vi.fn((l: () => void) => { resetListener = l; return () => { resetListener = null; }; }),
    now: () => 0,
    ...over,
  };
  return { deps, signals, reset: () => resetListener?.(), listening: () => resetListener !== null };
}

async function readyFlow(over: Partial<AutoShowFlowDeps> = {}) {
  const f = fakeDeps(over);
  const flow = createAutoShowFlow(f.deps);
  await flow.start();
  expect(flow.current().kind).toBe('ready');
  return { ...f, flow };
}

describe('the dialog flow', () => {
  it('reads the song, then offers Both when the library has videos', async () => {
    const withVideos = prep({ libraryVideos: 2 });
    const { flow, deps } = await readyFlow({ prepare: async () => ({ ok: true, prep: withVideos }) });
    expect(deps.redraft).toHaveBeenCalledWith(withVideos, { source: 'both' }, expect.anything());
    expect(flow.current()).toMatchObject({ kind: 'ready', content: 'both' });
  });

  it('a read that throws ends in an error with Try again, and Try again reads again', async () => {
    let calls = 0;
    const f = fakeDeps({ prepare: async () => { calls++; if (calls === 1) throw new Error('decoder'); return { ok: true, prep: P }; } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const flow = createAutoShowFlow(f.deps);
    await flow.start();
    expect(flow.current()).toMatchObject({ kind: 'error', message: THROW_MESSAGE, canRetry: true });
    await flow.retry();
    expect(flow.current().kind).toBe('ready');
    warn.mockRestore();
  });

  it('a read that says no is an error without Try again', async () => {
    const f = fakeDeps({ prepare: vi.fn(async (): Promise<AutoShowPrepResult> => ({ ok: false, reason: 'Drop a song on the Audio row first.' })) });
    const flow = createAutoShowFlow(f.deps);
    await flow.start();
    expect(flow.current()).toMatchObject({ kind: 'error', message: 'Drop a song on the Audio row first.', canRetry: false });
    await flow.retry();
    expect(f.deps.prepare).toHaveBeenCalledTimes(1);
  });

  it('a throw while redrafting, building or shuffling never leaves it waiting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = await readyFlow({ redraft: async () => { throw new Error('x'); } });
    await a.flow.setStyle('hard');
    expect(a.flow.current().kind).toBe('error');

    const b = await readyFlow({ commit: () => { throw new Error('x'); } });
    await b.flow.build();
    expect(b.flow.current().kind).toBe('error');

    const c = await readyFlow({ shuffle: async () => { throw new Error('x'); } });
    await c.flow.build();
    await c.flow.shuffle();
    expect(c.flow.current().kind).toBe('error');

    const d = await readyFlow({ prepareScore: async () => { throw new Error('x'); } });
    await d.flow.setContent('looks');
    expect(d.flow.current().kind).toBe('error');
    warn.mockRestore();
  });

  it('a second click while a step runs does nothing (Shuffle included)', async () => {
    const gate = deferred<AutoShowPrepResult>();
    const { flow, deps } = await readyFlow({ shuffle: vi.fn(() => gate.promise) });
    await flow.build();
    const first = flow.shuffle();
    const second = flow.shuffle();
    await flow.setStyle('hard');
    await flow.build();
    expect(deps.shuffle).toHaveBeenCalledTimes(1);
    expect(deps.redraft).not.toHaveBeenCalled();
    expect(flow.current().kind).toBe('shuffling');
    gate.resolve({ ok: true, prep: prep({ style: 'chill' }) });
    await Promise.all([first, second]);
    expect(flow.current()).toMatchObject({ kind: 'done' });
  });

  it('style and content changes redraft; Looks only reads the Score draft', async () => {
    const { flow, deps } = await readyFlow();
    await flow.setStyle('hard');
    expect(deps.redraft).toHaveBeenLastCalledWith(P, { style: 'hard' }, expect.anything());
    await flow.setContent('looks');
    expect(flow.current()).toMatchObject({ kind: 'ready', content: 'looks', scorePrep: SP });
    // Style is not for Looks only.
    await flow.setStyle('chill');
    expect(deps.redraft).toHaveBeenCalledTimes(1);
    await flow.setContent('library');
    expect(deps.redraft).toHaveBeenLastCalledWith(expect.anything(), { source: 'library' }, expect.anything());
    expect(flow.current()).toMatchObject({ content: 'library' });
  });

  it('builds, then shuffles; Looks only builds and shuffles the Score draft and plays it', async () => {
    const a = await readyFlow();
    await a.flow.build();
    expect(a.deps.commit).toHaveBeenCalledWith(P);
    expect(a.flow.current()).toMatchObject({ kind: 'done', builtMs: 110 });
    await a.flow.shuffle();
    expect(a.flow.current()).toMatchObject({ kind: 'done', prep: { style: 'hard' } });

    const b = await readyFlow();
    await b.flow.setContent('looks');
    await b.flow.build();
    expect(b.deps.commitScore).toHaveBeenCalledWith(SP);
    expect(b.deps.playFromTop).toHaveBeenCalledTimes(1);
    await b.flow.shuffle();
    expect(b.flow.current()).toMatchObject({ kind: 'done', scorePrep: { tag: 'shuffled' } });
    expect(b.deps.playFromTop).toHaveBeenCalledTimes(2);
  });

  it('a draft gone stale is worked out again and shown, never laid down as it was', async () => {
    const fresh = prep({ style: 'groove' });
    let first = true;
    const { flow, deps } = await readyFlow({
      commit: vi.fn((): DraftCommitResult => (first ? (first = false, { ok: false, why: 'changed', reason: 'changed since' }) : { ok: true })),
      redraft: vi.fn(async () => fresh),
    });
    await flow.build();
    expect(deps.redraft).toHaveBeenCalledWith(P, {}, expect.anything());
    expect(flow.current()).toMatchObject({ kind: 'ready', prep: fresh, note: 'changed since' });
    await flow.build();
    expect(deps.commit).toHaveBeenLastCalledWith(fresh);
    expect(flow.current().kind).toBe('done');
  });

  it('a Looks only draft gone stale is read again', async () => {
    const again = scorePrep('again');
    let n = 0;
    const { flow } = await readyFlow({
      prepareScore: async () => ({ ok: true, prep: n++ ? again : SP }),
      commitScore: () => ({ ok: false, why: 'changed', reason: 'changed since' }),
    });
    await flow.setContent('looks');
    await flow.build();
    expect(flow.current()).toMatchObject({ kind: 'ready', scorePrep: again, note: 'changed since' });
  });

  it('a changed song refuses with Try again; another document or nothing to add refuses with OK', async () => {
    const song = await readyFlow({ commit: () => ({ ok: false, why: 'song', reason: 'The song changed' }) });
    await song.flow.build();
    expect(song.flow.current()).toMatchObject({ kind: 'error', message: 'The song changed', canRetry: true });
    const doc = await readyFlow({ commit: () => ({ ok: false, why: 'doc', reason: 'Open the Timeline first.' }) });
    await doc.flow.build();
    expect(doc.flow.current()).toMatchObject({ kind: 'error', canRetry: false });
    const empty = await readyFlow({ commit: () => ({ ok: false, why: 'empty', reason: 'Nothing to add' }) });
    await empty.flow.build();
    expect(empty.flow.current()).toMatchObject({ kind: 'error', message: 'Nothing to add', canRetry: false });
  });

  it('Shuffle after the show was undone goes back to Build with a fresh draft (nothing laid on top)', async () => {
    const fresh = prep({ style: 'chill' });
    const { flow, deps } = await readyFlow({
      shuffle: async () => ({ ok: false, undone: true, reason: 'undone' }),
      redraft: vi.fn(async () => fresh),
    });
    await flow.build();
    await flow.shuffle();
    expect(flow.current()).toMatchObject({ kind: 'ready', prep: fresh, note: UNDONE_NOTE });
    expect(deps.commit).toHaveBeenCalledTimes(1);

    const looks = await readyFlow({ shuffleScore: async () => ({ ok: false, undone: true, reason: 'undone' }) });
    await looks.flow.setContent('looks');
    await looks.flow.build();
    await looks.flow.shuffle();
    expect(looks.flow.current()).toMatchObject({ kind: 'ready', content: 'looks', note: UNDONE_NOTE });
  });

  it('Close stops the read: its signal fires and its late answer changes nothing', async () => {
    const gate = deferred<AutoShowPrepResult>();
    const f = fakeDeps({ prepare: vi.fn((signal: AbortSignal) => { f.signals.push(signal); return gate.promise; }) });
    const flow = createAutoShowFlow(f.deps);
    const reading = flow.start();
    expect(flow.current().kind).toBe('reading');
    flow.dispose();
    expect(f.signals[0].aborted).toBe(true);
    expect(f.deps.release).toHaveBeenCalledTimes(1);
    expect(f.listening()).toBe(false);
    gate.resolve({ ok: true, prep: P });
    await reading;
    expect(flow.current().kind).toBe('closed');
    // Nothing starts after it closed.
    await flow.retry();
    expect(f.deps.prepare).toHaveBeenCalledTimes(1);
  });

  it('a new project or document while reading stops it (error, Try again); after a build it closes', async () => {
    const gate = deferred<AutoShowPrepResult>();
    const signals: AbortSignal[] = [];
    let n = 0;
    const f = fakeDeps({ prepare: vi.fn((signal: AbortSignal) => { signals.push(signal); return n++ === 0 ? gate.promise : Promise.resolve({ ok: true, prep: P } as AutoShowPrepResult); }) });
    const flow = createAutoShowFlow(f.deps);
    const reading = flow.start();
    f.reset();
    expect(signals[0].aborted).toBe(true);
    expect(flow.current()).toMatchObject({ kind: 'error', message: RESET_MESSAGE, canRetry: true });
    gate.resolve({ ok: true, prep: P });
    await reading;
    expect(flow.current().kind).toBe('error');
    await flow.retry();
    expect(flow.current().kind).toBe('ready');
    await flow.build();
    f.reset();
    expect(flow.current().kind).toBe('closed');
  });

  it('a new project while redrafting stops the redraft', async () => {
    const gate = deferred<AutoShowPrep | null>();
    const signals: AbortSignal[] = [];
    const { flow, reset } = await readyFlow({ redraft: vi.fn((_p: AutoShowPrep, _c: object, signal: AbortSignal) => { signals.push(signal); return gate.promise; }) });
    const pending = flow.setStyle('hard');
    expect(flow.current().kind).toBe('redrafting');
    reset();
    expect(signals[0].aborted).toBe(true);
    gate.resolve(prep({ style: 'hard' }));
    await pending;
    expect(flow.current()).toMatchObject({ kind: 'error', message: RESET_MESSAGE });
  });

  it('a step that says it was stopped when nothing stopped it ends in an error, not waiting', async () => {
    const { flow } = await readyFlow({ redraft: async () => null });
    await flow.setStyle('hard');
    expect(flow.current()).toMatchObject({ kind: 'error', canRetry: true });
  });
});
