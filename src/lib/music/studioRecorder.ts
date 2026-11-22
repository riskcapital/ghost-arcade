/**
 * Record A/V from the studio: the program output with the studio's mix as
 * its sound (the app's own recorder, which muxes the studio audio into the
 * video file), or the mix alone as a WAV, with optional stems: a WAV per
 * mixer channel, recorded together so they line up. A count-in waits for
 * the next bar line. Finished recordings are listed with a way to reveal
 * them; audio files are kept in the app's asset folder (and, with
 * Auto-Download on, offered in a save dialog too).
 */

import { get, writable } from 'svelte/store';
import { startRecording, type RecorderHandle } from '../recording/recorder';
import { nextLaunchBoundary } from '../stores/launchClock';
import { settings } from '../stores/settings';
import { mediaLibrary } from '../stores/media';
import { invoke, isElectron } from '../bridge';
import { downloadBlob } from '../recording/offlineRender';
import { pathToFileUrl } from '../storage/assetRegistry';
import { showToast } from '../stores/errorToast';
import { generateUUID } from '../utils/uuid';
import { studioAudio } from './musicRuntime';
import { musicStudio } from './musicStudioStore';
import { CHANNEL_LABELS, type ChannelId } from './mixer';
import { encodeWav } from './wav';

export { encodeWav };

export type StudioRecMode = 'video' | 'audio';

export interface StudioRecOptions {
  mode: StudioRecMode;
  stems: boolean;
  countIn: boolean;
}

export interface StudioRecState {
  /** starting: setting the captures up (a second press waits for it). */
  phase: 'idle' | 'waiting' | 'starting' | 'recording' | 'saving';
  /** performance.now() when it started recording. */
  startedAt: number;
  mode: StudioRecMode;
}

export interface RecentRecording {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'stem';
  path: string | null;
  at: number;
}

export const studioRec = writable<StudioRecState>({ phase: 'idle', startedAt: 0, mode: 'video' });

const RECENT_KEY = 'ga.studio.recentRecordings';
function loadRecent(): RecentRecording[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.slice(0, 30) : [];
  } catch {
    return [];
  }
}
export const recentRecordings = writable<RecentRecording[]>(typeof localStorage === 'undefined' ? [] : loadRecent());
recentRecordings.subscribe((list) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    // Private windows keep the list for the session.
  }
});

function remember(entry: Omit<RecentRecording, 'id' | 'at'>): void {
  recentRecordings.update((list) => [{ ...entry, id: generateUUID(), at: Date.now() }, ...list].slice(0, 30));
}

export function forgetRecording(id: string): void {
  recentRecordings.update((list) => list.filter((r) => r.id !== id));
}

export function revealRecording(r: RecentRecording): void {
  if (r.path) void invoke('video_converter_reveal_path', { path: r.path });
}

// ── Writing WAVs as they record ─────────────────────────────────────────

