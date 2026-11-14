/**
 * The ✦ Auto show dialog as one state and one transition function.
 *
 *   idle → reading → ready ⇄ redrafting
 *                    ready → building → done ⇄ shuffling
 *                            building → ready (the Timeline changed: worked out again)
 *                                       shuffling → ready (the show was undone)
 *   any step that waits → error (with Try again when reading again can help)
 *   a new project or document: waiting steps stop (error, Try again); a built show's dialog closes
 *
 * Every step that waits has a token; its result counts only while the state
 * still carries that token, so a late answer (after Close, a new project or
 * another step) changes nothing. The controller also stops the work itself
 * (an AbortSignal) and catches any throw, so no step can leave the dialog
 * waiting or its buttons off.
 */
import { writable, type Readable } from 'svelte/store';
import type { AutoShowPrep, AutoShowPrepResult, AutoShowSource } from '../../../../timeline/autoshow/autoShowRuntime';
import type { DraftCommitResult, ScorePrep, ScorePrepResult } from '../../../../timeline/score/scoreRuntime';
import type { ShowStyle } from '../../../../timeline/autoshow/songStyle';

export type AutoShowContent = AutoShowSource | 'looks';

/** What the dialog shows once the song is read. */
export interface AutoShowShown {
  prep: AutoShowPrep;
  content: AutoShowContent;
  /** The Looks only draft (content 'looks'). */
  scorePrep: ScorePrep | null;
  /** A line above the choices (the draft was worked out again, the show was undone). */
  note: string | null;
}

export type AutoShowFlowState =
  | { kind: 'idle' }
  | { kind: 'reading'; token: number }
  | ({ kind: 'ready' } & AutoShowShown)
  | ({ kind: 'redrafting'; token: number } & AutoShowShown)
  | ({ kind: 'building'; token: number } & AutoShowShown)
  | ({ kind: 'done'; builtMs: number } & AutoShowShown)
  | ({ kind: 'shuffling'; token: number; builtMs: number } & AutoShowShown)
  | { kind: 'error'; message: string; canRetry: boolean; prep: AutoShowPrep | null }
  | { kind: 'closed' };

export type AutoShowFlowEvent =
  | { type: 'read'; token: number }
  | { type: 'read-ok'; token: number; prep: AutoShowPrep; content: AutoShowContent }
  | { type: 'redraft'; token: number }
  | { type: 'redraft-ok'; token: number; prep: AutoShowPrep; content: AutoShowContent; scorePrep: ScorePrep | null }
  | { type: 'build'; token: number }
  | { type: 'built'; token: number; builtMs: number }
  | { type: 'rebuilt'; token: number; prep: AutoShowPrep; scorePrep: ScorePrep | null; note: string }
  | { type: 'shuffle'; token: number }
  | { type: 'shuffled'; token: number; prep: AutoShowPrep; scorePrep: ScorePrep | null }
  | { type: 'undone'; token: number; prep: AutoShowPrep; scorePrep: ScorePrep | null; note: string }
  | { type: 'fail'; token: number; message: string; canRetry: boolean }
  | { type: 'reset' }
  | { type: 'close' };

export const RESET_MESSAGE = 'Another project or document was opened, so Auto show stopped.';
export const THROW_MESSAGE = 'Something went wrong. Try again, or close.';
export const UNDONE_NOTE = 'The show was undone, so Shuffle had nothing to replace. Build it again, or close.';

/** The token of a state that is waiting on something (else null). */
export function waitingToken(s: AutoShowFlowState): number | null {
  return s.kind === 'reading' || s.kind === 'redrafting' || s.kind === 'building' || s.kind === 'shuffling' ? s.token : null;
}

function shown(s: AutoShowShown): AutoShowShown {
  return { prep: s.prep, content: s.content, scorePrep: s.scorePrep, note: s.note };
}

