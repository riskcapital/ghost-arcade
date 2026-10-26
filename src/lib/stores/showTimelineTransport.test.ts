/**
 * The show transport with a fake clock: the playhead follows the sound card
 * while the show has audio, seeks and loop wraps stay exact, and a show that
 * does not loop does what its end action says.
 *
 * requestAnimationFrame is replaced by a queue the test steps by hand, and
 * the audio clock by a number the test moves, so every frame is exact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  fitShowZoom,
  normalizeShowEndAction,
  setShowAudioClockReader,
  setShowCompositionLoader,
  setShowTransportSink,
  showTimeline,
  SHOW_MAX_ZOOM,
  SHOW_MIN_ZOOM,
  type ShowTransportEvent,
} from './showTimeline';

let frames: Array<(now: number) => void> = [];
let frameMs = 0;
let audioSeconds: number | null = null;

/** Run one animation frame, `ms` after the last one; the audio clock moves by `audioStep` seconds. */
function frame(ms: number, audioStep = ms / 1000) {
  frameMs += ms;
  if (audioSeconds !== null) audioSeconds += audioStep;
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(frameMs);
}

function hydrateShow(opts: { duration?: number; loop?: boolean; endAction?: string; audio?: boolean } = {}) {
  const duration = opts.duration ?? 10;
  showTimeline.hydrate({
    version: 1,
    loop: opts.loop === true,
    endAction: opts.endAction,
    audioTracks: opts.audio === false ? [] : [{
      id: 'song', name: 'Song', url: 'blob:song', startTime: 0, duration, offset: 0, sourceDuration: duration,
      volume: 1, muted: false, lane: 0, peaks: [1, 2, 3],
    }],
    presetClips: [
      { id: 'one', compositionId: 'A', startTime: 0, duration: duration / 2, transitionIn: 'cut', transitionDuration: 0 },
      { id: 'two', compositionId: 'B', startTime: duration / 2, duration: duration / 2, transitionIn: 'cut', transitionDuration: 0 },
    ],
  });
}

beforeEach(() => {
  showTimeline._resetForTest();
  frames = [];
  frameMs = 1000;
  audioSeconds = 500;
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => { frames = []; });
  setShowAudioClockReader(() => audioSeconds);
});

afterEach(() => {
  setShowCompositionLoader(null);
  setShowTransportSink(null);
  showTimeline._resetForTest();
  vi.unstubAllGlobals();
});

describe('audio as the master clock', () => {
  it('moves the playhead with the sound card, not with the frames', () => {
    hydrateShow();
    showTimeline.play();
    frame(16); // anchors
    // Frames say a second passed; the sound card played 0.95 s.
    for (let i = 0; i < 10; i++) frame(100, 0.095);
    expect(get(showTimeline).currentTime).toBeCloseTo(0.95, 6);
  });

  it('uses the frame clock when the show has no audio', () => {
    hydrateShow({ audio: false });
    showTimeline.play();
    frame(16);
    for (let i = 0; i < 10; i++) frame(100, 0.095);
    expect(get(showTimeline).currentTime).toBeCloseTo(1, 6);
  });

  it('falls back to the frame clock while the audio engine is not running', () => {
    hydrateShow();
    setShowAudioClockReader(() => null);
    showTimeline.play();
    frame(16);
    frame(500);
    expect(get(showTimeline).currentTime).toBeCloseTo(0.5, 6);
  });

  it('a seek while playing carries on from the new position', () => {
    hydrateShow({ duration: 60 });
    showTimeline.play();
    frame(16);
    frame(1000);
    showTimeline.seek(30);
    frame(16, 0.2); // re-anchors here
    frame(500, 0.5);
    expect(get(showTimeline).currentTime).toBeCloseTo(30.5, 6);
  });

  it('wraps a looping show without losing time', () => {
    const loads: string[] = [];
    setShowCompositionLoader((id) => loads.push(id));
    hydrateShow({ duration: 10, loop: true });
    showTimeline.play();
    frame(16);
    frame(9900, 9.9);
    frame(250, 0.25); // 10.15 → 0.15
    expect(get(showTimeline).currentTime).toBeCloseTo(0.15, 6);
    expect(get(showTimeline).isPlaying).toBe(true);
    frame(100, 0.1);
    expect(get(showTimeline).currentTime).toBeCloseTo(0.25, 6);
    expect(loads).toEqual(['A', 'B', 'A']);
  });
});

