/**
 * The show tray's editing rules: what Delete acts on after keys are
 * clicked, which modifier selects and which moves freely, cancelling a drag,
 * dragging a selection that spans tracks, where a moving clip snaps, short
 * clips, wheel zoom, playhead follow, Esc with a menu open and key labels.
 *
 * The tray itself needs a DOM and the whole app, so these drive the same
 * code it runs: the selection watcher with the real show store, the drag
 * session with a stand-in window, and the pure helpers. The real-input
 * checks (CDP) are in the stream's handoff.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get } from 'svelte/store';
import type { Layer, ShowClipMedia } from '../../../types';
import {
  showTimeline,
  setShowCompositionLoader,
  setShowSnapEdgeProvider,
  setShowTrackFrameSink,
} from '../../../stores/showTimeline';
import { createTempoMap, nearestGridTime } from '../../../show/tempoMap';
import { selectionDropsKeys, watchShowSelection } from './selectionChecks';
import { cancelActiveDrag, dragInFlight, followPointer } from './dragSession';
import { addsToSelection, dragRowOffset, laneKeySelection, movesFreely, trimEdgeWidth } from './trackLayout';
import { deleteSelection } from './trackCommands';
import { dragSnapper, snapMovingClip } from './dragSnap';
import { anchoredScrollLeft, followScrollLeft, wheelPixels, wheelZoomFactor } from './gridView';
import { onMac, shortcutLabels, showPopoverOpen } from './keyLabels';

const media = (name: string): ShowClipMedia => ({ kind: 'image', name, src: `/img/${name}` });
const layer = (id: string) => ({ id, name: id, type: 'media', opacity: 1, source: null }) as unknown as Layer;
const flush = () => new Promise<void>((r) => queueMicrotask(r));

describe('keys on a lane next to the show selection (B1)', () => {
  let trackId = '';
  let stop: () => void = () => {};
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
    trackId = showTimeline.addLayerTrack(layer('A'));
    showTimeline.addTrackLane(trackId, { key: 'layer:opacity', label: 'Opacity', type: 'number' });
    showTimeline.setLaneKey(trackId, 'layer:opacity', 2, 0.2);
    showTimeline.setLaneKey(trackId, 'layer:opacity', 6, 0.9);
    showTimeline.addLayerClip(trackId, media('a'), 0, { duration: 10 });
    showTimeline.addPresetClip('comp-a', 8, 'A');
    showTimeline.addPresetClip('comp-b', 8, 'B');
    laneKeySelection.set(null);
    stop = watchShowSelection(showTimeline, laneKeySelection);
  });
  afterEach(() => {
    stop();
    laneKeySelection.set(null);
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
  });

  const keys = () => get(showTimeline).layerTracks[0].lanes[0].keyframes.map((k) => k.time);

  it('keys clicked while a preset clip is selected stay selected, and Delete removes the key', async () => {
    const preset = get(showTimeline).presetClips[0];
    showTimeline.select({ kind: 'preset', id: preset.id });
    await flush();
    // What clicking a key does (ShowTrackLanes.selectKeys).
    laneKeySelection.set({ trackId, key: 'layer:opacity', times: [6] });
    showTimeline.selectLayerClips([]);
    // Store updates that are not a change of selection: playhead frames.
    for (let i = 0; i < 20; i++) { showTimeline.seek(i * 0.1); await flush(); }
    expect(get(laneKeySelection)?.times).toEqual([6]);
    // The tray's Delete: keys first.
    expect(deleteSelection(false)).toBe(true);
    expect(keys()).toEqual([2]);
    expect(get(showTimeline).presetClips).toHaveLength(2);
  });

  it('keys on a selected track stay selected', async () => {
    showTimeline.select({ kind: 'track', id: trackId });
    await flush();
    laneKeySelection.set({ trackId, key: 'layer:opacity', times: [2] });
    for (let i = 0; i < 10; i++) { showTimeline.seek(i); await flush(); }
    expect(get(laneKeySelection)?.times).toEqual([2]);
    expect(get(showTimeline).selection?.kind).toBe('track');
  });

  it('picking something else lets go of the keys', async () => {
    laneKeySelection.set({ trackId, key: 'layer:opacity', times: [2] });
    const [a, b] = get(showTimeline).presetClips;
    showTimeline.select({ kind: 'preset', id: a.id });
    await flush();
    expect(get(laneKeySelection)).toBeNull();
    laneKeySelection.set({ trackId, key: 'layer:opacity', times: [2] });
    showTimeline.select({ kind: 'preset', id: b.id });
    await flush();
    expect(get(laneKeySelection)).toBeNull();
    // A layer clip selection keeps them (keys and clips together).
    laneKeySelection.set({ trackId, key: 'layer:opacity', times: [2] });
    showTimeline.selectLayerClips([get(showTimeline).layerTracks[0].clips[0].id]);
    await flush();
    expect(get(laneKeySelection)?.times).toEqual([2]);
  });

  it('decides on a change of selection only', () => {
    const p = { kind: 'preset' as const, id: 'p' };
    expect(selectionDropsKeys(p, p)).toBe(false);
    expect(selectionDropsKeys(p, { ...p })).toBe(false);
    expect(selectionDropsKeys(p, null)).toBe(false);
    expect(selectionDropsKeys(null, p)).toBe(true);
    expect(selectionDropsKeys(p, { kind: 'track', id: 't' })).toBe(true);
    expect(selectionDropsKeys(p, { kind: 'layerClip', id: 'c' })).toBe(false);
  });

  it('the tray uses the watcher, not a check on every update', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/components/ShowTimeline.svelte'), 'utf8');
    expect(src).toMatch(/watchShowSelection\(showTimeline, laneKeySelection/);
    expect(src).not.toMatch(/sel\.kind !== 'layerClip'\) laneKeySelection\.set\(null\)/);
  });
});

describe('modifiers (B2)', () => {
  const ev = (o: Partial<MouseEvent>) => ({ shiftKey: false, metaKey: false, ctrlKey: false, ...o }) as MouseEvent;

  it('Cmd/Ctrl moves freely and never adds to the selection; Shift adds', () => {
    expect(addsToSelection(ev({ metaKey: true }))).toBe(false);
    expect(addsToSelection(ev({ ctrlKey: true }))).toBe(false);
    expect(addsToSelection(ev({ shiftKey: true }))).toBe(true);
    expect(movesFreely(ev({ metaKey: true }))).toBe(true);
    expect(movesFreely(ev({ ctrlKey: true }))).toBe(true);
    expect(movesFreely(ev({ shiftKey: true }))).toBe(false);
  });

  it('pressClip and pressKey take "add" from Shift alone', () => {
    const lanes = readFileSync(join(process.cwd(), 'src/lib/components/show/timeline/ShowTrackLanes.svelte'), 'utf8');
    const press = lanes.slice(lanes.indexOf('function pressClip'), lanes.indexOf('function dragClips'));
    expect(press).toMatch(/const additive = addsToSelection\(e\)/);
    expect(press).not.toMatch(/metaKey|ctrlKey/);
    const keyView = readFileSync(join(process.cwd(), 'src/lib/components/show/timeline/KeyframeLaneView.svelte'), 'utf8');
    const pressKey = keyView.slice(keyView.indexOf('function pressKey'), keyView.indexOf('function swallowClick'));
    expect(pressKey).toMatch(/const additive = addsToSelection\(e\)/);
    expect(pressKey).not.toMatch(/metaKey|ctrlKey/);
  });
});

/** A stand-in window for the drag session. */
function fakeWindow() {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const key = (type: string, capture?: boolean | AddEventListenerOptions) => `${type}:${typeof capture === 'object' ? !!capture.capture : !!capture}`;
  return {
    addEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions) {
      const k = key(type, opts);
      if (!listeners.has(k)) listeners.set(k, new Set());
      listeners.get(k)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions) {
      listeners.get(key(type, opts))?.delete(fn);
    },
    fire(type: string, init: Record<string, unknown> = {}) {
      let stopped = false;
      const e = { type, stopPropagation: () => { stopped = true; }, ...init } as unknown as Event;
      for (const k of [`${type}:true`, `${type}:false`]) for (const fn of [...(listeners.get(k) ?? [])]) fn(e);
      return stopped;
    },
    count() { let n = 0; for (const s of listeners.values()) n += s.size; return n; },
  };
}

