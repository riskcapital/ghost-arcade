// The first-run coach: three things a new performer does once, in order. Each step is ticked by
// really doing it in the deck. Pure, so the order and the wording are tested.

export type CoachEvent = 'launch' | 'layer' | 'controls';
export type CoachStep = { id: CoachEvent; title: string; hint: string };

export const COACH_STEPS: CoachStep[] = [
  { id: 'launch', title: 'Launch a clip', hint: 'Tap any picture in the deck.' },
  { id: 'layer', title: 'Layer a second clip', hint: 'Tap a picture on another row.' },
  { id: 'controls', title: 'Open Controls', hint: 'Tap Controls to change the look.' },
];

export type CoachState = { step: number; done: boolean };
export const startCoach = (): CoachState => ({ step: 0, done: false });

/**
 * What the coach shows after something happened in the deck. Only the step being asked for moves
 * it on: opening Controls early does not skip the launch steps.
 */
export function coachAfter(state: CoachState, event: CoachEvent): CoachState {
  if (state.done || COACH_STEPS[state.step]?.id !== event) return state;
  const step = state.step + 1;
  return { step, done: step >= COACH_STEPS.length };
}

/**
 * A clip was launched by hand on `row` while `playingRows` were already playing. One tap moves
 * the coach one step at most: the first launch ticks "Launch a clip" wherever it lands, and
 * after that only a launch that plays together with another row ticks "Layer a second clip".
 */
export function coachLaunch(state: CoachState, playingRows: number[], row: number): CoachState {
  if (state.done) return state;
  if (COACH_STEPS[state.step]?.id === 'launch') return coachAfter(state, 'launch');
  return playingRows.some((r) => r !== row) ? coachAfter(state, 'layer') : state;
}
