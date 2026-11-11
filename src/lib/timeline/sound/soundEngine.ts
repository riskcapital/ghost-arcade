/**
 * Playing the Timeline's sound rows and Live rows.
 *
 * Audio blocks keep their own media elements on the clip audio bus (so
 * tempo following, drift correction, the audio clock and the analyser all
 * work as on the Show). The bus hands each Timeline block's sound to this
 * module (`setShowAudioRouter`), which runs it through:
 *
 *   block fade gain → row: build FX → Music Studio effects → duck → level → bus master
 *
 * The effects are the studio's own units (`MacroFxChain`, `BuildFx`,
 * `Ducker`), not copies, driven by the row's settings with the control
 * lines' values on top (`controlLineFrame`, scope 'sound').
 *
 * Live rows: `LiveClipScheduler` turns the playhead into fire / stop
 * requests for the Ghost Arcade script in Live.
 *
 * Everything is evaluated from the show's own evaluation (`onShowFrame`):
 * every frame while playing, every seek, nothing during an offline render
 * (which uses the Timeline's own audio, never Live).
 */
import { get } from 'svelte/store';
import {
  onShowFrame,
  onShowDocChange,
  setShowAudioRouter,
  showTimeline,
  type ShowFrameTick,
  type ShowTimelineState,
} from '../../stores/showTimeline';
import { bpmAt, buildHitTimes, buildSettingsFor, GAIN_TC, RowBus } from './rowBus';
import { cachedShowAudioDecode, decodeShowAudio } from '../../audio/showAudio';
import { abletonBridge } from '../../ableton/abletonBridge';
import { currentLineFrame } from '../lines/lineRuntime';
import { songFeaturesFor } from '../lines/songFeatures';
import type { ShowAudioTrack, ShowTempoMap } from '../../types';
import { blockGainAt, effectiveFades, rowAudible, soundRowsFor, type SoundDoc, type SoundRow } from './soundModel';
import { rowValues } from './soundParams';
import { beatHitsBetween, kickHitsInFeatures, rowKickTimes, timesBetween } from './soundDuck';
import { LiveClipScheduler, liveSchedInputs, type LiveCommand } from './liveSchedule';

const DUCK_LOOKAHEAD = 0.15;

interface EngineState {
  ctx: AudioContext | null;
  master: AudioNode | null;
  buses: Map<string, RowBus>;
  blockGains: Map<string, { node: GainNode; rowId: string; last: number }>;
  /** Show time up to which each row's ducks are scheduled. */
  duckedTo: Map<string, number>;
  /** Build blocks started this pass. */
  buildsStarted: Set<string>;
  lastSeek: number;
  wasPlaying: boolean;
  /** Kick times per source row (show seconds), by placement signature. */
  kicks: Map<string, { sig: string; times: number[] | null }>;
}

const engine: EngineState = {
  ctx: null,
  master: null,
  buses: new Map(),
  blockGains: new Map(),
  duckedTo: new Map(),
  buildsStarted: new Set(),
  lastSeek: Number.NaN,
  wasPlaying: false,
  kicks: new Map(),
};

/** Sent to the Live script (the bridge; tests replace it). */
let liveSend: (cmd: LiveCommand) => void = (cmd) => {
  if (cmd.t === 'fire_clip') abletonBridge.launchClip(cmd.i, cmd.s, { ...(cmd.q !== undefined ? { q: cmd.q } : {}), ...(cmd.pos !== undefined ? { pos: cmd.pos } : {}) });
  else if (cmd.t === 'stop_track') abletonBridge.stopTrack(cmd.i, cmd.q !== undefined ? { q: cmd.q } : {});
  else abletonBridge.stopAllClips(cmd.q !== undefined ? { q: cmd.q } : {});
};
const liveScheduler = new LiveClipScheduler({ send: (cmd) => liveSend(cmd) });

/** Test seam: where Live requests go. */
export function setLiveSender(send: ((cmd: LiveCommand) => void) | null): void {
  liveSend = send ?? ((cmd) => {
    if (cmd.t === 'fire_clip') abletonBridge.launchClip(cmd.i, cmd.s, { ...(cmd.q !== undefined ? { q: cmd.q } : {}), ...(cmd.pos !== undefined ? { pos: cmd.pos } : {}) });
    else if (cmd.t === 'stop_track') abletonBridge.stopTrack(cmd.i, cmd.q !== undefined ? { q: cmd.q } : {});
    else abletonBridge.stopAllClips(cmd.q !== undefined ? { q: cmd.q } : {});
  });
}

function rowsOf(s: Pick<ShowTimelineState, 'sound' | 'audioTracks'>): SoundRow[] {
  return soundRowsFor(s.sound, s.audioTracks);
}

function busFor(rowId: string): RowBus | null {
  const ctx = engine.ctx;
  const master = engine.master;
  if (!ctx || !master) return null;
  let bus = engine.buses.get(rowId);
  if (!bus) {
    bus = new RowBus(ctx, master);
    engine.buses.set(rowId, bus);
  }
  return bus;
}