describe('drag session (B3)', () => {
  it('Esc cancels: cancel runs, end does not, and the release is not a click', () => {
    const w = fakeWindow();
    const calls: string[] = [];
    followPointer({ move: () => calls.push('move'), end: () => calls.push('end'), cancel: () => calls.push('cancel') }, w as unknown as Window);
    w.fire('mousemove', { buttons: 1 });
    expect(dragInFlight()).toBe(true);
    // The tray's key handler asks this first on Esc.
    expect(cancelActiveDrag()).toBe(true);
    expect(dragInFlight()).toBe(false);
    expect(cancelActiveDrag()).toBe(false);
    w.fire('mousemove', { buttons: 1 });
    w.fire('mouseup');
    expect(w.fire('click')).toBe(true); // swallowed
    expect(calls).toEqual(['move', 'cancel']);
  });

  it('a move with no button held ends the drag (the release was missed)', () => {
    const w = fakeWindow();
    const calls: string[] = [];
    followPointer({ move: () => calls.push('move'), end: () => calls.push('end'), cancel: () => calls.push('cancel') }, w as unknown as Window);
    w.fire('mousemove', { buttons: 1 });
    w.fire('mousemove', { buttons: 0 });
    w.fire('mousemove', { buttons: 0 });
    expect(calls).toEqual(['move', 'end']);
    expect(dragInFlight()).toBe(false);
    expect(w.count()).toBe(0);
  });

  it('the window losing focus cancels', () => {
    const w = fakeWindow();
    const calls: string[] = [];
    followPointer({ move: () => calls.push('move'), end: () => calls.push('end'), cancel: () => calls.push('cancel') }, w as unknown as Window);
    w.fire('mousemove', { buttons: 1 });
    w.fire('blur');
    w.fire('mouseup');
    expect(calls).toEqual(['move', 'cancel']);
    expect(w.count()).toBe(0);
  });

  it('a release ends it once', () => {
    const w = fakeWindow();
    const end = vi.fn();
    followPointer({ move: () => {}, end, cancel: () => {} }, w as unknown as Window);
    w.fire('mouseup');
    w.fire('mouseup');
    expect(end).toHaveBeenCalledTimes(1);
    expect(w.count()).toBe(0);
  });

  it('Esc in the tray cancels a drag before anything else, and Alt-drag copies paste only on release', () => {
    const tray = readFileSync(join(process.cwd(), 'src/lib/components/ShowTimeline.svelte'), 'utf8');
    const handler = tray.slice(tray.indexOf('function handleShowKey'));
    expect(handler.indexOf('cancelActiveDrag()')).toBeGreaterThan(-1);
    expect(handler.indexOf('cancelActiveDrag()')).toBeLessThan(handler.indexOf('classifyShowKey('));
    const lanes = readFileSync(join(process.cwd(), 'src/lib/components/show/timeline/ShowTrackLanes.svelte'), 'utf8');
    const copies = lanes.slice(lanes.indexOf('function dragCopies'), lanes.indexOf('// ── Clip menu'));
    // The paste is in the release handler; the cancel handler only clears ghosts.
    const at = copies.lastIndexOf('}, 3, () => {');
    const cancelPart = copies.slice(at, copies.indexOf('});', at));
    expect(cancelPart).toMatch(/ghosts = \[\]/);
    expect(cancelPart).not.toMatch(/pasteLayerClipGroups/);
  });
});

