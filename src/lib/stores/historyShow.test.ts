import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { history, showHistoryRestore } from './history';
import { setHistoryCallback, flushPendingHistorySnapshot, beginHistoryRestore, endHistoryRestore } from './historyHooks';
import { showTimeline, setShowCompositionLoader } from './showTimeline';
import type { Project } from '../types';

/**
 * The show timeline lives in its own store, so history carries its
 * arrangement as another part of each step (like keyframes and the output
 * stage). Before this, no show edit could be undone.
 */

const project = { name: 'p', layers: [] } as unknown as Project;

/** The same capture/commit/restore App.svelte does, minus the other stores. */
function wireHistory() {
  const capture = () => ({ project, show: showTimeline.exportArrangement() });
  setHistoryCallback(
    () => {
      const c = capture();
      history.record(c.project, null, null, c.show);
    },
    {
      capture,
      commit: (captured) => {
        const c = captured as ReturnType<typeof capture>;
        history.record(c.project, null, null, c.show);
      },
      amend: () => {
        const c = capture();
        history.amend(c.project, null, null, {}, c.show);
      },
    },
  );
  history.init(project, null, null, showTimeline.exportArrangement());
}

function restore(snapshot: ReturnType<typeof history.undo>) {
  if (!snapshot) return;
  beginHistoryRestore();
  try {
    const show = showHistoryRestore(snapshot.show, snapshot.leavingShow);
    if (show !== undefined) showTimeline.restoreArrangement(show);
  } finally {
    endHistoryRestore();
  }
}

const undo = () => { flushPendingHistorySnapshot(); history.suppress(); restore(history.undo(project)); history.unsuppress(); };
const redo = () => { flushPendingHistorySnapshot(); history.suppress(); restore(history.redo(project)); history.unsuppress(); };

describe('history carries the show arrangement', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    history.clear();
    wireHistory();
  });
  afterEach(() => {
    setHistoryCallback(() => {});
    setShowCompositionLoader(null);
    history.clear();
    showTimeline._resetForTest();
  });

  it('undoes and redoes adding a preset clip', () => {
    const id = showTimeline.addPresetClip('comp-a', 10);
    expect(get(showTimeline).presetClips.map((c) => c.id)).toEqual([id]);
    undo();
    expect(get(showTimeline).presetClips).toEqual([]);
    redo();
    expect(get(showTimeline).presetClips.map((c) => c.id)).toEqual([id]);
  });

  it('turns a drag (many moves) into one step', () => {
    const a = showTimeline.addPresetClip('comp-a', 10);
    showTimeline.addPresetClip('comp-b', 10);
    showTimeline.setSnapEnabled(false);
    // Drag clip B rightwards in small steps.
    const b = get(showTimeline).presetClips[1].id;
    for (let t = 11; t <= 20; t++) showTimeline.movePresetClip(b, t);
    expect(get(showTimeline).presetClips.find((c) => c.id === b)!.startTime).toBe(20);
    undo();
    expect(get(showTimeline).presetClips.find((c) => c.id === b)!.startTime).toBe(10);
    expect(get(showTimeline).presetClips.find((c) => c.id === a)!.startTime).toBe(0);
  });

  it('keeps the transport where it is when a step is undone', () => {
    showTimeline.addPresetClip('comp-a', 10);
    showTimeline.addPresetClip('comp-b', 10);
    showTimeline.seek(4);
    showTimeline.setLoop(true);
    undo();
    const s = get(showTimeline);
    expect(s.loop).toBe(false);
    expect(s.currentTime).toBe(4);
    expect(s.presetClips).toHaveLength(2);
  });

  it('leaves the live show alone for a step that did not touch it', () => {
    showTimeline.addPresetClip('comp-a', 10);
    // A project-only step: the show part is the same on both sides.
    history.record({ ...project, name: 'renamed' } as Project, null, null, showTimeline.exportArrangement());
    const snapshot = history.undo(project)!;
    expect(showHistoryRestore(snapshot.show, snapshot.leavingShow)).toBeUndefined();
  });

  it('treats a step recorded without a show as not touching it', () => {
    expect(showHistoryRestore(undefined, { presetClips: [] })).toBeUndefined();
    expect(showHistoryRestore({ presetClips: [] }, { presetClips: [] })).toBeUndefined();
    expect(showHistoryRestore({ presetClips: [1] }, { presetClips: [] })).toEqual({ presetClips: [1] });
  });

  it('records nothing while a step is being restored', () => {
    showTimeline.addPresetClip('comp-a', 10);
    const before = get(history).past.length;
    beginHistoryRestore();
    showTimeline.addPresetClip('comp-b', 10);
    endHistoryRestore();
    expect(get(history).past.length).toBe(before);
  });
});
