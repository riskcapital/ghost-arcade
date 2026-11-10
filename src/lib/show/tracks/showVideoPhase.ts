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
 */
import type { ShowTrackFrame } from './showTrackEval';
import type { ShowClipSources } from './showClipSources';

export const SHOW_PHASE_INTERVAL_MS = 100;

export interface ShowPhaseTarget {
  sourceId: string;
  uri: string;
  seekGeneration: number;
  timeSeconds: number;
}

/** Phase targets for every playing video clip in `frame`. */
export function showPhaseTargets(frame: ShowTrackFrame | null, sources: ShowClipSources): ShowPhaseTarget[] {
  if (!frame || !frame.playing || frame.manualClock) return [];
  const targets: ShowPhaseTarget[] = [];
  for (const state of frame.tracks) {
    const clip = state.clip;
    if (!clip || clip.media.kind !== 'video' || clip.paused) continue;
    const anchor = sources.anchorFor(state.trackId);
    if (!anchor || anchor.runId !== clip.runId || anchor.paused) continue;
    targets.push({ sourceId: anchor.sourceId, uri: anchor.src, seekGeneration: anchor.nativeSeekSeq, timeSeconds: clip.mediaTime });
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