describe('Esc during an Alt-drag with the real store (B3)', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
  });
  afterEach(() => {
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
  });

  it('a cancelled move puts the show back exactly', () => {
    const a = showTimeline.addLayerTrack(layer('A'));
    const id = showTimeline.addLayerClip(a, media('x'), 3.37, { duration: 4 })!;
    showTimeline.selectLayerClips([id]);
    const before = showTimeline.exportArrangement();
    const w = fakeWindow();
    followPointer({
      move: () => { showTimeline.moveLayerClipsAcross([id], 2, 0); },
      end: () => {},
      cancel: () => showTimeline.restoreArrangement(before),
    }, w as unknown as Window);
    w.fire('mousemove', { buttons: 1 });
    expect(showTimeline.findLayerClip(id)?.clip.startTime).toBeCloseTo(5.37);
    cancelActiveDrag();
    expect(showTimeline.findLayerClip(id)?.clip.startTime).toBe(3.37);
    expect(get(showTimeline).selectedClipIds).toEqual([id]);
  });
});

describe('dragging a selection that spans tracks (B9)', () => {
  it('stops at the first and last track instead of being refused', () => {
    // Clips on rows 1 and 2 of 4, grabbed on row 1.
    expect(dragRowOffset(3, 1, 1, 2, 4)).toBe(1); // row 2's clips reach the last track
    expect(dragRowOffset(0, 1, 1, 2, 4)).toBe(-1);
    expect(dragRowOffset(1, 1, 1, 2, 4)).toBe(0);
    // Grabbed on the lower row: going up stops when the upper row reaches 0.
    expect(dragRowOffset(0, 2, 1, 2, 4)).toBe(-1);
    // One track's selection behaves as before.
    expect(dragRowOffset(9, 0, 0, 0, 4)).toBe(3);
  });

  it('the clip drag uses the whole selection’s rows', () => {
    const lanes = readFileSync(join(process.cwd(), 'src/lib/components/show/timeline/ShowTrackLanes.svelte'), 'utf8');
    const drag = lanes.slice(lanes.indexOf('function dragClips'), lanes.indexOf('function dragCopies'));
    expect(drag).toMatch(/dragRowOffset\(row, startIndex, minIndex, maxIndex, list\.length\)/);
  });
});

