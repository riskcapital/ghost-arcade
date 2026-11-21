/**
 * Audio clips in the session grid: a recorded audio loop playing in its
 * part's slot. Launched on the next bar (or the current bar when nothing
 * plays), it loops from its first frame, its speed following the tempo by
 * the ratio to the tempo it was recorded at. One clip per part; starting a
 * notes clip in the part stops it.
 *
 * Decoded loops are cached by clip, up to SESSION_AUDIO_CACHE_BYTES; past
 * that the ones not playing that were used longest ago are let go (they
 * decode again from their file when launched).
 */

import { resolveAssetRefForRuntime, type AssetRef } from '../storage/assetRegistry';
import type { AudioClip } from './session';

export const SESSION_AUDIO_CACHE_BYTES = 256 * 1024 * 1024;

interface Cached {
  buffer: AudioBuffer;
  bytes: number;
  used: number;
}

interface Playing {
  clipId: string;
  src: AudioBufferSourceNode;
  env: GainNode;
  bpm: number;
}

/** Which cached loops to let go to fit the budget: not playing, least recently used first. */
export function evictions(entries: Array<{ id: string; bytes: number; used: number }>, playing: ReadonlySet<string>, budget = SESSION_AUDIO_CACHE_BYTES): string[] {
  let total = entries.reduce((n, e) => n + e.bytes, 0);
  const out: string[] = [];
  for (const e of [...entries].filter((x) => !playing.has(x.id)).sort((a, b) => a.used - b.used)) {
    if (total <= budget) break;
    total -= e.bytes;
    out.push(e.id);
  }
  return out;
}

/** Where an audio clip's WAV loads from. */
export function audioClipUrl(clip: Pick<AudioClip, 'src' | '_assetRef'>): string {
  if (clip._assetRef) return resolveAssetRefForRuntime(clip._assetRef as AssetRef, undefined, clip.src) ?? clip.src;
  return clip.src;
}

export class SessionAudio {
  private cache = new Map<string, Cached>();
  private loading = new Map<string, Promise<AudioBuffer | null>>();
  private playing = new Map<string, Playing>();
  private serial = 0;
  private tokens = new Map<string, number>();

  constructor(private readonly ctx: AudioContext, private readonly out: AudioNode) {}

  private async buffer(clip: AudioClip): Promise<AudioBuffer | null> {
    const hit = this.cache.get(clip.id);
    if (hit) {
      hit.used = performance.now();
      return hit.buffer;
    }
    let p = this.loading.get(clip.id);
    if (!p) {
      p = (async () => {
        try {
          const res = await fetch(audioClipUrl(clip));
          const buffer = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.cache.set(clip.id, { buffer, bytes: buffer.length * buffer.numberOfChannels * 4, used: performance.now() });
          this.trim();
          return buffer;
        } catch (err) {
          console.warn('[SessionAudio] Could not load', clip.name, err);
          return null;
        } finally {
          this.loading.delete(clip.id);
        }
      })();
      this.loading.set(clip.id, p);
    }
    return p;
  }

  private trim(): void {
    const ids = new Set([...this.playing.values()].map((p) => p.clipId));
    for (const id of evictions([...this.cache].map(([id, c]) => ({ id, bytes: c.bytes, used: c.used })), ids)) this.cache.delete(id);
  }

  /** Play `clip` in `part` from audio time `at`, at `tempo` BPM; returns false when it could not load. */
  async play(part: string, clip: AudioClip, at: number, tempo: number): Promise<boolean> {
    const token = ++this.serial;
    this.tokens.set(part, token);
    const buffer = await this.buffer(clip);
    // Another launch or a stop came in while it loaded.
    if (!buffer || this.tokens.get(part) !== token) return false;
    const when = Math.max(this.ctx.currentTime + 0.01, at);
    this.stop(part, when);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.playbackRate.value = rateFor(tempo, clip.bpm);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(clip.level, when + 0.005);
    src.connect(env).connect(this.out);
    src.onended = () => { try { env.disconnect(); } catch { /* gone */ } };
    src.start(when, (Math.max(0, this.ctx.currentTime - at) * rateFor(tempo, clip.bpm)) % buffer.duration);
    this.playing.set(part, { clipId: clip.id, src, env, bpm: clip.bpm });
    return true;
  }

  stop(part: string, at = this.ctx.currentTime, fade = 0.02): void {
    const p = this.playing.get(part);
    if (at === this.ctx.currentTime) this.tokens.delete(part);
    if (!p) return;
    this.playing.delete(part);
    const when = Math.max(at, this.ctx.currentTime);
    try {
      p.env.gain.cancelScheduledValues(when);
      p.env.gain.setValueAtTime(p.env.gain.value, when);
      p.env.gain.linearRampToValueAtTime(0, when + fade);
      p.src.stop(when + fade + 0.01);
    } catch { /* stopped */ }
  }

  stopAll(): void {
    for (const part of [...this.playing.keys()]) this.stop(part);
    this.tokens.clear();
  }

  clipIn(part: string): string | null {
    return this.playing.get(part)?.clipId ?? null;
  }

  setLevel(clipId: string, level: number): void {
    for (const p of this.playing.values()) if (p.clipId === clipId) p.env.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.ctx.currentTime, 0.02);
  }

  /** The tempo moved: every clip follows it. */
  setTempo(tempo: number): void {
    for (const p of this.playing.values()) p.src.playbackRate.setTargetAtTime(rateFor(tempo, p.bpm), this.ctx.currentTime, 0.05);
  }

  cachedBytes(): number {
    let n = 0;
    for (const c of this.cache.values()) n += c.bytes;
    return n;
  }
}

/** The speed a loop recorded at `bpm` plays at to keep `tempo`. */
export function rateFor(tempo: number, bpm: number): number {
  return tempo > 0 && bpm > 0 ? Math.max(0.25, Math.min(4, tempo / bpm)) : 1;
}