describe('end of the show', () => {
  function runToEnd() {
    showTimeline.play();
    frame(16);
    frame(10500, 10.5);
  }

  it('hold (default): stops on the end with the last look up', () => {
    const loads: string[] = [];
    setShowCompositionLoader((id) => loads.push(id));
    hydrateShow();
    expect(get(showTimeline).endAction).toBe('hold');
    runToEnd();
    const s = get(showTimeline);
    expect(s.isPlaying).toBe(false);
    expect(s.currentTime).toBe(10);
    expect(s.activeClipId).toBe('two');
    expect(loads).toEqual(['A', 'B']);
  });

  it('rewind: back to the start with the opening look cued', () => {
    const loads: string[] = [];
    setShowCompositionLoader((id) => loads.push(id));
    hydrateShow({ endAction: 'rewind' });
    runToEnd();
    const s = get(showTimeline);
    expect(s.isPlaying).toBe(false);
    expect(s.currentTime).toBe(0);
    expect(s.activeClipId).toBe('one');
    expect(loads).toEqual(['A', 'B', 'A']);
  });

  it('blackout: asks for a blackout, and a new start says so', () => {
    const events: ShowTransportEvent[] = [];
    setShowTransportSink((e) => events.push(e));
    hydrateShow({ endAction: 'blackout' });
    runToEnd();
    expect(events).toEqual([{ type: 'start' }, { type: 'end', action: 'blackout' }]);
    // Play again from the end: the show starts over.
    showTimeline.play();
    expect(get(showTimeline).currentTime).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'start' });
  });

  it('a looping show never ends', () => {
    const events: ShowTransportEvent[] = [];
    setShowTransportSink((e) => events.push(e));
    hydrateShow({ loop: true, endAction: 'blackout' });
    runToEnd();
    expect(get(showTimeline).isPlaying).toBe(true);
    expect(events.filter((e) => e.type === 'end')).toEqual([]);
  });

  it('saves and restores the end action', () => {
    hydrateShow({ endAction: 'rewind' });
    expect(showTimeline.serialize().endAction).toBe('rewind');
    showTimeline.setEndAction('blackout');
    const saved = showTimeline.serialize();
    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    expect(get(showTimeline).endAction).toBe('blackout');
    expect(normalizeShowEndAction('explode')).toBe('hold');
  });
});

describe('laying a show out', () => {
  it('replaces the preset lane in one go', () => {
    hydrateShow({ duration: 60 });
    showTimeline.setPresetClips([
      { compositionId: 'C', startTime: 20, duration: 40, label: 'Late' },
      { compositionId: 'D', startTime: 0, duration: 20 },
    ]);
    const s = get(showTimeline);
    expect(s.presetClips.map((c) => [c.compositionId, c.startTime, c.duration])).toEqual([['D', 0, 20], ['C', 20, 40]]);
    expect(s.duration).toBe(60);
  });

  it('zooms the whole show into the tray width', () => {
    expect(fitShowZoom(200, 1000)).toBe(5);
    expect(fitShowZoom(1, 100000)).toBe(SHOW_MAX_ZOOM);
    expect(fitShowZoom(100000, 100)).toBe(SHOW_MIN_ZOOM);
    hydrateShow({ duration: 100 });
    showTimeline.zoomToFit(1200);
    expect(get(showTimeline).zoom).toBe(12);
  });
});
