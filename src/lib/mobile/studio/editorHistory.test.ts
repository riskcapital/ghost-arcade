import { describe, it, expect } from 'vitest';
import {
  HISTORY_DEPTH,
  begin,
  canRedo,
  canUndo,
  emptyHistory,
  record,
  redo,
  touch,
  undo,
  type History,
} from './editorHistory';

type State = { n: number };
const same = (a: State, b: State) => a.n === b.n;

/** Drive a history the way the editor does: `current` is the live state. */
function editor() {
  let history: History<State> = emptyHistory();
  let current: State = { n: 0 };
  return {
    get history() {
      return history;
    },
    get value() {
      return current.n;
    },
    /** One-step edit. */
    set(n: number) {
      const before = current;
      current = { n };
      if (!same(before, current)) history = record(history, before);
    },
    press() {
      history = begin(history, current);
    },
    drag(n: number) {
      current = { n };
      history = touch(history, current, same);
    },
    undo() {
      const step = undo(history, () => current);
      if (!step) return false;
      history = step.history;
      current = step.state;
      return true;
    },
    redo() {
      const step = redo(history, () => current);
      if (!step) return false;
      history = step.history;
      current = step.state;
      return true;
    },
  };
}

describe('editor undo / redo history', () => {
  it('undoes and redoes one-step edits in order', () => {
    const e = editor();
    e.set(1);
    e.set(2);
    e.set(3);
    expect(e.undo()).toBe(true);
    expect(e.value).toBe(2);
    expect(e.undo()).toBe(true);
    expect(e.value).toBe(1);
    expect(e.redo()).toBe(true);
    expect(e.value).toBe(2);
    expect(e.redo()).toBe(true);
    expect(e.value).toBe(3);
    expect(e.redo()).toBe(false);
  });

  it('has nothing to undo or redo at the start', () => {
    const e = editor();
    expect(canUndo(e.history)).toBe(false);
    expect(canRedo(e.history)).toBe(false);
    expect(e.undo()).toBe(false);
    expect(e.redo()).toBe(false);
  });

  it('a new edit after undo drops the redo branch', () => {
    const e = editor();
    e.set(1);
    e.set(2);
    e.undo();
    expect(canRedo(e.history)).toBe(true);
    e.set(5);
    expect(canRedo(e.history)).toBe(false);
    e.undo();
    expect(e.value).toBe(1);
  });

  it('a press that changes nothing adds no entry', () => {
    const e = editor();
    e.set(1);
    for (let i = 0; i < 30; i++) e.press();
    expect(e.history.past).toHaveLength(1);
    e.undo();
    expect(e.value).toBe(0);
  });

  it('a whole drag is one entry', () => {
    const e = editor();
    e.press();
    for (let n = 1; n <= 50; n++) e.drag(n);
    expect(e.history.past).toHaveLength(1);
    e.undo();
    expect(e.value).toBe(0);
    e.redo();
    expect(e.value).toBe(50);
  });

  it('a drag that returns to where it started still counts once it moved', () => {
    const e = editor();
    e.press();
    e.drag(4);
    e.drag(0);
    expect(e.history.past).toHaveLength(1);
  });

  it('changes without a press are not recorded on their own', () => {
    const e = editor();
    e.drag(3);
    expect(canUndo(e.history)).toBe(false);
  });

  it('an edit that changes nothing is not recorded', () => {
    const e = editor();
    e.set(0);
    expect(canUndo(e.history)).toBe(false);
  });

  it('keeps the newest 100 steps', () => {
    expect(HISTORY_DEPTH).toBe(100);
    const e = editor();
    for (let n = 1; n <= HISTORY_DEPTH + 20; n++) e.set(n);
    expect(e.history.past).toHaveLength(HISTORY_DEPTH);
    let steps = 0;
    while (e.undo()) steps++;
    expect(steps).toBe(HISTORY_DEPTH);
    expect(e.value).toBe(20);
  });

  it('lets the caller capture the present to match the state being restored', () => {
    type Rich = { n: number; tracks?: string[] };
    let history: History<Rich> = record(emptyHistory<Rich>(), { n: 1, tracks: ['a'] });
    const step = undo(history, (target) => (target.tracks ? { n: 2, tracks: ['b'] } : { n: 2 }))!;
    expect(step.state).toEqual({ n: 1, tracks: ['a'] });
    expect(step.history.future).toEqual([{ n: 2, tracks: ['b'] }]);
    history = step.history;
    expect(redo(history, (target) => (target.tracks ? { n: 1, tracks: ['a'] } : { n: 1 }))!.state).toEqual({
      n: 2,
      tracks: ['b'],
    });
  });

  it('never changes the history passed in', () => {
    const start = record(emptyHistory<State>(), { n: 1 });
    const frozen = JSON.stringify(start);
    record(start, { n: 2 });
    begin(start, { n: 3 });
    undo(start, () => ({ n: 9 }));
    expect(JSON.stringify(start)).toBe(frozen);
  });
});
