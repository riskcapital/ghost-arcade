/**
 * Visuals on by default: when the studio starts making music and there are
 * no visuals anywhere, they go on the deck, so music never plays to a blank
 * output. Hiding the visuals turns this off until they are shown again.
 */
import { musicStudio, isStudioPlaying } from './musicStudioStore';
import { autoPlaceStudio } from './studioTarget';
import { VISUAL_SCENES } from './visualScenes';
import { showToast } from '../stores/errorToast';

let watching = false;

/** Start watching for the music to start (once; later calls do nothing). */
export function watchAutoVisuals(): void {
  if (watching) return;
  watching = true;
  let wasPlaying = false;
  musicStudio.subscribe((s) => {
    const playing = isStudioPlaying(s);
    const started = playing && !wasPlaying;
    wasPlaying = playing;
    if (!started || s.visualsHidden || !s.isOpen) return;
    // After the store write that started the music has finished.
    queueMicrotask(() => {
      const row = autoPlaceStudio(s.set, (set) => VISUAL_SCENES.find((scene) => scene.set === set));
      if (row !== null) showToast(`The visuals are on deck A, row ${row + 1}.`, 'info');
    });
  });
}