/** The clip bus asks where a Timeline track's sound goes. */
function route(trackId: string, ctx: AudioContext, master: AudioNode): AudioNode | null {
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return null;
  const track = s.audioTracks.find((t) => t.id === trackId);
  if (!track) return null;
  if (engine.ctx !== ctx || engine.master !== master) {
    releaseGraph();
    engine.ctx = ctx;
    engine.master = master;
  }
  const row = rowsOf(s)[track.lane];
  if (!row) return null;
  const bus = busFor(row.id);
  if (!bus) return null;
  let entry = engine.blockGains.get(trackId);
  if (!entry) {
    entry = { node: ctx.createGain(), rowId: row.id, last: -1 };
    entry.node.gain.value = 0;
    engine.blockGains.set(trackId, entry);
  } else {
    try { entry.node.disconnect(); } catch { /* none */ }
    entry.rowId = row.id;
  }
  entry.node.connect(bus.input);
  return entry.node;
}

function releaseGraph(): void {
  for (const bus of engine.buses.values()) bus.dispose();
  engine.buses.clear();
  for (const e of engine.blockGains.values()) {
    try { e.node.disconnect(); } catch { /* gone */ }
  }
  engine.blockGains.clear();
  engine.duckedTo.clear();
  engine.buildsStarted.clear();
}

// ── Ducking ────────────────────────────────────────────────────────────────

function kickTimesFor(s: ShowTimelineState, rowIndex: number, rowId: string): number[] | null {
  const blocks = s.audioTracks.filter((t) => t.lane === rowIndex && t.url && !t.muted);
  const sig = blocks.map((b) => `${b.url}@${b.startTime}:${b.duration}:${b.offset}`).join('|');
  const cached = engine.kicks.get(rowId);
  if (cached && cached.sig === sig) return cached.times;
  engine.kicks.set(rowId, { sig, times: null });
  void (async () => {
    const placements = [];
    for (const b of blocks) {
      const features = await songFeaturesFor(b.url, async () => cachedShowAudioDecode(b.url) ?? (await decodeShowAudio(b.url)));
      if (features) placements.push({ startTime: b.startTime, duration: b.duration, offset: b.offset, hits: kickHitsInFeatures(features) });
    }
    const entry = engine.kicks.get(rowId);
    if (entry && entry.sig === sig) entry.times = rowKickTimes(placements);
  })();
  return null;
}

function scheduleDucks(s: ShowTimelineState, rows: SoundRow[], t: number, tempo: ShowTempoMap | null): void {
  const ctx = engine.ctx;
  if (!ctx) return;
  const frame = currentLineFrame();
  rows.forEach((row) => {
    if (!row.duck) return;
    const bus = engine.buses.get(row.id);
    if (!bus) return;
    const from = Math.max(t, engine.duckedTo.get(row.id) ?? t);
    const to = t + DUCK_LOOKAHEAD;
    if (to <= from) return;
    engine.duckedTo.set(row.id, to);
    let hits: number[];
    if (row.duck.source === 'beat') hits = beatHitsBetween(tempo, from, to);
    else {
      const index = rows.findIndex((r) => r.id === row.duck!.source);
      const times = index >= 0 ? kickTimesFor(s, index, row.duck.source) : null;
      hits = times ? timesBetween(times, from, to) : [];
    }
    const depth = rowValues(row, frame?.sounds?.get(row.id)).duckDepth;
    for (const h of hits) bus.ducker.duck(depth, 1, row.duck.release, ctx.currentTime + Math.max(0, h - t));
  });
}

// ── Builds ─────────────────────────────────────────────────────────────────

function runBuilds(doc: SoundDoc, rows: SoundRow[], t: number, tempo: ShowTempoMap | null): void {
  const ctx = engine.ctx;
  if (!ctx) return;
  for (const b of doc.builds) {
    if (engine.buildsStarted.has(b.id)) continue;
    const end = b.startTime + b.duration;
    if (t < b.startTime - 0.1 || t >= end - 0.05) continue;
    const row = rows[b.lane];
    const bus = row ? busFor(row.id) : null;
    if (!bus) continue;
    engine.buildsStarted.add(b.id);
    const now = ctx.currentTime;
    const at = (x: number) => now + (x - t);
    bus.build.start({
      start: at(b.startTime),
      land: at(end),
      beatSeconds: 60 / bpmAt(tempo, b.startTime),
      hits: buildHitTimes(b, tempo).map((h) => ({ ...h, time: at(h.time) })),
      settings: buildSettingsFor(b),
    });
  }
}

function cancelBuilds(): void {
  for (const bus of engine.buses.values()) if (bus.hasBuild()) bus.build.cancel();
  engine.buildsStarted.clear();
}

// ── Live ───────────────────────────────────────────────────────────────────

