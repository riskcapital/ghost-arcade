/**
 * Where the Timeline's LED rows meet the WLED sender. The Timeline publishes
 * its LED state on every evaluation (each frame while playing, every seek
 * and scrub); the sender renders each controller from it (ledRender.ts) when
 * it next sends. Null: the Timeline is not active, the project's own LED
 * output runs.
 */
import type { LedLookOnStrips, LedLineValues } from './ledRender';
import type { TimelineLedClip } from './ledClips';

export interface LedTimelineState {
  time: number;
  bpm: number;
  clips: readonly TimelineLedClip[];
  /** Block lines (`ledblock:` keys) by block id. */
  lines: ReadonlyMap<string, LedLineValues>;
  /** LED blocks with a where line: block id → fixture spot id → weight. */
  where: ReadonlyMap<string, ReadonlyMap<string, number>>;
  looks: readonly LedLookOnStrips[];
  /** A where line on the LEDs exists: every controller is the Timeline's. */
  allDriven: boolean;
}

let current: LedTimelineState | null = null;

export function publishLedTimeline(state: LedTimelineState | null): void {
  current = state && (state.clips.length || state.allDriven) ? state : null;
}

export function currentLedTimeline(): LedTimelineState | null {
  return current;
}
