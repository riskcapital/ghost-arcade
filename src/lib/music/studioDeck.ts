/**
 * Going between the Studio view and the VJ deck while the music plays.
 *
 * In VJ mode the studio shows one of three ways: the full-screen Studio
 * view, the music tray under the deck, or on the deck as one strip, so the
 * clip grid keeps its room for mixing. The backquote key (left of 1) and
 * the `studio.view` control go from the Studio view to the deck and back.
 */

import { get, writable, type Readable } from 'svelte/store';
import { musicStudio } from './musicStudioStore';
import { isTypingTarget } from './musicKeyboard';
import { registerStudioControls } from './studioControls';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { synthVisionStore } from '../stores/synthVision';

/** KeyboardEvent.code of the switch key, and how it is printed. */
export const STUDIO_VIEW_KEY = 'Backquote';
export const STUDIO_VIEW_KEY_LABEL = '`';

const onDeck = writable(false);
/** The studio is on the VJ deck as a strip (the tray is folded away). */
export const studioOnDeck: Readable<boolean> = { subscribe: onDeck.subscribe };

export function showStudioView(): void {
  musicStudio.setStudioView(true);
}

/** The VJ deck with the studio as one strip; the music keeps playing. */
export function showDeck(): void {
  onDeck.set(true);
  musicStudio.setStudioView(false);
}

/** The VJ deck with the music tray under it. */
export function showTray(): void {
  onDeck.set(false);
  musicStudio.setStudioView(false);
}

/** The Studio view to the deck, or anything else to the Studio view. Only in VJ mode, where the view shows. */
export function toggleStudioView(): void {
  if (!get(vjClipLauncher).isOpen) return;
  const s = get(musicStudio);
  if (s.isOpen && s.studioView) showDeck();
  else showStudioView();
}

/** True for the switch key when nothing else wants it (typing, Performer's keys, a shortcut with modifiers). */
export function isStudioViewKey(e: KeyboardEvent): boolean {
  if (e.code !== STUDIO_VIEW_KEY || e.repeat || e.defaultPrevented) return false;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  if (get(synthVisionStore).keyboardActive) return false;
  return !(typeof document !== 'undefined' && isTypingTarget(document.activeElement));
}

/**
 * Listen for the switch key. Bubble phase, so a learned key binding on the
 * same key (and key learning) comes first. Returns a detach function.
 */
export function attachStudioViewKey(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isStudioViewKey(e)) return;
    e.preventDefault();
    toggleStudioView();
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

// A studio opened again starts with its tray.
musicStudio.subscribe((s) => {
  if (!s.isOpen && get(onDeck)) onDeck.set(false);
});

registerStudioControls([
  { id: 'studio.view', label: 'Studio view or VJ deck', group: 'Studio', kind: 'trigger', run: () => toggleStudioView() },
]);
