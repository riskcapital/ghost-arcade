/**
 * The Timeline's editing tools and shuttle, as a video editor has them:
 *
 *   razor    C: a click on a block cuts it there
 *   ripple   B: dragging an edge moves every later block on the row with it
 *   roll     N: dragging the cut between two touching blocks moves both edges
 *   slip     Y: dragging a block plays a different stretch of its media in place
 *   select   V: back to selecting and moving
 *   shuttle  J plays backwards (each press doubles the speed, up to 8×),
 *            K stops, L plays
 *
 * The playhead moves through the show store, so everything that follows it
 * (the picture, lines, the time readout) follows the shuttle too.
 */
import { get, writable } from 'svelte/store';
import { showTimeline } from '../../../stores/showTimeline';

export type EditTool = 'select' | 'razor' | 'ripple' | 'roll' | 'slip';
export const EDIT_TOOLS: ReadonlyArray<{ id: EditTool; label: string; key: string; hint: string }> = [
  { id: 'select', label: 'Select', key: 'V', hint: 'Select, move and trim blocks' },
  { id: 'razor', label: 'Razor', key: 'C', hint: 'Click a block to cut it there' },
  { id: 'ripple', label: 'Ripple', key: 'Shift+B', hint: 'Drag an edge: later blocks on the row move with it' },
  { id: 'roll', label: 'Roll', key: 'N', hint: 'Drag the cut between two touching blocks' },
  { id: 'slip', label: 'Slip', key: 'Y', hint: 'Drag a block to play a different part of its media in place' },
];

/** The pointer's tool on the Timeline's blocks. */
export const editTool = writable<EditTool>('select');

/** Seconds per frame for ← / → steps. */
export const FRAME_SECONDS = 1 / 30;
const MAX_REVERSE = 8;

let reverseRate = 0;
let raf = 0;
let lastMs = 0;

/** The speed of the backwards shuttle (0: not running). */
export const shuttleReverse = writable(0);

function frame(now: number): void {
  raf = 0;
  if (!reverseRate) return;
  const s = get(showTimeline);
  // Play started some other way (Space, the button): the shuttle gives way.
  if (s.isPlaying) { stopReverse(); return; }
  const dt = lastMs ? Math.min(0.1, (now - lastMs) / 1000) : 0;
  lastMs = now;
  const next = s.currentTime - dt * reverseRate;
  if (next <= 0) {
    showTimeline.seek(0);
    stopReverse();
    return;
  }
  showTimeline.seek(next);
  raf = requestAnimationFrame(frame);
}

function stopReverse(): void {
  reverseRate = 0;
  lastMs = 0;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  shuttleReverse.set(0);
}

/** J: play backwards; pressed again while running, twice as fast. */
export function shuttleBack(): void {
  if (get(showTimeline).isPlaying) showTimeline.pause();
  reverseRate = reverseRate ? Math.min(MAX_REVERSE, reverseRate * 2) : 1;
  shuttleReverse.set(reverseRate);
  if (!raf && typeof requestAnimationFrame === 'function') {
    lastMs = 0;
    raf = requestAnimationFrame(frame);
  }
}

/** K: stop, whichever way it was going. */
export function shuttleStop(): void {
  stopReverse();
  if (get(showTimeline).isPlaying) showTimeline.pause();
}

/** L: play forwards. */
export function shuttleForward(): void {
  stopReverse();
  if (!get(showTimeline).isPlaying) showTimeline.play();
}

/** ← / →: one frame back or on, stopped. */
export function stepFrame(direction: -1 | 1): void {
  stopReverse();
  const s = get(showTimeline);
  if (s.isPlaying) showTimeline.pause();
  showTimeline.seek(Math.max(0, get(showTimeline).currentTime + direction * FRAME_SECONDS));
}

/** Test seam. */
export function _resetEditToolsForTest(): void {
  stopReverse();
  editTool.set('select');
}
