import { describe, expect, it, vi } from 'vitest';

// The app's instance is not used here: these mocks only keep the imports light.
vi.mock('./musicRuntime', () => ({ playAll: vi.fn(), stopAll: vi.fn(), studioTransportPlaying: () => false }));
vi.mock('./loopStation', () => ({ setLoopSessionHold: vi.fn() }));

import { createLinkStartStop, sessionStartBeat, type StartStopDeps } from './linkStartStop';

function fakes(over: Partial<Record<'enabled' | 'following' | 'liveControl' | 'sessionPlaying' | 'playing', boolean>> = {}) {
  const st = { enabled: true, following: true, liveControl: false, sessionPlaying: false, playing: false, beat: 13.5, now: 0, ...over };
  const calls: string[] = [];
  const deps: StartStopDeps = {
    enabled: () => st.enabled,
    following: () => st.following,
    liveControl: () => st.liveControl,
    sessionPlaying: () => st.sessionPlaying,
    beatNow: () => st.beat,
    playing: () => st.playing,
    play: (o) => { calls.push(`play ${o.atBeat ?? '-'}${o.resumeOnly ? ' resume' : ''}`); st.playing = true; },
    stop: () => { calls.push('stop'); st.playing = false; },
    hold: (on, b) => calls.push(`hold ${on}${b !== undefined ? ` ${b}` : ''}`),
    setSessionPlaying: (p, b) => calls.push(`session ${p}${b !== undefined ? ` ${b}` : ''}`),
    nowMs: () => st.now,
  };
  return { st, calls, sync: createLinkStartStop(deps) };
}

describe('the bar a session start lands on', () => {
  it('is the bar it started on, or the next one when it started between bars', () => {
    expect(sessionStartBeat(16)).toBe(16);
    expect(sessionStartBeat(15.9999)).toBe(16);
    expect(sessionStartBeat(16.002)).toBe(16);
    expect(sessionStartBeat(17)).toBe(20);
    expect(sessionStartBeat(-3)).toBe(0);
    expect(sessionStartBeat(4.5, 3)).toBe(6);
  });
});

describe('Start/Stop Sync off', () => {
  it('Play and Stop are the studio alone, and the session is left to itself', () => {
    const { calls, sync } = fakes({ enabled: false });
    sync.refresh();
    sync.play();
    sync.stop();
    sync.sessionChanged({ playing: true, beat: 16 });
    sync.sessionChanged({ playing: false, beat: 20 });
    expect(calls).toEqual(['play -', 'stop']);
  });
});

describe('Start/Stop Sync on', () => {
  it('the session starting brings the studio back on the bar it started on', () => {
    const { calls, sync } = fakes();
    sync.sessionChanged({ playing: true, beat: 31.999 });
    expect(calls).toEqual(['play 32 resume']);
  });

  it('the session stopping stops the studio, and armed takes wait for the next start', () => {
    const { calls, sync, st } = fakes({ playing: true, sessionPlaying: true });
    sync.sessionChanged({ playing: false, beat: 40 });
    expect(calls).toEqual(['stop', 'hold true']);
    st.sessionPlaying = false;
    sync.refresh();
    sync.sessionChanged({ playing: true, beat: 48 });
    expect(calls).toEqual(['stop', 'hold true', 'hold false 48', 'play 48 resume']);
  });

  it('our own start coming back does not start anything twice', () => {
    const { calls, sync, st } = fakes();
    sync.play();
    expect(calls).toEqual(['play 16', 'session true 16']);
    st.sessionPlaying = true;
    sync.sessionChanged({ playing: true, beat: 16 });
    sync.refresh();
    expect(calls).toEqual(['play 16', 'session true 16']);
  });

  it('Stop stops the session, and its echo does nothing more', () => {
    const { calls, sync, st } = fakes({ playing: true, sessionPlaying: true });
    sync.stop();
    st.sessionPlaying = false;
    sync.sessionChanged({ playing: false, beat: 20 });
    expect(calls).toEqual(['stop', 'session false', 'hold true']);
  });

  it('Play releases takes waiting for the session on the same bar', () => {
    const { calls, sync } = fakes();
    sync.refresh();
    sync.play();
    expect(calls).toEqual(['hold true', 'hold false 16', 'play 16', 'session true 16']);
  });

  it('does not take the hold back before the session reads our start back', () => {
    const { calls, sync, st } = fakes();
    sync.refresh();
    sync.play();
    // A poll still reads the session stopped a few ms later.
    st.now = 5;
    sync.refresh();
    expect(calls.filter((c) => c.startsWith('hold'))).toEqual(['hold true', 'hold false 16']);
    // Never read back: after a second the session's own state counts again.
    st.now = 1500;
    sync.refresh();
    expect(calls.at(-1)).toBe('hold true');
  });

  it('alone in the session (no peers) Play starts now and tells the session, without a hold', () => {
    const { calls, sync } = fakes({ following: false });
    sync.refresh();
    sync.play();
    sync.sessionChanged({ playing: true, beat: 3 });
    expect(calls).toEqual(['play -', 'session true']);
  });

  it('the session starting while the studio already plays changes nothing', () => {
    const { calls, sync } = fakes({ playing: true });
    sync.sessionChanged({ playing: true, beat: 8 });
    expect(calls).toEqual([]);
  });

  it('leaves the transport to Live while Live drives the studio through its script', () => {
    const { calls, sync } = fakes({ liveControl: true, playing: true });
    sync.refresh();
    sync.sessionChanged({ playing: false, beat: 8 });
    sync.play();
    expect(calls).toEqual(['play -']);
  });

  it('turning it off lets takes waiting for the session go', () => {
    const { calls, sync, st } = fakes();
    sync.refresh();
    st.enabled = false;
    sync.refresh();
    expect(calls).toEqual(['hold true', 'hold false']);
  });
});
