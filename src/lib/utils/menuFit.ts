/**
 * Keeps a drop-down menu inside the window: it gets a max-height that ends a
 * little above the window's bottom edge and scrolls past that, so a long
 * menu (ten recent files) in a short window still reaches every item.
 */

/** Height a menu whose top edge is at `top` may take, CSS px. */
export function menuMaxHeight(top: number, viewportHeight: number, margin = 8, minimum = 160): number {
  const room = Math.floor(viewportHeight - Math.max(0, top) - margin);
  return Math.max(minimum, room);
}

/** Svelte action: fits the node's height to the window, now and on resize. */
export function fitMenuHeight(node: HTMLElement, margin = 8) {
  const fit = () => {
    node.style.maxHeight = `${menuMaxHeight(node.getBoundingClientRect().top, window.innerHeight, margin)}px`;
  };
  fit();
  window.addEventListener('resize', fit);
  return {
    destroy() {
      window.removeEventListener('resize', fit);
    },
  };
}
