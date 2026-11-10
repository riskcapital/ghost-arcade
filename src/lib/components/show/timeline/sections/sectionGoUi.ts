/**
 * What GO does right now, in words (the transport's GO and the cue list).
 * Pure.
 */
import type { ShowSectionStatus } from '../../../../stores/showTimeline';
import { sectionAt, type TimelineSection } from '../../../../timeline/sections/sectionModel';
import { nextStop } from '../../../../timeline/sections/sectionPlayer';

export function goLabel(sections: readonly TimelineSection[], status: ShowSectionStatus, t: number, playing: boolean): string {
  const byId = (id: string | null) => (id ? sections.find((s) => s.id === id) ?? null : null);
  const held = byId(status.holdId);
  if (held) return held.action === 'live' ? `Take the pieces back, go on from ${held.name}` : `Go on from ${held.name}`;
  if (!playing) return 'Play';
  const here = sectionAt(sections, t);
  if (here?.action === 'vamp') {
    if (status.vampExitId === here.id) return `Leaving ${here.name}${status.vampExitAt !== null ? ' at the next bar' : ' after this pass'}`;
    return here.exit === 'bar' ? `Leave ${here.name} at the next bar` : `Leave ${here.name} after this pass`;
  }
  if (here && (here.action === 'hold' || here.action === 'live')) {
    return status.armed.includes(here.id) ? `${here.name} plays on at its end` : `Play on through the end of ${here.name}`;
  }
  const next = nextStop(sections, t);
  return next ? `Nothing waits yet (next: ${next.name})` : 'Nothing waits';
}

/** The transport's short status: holding, looping, live, armed. */
export function sectionStatusText(sections: readonly TimelineSection[], status: ShowSectionStatus, t: number, playing: boolean): string {
  const byId = (id: string | null) => (id ? sections.find((s) => s.id === id) ?? null : null);
  const held = byId(status.holdId);
  if (held) return held.action === 'live' ? `LIVE · ${held.name}: GO to take back` : `HOLD · ${held.name}`;
  const live = byId(status.liveId);
  if (live) return `LIVE · ${live.name}`;
  if (!playing) return '';
  const here = sectionAt(sections, t);
  if (!here) return '';
  if (here.action === 'vamp') {
    const passes = status.passes[here.id];
    return status.vampExitId === here.id ? `LOOP · ${here.name}: leaving` : `LOOP · ${here.name}${passes ? ` ×${passes + 1}` : ''}`;
  }
  if (status.armed.includes(here.id)) return `GO armed · ${here.name}`;
  return here.name;
}
