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
  project: { subscribe: state.subscribe, selectLayer: () => {} },
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

const { showTimeline, setShowCompositionLoader } = await import('../../stores/showTimeline');
const { setHistoryCallback } = await import('../../stores/historyHooks');
const { runMidiTaps } = await import('../../midi/midiTaps');
const { currentLineFrame } = await import('./lineRuntime');
const lines = await import('./timelineLines');
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
