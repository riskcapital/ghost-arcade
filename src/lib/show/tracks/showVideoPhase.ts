/**
 * Keeps show video clips on the show's clock while they play.
 *
 * The show's playhead follows the sound card; the core's decoders follow the
 * render clock. The two drift apart slowly, so ten times a second this sends
 * each playing clip's expected media time as a phase target
 * (`set_media_source_phase`). The core then nudges that decoder's speed by
 * at most ±4 % and never seeks, so the correction is invisible. Targets
 * expire in the core after 500 ms, so a stalled editor cannot leave a clip
 * running fast.
 *
 * The core only phase-follows looping sources, which is why clip sources
 * always go out looping (see showClipSources.ts).
 *
 * A target is compared with the decoder's position when the core receives
 * it, so it has to name the media time for that instant, not for the show
 * frame it was read from (up to a display frame older). Targets are
 * projected from the frame's evaluation time to the moment they are sent;
 * otherwise the follower settles the picture that much behind the show.
 *
 * The core reports how far off each followed session is as
 * `phase_error_seconds` in the status's `native_video_sessions`.
 */
import type { ShowTrackClipState, ShowTrackFrame } from './showTrackEval';
import type { ShowClipAnchor, ShowClipSources } from './showClipSources';

export const SHOW_PHASE_INTERVAL_MS = 100;

export interface ShowPhaseTarget {
  sourceId: string;
  uri: string;
  seekGeneration: number;
  timeSeconds: number;
}

/** A target is never projected further than this past its frame: a show
 *  that stopped publishing is stalled, not running on. */
export const SHOW_PHASE_MAX_PROJECTION_SECONDS = 0.1;

/** `mediaTime` moved on by `seconds` of show time, wrapped past the end
 *  like the core loops a source trimmed to [loopStart, duration). */
export function projectMediaTime(mediaTime: number, seconds: number, rate: number, loopStart: number, duration?: number): number {
  const t = mediaTime + seconds * rate;
  const end = Number(duration);
  if (!(end > 0)) return t;
  const span = end - loopStart;
  if (!(span > 0) || t < end) return t;
  return loopStart + ((t - loopStart) % span);
}

/** Phase targets for every playing video clip in `frame`, projected to
 *  `nowMs` (performance.now()) when the frame says when it was evaluated. */
export function showPhaseTargets(frame: ShowTrackFrame | null, sources: ShowClipSources, nowMs?: number): ShowPhaseTarget[] {
  if (!frame || !frame.playing || frame.manualClock) return [];
  const age = Number.isFinite(nowMs) && Number.isFinite(frame.evaluatedAtMs)
    ? Math.min(SHOW_PHASE_MAX_PROJECTION_SECONDS, Math.max(0, (nowMs! - frame.evaluatedAtMs!) / 1000))
    : 0;
  const targets: ShowPhaseTarget[] = [];
  const follow = (clip: ShowTrackClipState | null | undefined, anchor: Readonly<ShowClipAnchor> | null) => {
    if (!clip || clip.media.kind !== 'video' || clip.paused) return;
    if (!anchor || anchor.runId !== clip.runId || anchor.paused) return;
    // One target per decoder (a crossfade's two sides never share one).
    if (targets.some((t) => t.sourceId === anchor.sourceId)) return;
    const timeSeconds = age > 0
      ? projectMediaTime(clip.mediaTime, age, clip.rate, clip.loopStart, clip.media.sourceDuration)
      : clip.mediaTime;
    targets.push({ sourceId: anchor.sourceId, uri: anchor.src, seekGeneration: anchor.nativeSeekSeq, timeSeconds });
  };
  for (const state of frame.tracks) {
    follow(state.clip, sources.anchorFor(state.trackId));
    // The outgoing clip of a crossfade plays on its own decoder: follow it
    // too, or it drifts for the length of the crossfade.
    if (state.xfade) follow(state.xfade.clip, sources.xfadeAnchorFor(state.trackId));
  }
  return targets;
}

export type PhaseCommand =
  | { type: 'set_media_source_phase'; source_id: string; uri: string; seek_generation: number; time_seconds: number; reverse: boolean }
  | { type: 'set_media_source_phase'; source_id: string; enabled: false };

/** Commands for this tick, and the set of sources now being followed. */
export function showPhaseCommands(targets: ShowPhaseTarget[], following: ReadonlySet<string>): { commands: PhaseCommand[]; following: Set<string> } {
  const next = new Set<string>();
  const commands: PhaseCommand[] = [];
  for (const t of targets) {
    next.add(t.sourceId);
    commands.push({ type: 'set_media_source_phase', source_id: t.sourceId, uri: t.uri, seek_generation: t.seekGeneration, time_seconds: Number(t.timeSeconds.toFixed(6)), reverse: false });
  }
  for (const id of following) if (!next.has(id)) commands.push({ type: 'set_media_source_phase', source_id: id, enabled: false });
  return { commands, following: next };
}
