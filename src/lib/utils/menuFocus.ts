/**
 * Svelte action: a menu (a <select>) inside the node gives its focus back
 * once a choice is made with the mouse, so the letter keys play notes again
 * instead of jumping the menu to another sound. A menu worked from the
 * keyboard (arrows) keeps its focus, so it can still be stepped through.
 */

interface MenuEventLike {
  target: EventTarget | null;
}

type MenuLike = { tagName?: string; blur?: () => void };

const isMenu = (t: EventTarget | null): t is EventTarget & MenuLike => !!t && (t as MenuLike).tagName === 'SELECT';

/** The listeners, apart from the DOM so they can be tested. */
export function menuFocusHandlers() {
  let keyed: EventTarget | null = null;
  return {
    pointerdown(e: MenuEventLike) {
      keyed = null;
      void e;
    },
    keydown(e: MenuEventLike) {
      if (isMenu(e.target)) keyed = e.target;
    },
    change(e: MenuEventLike) {
      const t = e.target;
      if (!isMenu(t) || keyed === t) return;
      t.blur?.();
    },
  };
}

export function releaseMenuFocus(node: HTMLElement) {
  const h = menuFocusHandlers();
  node.addEventListener('pointerdown', h.pointerdown, true);
  node.addEventListener('keydown', h.keydown, true);
  node.addEventListener('change', h.change);
  return {
    destroy() {
      node.removeEventListener('pointerdown', h.pointerdown, true);
      node.removeEventListener('keydown', h.keydown, true);
      node.removeEventListener('change', h.change);
    },
  };
}
