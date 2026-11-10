/**
 * The Timeline's soundtrack, rendered offline for "Render to Video": every
 * sound row as it plays, through the same chain (the studio's effect units,
 * build FX, ducking, fades, levels) and with the control lines' values on
 * the row's level and effects, sampled through the render on the show's
 * clock. Live clips are not in it: they play in Live.
 *
 * The render pauses itself every `step` seconds (OfflineAudioContext
 * suspend) to apply the lines' values at that show time, the same way the
 * live engine applies them each frame.
 */
import type { ShowTimelineState } from '../../stores/showTimeline';
import { loadStudioFx } from '../../music/macroFxAudio';
import { songFeaturesFor } from '../lines/songFeatures';
import { createLineEvaluator, SOUND_ROW_TRACK_PREFIX, type PlacedSong } from '../lines/lineEvaluator';
import { cachedShowAudioDecode, decodeShowAudio } from '../../audio/showAudio';
import { blockGainAt, effectiveFades, rowAudible, soundRowsFor } from './soundModel';
import { rowValues } from './soundParams';
import { beatHitsBetween, kickHitsInFeatures, rowKickTimes } from './soundDuck';
import { bpmAt, buildHitTimes, buildSettingsFor, RowBus } from './rowBus';
import { encodeWav } from '../../music/wav';

export const EXPORT_SAMPLE_RATE = 48000;

type Doc = Pick<ShowTimelineState, 'audioTracks' | 'sound' | 'lines' | 'tempo' | 'duration'>;

async function decodeStereo(ctx: BaseAudioContext, url: string, cache: Map<string, AudioBuffer | null>): Promise<AudioBuffer | null> {
  if (cache.has(url)) return cache.get(url)!;
  let buffer: AudioBuffer | null = null;
  try {
    const res = await fetch(url);
    if (res.ok) buffer = await ctx.decodeAudioData(await res.arrayBuffer());
  } catch (err) {
    console.warn('[soundExport] could not decode', url, err);
  }
  cache.set(url, buffer);
  return buffer;
}

/** Songs (offline features) for lines that follow sound, as the live session has them. */
async function placedSongs(doc: Doc): Promise<PlacedSong[]> {
  if (!doc.lines.some((l) => l.follow && (l.follow.source.kind === 'audio' || l.follow.source.kind === 'stem'))) return [];
  const rows = soundRowsFor(doc.sound, doc.audioTracks);
  const out: PlacedSong[] = [];
  for (const t of doc.audioTracks) {
    if (!t.url || t.muted) continue;
    const features = await songFeaturesFor(t.url, async () => cachedShowAudioDecode(t.url) ?? (await decodeShowAudio(t.url)));
    if (!features) continue;
    out.push({ trackId: t.id, startTime: t.startTime, offset: t.offset, length: t.duration, features });
    if (rows[t.lane]) out.push({ trackId: `${SOUND_ROW_TRACK_PREFIX}${rows[t.lane].id}`, startTime: t.startTime, offset: t.offset, length: t.duration, fadeIn: t.fadeIn, fadeOut: t.fadeOut, gain: t.volume, features });
  }
  return out;
}

/**
 * Render `seconds` of the Timeline's sound rows from show time 0. Returns
 * null when there is nothing to hear (no audio blocks, everything muted).
 */
