import { nativeVideoTransportSnapshot, type NativeVideoTransportTarget } from './nativeTransport';

export interface BeatPhaseClip extends NativeVideoTransportTarget {
  id: string;
  src: string;
  playbackSyncBeats?: number | null;
  _launchGeneration?: number;
}
/** Runtime-only phase anchors. A manual seek/pause establishes a new phase;
 * tempo changes retain the same beat anchor and never fight the operator. */
export class VideoBeatPhase {
  private anchors = new Map<string, { token: string; beat: number; phase: number }>();
  clear() { this.anchors.clear(); }
  retain(keys: Set<string>) { for (const key of this.anchors.keys()) if (!keys.has(key)) this.anchors.delete(key); }
  sample(key: string, clip: BeatPhaseClip, beat: number, epoch: number | null, now = performance.now()) {
    const duration = Number(clip.durationSeconds ?? clip.videoElement?.duration);
    const beats = Number(clip.playbackSyncBeats);
    const lo = duration * (clip.trimStart ?? 0);
    const span = duration * ((clip.trimEnd ?? 1) - (clip.trimStart ?? 0));
    if (!Number.isFinite(beat) || !Number.isFinite(span) || !(span > 0) || !(beats > 0)
      || clip.isPlaying === false || clip.playbackMode === 'once') {
      this.anchors.delete(key); return null;
    }
    const bounce = clip.playbackMode === 'bounce';
    const reverse = (clip.playbackRate ?? 1) < 0;
    const cycle = span * (bounce ? 2 : 1);
    const token = JSON.stringify([clip.id, clip.src, clip._launchGeneration, clip._nativePlaybackSeekSeq,
      lo, span, beats, bounce, reverse, epoch]);
    let anchor = this.anchors.get(key);
    if (!anchor || anchor.token !== token) {
      const snapshot = nativeVideoTransportSnapshot(clip, now);
      const position = Math.max(0, Math.min(span, snapshot.timeSeconds - lo));
      anchor = { token, beat, phase: snapshot.direction < 0 ? cycle - position : position };
      this.anchors.set(key, anchor);
    }
    const phase = ((anchor.phase + (beat - anchor.beat) / beats * cycle) % cycle + cycle) % cycle;
    const returning = bounce ? phase >= span : reverse;
    return { timeSeconds: lo + (returning ? cycle - phase : phase), reverse: returning };
  }
}
