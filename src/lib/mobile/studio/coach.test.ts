import { describe, expect, it } from 'vitest';
import { COACH_STEPS, MAPPING_COACH_STEPS, coachAfter, coachLaunch, coachSkip, coachStep, coachSteps, startCoach } from './coach';

describe('first-run coach', () => {
  it('has three steps: launch, layer, controls', () => {
    expect(COACH_STEPS.map((s) => s.id)).toEqual(['launch', 'layer', 'controls']);
  });
  it('moves one step per launch, and only layers when another row is playing', () => {
    let state = startCoach();
    state = coachLaunch(state, [0], 2); // first tap, on a lower row
    expect(state).toEqual({ step: 1, done: false });
    state = coachLaunch(state, [2], 2); // swapping the clip on the only playing row is not layering
    expect(state.step).toBe(1);
    state = coachLaunch(state, [2], 0);
    expect(state.step).toBe(2);
    state = coachLaunch(state, [0, 2], 1); // launches do not tick the Controls step
    expect(state.step).toBe(2);
  });
  it('does not skip ahead when Controls is opened early', () => {
    expect(coachAfter(startCoach(), 'controls')).toEqual(startCoach());
  });
  it('finishes after Controls and then ignores everything', () => {
    const done = coachAfter({ step: 2, done: false }, 'controls');
    expect(done).toEqual({ step: 3, done: true });
    expect(coachLaunch(done, [], 0)).toBe(done);
    expect(coachAfter(done, 'controls')).toBe(done);
  });
});

describe('mapping coach (first run from app 1.2)', () => {
  it('starts with the projector, then a corner, then the deck steps', () => {
    expect(MAPPING_COACH_STEPS.map((s) => s.id)).toEqual(['connect', 'corner', 'launch', 'layer', 'controls']);
    expect(MAPPING_COACH_STEPS[0].title).toBe('Connect a projector');
    expect(coachSteps('deck')).toBe(COACH_STEPS);
  });
  it('ticks the projector step when a display connects, or on Later', () => {
    const start = startCoach('mapping');
    expect(coachStep(start)?.id).toBe('connect');
    expect(coachAfter(start, 'corner')).toBe(start);
    expect(coachAfter(start, 'connect')).toEqual({ step: 1, done: false, track: 'mapping' });
    expect(coachSkip(start)).toEqual({ step: 1, done: false, track: 'mapping' });
    // Only the projector step can be put off.
    expect(coachSkip({ step: 1, done: false, track: 'mapping' })).toEqual({ step: 1, done: false, track: 'mapping' });
  });
  it('a launch does not skip the mapping steps, then counts as before', () => {
    let state = startCoach('mapping');
    expect(coachLaunch(state, [0], 0)).toBe(state);
    state = coachAfter(coachAfter(state, 'connect'), 'corner');
    state = coachLaunch(state, [0], 1);
    expect(coachStep(state)?.id).toBe('layer');
    state = coachLaunch(state, [1], 0);
    state = coachAfter(state, 'controls');
    expect(state.done).toBe(true);
  });
  it('leaves the deck track exactly as app 1.1 had it', () => {
    expect(startCoach()).toEqual({ step: 0, done: false });
    expect(coachSkip(startCoach())).toEqual(startCoach());
  });
});