function feedLiveScheduler(s: ShowTimelineState, rows: SoundRow[], env: { tempo: ShowTempoMap | null; loop: boolean; duration: number }): void {
  const bridge = get(abletonBridge);
  const frame = currentLineFrame();
  const inputs = liveSchedInputs(s.sound, rows, bridge, (row) => rowValues(row, frame?.sounds?.get(row.id)).muted);
  liveScheduler.setBlocks(inputs.rows, inputs.blocks);
  liveScheduler.setEnv({
    tempo: env.tempo,
    setQuantize: bridge.quantize,
    numerator: bridge.numerator,
    denominator: bridge.denominator,
    protocol: bridge.protocol,
    loop: env.loop,
    duration: env.duration,
  });
}

function syncLive(s: ShowTimelineState, rows: SoundRow[], tick: ShowFrameTick): void {
  feedLiveScheduler(s, rows, tick);
  liveScheduler.tick(tick.time, tick.playing, tick.seek);
}

/**
 * The Live scheduler with the Timeline's Live rows as they are now, for a
 * phrase landing (which may come while the Timeline is stopped, before any
 * frame has fed it).
 */
export function liveSchedulerNow(): LiveClipScheduler {
  const s = get(showTimeline);
  if (s.doc === 'timeline') feedLiveScheduler(s, rowsOf(s), { tempo: s.tempo, loop: s.loop, duration: s.duration });
  return liveScheduler;
}

// ── The frame ──────────────────────────────────────────────────────────────

function onFrame(tick: ShowFrameTick): void {
  if (tick.doc !== 'timeline') {
    if (engine.wasPlaying) {
      cancelBuilds();
      liveScheduler.tick(tick.time, false, tick.seek);
    }
    engine.wasPlaying = false;
    return;
  }
  // An offline render plays the Timeline's own audio only, never Live.
  if (tick.manual) return;
  const s = get(showTimeline);
  const rows = rowsOf(s);
  const t = tick.time;
  const jump = tick.seek !== engine.lastSeek || tick.playing !== engine.wasPlaying;
  engine.lastSeek = tick.seek;
  if (jump) {
    engine.duckedTo.clear();
    cancelBuilds();
  }
  engine.wasPlaying = tick.playing;

  if (engine.ctx) {
    // Blocks gone from the document (deleted, the other tab's) let go of their gains.
    if (engine.blockGains.size > s.audioTracks.length) {
      const live = new Set(s.audioTracks.map((x) => x.id));
      for (const [id, e] of engine.blockGains) {
        if (live.has(id)) continue;
        try { e.node.disconnect(); } catch { /* gone */ }
        engine.blockGains.delete(id);
      }
    }
    const frame = currentLineFrame();
    const values = rows.map((row) => rowValues(row, frame?.sounds?.get(row.id)));
    const bpm = bpmAt(tick.tempo, t);
    rows.forEach((row, i) => {
      const bus = engine.buses.get(row.id);
      if (!bus) return;
      const v = values[i];
      const audible = rowAudible({ muted: v.muted, solo: row.solo }, rows);
      bus.setLevel(audible ? v.volume : 0);
      bus.setFx(row, v.fx, bpm);
    });
    const byLane = new Map<number, ShowAudioTrack[]>();
    for (const tr of s.audioTracks) {
      const list = byLane.get(tr.lane);
      if (list) list.push(tr);
      else byLane.set(tr.lane, [tr]);
    }
    for (const tr of s.audioTracks) {
      const entry = engine.blockGains.get(tr.id);
      if (!entry) continue;
      const g = blockGainAt(tr, t, effectiveFades(tr, byLane.get(tr.lane) ?? []));
      if (Math.abs(g - entry.last) > 1e-3) {
        entry.last = g;
        entry.node.gain.setTargetAtTime(g, engine.ctx.currentTime, GAIN_TC);
      }
    }
    if (tick.playing) {
      scheduleDucks(s, rows, t, tick.tempo);
      runBuilds(s.sound, rows, t, tick.tempo);
    }
  }
  if (s.sound.live.length || rows.some((r) => r.kind === 'live') || engine.wasPlaying) syncLive(s, rows, tick);
}

let installed: (() => void) | null = null;

/** Wire the sound rows into the app (once, at start). */
export function installTimelineSound(): () => void {
  if (installed) return installed;
  setShowAudioRouter(route);
  const offFrame = onShowFrame(onFrame);
  const offDoc = onShowDocChange(() => {
    liveScheduler.reset();
    cancelBuilds();
  });
  // Debug/automation surface (CDP checks and the Show Runner), as window.__ghostArcade.
  if (typeof window !== 'undefined') {
    void import('./soundCommands').then((commands) => {
      try {
        const w = window as unknown as { __ghostArcade?: Record<string, unknown> };
        w.__ghostArcade = { ...(w.__ghostArcade ?? {}), timelineSound: { commands, ableton: abletonBridge, engine: _soundEngineState, liveScheduler } };
      } catch { /* sealed */ }
    });
  }
  installed = () => {
    offFrame();
    offDoc();
    setShowAudioRouter(null);
    releaseGraph();
    liveScheduler.reset();
    installed = null;
  };
  return installed;
}

/** Test seam: the engine's graph state. */
export function _soundEngineState(): Readonly<EngineState> {
  return engine;
}

export { liveScheduler as _liveScheduler };

export { bpmAt, buildHitTimes, buildSettingsFor };