export async function renderTimelineSound(
  doc: Doc,
  seconds: number,
  opts: { sampleRate?: number; step?: number; Offline?: typeof OfflineAudioContext } = {},
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
  const Offline = opts.Offline ?? (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  const rows = soundRowsFor(doc.sound, doc.audioTracks);
  const blocks = doc.audioTracks.filter((t) => t.url && !t.muted && t.volume > 0 && rows[t.lane]?.kind === 'audio');
  if (!Offline || !blocks.length || !(seconds > 0)) return null;
  const sampleRate = opts.sampleRate ?? EXPORT_SAMPLE_RATE;
  const step = opts.step ?? 1 / 30;
  const ctx = new Offline(2, Math.ceil(seconds * sampleRate), sampleRate);
  await loadStudioFx(ctx);
  const master = ctx.createGain();
  master.connect(ctx.destination);

  const buses = new Map(rows.map((r) => [r.id, new RowBus(ctx as unknown as AudioContext, master)]));
  // Worklet effects splice themselves in a moment after they are made.
  await new Promise((r) => setTimeout(r, 0));

  // Audio blocks: a source each, through its fade gain, into its row.
  const decoded = new Map<string, AudioBuffer | null>();
  const byLane = new Map<number, typeof blocks>();
  for (const b of blocks) byLane.set(b.lane, [...(byLane.get(b.lane) ?? []), b]);
  for (const b of blocks) {
    const buffer = await decodeStereo(ctx, b.url, decoded);
    if (!buffer || b.startTime >= seconds) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    const fades = effectiveFades(b, byLane.get(b.lane) ?? []);
    // The fade envelope at 100 points a second over its fades (flat in between).
    gain.gain.setValueAtTime(0, 0);
    const end = Math.min(seconds, b.startTime + b.duration);
    const points: number[] = [b.startTime];
    for (let t = b.startTime; t < b.startTime + fades.fadeIn; t += 0.01) points.push(t);
    points.push(b.startTime + fades.fadeIn);
    for (let t = b.startTime + b.duration - fades.fadeOut; t < end; t += 0.01) points.push(t);
    for (const t of points) if (t < end) gain.gain.setValueAtTime(blockGainAt(b, t, fades) * b.volume, t);
    gain.gain.setValueAtTime(0, end);
    src.connect(gain).connect(buses.get(rows[b.lane].id)!.input);
    src.start(b.startTime, b.offset, b.duration);
  }

  // Ducks: every hit up front.
  for (const row of rows) {
    if (!row.duck) continue;
    const bus = buses.get(row.id)!;
    let hits: number[];
    if (row.duck.source === 'beat') hits = beatHitsBetween(doc.tempo, 0, seconds);
    else {
      const lane = rows.findIndex((r) => r.id === row.duck!.source);
      const placements = [];
      for (const b of doc.audioTracks.filter((t) => t.lane === lane && t.url && !t.muted)) {
        const features = await songFeaturesFor(b.url, async () => cachedShowAudioDecode(b.url) ?? (await decodeShowAudio(b.url)));
        if (features) placements.push({ startTime: b.startTime, duration: b.duration, offset: b.offset, hits: kickHitsInFeatures(features) });
      }
      hits = rowKickTimes(placements).filter((t) => t < seconds);
    }
    for (const h of hits) bus.ducker.duck(row.duck.depth, 1, row.duck.release, h);
  }

  // Builds: started at their start, landing on their end.
  for (const b of doc.sound.builds) {
    const row = rows[b.lane];
    if (!row || b.startTime >= seconds) continue;
    const bus = buses.get(row.id)!;
    bus.build.start({
      start: b.startTime,
      land: b.startTime + b.duration,
      beatSeconds: 60 / bpmAt(doc.tempo, b.startTime),
      hits: buildHitTimes(b, doc.tempo),
      settings: buildSettingsFor(b),
    });
  }

  // Levels and effects with the lines on top, applied on the render's own clock.
  const evaluator = createLineEvaluator();
  const songs = await placedSongs(doc);
  const apply = (t: number) => {
    const frame = doc.lines.length ? evaluator.evaluate(doc.lines, t, { tempo: doc.tempo, songs, liveInputs: false }) : null;
    const bpm = bpmAt(doc.tempo, t);
    const values = rows.map((r) => rowValues(r, frame?.sounds?.get(r.id)));
    rows.forEach((row, i) => {
      const bus = buses.get(row.id)!;
      const audible = rowAudible({ muted: values[i].muted, solo: row.solo }, rows);
      bus.setLevel(audible ? values[i].volume : 0);
      bus.setFx(row, values[i].fx, bpm);
    });
  };
  apply(0);
  const offline = ctx as OfflineAudioContext;
  for (let t = step; t < seconds; t += step) {
    const at = t;
    void offline.suspend(at).then(() => {
      apply(at);
      void offline.resume();
    });
  }
  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  return { left, right, sampleRate };
}

/** The rendered soundtrack as a WAV file on disk (desktop), for the render mux. */
export async function timelineSoundtrackFile(doc: Doc, seconds: number): Promise<string | null> {
  const w = globalThis as { electronAPI?: { invoke?: (ch: string, args: unknown) => Promise<{ success?: boolean; path?: string } | null> } };
  if (!w.electronAPI?.invoke) return null;
  const sound = await renderTimelineSound(doc, seconds);
  if (!sound) return null;
  const bytes = encodeWav(sound.left, sound.right, sound.sampleRate);
  const saved = await w.electronAPI.invoke('save_generated_asset', { filename: 'timeline-soundtrack.wav', mime: 'audio/wav', bytes: bytes.buffer });
  return saved?.success && saved.path ? saved.path : null;
}