/** The next state. An event that does not fit the state (or a stale token) leaves it as it is. */
export function autoShowTransition(s: AutoShowFlowState, e: AutoShowFlowEvent): AutoShowFlowState {
  if (e.type === 'close') return s.kind === 'closed' ? s : { kind: 'closed' };
  if (s.kind === 'closed') return s;
  if (e.type === 'reset') {
    if (s.kind === 'done' || s.kind === 'shuffling') return { kind: 'closed' };
    if (s.kind === 'error') return s;
    return { kind: 'error', message: RESET_MESSAGE, canRetry: true, prep: 'prep' in s ? s.prep : null };
  }
  // Results of a step count only for that step.
  if (e.type !== 'read' && e.type !== 'redraft' && e.type !== 'build' && e.type !== 'shuffle') {
    if (waitingToken(s) !== e.token) return s;
  }
  switch (e.type) {
    case 'read':
      return s.kind === 'idle' || (s.kind === 'error' && s.canRetry) ? { kind: 'reading', token: e.token } : s;
    case 'read-ok':
      return s.kind === 'reading' ? { kind: 'ready', prep: e.prep, content: e.content, scorePrep: null, note: null } : s;
    case 'redraft':
      return s.kind === 'ready' ? { kind: 'redrafting', token: e.token, ...shown(s), note: null } : s;
    case 'redraft-ok':
      return s.kind === 'redrafting' ? { kind: 'ready', prep: e.prep, content: e.content, scorePrep: e.scorePrep, note: null } : s;
    case 'build':
      return s.kind === 'ready' ? { kind: 'building', token: e.token, ...shown(s) } : s;
    case 'built':
      return s.kind === 'building' ? { kind: 'done', ...shown(s), note: null, builtMs: e.builtMs } : s;
    case 'rebuilt':
      return s.kind === 'building' ? { kind: 'ready', ...shown(s), prep: e.prep, scorePrep: e.scorePrep, note: e.note } : s;
    case 'shuffle':
      return s.kind === 'done' ? { kind: 'shuffling', token: e.token, ...shown(s), builtMs: s.builtMs } : s;
    case 'shuffled':
      return s.kind === 'shuffling' ? { kind: 'done', ...shown(s), prep: e.prep, scorePrep: e.scorePrep, builtMs: s.builtMs } : s;
    case 'undone':
      return s.kind === 'shuffling' ? { kind: 'ready', ...shown(s), prep: e.prep, scorePrep: e.scorePrep, note: e.note } : s;
    case 'fail':
      return { kind: 'error', message: e.message, canRetry: e.canRetry, prep: 'prep' in s ? s.prep : null };
  }
}

/** What the dialog runs (the live ones in the dialog; fakes in tests). */
export interface AutoShowFlowDeps {
  prepare(signal: AbortSignal): Promise<AutoShowPrepResult>;
  redraft(prep: AutoShowPrep, change: { style?: ShowStyle; source?: AutoShowSource }, signal: AbortSignal): Promise<AutoShowPrep | null>;
  commit(prep: AutoShowPrep): DraftCommitResult;
  shuffle(signal: AbortSignal): Promise<AutoShowPrepResult>;
  prepareScore(signal: AbortSignal): Promise<ScorePrepResult>;
  commitScore(prep: ScorePrep): DraftCommitResult;
  shuffleScore(signal: AbortSignal): Promise<ScorePrepResult>;
  playFromTop(prep: Pick<AutoShowPrep, 'structure' | 'track'>): void;
  /** Let go of the last show's analysis (the dialog closed). */
  release(): void;
  /** Told when another project or document opens; returns the unsubscribe. */
  onReset(listener: () => void): () => void;
  now(): number;
}

export interface AutoShowFlow {
  state: Readable<AutoShowFlowState>;
  current(): AutoShowFlowState;
  start(): Promise<void>;
  retry(): Promise<void>;
  setStyle(style: ShowStyle): Promise<void>;
  setContent(content: AutoShowContent): Promise<void>;
  build(): Promise<void>;
  shuffle(): Promise<void>;
  close(): void;
  /** Stop what is waiting, stop listening, let go of the analysis. */
  dispose(): void;
}

type Outcome = AutoShowFlowEvent | null;