describe('where a moving clip snaps (B10)', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
  });
  afterEach(() => {
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    setShowSnapEdgeProvider(null);
    showTimeline._resetForTest();
  });

  it('with a tempo grid the start lands on the grid, not the end', () => {
    const a = showTimeline.addLayerTrack(layer('A'));
    const id = showTimeline.addLayerClip(a, media('x'), 0, { duration: 1.3 })!;
    const tempo = createTempoMap(120); // a beat is 0.5 s
    showTimeline.setTempo(tempo);
    showTimeline.setSnapGrid('beat');
    showTimeline.seek(100);
    const snapper = dragSnapper([id]);
    for (const raw of [10.21, 10.3, 10.69, 11.1, 12.44]) {
      const start = snapMovingClip(snapper, raw, 1.3);
      expect(Math.abs(start - nearestGridTime(tempo, raw, 'beat'))).toBeLessThan(1e-6);
    }
  });

  it('the end still butts up against a neighbour', () => {
    const a = showTimeline.addLayerTrack(layer('A'));
    const id = showTimeline.addLayerClip(a, media('x'), 0, { duration: 1.3 })!;
    showTimeline.addLayerClip(a, media('y'), 20.02, { duration: 2 });
    showTimeline.setTempo(createTempoMap(120));
    showTimeline.setSnapGrid('beat');
    showTimeline.setZoom(40);
    showTimeline.seek(100);
    const snapper = dragSnapper([id]);
    // End within a pixel of the neighbour's start, start 0.23 s off the beat.
    expect(snapMovingClip(snapper, 18.73, 1.3)).toBeCloseTo(20.02 - 1.3, 6);
  });

  it('snap off: the pointer', () => {
    const snapper = { snap: (t: number) => t, magnet: (t: number) => t };
    expect(snapMovingClip(snapper, 3.21, 2)).toBe(3.21);
  });
});

describe('short clips (B4)', () => {
  it('the middle half of a clip is always its body', () => {
    for (const w of [4, 6, 8, 12, 14, 20, 28, 40, 100]) {
      const edge = trimEdgeWidth(w);
      expect(edge).toBeGreaterThanOrEqual(1);
      expect(edge).toBeLessThanOrEqual(7);
      expect(w - edge * 2).toBeGreaterThanOrEqual(w / 2);
    }
    expect(trimEdgeWidth(400)).toBe(7);
  });
});

