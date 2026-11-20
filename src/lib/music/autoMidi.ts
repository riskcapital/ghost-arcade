/**
 * MIDI for the Audio Lab controls that have no path of their own, so
 * anything on screen can be assigned in MIDI learn.
 *
 * Knobs and faders: one that is given no path registers itself while it is
 * on screen as `ui.<module>.<label>` (a second one of the same name in the
 * module gets `-2`, and so on).
 *
 * Buttons: when MIDI learn scans the page, every Audio Lab button with no
 * path gets `btn.<module>.<label>`, worked out from where it is and what it
 * is called. A press from the controller clicks that button, found again the
 * same way.
 *
 * Both answer only while their control is on screen; the controls the
 * runtime registers itself (studioMidiControls.ts) answer everywhere.
 */

import { getContext, onDestroy, setContext } from 'svelte';
import { addonUsable } from '../addons/addonAccess';
import { STUDIO_SCOPE, registerStudioControl, setStudioControlFallback, studioControl, type StudioControl } from './studioControls';

const MODULE = Symbol('studio-midi-module');

/** A name as part of a control id: lower case letters, digits and dashes. */
export function midiSlug(text: string, fallback = 'x'): string {
  const s = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28).replace(/-+$/, '');
  return s || fallback;
}

/** Name the module the controls inside this component belong to (a rack module's title). */
export function setMidiModule(name: string): void {
  setContext(MODULE, midiSlug(name, 'lab'));
}

/**
 * Register a knob or fader that was given no path. `run` takes its position, 0-1.
 * Returns the path to put on the element, or '' while Audio Lab is locked.
 * Call it while the component is being set up.
 */
export function autoValueControl(label: string, run: (position: number) => void): string {
  if (!addonUsable('addon.audio-lab')) return '';
  const module = getContext<string | undefined>(MODULE) ?? 'lab';
  const base = `ui.${module}.${midiSlug(label)}`;
  let id = base;
  for (let n = 2; studioControl(id); n++) id = `${base}-${n}`;
  const off = registerStudioControl({ id, label, group: 'Audio Lab', kind: 'value', run });
  onDestroy(off);
  return `${STUDIO_SCOPE}${id}`;
}

// ── Buttons ─────────────────────────────────────────────────────────────

const BUTTON_PREFIX = 'btn.';
/** Where Audio Lab controls live: the full view, the tray, and its dialogs all carry the studio's tokens. */
const ROOTS = '.studio-tokens';

function buttonName(el: HTMLElement): string {
  // What the button says, when it says something short; else its label for screen readers or its tooltip.
  const said = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
  const raw = (said && said.length <= 24 ? said : '') || el.getAttribute('aria-label') || el.getAttribute('title') || said;
  // A tooltip often reads "Name: what it does (shortcut)"; the name is the first part.
  return raw.split(/[:(·]/)[0].trim().replace(/\s+/g, ' ');
}

/**
 * Give every Audio Lab button with no MIDI path one, from its module and its
 * name. The same page always gives the same paths.
 */
export function markAutoButtons(): void {
  if (!addonUsable('addon.audio-lab') || typeof document === 'undefined') return;
  const taken = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>(`${ROOTS} [data-midi-auto]`)) {
    // Marked on an earlier scan: forget it and work it out again, as the page may have changed.
    el.removeAttribute('data-midi-path');
    el.removeAttribute('data-midi-label');
    el.removeAttribute('data-midi-mode');
    el.removeAttribute('data-midi-auto');
  }
  for (const el of document.querySelectorAll<HTMLElement>(`${ROOTS} button`)) {
    if (el.hasAttribute('data-midi-path') || el.getAttribute('role') === 'slider' || (el as HTMLButtonElement).disabled) continue;
    const name = buttonName(el);
    if (!name) continue;
    const module = midiSlug(el.closest<HTMLElement>('[data-midi-module]')?.dataset.midiModule ?? '', 'lab');
    const base = `${BUTTON_PREFIX}${module}.${midiSlug(name)}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    el.setAttribute('data-midi-path', `${STUDIO_SCOPE}${id}`);
    el.setAttribute('data-midi-label', name);
    el.setAttribute('data-midi-mode', 'toggle');
    el.setAttribute('data-midi-auto', '');
  }
}

function autoButton(id: string): StudioControl | undefined {
  if (!id.startsWith(BUTTON_PREFIX)) return undefined;
  return {
    id,
    label: id.slice(BUTTON_PREFIX.length),
    group: 'Audio Lab',
    kind: 'trigger',
    run() {
      if (typeof document === 'undefined') return;
      const find = () => document.querySelector<HTMLElement>(`${ROOTS} [data-midi-path="${STUDIO_SCOPE}${id}"]`);
      let el = find();
      if (!el) {
        markAutoButtons();
        el = find();
      }
      if (el && !(el as HTMLButtonElement).disabled) el.click();
    },
  };
}

setStudioControlFallback(autoButton);
