/**
 * The patch bay's rules, as changes to the patch. An input takes one cable;
 * an output feeds any number. An input's normal is its connection with no
 * cable in it: a cable replaces it, pulling the cable out brings it back, and
 * pulling out the normal itself breaks it (the input is then empty).
 */
import { INPUT_JACKS, type InputJack } from './patch';

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