describe('wheel zoom and playhead follow (B5, B6)', () => {
  it('zoom follows how far the wheel turned', () => {
    // A pinch: many small deltas zoom a little each.
    const pinch = Array.from({ length: 10 }, () => wheelZoomFactor(-2)).reduce((a, b) => a * b, 1);
    expect(pinch).toBeGreaterThan(1.03);
    expect(pinch).toBeLessThan(1.1);
    // A mouse wheel notch.
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1.2);
    expect(wheelZoomFactor(100)).toBeLessThan(1 / 1.2);
    expect(wheelZoomFactor(0)).toBe(1);
    // Line and page deltas are scaled, and one event is capped.
    expect(wheelPixels(3, 1)).toBe(48);
    expect(wheelZoomFactor(-10, 2)).toBe(1.5);
    expect(wheelZoomFactor(10, 2)).toBeCloseTo(1 / 1.5);
  });

  it('keeps the time under the pointer', () => {
    const zoom = 12;
    const pointerX = 300;
    const scrollLeft = 1000;
    const t = (scrollLeft + pointerX) / zoom;
    const next = 12 * 1.8;
    const sl = anchoredScrollLeft(t, next, pointerX);
    expect((sl + pointerX) / next).toBeCloseTo(t, 9);
    expect(anchoredScrollLeft(1, 10, 300)).toBe(0);
  });

  it('pages when the playhead runs off the view, not when the user scrolled away', () => {
    expect(followScrollLeft(900, 990, 0, 1000)).toBe(890);
    expect(followScrollLeft(500, 520, 0, 1000)).toBeNull();
    // Already off screen (scrolled away): left alone.
    expect(followScrollLeft(5000, 5010, 0, 1000)).toBeNull();
    // A loop back to the start pages back.
    expect(followScrollLeft(4970, 0, 4000, 1000)).toBe(0);
    expect(followScrollLeft(null, 5, 0, 1000)).toBeNull();
  });

  it('the header column forwards its wheel to the grid', () => {
    const tray = readFileSync(join(process.cwd(), 'src/lib/components/ShowTimeline.svelte'), 'utf8');
    expect(tray).toMatch(/class="lane-labels"[^>]*onwheel=\{handleLabelWheel\}/);
  });
});

describe('Esc with a menu open, and key labels (B11)', () => {
  it('a menu open in the tray takes Esc', () => {
    const doc = (hit: boolean) => ({ querySelector: vi.fn(() => (hit ? ({} as Element) : null)) });
    expect(showPopoverOpen(doc(true) as unknown as Document)).toBe(true);
    expect(showPopoverOpen(doc(false) as unknown as Document)).toBe(false);
    const tray = readFileSync(join(process.cwd(), 'src/lib/components/ShowTimeline.svelte'), 'utf8');
    const handler = tray.slice(tray.indexOf('function handleShowKey'));
    expect(handler.indexOf('showPopoverOpen()')).toBeLessThan(handler.indexOf('classifyShowKey('));
  });

  it('Mac glyphs on a Mac only', () => {
    expect(onMac('MacIntel')).toBe(true);
    expect(onMac('Win32')).toBe(false);
    expect(onMac('Linux x86_64')).toBe(false);
    expect(shortcutLabels(true)).toEqual({ duplicate: '⌘D', delete: '⌫', rippleDelete: '⇧⌫' });
    expect(shortcutLabels(false)).toEqual({ duplicate: 'Ctrl+D', delete: 'Del', rippleDelete: 'Shift+Del' });
    const menu = readFileSync(join(process.cwd(), 'src/lib/components/show/timeline/ShowClipContextMenu.svelte'), 'utf8');
    expect(menu).not.toMatch(/[⌘⌫⇧]/);
  });
});

describe('tray height (B7)', () => {
  const tray = readFileSync(join(process.cwd(), 'src/lib/components/ShowTimeline.svelte'), 'utf8');

  it('counts the pads and the inspector’s real height, and keeps room for the lanes', () => {
    expect(tray).toMatch(/const padsRoom = \$derived\(\(\$takeoverPadsOpen && isTimeline\) \|\| phraseStripShown \? padsH : 0\)/);
    expect(tray).toMatch(/Math\.max\(TRACK_INSPECTOR_RESERVE, inspectorH\)/);
    expect(tray).toMatch(/const chromeH = \$derived\(transportH \+ padsRoom \+ inspectorRoom \+ 1\)/);
    expect(tray).toMatch(/insp-idle" bind:clientHeight=\{inspectorH\}/);
  });

  it('publishes its height only after the height exists (a tray open at mount read it too early)', () => {
    const decl = tray.indexOf('const trayHeight = $derived(');
    const publish = tray.indexOf("'--ga-show-tray-height'");
    expect(decl).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(decl);
  });
});
