/**
 * The lines engine hooked into the Timeline: a session lives while the
 * Timeline is the active document, the show ticks it (play, seek, export),
 * edits reach the output at the playhead, and recording from a MIDI
 * controller ("touch a knob to bind", arm, play, sweep) writes a line as one
 * undo step of the document.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derived, get, writable } from 'svelte/store';
import type { Layer } from '../../types';

const state = writable<{ layers: Layer[]; selectedLayerId: string | null }>({ layers: [], selectedLayerId: null });
vi.mock('../../stores/layers', () => ({
  project: {
    subscribe: state.subscribe,
    selectLayer: () => {},
    update: state.update,
    setLayerSource: (id: string, source: unknown) => state.update((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? ({ ...l, source } as Layer) : l)) })),
  },
  layers: derived(state, (s) => s.layers),
  selectedLayerId: derived(state, (s) => s.selectedLayerId),
}));
let manualClock = false;
vi.mock('../../audio/visualAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../audio/visualAudio')>()),
  isVisualAudioManualClock: () => manualClock,
}));
vi.mock('../../ableton/abletonBridge', () => ({
  abletonBridge: { liveParamValue: () => null, liveLevelValue: () => null, watchLiveSources: () => {} },
}));

const { showTimeline, setShowCompositionLoader, parkedShowDoc } = await import('../../stores/showTimeline');
const { setHistoryCallback } = await import('../../stores/historyHooks');
const { runMidiTaps } = await import('../../midi/midiTaps');
const { currentLineFrame } = await import('./lineRuntime');
const lines = await import('./timelineLines');
const liveEdit = await import('../liveEdit');
const { recordDiscreteAction } = await import('../../stores/historyHooks');
const { lineValueAt } = await import('./lineEvaluator');

function layer(id: string): Layer {
  return {
    id, name: id, type: 'media', visible: true, opacity: 1, blendMode: 'normal',
    source: { id: `s-${id}`, type: 'shader', src: 'x.fs', name: 'x', shaderInputs: [{ NAME: 'speed', TYPE: 'float', MIN: 0, MAX: 4, DEFAULT: 1 }], shaderValues: { speed: 1 } },
  } as unknown as Layer;
}

let steps = 0;
let uninstall: () => void = () => {};
beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  steps = 0;
  setHistoryCallback(() => { steps++; });
  state.set({ layers: [layer('A')], selectedLayerId: 'A' });
  uninstall = lines.installTimelineLines();
  showTimeline.openDoc('timeline');
  showTimeline.syncStageRows(get(state).layers, []);
});
afterEach(() => {
  liveEdit._resetLiveEditForTest();
  uninstall();
  lines._resetTimelineLinesForTest();
  setShowCompositionLoader(null);
  showTimeline._resetForTest();
});

describe('the Timeline drives its lines', () => {
  it('a session exists only while the Timeline is active', () => {
    expect(lines.currentLineSession()).not.toBeNull();
    showTimeline.openDoc('show');
    expect(lines.currentLineSession()).toBeNull();
    showTimeline.openDoc('timeline');
    expect(lines.currentLineSession()).not.toBeNull();
  });

  it('a point added at the playhead reaches the output at once; seeking evaluates there', () => {
    showTimeline.seek(0);
    lines.addLineWithPoint({ scope: 'layer', id: 'A' }, 'layer:opacity', 0, 0);
    expect(currentLineFrame()?.layers.get('A')?.['layer:opacity']).toBe(0);
    lines.addLineWithPoint({ scope: 'layer', id: 'A' }, 'layer:opacity', 4, 1);
    expect(get(showTimeline).duration).toBe(4);
    showTimeline.seek(2);
    expect(currentLineFrame()?.layers.get('A')?.['layer:opacity']).toBeCloseTo(0.5);
    showTimeline.seek(3);
    expect(currentLineFrame()?.layers.get('A')?.['layer:opacity']).toBeCloseTo(0.75);
    // Scrubbing back gives the same value.
    showTimeline.seek(2);
    expect(currentLineFrame()?.layers.get('A')?.['layer:opacity']).toBeCloseTo(0.5);
  });

  it('a new line takes the parameter\'s range, colour and name from the registry', () => {
    const id = lines.addLineWithPoint({ scope: 'layer', id: 'A' }, 'shader:speed', 0)!;
    const line = get(showTimeline).lines.find((l) => l.id === id)!;
    expect(line.max).toBe(4);
    expect(line.points[0].v).toBe(1);
    expect(line.label).toBe('speed');
    expect(line.color).toMatch(/^#/);
  });

  it('following a clock, opening the Show tab ends an open pass in the Timeline', () => {
    lines.addLineWithPoint({ scope: 'layer', id: 'A' }, 'layer:opacity', 10, 1);
    lines.bindNextControl({ scope: 'layer', id: 'A' }, 'shader:speed', 'speed');
    runMidiTaps(0, 'cc', 21, 0, { id: 'dev', name: 'Knobs' });
    lines.armLines('latch');
    for (let i = 0; i <= 30; i++) {
      const t = (i / 30) * 1;
      runMidiTaps(0, 'cc', 21, 127, { id: 'dev', name: 'Knobs' });
      showTimeline.chase(t, true);
    }
    showTimeline.activateDoc('show');
    showTimeline.releaseChase();
    const rec = get(parkedShowDoc).lines.find((l) => l.key === 'shader:speed');
    expect(rec).toBeTruthy();
    expect(lineValueAt(rec!, 0.8) as number).toBeCloseTo(4, 1);
    expect(get(showTimeline).lines.some((l) => l.key === 'shader:speed')).toBe(false);
  });

  it('an LED block value moved from its panel while armed and playing is recorded', () => {
    const clip = showTimeline.addLedClip('led:strip', 0, { kind: 'colour', color: '#ff0000', duration: 20, brightness: 1 })!;
    expect(clip).toBeTruthy();
    lines.addLineWithPoint({ scope: 'block', id: clip }, 'ledblock:brightness', 10, 1);
    lines.armLines('touch');
    showTimeline.seek(2);
    showTimeline.play();
    // The panel's slider moving: the first change is seen, the rest recorded.
    showTimeline.updateLedClip(clip, { brightness: 0.5 });
    showTimeline.updateLedClip(clip, { brightness: 0.3 });
    lines.disarmLines();
    showTimeline.pause();
    const rec = get(showTimeline).lines.find((l) => l.key === 'ledblock:brightness')!;
    expect(lineValueAt(rec, 2) as number).toBeCloseTo(0.3, 2);
  });

  it('records a MIDI sweep into a new line: bind by touching a knob, arm, play; one undo step', () => {
    lines.addLineWithPoint({ scope: 'layer', id: 'A' }, 'layer:opacity', 10, 1);
    const before = steps;
    lines.bindNextControl({ scope: 'layer', id: 'A' }, 'shader:speed', 'speed');
    expect(get(lines.lineRecordState).bindPending?.key).toBe('shader:speed');
    // Touch a knob: CC 21 on channel 1 binds (and is kept from the mappings).
    expect(runMidiTaps(0, 'cc', 21, 0, { id: 'dev', name: 'Knobs' })).toBe(true);
    expect(get(showTimeline).lineBindings).toHaveLength(1);
    lines.armLines('latch');
    expect(get(lines.lineRecordState).armed).toBe(true);
    showTimeline.seek(0);
    showTimeline.play();
    // Sweep the knob from 0 to 127 over 2 s of show time.
    for (let i = 0; i <= 60; i++) {
      const t = (i / 60) * 2;
      runMidiTaps(0, 'cc', 21, Math.round((i / 60) * 127), { id: 'dev', name: 'Knobs' });
      showTimeline.seek(t);
    }
    // While the pass is open the output follows the knob.
    expect(currentLineFrame()?.layers.get('A')?.['shader:speed']).toBeCloseTo(4, 1);
    showTimeline.pause();
    const rec = get(showTimeline).lines.find((l) => l.key === 'shader:speed')!;
    expect(rec).toBeTruthy();
    // Thinned to a few points, and it follows the sweep.
    expect(rec.points.length).toBeLessThan(20);
    expect(lineValueAt(rec, 1) as number).toBeCloseTo(2, 0);
    expect(lineValueAt(rec, 2) as number).toBeCloseTo(4, 0);
    expect(steps - before).toBe(1);
  });

  it('a line following a CC moves with the knob live; an offline render leaves live inputs out', () => {
    lines.addLineWithPoint({ scope: 'layer', id: 'A' }, 'layer:opacity', 0, 0.3);
    showTimeline.editLines((list) => list.map((l) => ({ ...l, follow: { source: { kind: 'midi', cc: 7, channel: -1 }, depth: 1 } })));
    runMidiTaps(0, 'cc', 7, 127, { id: null });
    showTimeline.seek(0);
    expect(currentLineFrame()?.layers.get('A')?.['layer:opacity']).toBeCloseTo(1);
    manualClock = true;
    try {
      showTimeline.seek(0.5);
      expect(currentLineFrame()?.layers.get('A')?.['layer:opacity']).toBeCloseTo(0.3);
    } finally {
      manualClock = false;
    }
  });
});

describe('scopes and sources registered at runtime on the Timeline', () => {
  it('⌇+ adds a line on a registered scope; the Timeline drives it (apply) on play and seek; a registered source moves it', async () => {
    const { registerParamScope, registerLineSource } = await import('./lineExtensions');
    const applied: Array<Record<string, number | boolean> | null> = [];
    const stored = { cutoff: 0.2 };
    const offScope = registerParamScope({
      scope: 'test.voice',
      label: 'Test voices',
      targets: () => [{ id: 'lead', label: 'Lead' }],
      params: (id) => (id === 'lead' ? [{ key: 'voice:cutoff', label: 'Cutoff', group: 'Voice', min: 0, max: 1, step: 0.01, default: stored.cutoff, kind: 'continuous' }] : []),
      read: (id, key) => (id === 'lead' && key === 'voice:cutoff' ? stored.cutoff : undefined),
      apply: (values) => applied.push(values?.get('lead') ? { ...values.get('lead')! } : null),
    });
    const offSource = registerLineSource({ kind: 'test.half', label: 'Half', sample: () => 0.5 });
    try {
      const target = { scope: 'test.voice' as const, id: 'lead' };
      expect(lines.paramsForTarget(target).map((p) => p.key)).toEqual(['voice:cutoff']);
      // A point at the playhead holds the stored value.
      const id = lines.addLineAtPlayhead(target, 'voice:cutoff')!;
      expect(get(showTimeline).lines.find((l) => l.id === id)).toMatchObject({ target, key: 'voice:cutoff', label: 'Cutoff', min: 0, max: 1, points: [{ t: 0, v: 0.2 }] });
      expect(applied.at(-1)?.['voice:cutoff']).toBeCloseTo(0.2, 6);
      lines.addLineWithPoint(target, 'voice:cutoff', 4, 1);
      showTimeline.seek(2);
      expect(applied.at(-1)?.['voice:cutoff']).toBeCloseTo(0.6, 6);
      // Following the registered source: base + depth × range × 0.5.
      showTimeline.editLines((list) => list.map((l) => (l.id === id ? { ...l, follow: { source: { kind: 'test.half' }, depth: 0.2 } } : l)));
      showTimeline.seek(2);
      expect(applied.at(-1)?.['voice:cutoff']).toBeCloseTo(0.7, 6);
      // The project is never written: the stored value is as it was.
      expect(stored.cutoff).toBe(0.2);
      // The Show tab takes over: the scope is let go.
      showTimeline.openDoc('show');
      expect(applied.at(-1)).toBeNull();
    } finally {
      offScope();
      offSource();
    }
  });
});

describe('selected line points', () => {
  const line = { id: 'l', target: { scope: 'layer' as const, id: 'A' }, key: 'layer:opacity', kind: 'continuous' as const, min: 0, max: 1, points: [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 2, v: 0 }], follow: { depthPoints: [{ t: 0, v: 1 }, { t: 3, v: 0 }] } } as never;
  it('belong to the list they were picked in', () => {
    const sel = { lineId: 'l', points: [1], channel: 'depth' as const, of: (line as { follow: { depthPoints: unknown[] } }).follow.depthPoints as never };
    expect(lines.selectedLinePoints(sel, line, 'depth')).toEqual([1]);
    expect(lines.selectedLinePoints(sel, line, 'points')).toEqual([]);
  });
  it('no longer apply once the points were replaced (undo, a recorded pass)', () => {
    const l = line as { points: unknown[] };
    const sel = { lineId: 'l', points: [2], channel: 'points' as const, of: l.points as never };
    expect(lines.selectedLinePoints(sel, line)).toEqual([2]);
    const replaced = { ...(line as object), points: [{ t: 0, v: 0 }, { t: 2, v: 0 }] } as never;
    expect(lines.selectedLinePoints(sel, replaced)).toEqual([]);
  });
});

describe('record state', () => {
  it('is published only when it changes, not every frame while armed', () => {
    lines.armLines('touch');
    let notified = 0;
    const off = lines.lineRecordState.subscribe(() => { notified++; });
    notified = 0;
    for (let i = 0; i < 30; i++) showTimeline.seek(i / 30);
    off();
    expect(notified).toBe(0);
  });
});

describe('a long take', () => {
  it('stops itself at the take cap and says why; the view gets the samples, not copies', async () => {
    const A = { scope: 'layer' as const, id: 'A' };
    lines.addLineWithPoint(A, 'shader:speed', 0, 1);
    lines.armLines('latch');
    showTimeline.seek(1);
    showTimeline.play();
    lines.lineControlInput(A, 'shader:speed', 3);
    const lineId = get(showTimeline).lines[0].id;
    let most = 0;
    let shared = true;
    for (let i = 1; i * 0.25 <= lines.MAX_TAKE_SECONDS + 2; i++) {
      showTimeline.seek(1 + i * 0.25);
      const pass = get(lines.recordingPasses).get(lineId);
      if (!pass) continue;
      most = Math.max(most, pass.samples.length);
      if (pass.samples !== lines.currentLineSession()!.recorder.passSamples().get(lineId)) shared = false;
    }
    await Promise.resolve();
    expect(shared).toBe(true);
    expect(most).toBeLessThanOrEqual(3);
    expect(get(showTimeline).isPlaying).toBe(false);
    expect(get(showTimeline).currentTime).toBeLessThanOrEqual(lines.MAX_TAKE_SECONDS + 3);
    expect(get(lines.lineRecordState).notice).toBe(lines.TAKE_CAP_NOTICE);
    const line = get(showTimeline).lines.find((l) => l.id === lineId)!;
    expect(lineValueAt(line, 900) as number).toBeCloseTo(3);
    // The next take starts without the notice.
    showTimeline.play();
    showTimeline.seek(get(showTimeline).currentTime + 0.1);
    expect(get(lines.lineRecordState).notice).toBeNull();
  });
});

describe('Live edit on the Timeline', () => {
  const A = { scope: 'layer' as const, id: 'A' };
  const layerA = () => get(state).layers.find((l) => l.id === 'A')!;
  const setLayer = (id: string, patch: Partial<Layer>) => state.update((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) }));
  function liveEditParked(at = 3) {
    lines.setFollowEdits(true);
    lines.armLines('touch');
    showTimeline.seek(at);
    expect(get(liveEdit.liveEditOn)).toBe(true);
  }

  beforeEach(() => {
    state.set({ layers: [layer('A'), layer('B')], selectedLayerId: 'A' });
  });

  it('Discard puts back only the held change, as one step, however many steps came after it', () => {
    liveEditParked();
    setLayer('A', { opacity: 0.4 });
    expect(get(liveEdit.heldEdits)).toMatchObject([{ kind: 'param', key: 'layer:opacity', value: 0.4, was: 1 }]);
    // Edits that are not held: a rename, and more steps than the undo history keeps.
    setLayer('B', { name: 'Renamed' });
    for (let i = 0; i < 60; i++) recordDiscreteAction();
    const before = steps;
    expect(liveEdit.discardHeldEdits()).toBe(true);
    expect(layerA().opacity).toBe(1);
    expect(get(state).layers.find((l) => l.id === 'B')!.name).toBe('Renamed');
    expect(steps - before).toBe(1);
    // Nothing was keyed, nothing is held again, Live edit stays on.
    expect(get(showTimeline).lines).toHaveLength(0);
    expect(get(liveEdit.heldEdits)).toHaveLength(0);
    expect(get(liveEdit.liveEditOn)).toBe(true);
  });

  it('when a held change cannot be put back, Discard puts back the rest and keeps that one held, saying why', () => {
    liveEditParked();
    setLayer('A', { opacity: 0.4 });
    setLayer('B', { opacity: 0.5 });
    state.update((p) => ({ ...p, layers: p.layers.filter((l) => l.id !== 'A') }));
    const before = steps;
    expect(liveEdit.discardHeldEdits()).toBe(false);
    expect(get(state).layers.find((l) => l.id === 'B')!.opacity).toBe(1);
    expect(steps - before).toBe(1);
    expect(get(liveEdit.heldEdits)).toMatchObject([{ kind: 'param', target: { scope: 'layer', id: 'A' } }]);
    expect(get(liveEdit.liveEdit).notice).toMatch(/can't put back/);
  });

  it('when no held change can be put back, Discard changes nothing and says why', () => {
    liveEditParked();
    setLayer('A', { opacity: 0.4 });
    state.update((p) => ({ ...p, layers: p.layers.filter((l) => l.id !== 'A') }));
    const before = steps;
    expect(liveEdit.discardHeldEdits()).toBe(false);
    expect(steps).toBe(before);
    expect(get(liveEdit.heldEdits)).toHaveLength(1);
    expect(get(liveEdit.liveEdit).notice).toMatch(/can't put back/);
  });

  it('another document, another project or stopping drops what is held', () => {
    liveEditParked();
    setLayer('A', { opacity: 0.4 });
    showTimeline.openDoc('show');
    expect(get(liveEdit.heldEdits)).toHaveLength(0);
    showTimeline.openDoc('timeline');
    liveEditParked();
    setLayer('A', { opacity: 0.3 });
    expect(get(liveEdit.heldEdits)).toHaveLength(1);
    showTimeline.clear();
    expect(get(liveEdit.heldEdits)).toHaveLength(0);
  });

  it('stopping Live edit drops what is held; the change stays in the editor', () => {
    liveEditParked();
    setLayer('A', { opacity: 0.4 });
    lines.disarmLines();
    expect(get(liveEdit.heldEdits)).toHaveLength(0);
    expect(layerA().opacity).toBe(0.4);
  });

  it('content swapped on a piece without a row: no row until Update, which makes it with the cut-in; Discard puts the content back', () => {
    const rowOfC = () => get(showTimeline).layerTracks.find((t) => t.layerId === 'C' && !t.subRow);
    liveEditParked(4);
    state.update((p) => ({ ...p, layers: [...p.layers, layer('C')] }));
    expect(rowOfC()).toBeUndefined();
    const prism = { id: 's-prism', type: 'shader', src: 'prism.fs', name: 'Prism', shaderCode: 'void main(){}', shaderInputs: [], shaderValues: {} };
    const first = get(state).layers.find((l) => l.id === 'C')!.source;
    setLayer('C', { source: prism as never });
    expect(get(liveEdit.heldEdits)).toMatchObject([{ kind: 'content', trackId: null, piece: { layerId: 'C' } }]);
    expect(rowOfC()).toBeUndefined();
    expect(liveEdit.discardHeldEdits()).toBe(true);
    expect(get(state).layers.find((l) => l.id === 'C')!.source).toBe(first);
    expect(rowOfC()).toBeUndefined();
    // Again, and Update: the row and its block come in together.
    setLayer('C', { source: prism as never });
    liveEdit.updateHeldEdits();
    const row = rowOfC();
    expect(row?.clips.map((c) => [c.media.name, c.startTime])).toEqual([['Prism', 4]]);
  });
});

describe('Live edit Update', () => {
  const setLayer = (id: string, patch: Partial<Layer>) => state.update((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) }));
  const prism = { id: 's-prism', type: 'shader', src: 'prism.fs', name: 'Prism', shaderCode: 'void main(){}', shaderInputs: [], shaderValues: {} };
  const tide = { id: 's-tide', type: 'shader', src: 'tide.fs', name: 'Tide', shaderCode: 'void tide(){}', shaderInputs: [], shaderValues: {} };

  beforeEach(() => {
    state.set({ layers: [layer('A'), layer('B'), layer('C')], selectedLayerId: 'A' });
    showTimeline.syncStageRows(get(state).layers, []);
  });

  it('keys every held change (settings and content) as exactly one undo step', async () => {
    lines.setFollowEdits(true);
    lines.armLines('touch');
    showTimeline.seek(2);
    setLayer('A', { opacity: 0.4 });
    setLayer('B', { opacity: 0.6 });
    setLayer('A', { source: prism as never });
    setLayer('C', { source: tide as never });
    expect(get(liveEdit.heldEdits)).toHaveLength(4);
    const before = steps;
    expect(liveEdit.updateHeldEdits()).toBe(4);
    // Nothing left waiting to become a step later, either.
    await new Promise((r) => setTimeout(r, 700));
    expect(steps - before).toBe(1);
    const s = get(showTimeline);
    expect(s.lines.map((l) => ('id' in l.target ? l.target.id : '')).sort()).toEqual(['A', 'B']);
    const blocks = s.layerTracks.flatMap((t) => t.clips.map((c) => c.media.name)).sort();
    expect(blocks).toContain('Prism');
    expect(blocks).toContain('Tide');
    expect(get(liveEdit.heldEdits)).toHaveLength(0);
  });

  it('one Undo takes the whole Update off the Timeline, and Redo puts it back', async () => {
    const { history, showHistoryRestore } = await import('../../stores/history');
    const { beginHistoryRestore, endHistoryRestore, flushPendingHistorySnapshot } = await import('../../stores/historyHooks');
    const proj = { name: 'p', layers: [] } as never;
    const capture = () => ({ show: showTimeline.exportArrangement() });
    setHistoryCallback(() => { history.record(proj, null, null, capture().show); }, {
      capture,
      commit: (c) => { history.record(proj, null, null, (c as ReturnType<typeof capture>).show); },
    });
    history.clear();
    history.init(proj, null, null, showTimeline.exportArrangement());
    const restore = (snap: ReturnType<typeof history.undo>) => {
      if (!snap) return;
      beginHistoryRestore();
      try {
        const show = showHistoryRestore(snap.show, snap.leavingShow);
        if (show !== undefined) showTimeline.restoreArrangement(show);
      } finally { endHistoryRestore(); }
    };
    try {
      lines.setFollowEdits(true);
      lines.armLines('touch');
      showTimeline.seek(2);
      setLayer('A', { opacity: 0.4 });
      setLayer('B', { opacity: 0.6 });
      setLayer('A', { source: prism as never });
      setLayer('C', { source: tide as never });
      liveEdit.updateHeldEdits();
      const after = get(showTimeline);
      expect(after.lines).toHaveLength(2);
      expect(after.layerTracks.some((t) => t.clips.some((c) => c.media.name === 'Tide'))).toBe(true);
      flushPendingHistorySnapshot();
      history.suppress(); restore(history.undo(proj)); history.unsuppress();
      expect(get(showTimeline).lines).toHaveLength(0);
      expect(get(showTimeline).layerTracks.some((t) => t.clips.some((c) => c.media.name === 'Tide' || c.media.name === 'Prism'))).toBe(false);
      history.suppress(); restore(history.redo(proj)); history.unsuppress();
      expect(get(showTimeline).lines).toHaveLength(2);
      expect(get(showTimeline).layerTracks.some((t) => t.clips.some((c) => c.media.name === 'Tide'))).toBe(true);
    } finally {
      history.clear();
    }
  });

  it('one step while an edit of the user\'s was still waiting: that edit stays its own step before it', () => {
    lines.setFollowEdits(true);
    lines.armLines('touch');
    showTimeline.seek(1);
    setLayer('A', { opacity: 0.3 });
    setLayer('A', { source: prism as never });
    // A slider still in its debounce when Update is pressed.
    expect(showTimeline.editLines((l) => [...l], 'user-slider')).toBe(true);
    const before = steps;
    liveEdit.updateHeldEdits();
    expect(steps - before).toBe(2);
  });
});

describe('recording content on a piece without a row', () => {
  const shaderSource = (name: string) => ({ id: `s-${name}`, type: 'shader', src: `${name}.fs`, name, shaderCode: `// ${name}\nvoid main(){}`, shaderInputs: [], shaderValues: {} });
  const rowOfC = () => get(showTimeline).layerTracks.find((t) => t.layerId === 'C' && !t.subRow);

  it('the row comes with the first block, in the same undo step', () => {
    lines.setFollowEdits(true);
    lines.armLines('touch');
    showTimeline.seek(1);
    showTimeline.play();
    state.update((p) => ({ ...p, layers: [...p.layers, { ...layer('C'), source: shaderSource('Tide') } as unknown as Layer] }));
    for (let t = 1; t <= 3; t += 0.1) showTimeline.seek(t);
    expect(rowOfC()).toBeUndefined();
    const before = steps;
    state.update((p) => ({ ...p, layers: p.layers.map((l) => (l.id === 'C' ? ({ ...l, source: shaderSource('Prism') } as unknown as Layer) : l)) }));
    // What the piece showed from the start of the take is written: the row and that block are one step.
    expect(rowOfC()?.clips.map((c) => c.media.name)).toEqual(['Tide']);
    expect(steps - before).toBe(1);
    for (let t = 3; t <= 5; t += 0.1) showTimeline.seek(t);
    showTimeline.pause();
    expect(rowOfC()?.clips.map((c) => c.media.name)).toEqual(['Tide', 'Prism']);
    expect(steps - before).toBe(2);
  });

  it('a row command that puts nothing on a new row leaves no row behind', () => {
    const c = { ...layer('C'), source: shaderSource('Tide') } as unknown as Layer;
    // Too short to be a block.
    expect(showTimeline.recordLayerBlockFor(c, { kind: 'shader', name: 'Tide', src: 'Tide.fs', shaderCode: 'x' } as never, 2, 2.001)).toBeNull();
    expect(rowOfC()).toBeUndefined();
  });
});
