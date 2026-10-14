/**
 * Deck monitor mirror — the Deck A and Deck B confidence monitors for a
 * platform with no native presenter.
 *
 * On macOS and Windows the core hands each monitor to the presenter as a
 * shared texture and nothing is read back. Where the core cannot export one
 * (Linux), the VJ panel shows the monitors itself: this pump asks the core
 * for each deck's last drawn frame and paints it into the panel's canvases.
 * The monitors are small (480 px wide), so a frame is a few hundred
 * kilobytes, and a deck that is busy or not drawn yet simply skips a tick.
 */
import { invoke } from '$lib/bridge';
import { drawSnapshotToCanvas, type SnapshotPixels } from './nativeCompositeMirror';

export interface DeckMonitorMirrorHandle {
  release(): void;
}

const DEFAULT_FPS = 15;

interface DeckState {
  bank: 'a' | 'b';
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  scratch: ImageData | null;
  inFlight: boolean;
  /** The canvas holds a picture, so an empty deck has something to clear. */
  drawn: boolean;
}

/** Start painting both deck monitors. Call `release()` when the monitors
 *  leave the screen; the pump stops and in-flight frames are dropped. */
export function startNativeDeckMonitorMirror(
  canvases: { a: HTMLCanvasElement; b: HTMLCanvasElement },
  fps = DEFAULT_FPS,
): DeckMonitorMirrorHandle {
  let released = false;
  const decks: DeckState[] = (['a', 'b'] as const).map((bank) => ({
    bank,
    canvas: canvases[bank],
    ctx: canvases[bank].getContext('2d'),
    scratch: null,
    inFlight: false,
    drawn: false,
  }));

  async function pump(deck: DeckState): Promise<void> {
    if (deck.inFlight || !deck.ctx) return;
    deck.inFlight = true;
    try {
      const snap = await invoke('native_renderer_get_frame_snapshot', {
        include_pixels: true,
        deck_monitor: deck.bank,
      }) as SnapshotPixels | null;
      if (released) return;
      const image = drawSnapshotToCanvas(snap, deck.canvas, deck.ctx, deck.scratch);
      if (image) {
        deck.scratch = image;
        deck.drawn = true;
      }
    } catch {
      // Not drawn yet (no clip on this deck since the core started) or a
      // readback already in flight: both resolve by themselves. A deck with
      // nothing to show must not keep its last picture.
      if (!released && deck.drawn && deck.ctx) {
        deck.ctx.clearRect(0, 0, deck.canvas.width, deck.canvas.height);
        deck.drawn = false;
      }
    } finally {
      deck.inFlight = false;
    }
  }

  const interval = Math.round(1000 / Math.max(1, Math.min(30, fps)));
  const timer = setInterval(() => { for (const deck of decks) void pump(deck); }, interval);
  for (const deck of decks) void pump(deck);

  return {
    release() {
      if (released) return;
      released = true;
      clearInterval(timer);
    },
  };
}