/** Two float channels as 16-bit stereo PCM, interleaved (a WAV's data). */
export function pcm16Interleaved(left: Float32Array, right: Float32Array): Uint8Array {
  const n = Math.min(left.length, right.length);
  const out = new DataView(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    out.setInt16(i * 4, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    out.setInt16(i * 4 + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
  }
  return new Uint8Array(out.buffer);
}

/** The loudest sample in either channel. */
export function peakOf(left: Float32Array, right: Float32Array): number {
  let p = 0;
  for (let i = 0; i < left.length; i++) p = Math.max(p, Math.abs(left[i]));
  for (let i = 0; i < right.length; i++) p = Math.max(p, Math.abs(right[i]));
  return p;
}

/** Where a capture's PCM goes as it arrives. */
export interface WavSink {
  push(left: Float32Array, right: Float32Array): void;
  /** Close it as a WAV at `rate`; the file's path (null in a browser), or throws when a write failed. */
  finish(rate: number): Promise<string | null>;
  /** Throw it away (and its file). */
  abort(): Promise<void>;
}

/** Most PCM a stream holds before it is on disk; past this the take fails rather than grow without end. */
export const MAX_PENDING_BYTES = 48 * 1024 * 1024;
/** Blocks are written in batches of about this many bytes (a second of stereo 16-bit at 48 kHz is 192 kB). */
const WRITE_BATCH_BYTES = 384 * 1024;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Invoke = (cmd: string, args?: any) => Promise<unknown>;

/** Desktop: the WAV is written in batches through wav_stream_* as it records; little is kept in memory. */
export async function streamingSink(name: string, call: Invoke = invoke): Promise<WavSink> {
  const begun = (await call('wav_stream_begin', { filename: `${name}.wav` })) as { success?: boolean; id?: string; error?: string } | null;
  if (!begun?.success || !begun.id) throw new Error(begun?.error || 'Could not start writing the recording');
  const id = begun.id;
  let batch: Uint8Array[] = [];
  let batchBytes = 0;
  let pending = 0;
  let failure: Error | null = null;
  let chain: Promise<void> = Promise.resolve();
  const send = () => {
    if (!batchBytes) return;
    const bytes = new Uint8Array(batchBytes);
    let o = 0;
    for (const b of batch) { bytes.set(b, o); o += b.length; }
    batch = [];
    batchBytes = 0;
    chain = chain.then(async () => {
      if (failure) return;
      const r = (await call('wav_stream_write', { id, bytes }).catch((e) => ({ success: false, error: String(e) }))) as { success?: boolean; error?: string } | null;
      pending -= bytes.length;
      if (!r?.success) failure = new Error(r?.error || 'Could not write the recording');
    });
  };
  return {
    push(left, right) {
      if (failure) return;
      const pcm = pcm16Interleaved(left, right);
      pending += pcm.length;
      if (pending > MAX_PENDING_BYTES) {
        failure = new Error('The disk is not keeping up with the recording');
        return;
      }
      batch.push(pcm);
      batchBytes += pcm.length;
      if (batchBytes >= WRITE_BATCH_BYTES) send();
    },
    async finish(rate) {
      send();
      await chain;
      if (failure) {
        await call('wav_stream_abort', { id }).catch(() => {});
        throw failure;
      }
      const r = (await call('wav_stream_finish', { id, sampleRate: rate })) as { success?: boolean; path?: string; error?: string } | null;
      if (!r?.success || !r.path) throw new Error(r?.error || 'Could not finish the recording');
      return r.path;
    },
    async abort() {
      failure ??= new Error('aborted');
      await chain.catch(() => {});
      await call('wav_stream_abort', { id }).catch(() => {});
    },
  };
}

/** Browser: no streaming write, so the take is kept in memory and downloaded at the end. */
function memorySink(name: string): WavSink {
  let left: Float32Array[] = [];
  let right: Float32Array[] = [];
  const join = (parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  return {
    push(l, r) { left.push(l); right.push(r); },
    async finish(rate) {
      const wav = encodeWav(join(left), join(right), rate);
      left = []; right = [];
      downloadBlob(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }), `${name}.wav`);
      return null;
    },
    async abort() { left = []; right = []; },
  };
}

/** With Auto-Download on, offer the finished mix in a save dialog too (copied from the asset folder). */
async function offerCopy(path: string, name: string): Promise<void> {
  const dialog = (await invoke('save_project_dialog', {
    title: 'Save Recording',
    defaultPath: `${name}.wav`,
    filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
  })) as { canceled?: boolean; filePath?: string | null } | null;
  if (!dialog || dialog.canceled || !dialog.filePath) return;
  const bytes = new Uint8Array(await (await fetch(pathToFileUrl(path))).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await invoke('save_file_binary', { path: dialog.filePath, base64Data: btoa(bin) });
}

// ── The take ────────────────────────────────────────────────────────────

/** How long to wait for a capture's last block after stop before giving up on it. */
export const FLUSH_TIMEOUT_MS = 3000;
/** Longest the video recorder gets to finish its file before the button is freed anyway. */
export const VIDEO_FINISH_TIMEOUT_MS = 120_000;
/** How far ahead on the audio clock captures start and stop, so all are told before the frame comes. */
const ALIGN_SECONDS = 0.05;

interface PcmCapture {
  id: string;
  label: string;
  node: AudioWorkletNode;
  sink: WavSink;
  peak: number;
  done: Promise<number>;
}

/** One recording, from the press to the last file: everything it opened is its own to close. */
interface Take {
  id: number;
  opts: StudioRecOptions;
  name: string;
  ctx: AudioContext | null;
  captures: PcmCapture[];
  video: RecorderHandle | null;
  /** The video recorder has finished with its file (or there is none). */
  videoDone: boolean;
  /** The WAVs are all written (or there are none). */
  filesDone: boolean;
  cancelled: boolean;
}

let take: Take | null = null;
let serial = 0;
let countInTimer: ReturnType<typeof setTimeout> | null = null;
let workletLoaded: Promise<void> | null = null;

/** Test seam: what makes a capture's sink and its worklet. */
export const recorderDeps = {
  sink: (name: string): Promise<WavSink> => (isElectron ? streamingSink(name) : Promise.resolve(memorySink(name))),
  async loadWorklet(ctx: AudioContext): Promise<void> {
    workletLoaded ??= (async () => {
      const { default: url } = await import('./pcmCaptureWorklet.ts?worker&url');
      await ctx.audioWorklet.addModule(url);
    })().catch((err) => { workletLoaded = null; throw err; });
    await workletLoaded;
  },
  node: (ctx: AudioContext): AudioWorkletNode =>
    new AudioWorkletNode(ctx, 'ghost-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' }),
};

function makeCapture(ctx: AudioContext, id: string, label: string, sink: WavSink): PcmCapture {
  const node = recorderDeps.node(ctx);
  const c: PcmCapture = { id, label, node, sink, peak: 0, done: Promise.resolve(ctx.sampleRate) };
  c.done = new Promise((resolve) => {
    node.port.onmessage = (e: MessageEvent<{ left?: Float32Array; right?: Float32Array; done?: boolean; sampleRate?: number }>) => {
      if (e.data.left && e.data.right) {
        c.peak = Math.max(c.peak, peakOf(e.data.left, e.data.right));
        sink.push(e.data.left, e.data.right);
      }
      if (e.data.done) resolve(e.data.sampleRate ?? ctx.sampleRate);
    };
  });
  return c;
}

const idle = (mode: StudioRecMode) => studioRec.set({ phase: 'idle', startedAt: 0, mode });

/** The take is over once its files are written and its video is done: only then is the button free. */
function settle(t: Take): void {
  if (take !== t || !t.filesDone || !t.videoDone) return;
  take = null;
  idle(t.opts.mode);
}

/** Close everything a take opened, without keeping anything. */
async function release(t: Take): Promise<void> {
  const caps = t.captures;
  t.captures = [];
  for (const c of caps) {
    try { c.node.port.postMessage({ stop: 0 }); } catch { /* gone */ }
    try { c.node.disconnect(); } catch { /* gone */ }
  }
  await Promise.allSettled(caps.map((c) => c.sink.abort()));
  if (t.video) {
    try { t.video.stop(); } catch { /* stopped */ }
  }
}

async function begin(t: Take): Promise<void> {
  countInTimer = null;
  const engine = studioAudio();
  const master = engine.recordingNode();
  const ctx = (master?.context as AudioContext | undefined) ?? null;
  t.ctx = ctx;
  studioRec.set({ phase: 'starting', startedAt: 0, mode: t.opts.mode });
  try {
    const wanted: Array<{ id: string; label: string; source: AudioNode }> = [];
    if (t.opts.mode === 'audio' && master) wanted.push({ id: 'mix', label: t.name, source: master });
    if (t.opts.stems && ctx) {
      const mixer = get(musicStudio).mixer as Record<string, { arm?: boolean } | undefined>;
      const armed = Object.entries(mixer).filter(([, st]) => st?.arm).map(([id]) => id);
      for (const [id, node] of engine.stemNodes()) {
        if (!armed.length || armed.includes(id)) wanted.push({ id, label: `${t.name} - ${CHANNEL_LABELS[id as ChannelId] ?? id}`, source: node });
      }
    }
    if (wanted.length && ctx) {
      await recorderDeps.loadWorklet(ctx);
      if (t.cancelled) throw new Error('cancelled');
      // Every file is opened before any capture is connected.
      const sinks: WavSink[] = [];
      try {
        for (const w of wanted) {
          sinks.push(await recorderDeps.sink(w.label));
          if (t.cancelled) throw new Error('cancelled');
        }
      } catch (err) {
        await Promise.allSettled(sinks.map((x) => x.abort()));
        throw err;
      }
      t.captures = wanted.map((w, k) => makeCapture(ctx, w.id, w.label, sinks[k]));
      // Connected in one go and told one start frame: they line up to the sample.
      for (const [k, c] of t.captures.entries()) wanted[k].source.connect(c.node);
      const start = Math.round((ctx.currentTime + ALIGN_SECONDS) * ctx.sampleRate);
      for (const c of t.captures) c.node.port.postMessage({ start });
    }
    if (t.opts.mode === 'video') {
      t.videoDone = false;
      t.video = startRecording({
        namePrefix: 'Audio Lab',
        onComplete: () => {
          t.video = null;
          // The recorder keeps the file in the media library; list the newest studio one.
          const items = get(mediaLibrary) as unknown as Array<{ name: string; _assetRef?: { originalPath?: string } }>;
          const item = [...items].reverse().find((i) => i.name.startsWith('Audio Lab'));
          remember({ name: item?.name ?? t.name, kind: 'video', path: item?._assetRef?.originalPath ?? null });
          t.videoDone = true;
          settle(t);
        },
        onError: (err) => {
          t.video = null;
          t.videoDone = true;
          showToast('Recording could not start: ' + err.message, 'error');
          if (take === t && get(studioRec).phase !== 'saving') void fail(t);
          else settle(t);
        },
      });
      if (!t.video) throw new Error('The recorder did not start.');
    }
    if (t.cancelled) throw new Error('cancelled');
    studioRec.set({ phase: 'recording', startedAt: performance.now(), mode: t.opts.mode });
  } catch (err) {
    if (!t.cancelled) {
      console.warn('[Studio] recording failed to start:', err);
      showToast(`Recording could not start: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
    await fail(t);
  }
}

/** A take that could not go on: all of it is released and the button is free again. */
async function fail(t: Take): Promise<void> {
  await release(t);
  t.videoDone = true;
  t.filesDone = true;
  if (take === t) {
    take = null;
    idle(t.opts.mode);
  }
}

/** Start recording (on the next bar with a count-in). A press while one is under way does nothing. */
export function startStudioRecording(opts: StudioRecOptions): void {
  if (take || get(studioRec).phase !== 'idle') return;
  const t: Take = {
    id: ++serial,
    opts,
    name: `Audio Lab ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}`,
    ctx: null,
    captures: [],
    video: null,
    videoDone: true,
    filesDone: false,
    cancelled: false,
  };
  take = t;
  if (opts.countIn) {
    studioRec.set({ phase: 'waiting', startedAt: 0, mode: opts.mode });
    countInTimer = setTimeout(() => void begin(t), Math.max(0, nextLaunchBoundary(4) - performance.now()));
  } else {
    studioRec.set({ phase: 'starting', startedAt: 0, mode: opts.mode });
    void begin(t);
  }
}

/** Stop and keep everything recorded (or cancel one still waiting or starting). */
export async function stopStudioRecording(): Promise<void> {
  const t = take;
  if (!t) return;
  const state = get(studioRec);
  if (countInTimer) {
    clearTimeout(countInTimer);
    countInTimer = null;
    take = null;
    idle(state.mode);
    return;
  }
  if (state.phase === 'starting') {
    // begin() sees it after its next step and releases what it opened.
    t.cancelled = true;
    return;
  }
  if (state.phase !== 'recording') return;
  studioRec.set({ ...state, phase: 'saving' });
  if (t.video) {
    try { t.video.stop(); } catch (err) { console.warn('[Studio] video stop failed:', err); t.videoDone = true; }
    // A recorder that never reports back must not leave the button on Saving.
    setTimeout(() => { if (!t.videoDone) { t.videoDone = true; settle(t); } }, VIDEO_FINISH_TIMEOUT_MS);
  }
  const caps = t.captures;
  t.captures = [];
  const ctx = t.ctx;
  // One stop frame for all of them: equal sample counts.
  const stop = ctx ? Math.round((ctx.currentTime + ALIGN_SECONDS) * ctx.sampleRate) : 0;
  for (const c of caps) c.node.port.postMessage({ stop });
  const offer = !!settings.get().recording.autoDownload;
  const failed: string[] = [];
  try {
    for (const c of caps) {
      const rate = await Promise.race([c.done, new Promise<null>((r) => setTimeout(() => r(null), FLUSH_TIMEOUT_MS))]);
      try { c.node.disconnect(); } catch { /* gone */ }
      const isMix = c.id === 'mix';
      // Silent stems (an instrument that never played, on either side) are left out.
      if (rate === null || (!isMix && c.peak <= 1e-4)) {
        if (rate === null) failed.push(c.label);
        await c.sink.abort();
        continue;
      }
      try {
        const path = await c.sink.finish(rate);
        // Listed only once the file is really there.
        remember({ name: c.label, kind: isMix ? 'audio' : 'stem', path });
        if (isMix && offer && path) await offerCopy(path, c.label).catch((err) => console.warn('[Studio] save dialog copy failed:', err));
      } catch (err) {
        console.warn('[Studio] could not write', c.label, err);
        failed.push(c.label);
      }
    }
  } finally {
    if (failed.length) showToast(`Could not save ${failed.length === 1 ? failed[0] : `${failed.length} recordings`}.`, 'error');
    t.filesDone = true;
    settle(t);
  }
}

/** Test seam: forget any take. */
export function _resetRecorderForTests(): void {
  if (countInTimer) clearTimeout(countInTimer);
  countInTimer = null;
  take = null;
  workletLoaded = null;
  idle('video');
}
