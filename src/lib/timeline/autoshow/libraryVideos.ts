/**
 * My library for Auto show: the user's own videos (the media library) as
 * cast members, tiered by energy.
 *
 * A video's tier comes from its name or folder when that says ("drop",
 * "calm", "build"…), else from a few decoded frames: how much the picture
 * moves between them and how bright it is. Measures are cached per file for
 * the session. A video the page cannot decode (HAP) and whose name says
 * nothing sits in the middle (groove).
 */
import type { MediaItem } from '../../stores/media';
import type { AutoShowTier, CastMember } from './catalog';

const NAME_TIERS: Array<[RegExp, AutoShowTier]> = [
  [/\b(drop|peak|hard|strobe|impact|banger|rave|heavy)\b/i, 'peak'],
  [/\b(build|rise|riser|drive|driving|fast|energy|tension)\b/i, 'drive'],
  [/\b(calm|ambient|chill|slow|intro|outro|soft|drift|still|breath(e|ing)?|pad)\b/i, 'calm'],
  [/\b(groove|loop|mid|verse|bounce|flow)\b/i, 'groove'],
];

/** A tier from a video's name or the folders it sits in, else null. */
export function tierFromName(name: string, path = ''): AutoShowTier | null {
  const words = `${path.replace(/[\\/_.-]+/g, ' ')} ${name.replace(/[_.-]+/g, ' ')}`;
  for (const [re, tier] of NAME_TIERS) if (re.test(words)) return tier;
  return null;
}

export interface VideoMeasure {
  /** Mean change between sampled frames, 0..1. */
  motion: number;
  /** Mean brightness, 0..1. */
  brightness: number;
}

/** A tier from how much a video moves and how bright it is. */
export function tierFromMeasure(m: VideoMeasure): AutoShowTier {
  const e = 0.7 * Math.min(1, m.motion / 0.12) + 0.3 * Math.min(1, m.brightness / 0.5);
  return e >= 0.75 ? 'peak' : e >= 0.5 ? 'drive' : e >= 0.25 ? 'groove' : 'calm';
}

const measured = new Map<string, VideoMeasure | null>();

/** Decode a few frames of a video in the page and measure them (cached). */
export async function measureVideo(src: string, frames = 5): Promise<VideoMeasure | null> {
  if (measured.has(src)) return measured.get(src) ?? null;
  if (typeof document === 'undefined') return null;
  const result = await new Promise<VideoMeasure | null>((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 18;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let done = false;
    const finish = (v: VideoMeasure | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 6000);
    video.onerror = () => finish(null);
    video.onloadedmetadata = async () => {
      if (!ctx || !(video.duration > 0)) return finish(null);
      const samples: Uint8ClampedArray[] = [];
      for (let i = 0; i < frames; i++) {
        const at = (video.duration * (i + 0.5)) / frames;
        await new Promise<void>((r) => { video.onseeked = () => r(); video.currentTime = at; });
        ctx.drawImage(video, 0, 0, 32, 18);
        samples.push(ctx.getImageData(0, 0, 32, 18).data.slice());
      }
      let bright = 0;
      let motion = 0;
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i];
        let b = 0;
        for (let k = 0; k < s.length; k += 4) b += (s[k] + s[k + 1] + s[k + 2]) / (3 * 255);
        bright += b / (s.length / 4);
        if (i > 0) {
          const p = samples[i - 1];
          let d = 0;
          for (let k = 0; k < s.length; k += 4) d += (Math.abs(s[k] - p[k]) + Math.abs(s[k + 1] - p[k + 1]) + Math.abs(s[k + 2] - p[k + 2])) / (3 * 255);
          motion += d / (s.length / 4);
        }
      }
      finish({ brightness: bright / samples.length, motion: samples.length > 1 ? motion / (samples.length - 1) : 0 });
    };
    video.src = src;
  });
  measured.set(src, result);
  return result;
}

/** The library's videos as cast members (named tiers first, then measured). */
export async function libraryCast(items: readonly MediaItem[], measure: (src: string) => Promise<VideoMeasure | null> = measureVideo): Promise<CastMember[]> {
  const out: CastMember[] = [];
  for (const item of items) {
    if (item.type !== 'video' || item.broken || !item.src) continue;
    const path = (item._assetRef as { originalPath?: string } | undefined)?.originalPath ?? '';
    let tier = tierFromName(item.name, path);
    if (!tier) {
      const m = /\.(mov|hap)$/i.test(path || item.name) ? null : await measure(item.src);
      tier = m ? tierFromMeasure(m) : 'groove';
    }
    const tiers: AutoShowTier[] = tier === 'calm' ? ['calm', 'groove'] : tier === 'peak' ? ['peak', 'drive'] : [tier];
    out.push({
      id: `library:${item.id}`,
      kind: 'video',
      ref: item.id,
      name: item.name.replace(/\.[a-z0-9]+$/i, ''),
      tiers,
      texture: 'organic',
      scale: ['piece', 'span'],
      params: {},
      paramsFor: () => ({}),
      video: { src: item.src, assetRef: item._assetRef, seconds: item.durationSeconds, width: item.videoWidth, height: item.videoHeight },
      cost: 'mid',
    });
  }
  return out;
}
