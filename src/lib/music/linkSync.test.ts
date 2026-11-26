import { describe, expect, it, vi } from 'vitest';

const { link, linkStore } = await vi.hoisted(async () => {
  const { writable } = await import('svelte/store');
  return { link: { follows: false }, linkStore: writable({ offsetMs: 0 }) };
});
vi.mock('../stores/launchClock', () => ({ launchClockFollowsLink: () => link.follows }));
vi.mock('../sync/abletonLink', () => ({ abletonLink: linkStore }));

import { externalClockBusy, linkLeadSeconds, loopFollowRange } from './linkSync';
import { LINK_FOLLOW_RANGE, OWN_FOLLOW_RANGE } from './looperMath';

const ctx = { baseLatency: 0.005, outputLatency: 0.02 };

describe('Audio Lab against a Link session', () => {
  it('schedules early only while Link with peers drives the clock', () => {
    link.follows = false;
    linkStore.set({ offsetMs: 30 });
    expect(linkLeadSeconds(ctx)).toBe(0);
    link.follows = true;
    expect(linkLeadSeconds(ctx)).toBeCloseTo(0.055, 12);
    linkStore.set({ offsetMs: 0 });
    expect(linkLeadSeconds(ctx)).toBeCloseTo(0.025, 12);
    expect(linkLeadSeconds(null)).toBe(0);
  });

  it('lets audio loops repitch through Link tempo jumps, and only under Link', () => {
    link.follows = false;
    expect(loopFollowRange()).toBe(OWN_FOLLOW_RANGE);
    link.follows = true;
    expect(loopFollowRange()).toBe(LINK_FOLLOW_RANGE);
  });

  it('counts a Link session, or Live playing while the studio follows it, as a clock already running', () => {
    expect(externalClockBusy({ linkFollowed: true, liveFollowed: false, livePlaying: false })).toBe(true);
    expect(externalClockBusy({ linkFollowed: false, liveFollowed: true, livePlaying: true })).toBe(true);
    expect(externalClockBusy({ linkFollowed: false, liveFollowed: true, livePlaying: false })).toBe(false);
    expect(externalClockBusy({ linkFollowed: false, liveFollowed: false, livePlaying: true })).toBe(false);
  });
});
