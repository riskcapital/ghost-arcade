import { describe, expect, it } from 'vitest';
import { COACH_STEPS, coachAfter, coachLaunch, startCoach } from './coach';

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
