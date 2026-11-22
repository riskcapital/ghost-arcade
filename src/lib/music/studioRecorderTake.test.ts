import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { createWavStreamStore } = require('../../../electron/wav-stream-store.cjs');

/** A fake audio graph: stems with a context, nodes that answer stop with what they were told. */
const ctx = { currentTime: 1, sampleRate: 48000 } as unknown as AudioContext;
const source = () => ({ context: ctx, connect: vi.fn() });
const stems = new Map<string, ReturnType<typeof source>>([['synth', source()], ['keys', source()]]);
vi.mock('./musicRuntime', () => ({ studioAudio: () => ({ recordingNode: () => source(), stemNodes: () => stems }) }));
vi.mock('../stores/settings', () => ({ settings: { get: () => ({ recording: { autoDownload: false } }) } }));
vi.mock('../stores/media', async () => ({ mediaLibrary: (await import('svelte/store')).writable([]) }));
vi.mock('../recording/recorder', () => ({ startRecording: () => null }));
vi.mock('../recording/offlineRender', () => ({ downloadBlob: () => {} }));
vi.mock('../bridge', async (orig) => ({ ...(await orig<typeof import('../bridge')>()), invoke: async () => null, isElectron: false }));
const toasts: string[] = [];
vi.mock('../stores/errorToast', () => ({ showToast: (m: string) => toasts.push(m) }));

import { musicStudio } from './musicStudioStore';
import { _resetRecorderForTests, peakOf, pcm16Interleaved, recentRecordings, recorderDeps, startStudioRecording, stopStudioRecording, streamingSink, studioRec, type WavSink } from './studioRecorder';

type Port = { onmessage: ((e: MessageEvent) => void) | null; postMessage: (m: { start?: number; stop?: number }) => void };
let nodes: Array<{ port: Port; disconnect: () => void; told: Array<{ start?: number; stop?: number }>; disconnected: boolean }> = [];
let sinks: Array<WavSink & { aborted: boolean; finished: boolean }> = [];
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  _resetRecorderForTests();
  musicStudio.hydrate(null);
  nodes = [];
  sinks = [];
  toasts.length = 0;
  recentRecordings.set([]);
  recorderDeps.loadWorklet = async () => {};
  recorderDeps.node = () => {
    const n = {
      told: [] as Array<{ start?: number; stop?: number }>,
      disconnected: false,
      disconnect() { n.disconnected = true; },
      port: {
        onmessage: null as ((e: MessageEvent) => void) | null,
        postMessage(m: { start?: number; stop?: number }) {
          n.told.push(m);
          // Answers a stop with a block of its own (right channel only) and done.
          if (typeof m.stop === 'number' && m.stop > 0) {
            queueMicrotask(() => {
              n.port.onmessage?.({ data: { left: new Float32Array(4), right: new Float32Array([0, 0.5, 0, 0]) } } as MessageEvent);
              n.port.onmessage?.({ data: { done: true, sampleRate: 48000 } } as MessageEvent);
            });
          }
        },
      },
    };
    nodes.push(n);
    return n as unknown as AudioWorkletNode;
  };
  recorderDeps.sink = async (name: string) => {
    const s = { aborted: false, finished: false, push() {}, async finish() { s.finished = true; return `/rec/${name}.wav`; }, async abort() { s.aborted = true; } };
    sinks.push(s);
    return s;
  };
});
afterEach(() => vi.useRealTimers());

describe('PCM for the files', () => {
  it('interleaves 16-bit stereo and finds a peak on either side', () => {
    const b = new DataView(pcm16Interleaved(new Float32Array([1, 0]), new Float32Array([0, -1])).buffer);
    expect([b.getInt16(0, true), b.getInt16(2, true), b.getInt16(4, true), b.getInt16(6, true)]).toEqual([0x7fff, 0, 0, -0x8000]);
    expect(peakOf(new Float32Array(3), new Float32Array([0, 0.3, 0]))).toBeCloseTo(0.3);
  });
});

