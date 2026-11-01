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
  phase: 'idle' | 'waiting' | 'recording' | 'saving';
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

// ── The capture ─────────────────────────────────────────────────────────

interface PcmCapture {
  id: string;
  node: AudioWorkletNode;
  left: Float32Array[];
  right: Float32Array[];
  done: Promise<number>;
}

let video: RecorderHandle | null = null;
let captures: PcmCapture[] = [];
let countInTimer: ReturnType<typeof setTimeout> | null = null;
let workletLoaded: Promise<void> | null = null;
let current: StudioRecOptions | null = null;
let takeName = '';

async function capture(ctx: AudioContext, id: string, source: AudioNode): Promise<PcmCapture> {
  workletLoaded ??= (async () => {
    const { default: url } = await import('./pcmCaptureWorklet.ts?worker&url');
    await ctx.audioWorklet.addModule(url);
  })();
  await workletLoaded;
  const node = new AudioWorkletNode(ctx, 'ghost-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit' });
  const c: PcmCapture = { id, node, left: [], right: [], done: Promise.resolve(ctx.sampleRate) };
  c.done = new Promise((resolve) => {
    node.port.onmessage = (e: MessageEvent<{ left?: Float32Array; right?: Float32Array; done?: boolean; sampleRate?: number }>) => {
      if (e.data.left && e.data.right) {
        c.left.push(e.data.left);
        c.right.push(e.data.right);
      }
      if (e.data.done) resolve(e.data.sampleRate ?? ctx.sampleRate);
    };
  });
  source.connect(node);
  return c;
}

const join = (parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** Keep a WAV: in the app's asset folder on the desktop (and offered in a save dialog with Auto-Download on), else a download. */
async function keepWav(bytes: Uint8Array, name: string, kind: 'audio' | 'stem', offerDialog: boolean): Promise<void> {
  if (!isElectron) {
    downloadBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' }), `${name}.wav`);
    remember({ name, kind, path: null });
    return;
  }
  const saved = (await invoke('save_generated_asset', { filename: `${name}.wav`, mime: 'audio/wav', bytes })) as { success?: boolean; path?: string } | null;
  const path = saved?.success && saved.path ? saved.path : null;
  remember({ name, kind, path });
  if (offerDialog) {
    const dialog = (await invoke('save_project_dialog', {
      title: 'Save Recording',
      defaultPath: `${name}.wav`,
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }],
    })) as { canceled?: boolean; filePath?: string | null } | null;
    if (dialog && !dialog.canceled && dialog.filePath) {
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      await invoke('save_file_binary', { path: dialog.filePath, base64Data: btoa(bin) });
    }
  }
}

async function begin(opts: StudioRecOptions): Promise<void> {
  countInTimer = null;
  const engine = studioAudio();
  const master = engine.recordingNode();
  const ctx = master?.context as AudioContext | undefined;
  takeName = `Studio ${new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '.')}`;
  try {
    if (opts.mode === 'video') {
      video = startRecording({
        namePrefix: 'Studio',
        onComplete: () => {
          video = null;
          // The recorder keeps the file in the media library; list the newest studio one.
          const items = get(mediaLibrary) as unknown as Array<{ name: string; _assetRef?: { originalPath?: string } }>;
          const item = [...items].reverse().find((i) => i.name.startsWith('Studio'));
          remember({ name: item?.name ?? takeName, kind: 'video', path: item?._assetRef?.originalPath ?? null });
          if (!captures.length) studioRec.set({ phase: 'idle', startedAt: 0, mode: opts.mode });
        },
        onError: (err) => {
          video = null;
          studioRec.set({ phase: 'idle', startedAt: 0, mode: opts.mode });
          alert('Recording could not start: ' + err.message);
        },
      });
      if (!video) throw new Error('The recorder did not start.');
    } else if (ctx && master) {
      captures.push(await capture(ctx, 'mix', master));
    }
    if (opts.stems && ctx) {
      const mixer = get(musicStudio).mixer as Record<string, { arm?: boolean } | undefined>;
      const armed = Object.entries(mixer).filter(([, st]) => st?.arm).map(([id]) => id);
      for (const [id, node] of engine.stemNodes()) if (!armed.length || armed.includes(id)) captures.push(await capture(ctx, id, node));
    }
    studioRec.set({ phase: 'recording', startedAt: performance.now(), mode: opts.mode });
  } catch (err) {
    console.warn('[Studio] recording failed to start:', err);
    studioRec.set({ phase: 'idle', startedAt: 0, mode: opts.mode });
  }
}

/** Start recording (on the next bar with a count-in). */
export function startStudioRecording(opts: StudioRecOptions): void {
  if (get(studioRec).phase !== 'idle') return;
  current = opts;
  if (opts.countIn) {
    studioRec.set({ phase: 'waiting', startedAt: 0, mode: opts.mode });
    countInTimer = setTimeout(() => void begin(opts), Math.max(0, nextLaunchBoundary(4) - performance.now()));
  } else void begin(opts);
}

/** Stop and keep everything recorded. */
export async function stopStudioRecording(): Promise<void> {
  const state = get(studioRec);
  if (countInTimer) {
    clearTimeout(countInTimer);
    countInTimer = null;
    studioRec.set({ phase: 'idle', startedAt: 0, mode: state.mode });
    return;
  }
  if (state.phase !== 'recording') return;
  studioRec.set({ ...state, phase: 'saving' });
  video?.stop();
  const taken = captures;
  captures = [];
  for (const c of taken) c.node.port.postMessage({ stop: true });
  const offer = !!settings.get().recording.autoDownload;
  for (const c of taken) {
    const rate = await c.done;
    try { c.node.disconnect(); } catch { /* gone */ }
    const wav = encodeWav(join(c.left), join(c.right), rate);
    const isMix = c.id === 'mix';
    const label = isMix ? takeName : `${takeName} - ${CHANNEL_LABELS[c.id as ChannelId] ?? c.id}`;
    // Silent stems (an instrument that never played) are left out.
    if (!isMix && !c.left.some((block) => block.some((x) => Math.abs(x) > 1e-4))) continue;
    await keepWav(wav, label, isMix ? 'audio' : 'stem', isMix && offer);
  }
  if (!video) studioRec.set({ phase: 'idle', startedAt: 0, mode: current?.mode ?? 'video' });
}
