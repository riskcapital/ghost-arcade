/**
 * Svelte action: moves the node to <body> while it is shown.
 *
 * A `position: fixed` popover placed from its anchor's viewport rect is only
 * right when nothing above it changes what "fixed" means. The top bar has a
 * backdrop filter (fixed children are placed against the bar, not the
 * window) and scales its groups with CSS zoom (lengths inside are scaled), so
 * a popover in it opened in the wrong place. At <body> it is placed against
 * the window, whatever its host does.
 *
 * Put it on an element inside a wrapper that stays in place (for example a
 * `display: contents` div): Svelte removes a block by walking its first to
 * last node, and a block's boundary node must not be moved away.
 */
export function portal(node: HTMLElement) {
  if (typeof document === 'undefined' || !document.body) return {};
  document.body.appendChild(node);
  return {
    destroy() {
      node.remove();
    },
  };
}
