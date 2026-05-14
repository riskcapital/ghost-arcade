/**
 * dragPreview — single-frame drag preview helpers.
 *
 * Why this exists
 * ───────────────
 * User report (Mar 2026, FamiliarDirection563): "I click to grab a single
 * shader to drag into the VJ deck and it shows 6 or 8 ghosted thumbnails
 * as I drag." The browser's default HTML5 drag behaviour captures the
 * source element's pixels AT DRAG START — but if that element has any
 * CSS animations, transitions, hover effects, or layout shifts during
 * the drag, Chromium can re-snapshot the element multiple times producing
 * a stack of ghost previews trailing the cursor. It looks broken and
 * makes the app feel "websitey" rather than native.
 *
 * Fix: explicitly set a SINGLE static drag image via
 * `dataTransfer.setDragImage(...)`. Once you do this, Chromium uses
 * exactly that image and stops re-snapshotting the source element.
 *
 * Two helpers:
 *   - `setCleanDragPreview(e, sourceEl)` — clones the source element
 *     once, applies a frozen-state class so animations stop, hands the
 *     clone to setDragImage, then removes it on the next tick. Gives
 *     a clean "ghost" of exactly what you're dragging.
 *   - `setMinimalDragPreview(e)` — uses a 1×1 transparent image. The
 *     element being dragged shows no ghost; the cursor + drop-target
 *     highlights communicate intent. Snappiest feel, native-app-like.
 */

let _transparentImg: HTMLImageElement | null = null;
function getTransparentImage(): HTMLImageElement {
  if (_transparentImg) return _transparentImg;
  const img = new Image();
  // 1×1 transparent PNG, base64-encoded so no network request.
  img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';
  _transparentImg = img;
  return img;
}

/**
 * Set a clean single-frame drag preview that stops the browser from
 * showing trailing ghosts. The source element is cloned to a hidden
 * off-screen container, used as the drag image for one frame, then
 * removed.
 */
export function setCleanDragPreview(e: DragEvent, sourceEl: HTMLElement, offsetX = 16, offsetY = 16): void {
  if (!e.dataTransfer) return;
  try {
    const clone = sourceEl.cloneNode(true) as HTMLElement;
    // Freeze the clone — no transitions, no animations, no hover effects
    // mid-drag. opacity:0.9 so the ghost is recognisable but clearly
    // distinct from the source.
    clone.style.cssText += `
      position: absolute;
      top: -9999px;
      left: -9999px;
      pointer-events: none;
      opacity: 0.9;
      transition: none !important;
      animation: none !important;
      transform: none !important;
    `;
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, offsetX, offsetY);
    // Remove on the next tick — browser only needs the element for one
    // frame at drag start.
    setTimeout(() => clone.remove(), 0);
  } catch {
    /* setDragImage can throw on some browsers/setups; silently fall back to default. */
  }
}

/**
 * Use a transparent 1×1 image as the drag preview. The browser shows
 * no visible ghost trailing the cursor. Drop-target highlighting
 * provides feedback. Snappiest, most native-app-like option.
 */
export function setMinimalDragPreview(e: DragEvent): void {
  if (!e.dataTransfer) return;
  try {
    e.dataTransfer.setDragImage(getTransparentImage(), 0, 0);
  } catch {
    /* fall back to default */
  }
}
