/**
 * The Timeline's editing tools and shuttle, as a video editor has them:
 *
 *   razor    C: a click on a block cuts it there
 *   ripple   Shift+B (B is Blackout): dragging an edge moves every later block on the row with it
 *   roll     N: dragging the cut between two touching blocks moves both edges
 *   slip     Y: dragging a block plays a different stretch of its media in place
 *   forward  A: a click selects every block and key from there on (Shift: on
 *            that row only); dragging moves them all (shift a whole passage)
 *   select   V: back to selecting and moving
 *   shuttle  J plays backwards (each press doubles the speed, up to 8×),
 *            K stops, L plays. Backwards moves the playhead at most
 *            REVERSE_SEEKS_PER_SECOND times a second: each move is a seek
 *            the songs and videos have to follow, and they cannot follow
 *            one every frame
 *
 * The playhead moves through the show store, so everything that follows it
 * (the picture, lines, the time readout) follows the shuttle too.
 */
import { get, writable } from 'svelte/store';
import { onShowDocChange, showTimeline } from '../../../stores/showTimeline';

export type EditTool = 'select' | 'razor' | 'ripple' | 'roll' | 'slip' | 'forward';
export const EDIT_TOOLS: ReadonlyArray<{ id: EditTool; label: string; key: string; hint: string }> = [
  { id: 'select', label: 'Select', key: 'V', hint: 'Select, move and trim blocks' },
  { id: 'razor', label: 'Razor', key: 'C', hint: 'Click a block to cut it there' },
  { id: 'ripple', label: 'Ripple', key: 'Shift+B', hint: 'Drag an edge: later blocks on the row move with it' },
  { id: 'roll', label: 'Roll', key: 'N', hint: 'Drag the cut between two touching blocks' },
  { id: 'slip', label: 'Slip', key: 'Y', hint: 'Drag a block to play a different part of its media in place' },
  { id: 'forward', label: 'Select forward', key: 'A', hint: 'Click a time: every block and key from there on is selected (Shift: that row only). Drag to shift them' },
];

/** The pointer's tool on the Timeline's blocks. */
export const editTool = writable<EditTool>('select');

/** Seconds per frame for ← / → steps. */
export const FRAME_SECONDS = 1 / 30;
const MAX_REVERSE = 8;

/** How often the backwards shuttle moves the playhead (each move is a seek). */
export const REVERSE_SEEKS_PER_SECOND = 12;
const REVERSE_SEEK_MS = 1000 / REVERSE_SEEKS_PER_SECOND;

let reverseRate = 0;
let raf = 0;
let lastMs = 0;
/** Where the shuttle has got to, and where it last put the playhead. */
let reversePos = 0;
let reverseSeekedTo: number | null = null;
let lastSeekMs = 0;

/** The speed of the backwards shuttle (0: not running). */
export const shuttleReverse = writable(0);

function frame(now: number): void {
  raf = 0;
  if (!reverseRate) return;
  const s = get(showTimeline);
  // Play started some other way (Space, the button): the shuttle gives way.
  if (s.isPlaying) { stopReverse(); return; }
  // The playhead moved some other way (a click on the ruler): go on from there.
  if (reverseSeekedTo === null || Math.abs(s.currentTime - reverseSeekedTo) > 1e-6) reversePos = s.currentTime;
  const dt = lastMs ? Math.min(0.1, (now - lastMs) / 1000) : 0;
  lastMs = now;
  reversePos -= dt * reverseRate;
  if (reversePos <= 0) {
    showTimeline.seek(0);
    stopReverse();
    return;
  }
  if (reverseSeekedTo === null || now - lastSeekMs >= REVERSE_SEEK_MS - 1) {
    lastSeekMs = now;
    showTimeline.seek(reversePos);
    reverseSeekedTo = get(showTimeline).currentTime;
  }
  raf = requestAnimationFrame(frame);
}

function stopReverse(): void {
  reverseRate = 0;
  lastMs = 0;
  reverseSeekedTo = null;
  lastSeekMs = 0;
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

/** The tray closed: a backwards shuttle stops with it. */
export function stopShuttle(): void {
  stopReverse();
}

// Another document opened: the tool goes back to Select (its menu lives in the
// Timeline) and a backwards shuttle stops instead of scrubbing the new one.
onShowDocChange(() => {
  stopReverse();
  editTool.set('select');
});

/** Test seam. */
export function _resetEditToolsForTest(): void {
  stopReverse();
  editTool.set('select');
}
