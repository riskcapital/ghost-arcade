/**
 * A list of control lines with undo. The Timeline document can hold its
 * lines here or keep them itself and pass the same callbacks to the
 * recorder; either way every edit is one call, and a recorded pass is one
 * undo step.
 */
import { writable, get } from 'svelte/store';
import type { ControlLine } from './lineModel';

export interface LineStoreState {
  lines: ControlLine[];
  canUndo: boolean;
  canRedo: boolean;
}

const UNDO_LIMIT = 100;

export function createLineStore(initial: ControlLine[] = []) {
  let lines = initial;
  const undo: { label: string; lines: ControlLine[] }[] = [];
  const redo: { label: string; lines: ControlLine[] }[] = [];
  const store = writable<LineStoreState>({ lines, canUndo: false, canRedo: false });
  const publish = () => store.set({ lines, canUndo: undo.length > 0, canRedo: redo.length > 0 });

  return {
    subscribe: store.subscribe,
    lines: () => lines,
    /** One undo step: `edit` returns the new list (or the same to do nothing). */
    edit(label: string, edit: (lines: ControlLine[]) => ControlLine[]): void {
      const next = edit(lines);
      if (next === lines) return;
      undo.push({ label, lines });
      if (undo.length > UNDO_LIMIT) undo.shift();
      redo.length = 0;
      lines = next;
      publish();
    },
    /** Replace one line by id (or add it), one undo step. */
    putLine(label: string, line: ControlLine): void {
      this.edit(label, (list) => {
        const i = list.findIndex((l) => l.id === line.id);
        if (i < 0) return [...list, line];
        const copy = list.slice();
        copy[i] = line;
        return copy;
      });
    },
    removeLine(label: string, id: string): void {
      this.edit(label, (list) => (list.some((l) => l.id === id) ? list.filter((l) => l.id !== id) : list));
    },
    undo(): string | null {
      const step = undo.pop();
      if (!step) return null;
      redo.push({ label: step.label, lines });
      lines = step.lines;
      publish();
      return step.label;
    },
    redo(): string | null {
      const step = redo.pop();
      if (!step) return null;
      undo.push({ label: step.label, lines });
      lines = step.lines;
      publish();
      return step.label;
    },
    /** Load a document's lines (clears undo). */
    reset(next: ControlLine[]): void {
      lines = next;
      undo.length = 0;
      redo.length = 0;
      publish();
    },
    undoLabels: () => undo.map((u) => u.label),
    state: () => get(store),
  };
}

export type LineStore = ReturnType<typeof createLineStore>;
