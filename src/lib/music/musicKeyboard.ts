/**
 * The letter keyboard as an instrument.
 *
 * While the studio's keys are armed, piano keys play notes and Z X C V shift
 * octave and velocity. Those keys are taken before the app's single-key
 * shortcuts and learned key bindings (T would otherwise cycle the test
 * pattern), everything else (modifier shortcuts, number keys, Space) keeps
 * working. Typing into a text field never plays notes.
 */

import { get, writable } from 'svelte/store';
import { synthVisionStore } from '../stores/synthVision';
import { keyboardAction, type KeyboardAction } from './keyboardLayout';

/** True while the studio's letter keys are armed. */
export const musicKeysArmed = writable(false);

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'number', 'password', 'tel', 'url', 'date', 'time', 'datetime-local', 'month', 'week']);

/** A focused control that takes typed letters. Sliders, buttons and checkboxes do not. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const node = el as HTMLElement;
  if (node.isContentEditable) return true;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES.has(((node as HTMLInputElement).type || 'text').toLowerCase());
  return false;
}

function performerOwnsKeys(): boolean {
  return get(synthVisionStore).keyboardActive;
}

/** What the music keyboard does with this key event, or null when it leaves it alone. */
export function musicKeyAction(e: KeyboardEvent, octave: number): KeyboardAction {
  if (!get(musicKeysArmed) || performerOwnsKeys()) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (typeof document !== 'undefined' && isTypingTarget(document.activeElement)) return null;
  return keyboardAction(e.code, octave);
}

/**
 * True when the music keyboard takes this key. The learned key bindings
 * check it so one key does not both play a note and fire a binding.
 */
export function musicKeyboardClaims(e: KeyboardEvent): boolean {
  // Octave is irrelevant to whether a key is claimed; any valid one works.
  return musicKeyAction(e, 4) !== null;
}

export interface MusicKeyboardHandlers {
  octave: () => number;
  noteOn: (note: number, code: string) => void;
  noteOff: (code: string) => void;
  shiftOctave: (delta: -1 | 1) => void;
  shiftVelocity: (delta: number) => void;
  /** Focus left the window: release everything held. */
  releaseAll: () => void;
}

/** Listen to the letter keys. Returns a detach function. */
export function attachMusicKeyboard(handlers: MusicKeyboardHandlers): () => void {
  const down = new Set<string>();

  const onKeyDown = (e: KeyboardEvent) => {
    const action = musicKeyAction(e, handlers.octave());
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat || down.has(e.code)) return;
    down.add(e.code);
    if (action.kind === 'note') handlers.noteOn(action.note, e.code);
    else if (action.kind === 'octave') handlers.shiftOctave(action.delta);
    else handlers.shiftVelocity(action.delta);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!down.has(e.code)) return;
    down.delete(e.code);
    e.preventDefault();
    e.stopPropagation();
    handlers.noteOff(e.code);
  };

  const onBlur = () => {
    down.clear();
    handlers.releaseAll();
  };

  // Capture phase on window: ahead of the app's shortcut handler.
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', onBlur);
    onBlur();
  };
}
