/**
 * The patch bay's rules, as changes to the patch. An input takes one cable;
 * an output feeds any number. An input's normal is its connection with no
 * cable in it: a cable replaces it, pulling the cable out brings it back, and
 * pulling out the normal itself breaks it (the input is then empty).
 */
import { INPUT_JACKS, INPUT_LAYER_KEY, VIDEOSYNTH_PARAMS, paramValue, type InputJack } from './patch';

/** What an input holds once its cable is pulled out. */
export function afterUnplug(jack: InputJack, current: number): number {
  return current === jack.normal ? 0 : jack.normal;
}

/** Unplug `jack`. */
export function unplugPatch(jack: InputJack, current: number): Record<string, number> {
  return { [jack.srcKey]: afterUnplug(jack, current) };
}

/**
 * Plug a cable from `source` into `into`. A cable carried from another input
 * leaves that input in the same step (it goes back to its normal).
 */
export function plugPatch(into: InputJack, source: number, carriedFrom?: InputJack): Record<string, number> {
  const patch: Record<string, number> = { [into.srcKey]: source };
  if (carriedFrom && carriedFrom !== into) patch[carriedFrom.srcKey] = afterUnplug(carriedFrom, source);
  return patch;
}

export const inputJack = (id: string): InputJack | undefined => INPUT_JACKS.find((j) => j.id === id);

/** Source index of the Input module's output (the chosen layer). */
export const INPUT_SOURCE = 13;
const OSCS = ['A', 'B', 'C'] as const;

/** What uses the input layer: oscillators drawing it and inputs patched from it. */
export function inputUsers(params: Record<string, unknown>): { drawnBy: string[]; patchedTo: InputJack[] } {
  const value = (key: string) => paramValue(params, VIDEOSYNTH_PARAMS.find((p) => p.key === key)!);
  return {
    drawnBy: OSCS.filter((n) => value(`vs${n}Input`) === 1),
    patchedTo: INPUT_JACKS.filter((j) => value(j.srcKey) === INPUT_SOURCE),
  };
}

/**
 * Choose the input layer. A layer nothing uses would change nothing on
 * screen, so when nothing uses the input yet, Oscillator A draws it.
 */
export function chooseInputPatch(params: Record<string, unknown>, layerId: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { [INPUT_LAYER_KEY]: layerId };
  const users = inputUsers(params);
  if (layerId && !users.drawnBy.length && !users.patchedTo.length) patch.vsAInput = 1;
  return patch;
}
