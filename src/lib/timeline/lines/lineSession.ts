/**
 * The app-side wiring of control lines, in one object the Timeline creates
 * for its document:
 *
 *   const lines = createLineSession({ initial: doc.lines, bindings: doc.lineBindings });
 *   // every frame (and on each seek while paused):
 *   lines.tick(showTime, playing, tempoMap);
 *   // on stop:            lines.stopped(showTime)
 *   // song on the show:   await lines.useSongs([{ trackId, url, startTime, offset }])
 *   // save:               doc.lines = lines.store.lines(); doc.lineBindings = lines.controls.bindings()
 *   // close:              lines.dispose()
 *
 * Nothing here writes the project: values go out through lineRuntime.
 */
import { get } from 'svelte/store';
import { project } from '../../stores/layers';
import { abletonBridge } from '../../ableton/abletonBridge';
import { addMidiTap } from '../../midi/midiTaps';
import { cachedShowAudioDecode, decodeShowAudio } from '../../audio/showAudio';
import { generateUUID } from '../../utils/uuid';
import type { ShowTempoMap } from '../../types';
import { createLineEvaluator, type LineContext, type PlacedSong } from './lineEvaluator';
import { createLineStore } from './lineStore';
import { createLineRecorder, type RecordMode } from './lineRecorder';
import { createLineControls, type LineBinding } from './lineControls';
import { clearLineFrame, publishLineFrame } from './lineRuntime';
import { findParam, type ParamTarget, type RegistrySource } from './paramRegistry';
import { songFeaturesFor } from './songFeatures';
import type { ControlLine } from './lineModel';

export interface SongPlacement {
  trackId: string;
  url: string;
  startTime: number;
  offset: number;
  rate?: number;
  length?: number;
  fadeIn?: number;
  fadeOut?: number;
  gain?: number;
}

function registrySource(): RegistrySource {
  const p = get(project) as any;
  return { layers: p?.layers ?? [], mappingComposition: p?.mappingComposition, wledControllers: p?.wledControllers, wledEffects: p?.wledEffects };
}

export function createLineSession(opts: {
  initial?: ControlLine[];
  bindings?: LineBinding[];
  onBindingsChange?: (bindings: LineBinding[]) => void;
  /** What the registry reads (default: the project). The Timeline adds its
   *  blocks, look blocks and off-stage pieces. */
  registry?: () => RegistrySource;
} = {}) {
  const source = opts.registry ?? registrySource;
  const store = createLineStore(opts.initial ?? []);
  const evaluator = createLineEvaluator();
  let showTime = 0;
  let playing = false;
  let tempo: ShowTempoMap | null = null;
  let songs: PlacedSong[] = [];
  let lastTick = Number.NaN;
  let lastTickMs = 0;
  const describe = (target: ParamTarget, key: string) => findParam(source(), target, key);

  const recorder = createLineRecorder({
    lines: () => store.lines(),
    commit: (label, line) => store.putLine(label, line),
    describe,
    newId: generateUUID,
  });
  const controls = createLineControls({
    recorder,
    lines: () => store.lines(),
    describe,
    showTime: () => showTime,
    playing: () => playing,
    newId: generateUUID,
    liveParam: (t, d, p) => abletonBridge.liveParamValue(t, d, p),
    onBindingsChange: opts.onBindingsChange,
  }, opts.bindings ?? []);

  const removeTap = addMidiTap((channel, type, number, value, from) => controls.onMidi(channel, type, number, value, from));
  const unsubProject = project.subscribe(() => controls.observe(source()));
  let watchedLive = '';

  function context(dtSeconds: number): LineContext {
    return {
      tempo,
      songs,
      liveInputs: true,
      liveParam: (t, d, p) => abletonBridge.liveParamValue(t, d, p),
      liveLevel: (t) => abletonBridge.liveLevelValue(t),
      midiCC: (ch, cc, input) => controls.midiCC(ch, cc, input),
      dt: dtSeconds,
      touch: controls.touches(),
    };
  }

  /** Ask Live for the knobs and levels the lines follow. */
  function syncLiveWatch(lines: readonly ControlLine[]): void {
    const params: [number, number, number][] = [];
    const levels: number[] = [];
    for (const l of lines) {
      const s = l.follow?.source;
      if (s?.kind === 'live-param') params.push([s.track, s.device, s.param]);
      if (s?.kind === 'live-level') levels.push(s.track);
    }
    for (const b of controls.bindings()) if (b.source.kind === 'live-param') params.push([b.source.track, b.source.device, b.source.param]);
    const key = JSON.stringify([params, levels]);
    if (key === watchedLive) return;
    watchedLive = key;
    abletonBridge.watchLiveSources(params, levels);
  }

  return {
    store,
    recorder,
    controls,
    /** Songs placed for music-following lines (offline features). */
    songs: (): readonly PlacedSong[] => songs,
    /** The context the last tick used (for drawing a source's trace). */
    traceContext: (): LineContext => ({ tempo, songs, liveInputs: false }),
    /** Check bound parameters against the registry now (the Timeline's
     *  own values changed: a block's, a look block's). */
    observe(): void { controls.observe(source()); },

    /** Evaluate and publish at show time `t`. Call every frame while playing and on every seek. */
    tick(t: number, isPlaying: boolean, tempoMap: ShowTempoMap | null = tempo): void {
      const ms = performance.now();
      const dt = lastTickMs ? Math.min(0.25, (ms - lastTickMs) / 1000) : 1 / 60;
      lastTickMs = ms;
      if (!(t >= lastTick && t - lastTick < 0.5)) evaluator.reset();
      lastTick = t;
      showTime = t;
      playing = isPlaying;
      tempo = tempoMap;
      controls.pollLive();
      if (recorder.armed && isPlaying) recorder.tick(t);
      const lines = recorder.overlay(store.lines());
      syncLiveWatch(lines);
      publishLineFrame(evaluator.evaluate(lines, t, context(dt)));
    },

    /** The show stopped: open record passes end here (latch too). */
    stopped(t: number): void {
      recorder.stop(t);
      playing = false;
    },

    arm(mode: RecordMode = 'touch'): void { recorder.arm(mode); },
    disarm(): void { recorder.disarm(showTime); },

    /** Songs on the show, analysed offline (once per file) for music-following lines. */
    async useSongs(placements: SongPlacement[]): Promise<void> {
      const placed: PlacedSong[] = [];
      for (const p of placements) {
        const features = await songFeaturesFor(p.url, async () => cachedShowAudioDecode(p.url) ?? (await decodeShowAudio(p.url)));
        if (features) placed.push({ trackId: p.trackId, startTime: p.startTime, offset: p.offset, rate: p.rate, length: p.length, fadeIn: p.fadeIn, fadeOut: p.fadeOut, gain: p.gain, features });
      }
      songs = placed;
    },

    /** Values for an offline render at show time `t`: live-only sources add nothing. */
    exportFrame(t: number, tempoMap: ShowTempoMap | null = tempo) {
      evaluator.reset();
      publishLineFrame(evaluator.evaluate(store.lines(), t, { tempo: tempoMap, songs, liveInputs: false }));
    },

    dispose(): void {
      removeTap();
      unsubProject();
      recorder.stop(showTime);
      clearLineFrame();
      abletonBridge.watchLiveSources([], []);
    },
  };
}

export type LineSession = ReturnType<typeof createLineSession>;
