/**
 * Audio Lab against an Ableton Link session: how far ahead to schedule so
 * what plays is heard on the session's beats, how far a loop may repitch to
 * stay with it, and whether an outside clock is already playing.
 */

import { get } from 'svelte/store';
import { abletonLink } from '../sync/abletonLink';
import { launchClockFollowsLink } from '../stores/launchClock';
import { LINK_FOLLOW_RANGE, OWN_FOLLOW_RANGE, outputLeadSeconds, type FollowRange } from './looperMath';

/**
 * Seconds to schedule Audio Lab's loops early so they are heard on Link's
 * beats: the device's output latency plus the user's trim, while Link with
 * peers drives the clock; 0 otherwise (nothing changes away from Link).
 */
export function linkLeadSeconds(ctx: { baseLatency?: number; outputLatency?: number } | null | undefined): number {
  if (!ctx || !launchClockFollowsLink()) return 0;
  return outputLeadSeconds(ctx, get(abletonLink).offsetMs);
}

/** How far a playing audio loop follows the clock's tempo: half to double speed under Link, a few percent otherwise. */
export function loopFollowRange(): FollowRange {
  return launchClockFollowsLink() ? LINK_FOLLOW_RANGE : OWN_FOLLOW_RANGE;
}

/**
 * Something outside the studio already keeps the beat: a Link session with
 * peers, or Live playing while the studio follows it. Recordings then start
 * on its bar with no count-in clicks, and a free loop never sets the tempo
 * (that would take over the session's tempo mid-set).
 */
export function externalClockBusy(opts: { linkFollowed: boolean; liveFollowed: boolean; livePlaying: boolean }): boolean {
  return opts.linkFollowed || (opts.liveFollowed && opts.livePlaying);
}
