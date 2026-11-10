/**
 * The show's phase follower against what the core and the broker actually
 * do with it.
 *
 * The core (`apply_media_source_phase` in native-renderer/src/main.rs)
 * silently ignores a phase target unless it matches the source's playback
 * state exactly: same URI and seek generation, a looping video that is not
 * paused, with a known duration. `coreAcceptsPhase` restates those guards;
 * the playback state comes from the real command NativeRendererSync builds
 * for the show's source, so a change on either side that would make the
 * core drop every show target fails here.
 *
 * The broker rebuilds the status the editor sees field by field; the
 * follower's error has to survive that, or nothing outside the core can
 * tell whether a clip is being steered.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ShowClipMedia, ShowLayerClip, ShowLayerTrack, Layer } from '../../types';
import { evaluateShowTracks } from './showTrackEval';
import { ShowClipSources } from './showClipSources';
import { showPhaseCommands, showPhaseTargets } from './showVideoPhase';
// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { normalizeStatus } from '../../../../electron/native-renderer-broker.js';

vi.mock('../../bridge', async (original) => ({
  ...(await original<typeof import('../../bridge')>()),
  invoke: vi.fn(async () => null),
}));

let SyncClass: typeof import('../../sync/nativeRendererSync').NativeRendererSync;

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { style: { setProperty: () => {} } } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
  ({ NativeRendererSync: SyncClass } = await import('../../sync/nativeRendererSync'));
});

type Command = Record<string, any>;

/** The guards `apply_media_source_phase` applies before it steers a session. */
function coreAcceptsPhase(playback: Command, phase: Command): boolean {
  const triml = Math.max(0, Math.min(1, Number(playback.trim_start ?? 0)));
  const trimr = Math.max(triml, Math.min(1, Number(playback.trim_end ?? 1)));
  const duration = Number(playback.duration_seconds);
  return phase.source_id === playback.source_id
    && phase.enabled !== false
    && playback.paused !== true
    && playback.loop_enabled === true
    && (playback.source_type ?? 'video') === 'video'
    && phase.uri === playback.uri
    && phase.seek_generation === playback.seek_generation
    && duration > 0
    && duration * (trimr - triml) > 0
    && Number.isFinite(phase.time_seconds);
}

const media = (sourceDuration = 10): ShowClipMedia => ({
  kind: 'video', name: 'framecode.mp4', src: 'ghost-asset://localhost/clips/framecode.mp4', sourceDuration,
});

function clip(id: string, startTime: number, duration: number, extra: Partial<ShowLayerClip> = {}): ShowLayerClip {
  return { id, startTime, duration, media: media(), inPoint: 0, endBehaviour: 'loop', fadeIn: 0, fadeOut: 0, ...extra };
}

function track(clips: ShowLayerClip[]): ShowLayerTrack {
  const template = { id: 'A', name: 'A', type: 'media', visible: true, opacity: 1, surfaceId: 'A' } as unknown as Layer;
  return { id: 't', layerId: 'A', layerName: 'A', template, clips, lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false };
}

function playbackFor(source: any): Command {
  const sync = new SyncClass() as any;
  return sync.nativeVideoPlaybackCommand(source, 'video', 1000, { time: 0 });
}

describe('show phase targets reach the core', () => {
  it.each([
    ['a looping clip, on its second pass', [clip('c', 0, 60)], 12],
    ['a clip with an in point, past a split', [clip('a', 0, 4, { inPoint: 2 }), clip('b', 4, 30, { inPoint: 6, loopStart: 2 })], 9],
    ['a slowed clip', [clip('c', 1, 60, { rate: 0.5 })], 7],
  ] as Array<[string, ShowLayerClip[], number]>)('%s', (_name, clips, t) => {
    const sources = new ShowClipSources({ now: () => 0 });
    const tracks = [track(clips)];
    const frame = evaluateShowTracks(tracks, t, { playing: true, seekGeneration: 3, evaluatedAtMs: 500 });
    const source = sources.sourceFor(frame.tracks[0], frame);
    const playback = playbackFor(source);
    const { commands } = showPhaseCommands(showPhaseTargets(frame, sources, 516), new Set());
    expect(commands).toHaveLength(1);
    expect(coreAcceptsPhase(playback, commands[0])).toBe(true);
    // And the target is where the show is 16 ms after the frame, in the
    // source's own media time.
    const c = frame.tracks[0].clip!;
    expect((commands[0] as Command).time_seconds).toBeCloseTo(c.mediaTime + 0.016 * c.rate, 5);
  });

  it('a re-anchored source moves both commands to the new generation together', () => {
    const sources = new ShowClipSources({ now: () => 0 });
    const tracks = [track([clip('c', 0, 60)])];
    const before = evaluateShowTracks(tracks, 5, { playing: true, seekGeneration: 1 });
    sources.sourceFor(before.tracks[0], before);
    const after = evaluateShowTracks(tracks, 20, { playing: true, seekGeneration: 2 });
    const source = sources.sourceFor(after.tracks[0], after);
    const playback = playbackFor(source);
    const { commands } = showPhaseCommands(showPhaseTargets(after, sources), new Set());
    expect(playback.seek_generation).toBe(2);
    expect(coreAcceptsPhase(playback, commands[0])).toBe(true);
    // A target left on the old generation would be ignored.
    expect(coreAcceptsPhase(playback, { ...commands[0], seek_generation: 1 })).toBe(false);
  });
});

describe('the broker keeps the follower visible', () => {
  const session = {
    source_id: 'show:c', signature: 's', state: 'playing', backend: 'videotoolbox', frames_presented: 3,
    uri: 'ghost-asset://localhost/clips/framecode.mp4', decode_max_edge: 640,
  };

  it('passes phase_error_seconds through while a target steers the session', () => {
    const status = normalizeStatus({ native_video_sessions: [{ ...session, phase_error_seconds: -0.0125 }] });
    expect(status.native_video_sessions[0]).toMatchObject({
      phase_error_seconds: -0.0125,
      uri: session.uri,
      decode_max_edge: 640,
    });
  });

  it('reports null when nothing steers it (or an older core leaves it out)', () => {
    const steered = normalizeStatus({ native_video_sessions: [{ ...session, phase_error_seconds: null, decode_max_edge: null }] });
    expect(steered.native_video_sessions[0].phase_error_seconds).toBeNull();
    expect(steered.native_video_sessions[0].decode_max_edge).toBeNull();
    const old = normalizeStatus({ native_video_sessions: [{ source_id: 'x' }] });
    expect(old.native_video_sessions[0]).toMatchObject({ phase_error_seconds: null, uri: '', decode_max_edge: null });
  });
});
