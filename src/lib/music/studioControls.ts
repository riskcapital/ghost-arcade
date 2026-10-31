/**
 * The studio's controls a MIDI controller can play: the band's throw, wash
 * and freeze, the FX pads and bowls, the looks on each instrument feed,
 * the songs. Each one is reached by the MIDI router as `studio:<id>`, and
 * learned by clicking an element marked `data-midi-path="studio:<id>"`.
 *
 * The code that owns a control registers it, so the router needs to know
 * nothing about the studio. Controls are registered by the studio's
 * runtime rather than its panels, so they answer while the performer is
 * on the VJ deck with the Studio view hidden.
 *
 * Values come in 0-1: a button or pad sends its velocity on press and 0 on
 * release, a knob or fader its position.
 */

import { writable } from 'svelte/store';

export const STUDIO_SCOPE = 'studio:';

/**
 * - trigger: fires once on each press.
 * - hold: on while held (throw, wash).
 * - toggle: each press flips it (freeze).
 * - value: follows a knob or fader.
 */
export type StudioControlKind = 'trigger' | 'hold' | 'toggle' | 'value';

export interface StudioControl {
  /** e.g. "band.throw", "pad.3", "voice.2.level", "song.next". */
  id: string;
  /** What the learn list shows: "Throw", "FX pad 4". */
  label: string;
  /** Where it is listed: "Band", "Pads", "Visuals", "Songs". */
  group: string;
  kind: StudioControlKind;
  /**
   * Act on a value. For trigger and toggle controls this is only called on
   * a press (with the velocity); for hold controls on press and release
   * (1 or 0, or the velocity); for value controls on every move.
   */
  run(value: number): void;
}

const controls = new Map<string, StudioControl>();
/** Whether each button-like control is pressed now, so a press is told from a held value. */
const pressed = new Map<string, boolean>();

/** Bumped when the list changes, for anything listing the controls. */
export const studioControlsVersion = writable(0);

const ID = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)*$/;

export function studioControlPath(id: string): string {
  return `${STUDIO_SCOPE}${id}`;
}

/** Register controls; returns a function that takes them away again. */
export function registerStudioControls(list: readonly StudioControl[]): () => void {
  for (const control of list) {
    if (!ID.test(control.id)) throw new Error(`Bad studio control id: ${control.id}`);
    controls.set(control.id, control);
    pressed.delete(control.id);
  }
  studioControlsVersion.update((v) => v + 1);
  return () => {
    let changed = false;
    for (const control of list) {
      if (controls.get(control.id) !== control) continue;
      controls.delete(control.id);
      pressed.delete(control.id);
      changed = true;
    }
    if (changed) studioControlsVersion.update((v) => v + 1);
  };
}

export function registerStudioControl(control: StudioControl): () => void {
  return registerStudioControls([control]);
}

export function studioControl(id: string): StudioControl | undefined {
  return controls.get(id);
}

/** Every control, grouped and in the order registered. */
export function studioControls(): StudioControl[] {
  const groups = new Map<string, StudioControl[]>();
  for (const control of controls.values()) {
    const list = groups.get(control.group) ?? [];
    list.push(control);
    groups.set(control.group, list);
  }
  return [...groups.values()].flat();
}

/** Any value over this is a press (a soft pad hit counts); a noisy fader resting near 0 is not. */
const PRESS = 0.04;

/**
 * Play a control from a MIDI value, 0-1. Returns false when no control has
 * that id (the studio's code is not loaded, or a mapping outlived it).
 */
export function runStudioControl(id: string, value: number): boolean {
  const control = controls.get(id);
  if (!control) return false;
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  if (control.kind === 'value') {
    control.run(v);
    return true;
  }
  const down = v > PRESS;
  const was = pressed.get(id) === true;
  if (down === was) return true;
  pressed.set(id, down);
  if (control.kind === 'hold') control.run(down ? v : 0);
  else if (down) control.run(v);
  return true;
}

/** Let go of every held control (the controller was unplugged, the kill switch). */
export function releaseStudioControls(): void {
  for (const [id, down] of pressed) {
    if (!down) continue;
    pressed.set(id, false);
    const control = controls.get(id);
    if (control?.kind === 'hold') control.run(0);
  }
}