describe('a Record A/V take', () => {
  it('starts once on a double press, all captures on one start frame and stopped on one frame', async () => {
    startStudioRecording({ mode: 'audio', stems: true, countIn: false });
    startStudioRecording({ mode: 'audio', stems: true, countIn: false });
    await settle();
    expect(get(studioRec).phase).toBe('recording');
    expect(nodes).toHaveLength(3);
    const starts = nodes.map((n) => n.told[0].start);
    expect(new Set(starts).size).toBe(1);
    await stopStudioRecording();
    expect(new Set(nodes.map((n) => n.told[1].stop)).size).toBe(1);
    // A stem with sound only on the right is kept; each listed only after its file is written.
    expect(get(recentRecordings).map((r) => r.kind).sort()).toEqual(['audio', 'stem', 'stem']);
    expect(get(studioRec).phase).toBe('idle');
  });

  it('releases every capture when a later one fails, and leaves the button usable', async () => {
    let k = 0;
    const make = recorderDeps.sink;
    recorderDeps.sink = async (name) => { if (++k === 3) throw new Error('disk full'); return make(name); };
    startStudioRecording({ mode: 'audio', stems: true, countIn: false });
    await settle();
    await settle();
    expect(get(studioRec).phase).toBe('idle');
    expect(sinks.every((s) => s.aborted)).toBe(true);
    expect(nodes).toHaveLength(0);
    expect(toasts.join(' ')).toContain('disk full');
    // A new take can start.
    startStudioRecording({ mode: 'audio', stems: false, countIn: false });
    await settle();
    expect(get(studioRec).phase).toBe('recording');
  });

  it('does not hang on a capture that never answers, and does not list it', async () => {
    startStudioRecording({ mode: 'audio', stems: false, countIn: false });
    await settle();
    nodes[0].port.postMessage = (m) => nodes[0].told.push(m);
    vi.useFakeTimers();
    const p = stopStudioRecording();
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(get(studioRec).phase).toBe('idle');
    expect(get(recentRecordings)).toHaveLength(0);
    expect(sinks[0].aborted).toBe(true);
  });

  it('a failed write leaves Saving and is not listed', async () => {
    recorderDeps.sink = async () => ({ push() {}, finish: async () => { throw new Error('nope'); }, abort: async () => {} });
    startStudioRecording({ mode: 'audio', stems: false, countIn: false });
    await settle();
    await stopStudioRecording();
    expect(get(studioRec).phase).toBe('idle');
    expect(get(recentRecordings)).toHaveLength(0);
    expect(toasts.length).toBe(1);
  });
});

describe('streaming a WAV to disk', () => {
  it('writes batches and a header for what is on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wav-'));
    const store = createWavStreamStore(dir);
    const call = async (cmd: string, args: Record<string, unknown>) => ({ success: true, ...store[cmd.replace('wav_stream_', '')](args) });
    const sink = await streamingSink('Take', call);
    for (let i = 0; i < 3; i++) sink.push(new Float32Array(48000).fill(0.25), new Float32Array(48000).fill(-0.25));
    const path = (await sink.finish(48000))!;
    const wav = readFileSync(path);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(24)).toBe(48000);
    expect(wav.readUInt32LE(40)).toBe(3 * 48000 * 4);
    expect(wav.length).toBe(44 + 3 * 48000 * 4);
    rmSync(dir, { recursive: true });
  });

  it('fails the file (and removes it) when a write is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wav-'));
    const store = createWavStreamStore(dir);
    let file = '';
    const call = async (cmd: string, args: Record<string, unknown>) => {
      if (cmd === 'wav_stream_write') return { success: false, error: 'disk full' };
      const r = store[cmd.replace('wav_stream_', '')](args);
      if (r.path) file = r.path;
      return { success: true, ...r };
    };
    const sink = await streamingSink('Take', call);
    sink.push(new Float32Array(200000), new Float32Array(200000));
    await expect(sink.finish(48000)).rejects.toThrow('disk full');
    expect(existsSync(file)).toBe(false);
    rmSync(dir, { recursive: true });
  });
});