export function createAutoShowFlow(deps: AutoShowFlowDeps): AutoShowFlow {
  let state: AutoShowFlowState = { kind: 'idle' };
  const store = writable<AutoShowFlowState>(state);
  let seq = 0;
  let job: AbortController | null = null;
  let disposed = false;

  function dispatch(e: AutoShowFlowEvent): void {
    const next = autoShowTransition(state, e);
    if (next === state) return;
    state = next;
    store.set(state);
  }

  function stopJob(): void {
    job?.abort();
    job = null;
  }

  /** Start a step that waits; its result counts only while it is still the step. */
  async function run(start: 'read' | 'redraft' | 'build' | 'shuffle', work: (signal: AbortSignal, token: number) => Promise<Outcome>): Promise<void> {
    if (disposed) return;
    const token = ++seq;
    const before = state;
    dispatch({ type: start, token });
    if (state === before) return; // not now (another step is running, or the dialog moved on)
    stopJob();
    const ac = new AbortController();
    job = ac;
    let out: Outcome;
    try {
      out = await work(ac.signal, token);
    } catch (err) {
      console.warn('[AutoShow] step failed:', err);
      out = { type: 'fail', token, message: THROW_MESSAGE, canRetry: true };
    }
    if (job === ac) job = null;
    // Stopped by Close, a new project or the next step: they moved the state.
    if (ac.signal.aborted) return;
    // A step that says it was stopped when nothing stopped it must not leave the dialog waiting.
    dispatch(out ?? { type: 'fail', token, message: THROW_MESSAGE, canRetry: true });
  }

  const fail = (token: number, message: string, canRetry: boolean): AutoShowFlowEvent => ({ type: 'fail', token, message, canRetry });
  const readyOf = (): AutoShowShown | null => (state.kind === 'ready' || state.kind === 'done' ? shown(state) : null);

  const unsubscribe = deps.onReset(() => {
    stopJob();
    dispatch({ type: 'reset' });
  });

  async function read(): Promise<void> {
    await run('read', async (signal, token) => {
      const r = await deps.prepare(signal);
      if (!r.ok) return r.cancelled ? null : fail(token, r.reason, false);
      // Both, when the library has videos.
      if (r.prep.libraryVideos > 0) {
        const both = await deps.redraft(r.prep, { source: 'both' }, signal);
        if (!both) return null;
        return { type: 'read-ok', token, prep: both, content: 'both' };
      }
      return { type: 'read-ok', token, prep: r.prep, content: 'builtin' };
    });
  }

  return {
    state: { subscribe: store.subscribe },
    current: () => state,
    start: read,
    retry: read,

    async setStyle(style) {
      const from = readyOf();
      if (!from || state.kind !== 'ready' || from.content === 'looks') return;
      await run('redraft', async (signal, token) => {
        const prep = await deps.redraft(from.prep, { style }, signal);
        return prep ? { type: 'redraft-ok', token, prep, content: from.content, scorePrep: from.scorePrep } : null;
      });
    },

    async setContent(content) {
      const from = readyOf();
      if (!from || state.kind !== 'ready') return;
      await run('redraft', async (signal, token) => {
        if (content === 'looks') {
          const r = await deps.prepareScore(signal);
          if (!r.ok) return r.cancelled ? null : fail(token, r.reason, false);
          return { type: 'redraft-ok', token, prep: from.prep, content, scorePrep: r.prep };
        }
        const prep = await deps.redraft(from.prep, { source: content }, signal);
        return prep ? { type: 'redraft-ok', token, prep, content, scorePrep: from.scorePrep } : null;
      });
    },

    async build() {
      const from = readyOf();
      if (!from || state.kind !== 'ready') return;
      await run('build', async (signal, token) => {
        const t0 = deps.now();
        const builtMs = () => from.prep.timings.analysisMs + from.prep.timings.draftMs + (deps.now() - t0);
        if (from.content === 'looks') {
          if (!from.scorePrep) return fail(token, 'Nothing to add: the Timeline already has all of it.', false);
          const r = deps.commitScore(from.scorePrep);
          if (r.ok) {
            deps.playFromTop({ structure: from.scorePrep.structure, track: from.scorePrep.track });
            return { type: 'built', token, builtMs: builtMs() };
          }
          if (r.why === 'changed') {
            const again = await deps.prepareScore(signal);
            if (!again.ok) return again.cancelled ? null : fail(token, again.reason, false);
            return { type: 'rebuilt', token, prep: from.prep, scorePrep: again.prep, note: r.reason };
          }
          return fail(token, r.reason, r.why === 'song');
        }
        const r = deps.commit(from.prep);
        if (r.ok) return { type: 'built', token, builtMs: builtMs() };
        if (r.why === 'changed') {
          const again = await deps.redraft(from.prep, {}, signal);
          return again ? { type: 'rebuilt', token, prep: again, scorePrep: from.scorePrep, note: r.reason } : null;
        }
        return fail(token, r.reason, r.why === 'song');
      });
    },

    async shuffle() {
      const from = readyOf();
      if (!from || state.kind !== 'done') return;
      await run('shuffle', async (signal, token) => {
        if (from.content === 'looks') {
          const r = await deps.shuffleScore(signal);
          if (r.ok) {
            deps.playFromTop({ structure: r.prep.structure, track: r.prep.track });
            return { type: 'shuffled', token, prep: from.prep, scorePrep: r.prep };
          }
          if (r.cancelled) return null;
          if (r.undone) {
            // Worked out again onto the Timeline as the undo left it.
            const again = await deps.prepareScore(signal);
            if (!again.ok) return again.cancelled ? null : fail(token, again.reason, false);
            return { type: 'undone', token, prep: from.prep, scorePrep: again.prep, note: UNDONE_NOTE };
          }
          return fail(token, r.reason, false);
        }
        const r = await deps.shuffle(signal);
        if (r.ok) return { type: 'shuffled', token, prep: r.prep, scorePrep: from.scorePrep };
        if (r.cancelled) return null;
        if (r.undone) {
          const again = await deps.redraft(from.prep, {}, signal);
          return again ? { type: 'undone', token, prep: again, scorePrep: from.scorePrep, note: UNDONE_NOTE } : null;
        }
        return fail(token, r.reason, false);
      });
    },

    close() {
      stopJob();
      dispatch({ type: 'close' });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      stopJob();
      unsubscribe();
      dispatch({ type: 'close' });
      deps.release();
    },
  };
}
