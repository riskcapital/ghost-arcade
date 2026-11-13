// The first-run coach: the things a new performer does once, in order. Each step is ticked by
// really doing it. Pure, so the order and the wording are tested.
//
// Two tracks. A device that already had a set when the coach arrived (app 1.1) keeps the deck
// track it knows. A first run from app 1.2 on starts on the mapping demo, so its coach begins with
// the projector and a corner, then goes on to the deck.

export type CoachEvent = 'connect' | 'corner' | 'launch' | 'layer' | 'controls';
export type CoachStep = {
  id: CoachEvent;
  title: string;
  hint: string;
  /** The workspace the step is done in. */
  tab: 'map' | 'perform';
  /** The step can be put off ("Later"): not everyone has a projector to hand. */
  skippable?: boolean;
};
export type CoachTrack = 'deck' | 'mapping';

export const COACH_STEPS: CoachStep[] = [
  { id: 'launch', title: 'Launch a clip', hint: 'Tap any picture in the deck.', tab: 'perform' },
  { id: 'layer', title: 'Layer a second clip', hint: 'Tap a picture on another row.', tab: 'perform' },
  { id: 'controls', title: 'Open Controls', hint: 'Tap Controls to change the look.', tab: 'perform' },
];

export const MAPPING_COACH_STEPS: CoachStep[] = [
  { id: 'connect', title: 'Connect a projector', hint: 'Use a cable or AirPlay. What plays on the boxes goes up on your wall.', tab: 'map', skippable: true },
  { id: 'corner', title: 'Drag a corner', hint: 'Pull each corner onto your wall or object.', tab: 'map' },
  { id: 'launch', title: 'Launch a clip', hint: 'Open Perform and tap any picture in the deck.', tab: 'perform' },
  COACH_STEPS[1],
  COACH_STEPS[2],
];

export const coachSteps = (track: CoachTrack = 'deck') => (track === 'mapping' ? MAPPING_COACH_STEPS : COACH_STEPS);

export type CoachState = { step: number; done: boolean; track?: 'mapping' };
export const startCoach = (track: CoachTrack = 'deck'): CoachState => (track === 'mapping' ? { step: 0, done: false, track } : { step: 0, done: false });

/** The step being asked for, or undefined when the coach is finished. */
export const coachStep = (state: CoachState): CoachStep | undefined => (state.done ? undefined : coachSteps(state.track)[state.step]);

/**
 * What the coach shows after something happened. Only the step being asked for moves it on:
 * opening Controls early does not skip the launch steps.
 */
export function coachAfter(state: CoachState, event: CoachEvent): CoachState {
  const steps = coachSteps(state.track);
  if (state.done || steps[state.step]?.id !== event) return state;
  const step = state.step + 1;
  return { ...state, step, done: step >= steps.length };
}

/** "Later" on a step that allows it: on to the next one. */
export function coachSkip(state: CoachState): CoachState {
  const current = coachStep(state);
  return current?.skippable ? coachAfter(state, current.id) : state;
}

/**
 * A clip was launched by hand on `row` while `playingRows` were already playing. One tap moves
 * the coach one step at most: the first launch ticks "Launch a clip" wherever it lands, and
 * after that only a launch that plays together with another row ticks "Layer a second clip".
 */
export function coachLaunch(state: CoachState, playingRows: number[], row: number): CoachState {
  const current = coachStep(state);
  if (!current) return state;
  if (current.id === 'launch') return coachAfter(state, 'launch');
  if (current.id !== 'layer') return state;
  return playingRows.some((r) => r !== row) ? coachAfter(state, 'layer') : state;
}
