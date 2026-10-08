// Drag-to-reorder for a short row or column of items (the effect chain, the block tabs).
//
// Nothing in the list moves in the document while a finger is down: the dragged item follows the
// finger with a transform and its neighbours slide aside the same way, then one `onmove(from, to)`
// is reported on release. Moving DOM nodes under a live touch loses the touch on iOS.

/** `list` with the item at `from` moved to position `to`. Out-of-range moves return a copy. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

export type Span = { start: number; size: number };

/**
 * Where the dragged item would land. `spans` are the items' resting positions along the drag
 * axis, `from` is the dragged one and `offset` how far it has been dragged. It takes a
 * neighbour's place once its own centre has passed that neighbour's centre.
 */
export function reorderTarget(spans: Span[], from: number, offset: number): number {
  const centre = spans[from].start + spans[from].size / 2 + offset;
  let to = from;
  for (let i = from + 1; i < spans.length; i++) if (centre > spans[i].start + spans[i].size / 2) to = i;
  for (let i = from - 1; i >= 0; i--) if (centre < spans[i].start + spans[i].size / 2) to = i;
  return to;
}

/** How far each resting item slides to open a gap for the dragged one. */
export function reorderShifts(spans: Span[], from: number, to: number, gap = 0): number[] {
  const step = spans[from].size + gap;
  return spans.map((_, i) => (i === from ? 0 : from < to && i > from && i <= to ? -step : to < from && i >= to && i < from ? step : 0));
}

export type ReorderOptions = {
  axis: 'x' | 'y';
  /** Position of this item in the list. */
  index: number;
  onmove: (from: number, to: number) => void;
  /**
   * Milliseconds the finger must rest before a drag starts. Use it when the item itself is the
   * handle and a quick swipe must keep scrolling the row. 0 (default) starts on the first move.
   */
  hold?: number;
  /** The hold elapsed and the item is lifted. */
  onlift?: () => void;
  /** The item was lifted and put down without moving: a long press. */
  onhold?: () => void;
  disabled?: boolean;
};

const ITEM = '[data-reorder-item]';
const SLOP = 6;

/**
 * Svelte action for the drag handle (or the item itself, with `hold`). The handle must sit inside
 * an element marked `data-reorder-item`; its siblings with the same mark are the list.
 * While an item is lifted its element carries `data-reorder-lifted`, and the list
 * `data-reorder-active`, for styling.
 */
export function dragReorder(node: HTMLElement, options: ReorderOptions) {
  let opts = options;
  let active: {
    id: number; x: number; y: number; item: HTMLElement; items: HTMLElement[]; spans: Span[]; gap: number;
    from: number; to: number; lifted: boolean; moved: boolean; timer?: ReturnType<typeof setTimeout>;
    /** Latest finger position along the axis, and the scrolling parent with where it started. */
    at: number; scroller: HTMLElement | null; scrollStart: number; frame: number;
  } | null = null;
  /** Swallows the click that follows a finished drag or long press. */
  let swallowClick = false;

  const along = (e: { clientX: number; clientY: number }) => (opts.axis === 'x' ? e.clientX : e.clientY);
  const translate = (el: HTMLElement, by: number) => { el.style.transform = by ? (opts.axis === 'x' ? `translateX(${by}px)` : `translateY(${by}px)`) : ''; };

  const scrollOf = (el: HTMLElement) => (opts.axis === 'x' ? el.scrollLeft : el.scrollTop);
  /** The nearest parent that scrolls along the drag axis, so a long list can be dragged through. */
  function scrollParent(from: HTMLElement): HTMLElement | null {
    for (let el = from.parentElement; el; el = el.parentElement) {
      const style = getComputedStyle(el);
      const overflow = opts.axis === 'x' ? style.overflowX : style.overflowY;
      const room = opts.axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
      if (room > 1 && /auto|scroll/.test(overflow)) return el;
    }
    return null;
  }
  /** Places every item for the current finger position and scroll. */
  function place() {
    if (!active?.moved) return;
    const offset = active.at - (opts.axis === 'x' ? active.x : active.y) + (active.scroller ? scrollOf(active.scroller) - active.scrollStart : 0);
    active.to = reorderTarget(active.spans, active.from, offset);
    const shifts = reorderShifts(active.spans, active.from, active.to, active.gap);
    active.items.forEach((el, i) => translate(el, i === active!.from ? offset : shifts[i]));
  }
  /** Scrolls the list while the finger rests near either end of it. */
  function edgeScroll() {
    if (!active?.lifted) return;
    active.frame = requestAnimationFrame(edgeScroll);
    const el = active.scroller;
    if (!el || !active.moved) return;
    const box = el.getBoundingClientRect();
    const start = opts.axis === 'x' ? box.left : box.top, end = opts.axis === 'x' ? box.right : box.bottom;
    const zone = Math.min(56, (end - start) / 4);
    const speed = active.at < start + zone ? -Math.ceil((start + zone - active.at) / 5) : active.at > end - zone ? Math.ceil((active.at - (end - zone)) / 5) : 0;
    if (!speed) return;
    const before = scrollOf(el);
    if (opts.axis === 'x') el.scrollLeft += Math.max(-14, Math.min(14, speed)); else el.scrollTop += Math.max(-14, Math.min(14, speed));
    if (scrollOf(el) !== before) place();
  }
  function lift() {
    if (!active || active.lifted) return;
    active.lifted = true;
    active.scroller = scrollParent(active.item);
    active.scrollStart = active.scroller ? scrollOf(active.scroller) : 0;
    active.frame = requestAnimationFrame(edgeScroll);
    active.item.setAttribute('data-reorder-lifted', '');
    active.item.parentElement?.setAttribute('data-reorder-active', '');
    opts.onlift?.();
  }
  function down(e: PointerEvent) {
    if (opts.disabled || active || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const item = node.closest<HTMLElement>(ITEM);
    const list = item?.parentElement;
    if (!item || !list) return;
    const items = [...list.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches(ITEM));
    const from = items.indexOf(item);
    if (from < 0 || items.length < 2 && !opts.onhold) return;
    const rects = items.map((el) => el.getBoundingClientRect());
    const spans = rects.map((r) => (opts.axis === 'x' ? { start: r.left, size: r.width } : { start: r.top, size: r.height }));
    const gap = spans.length > 1 ? Math.max(0, spans[1].start - spans[0].start - spans[0].size) : 0;
    swallowClick = false;
    active = { id: e.pointerId, x: e.clientX, y: e.clientY, item, items, spans, gap, from, to: from, lifted: false, moved: false, at: along(e), scroller: null, scrollStart: 0, frame: 0 };
    if (opts.hold) active.timer = setTimeout(lift, opts.hold);
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }
  function move(e: PointerEvent) {
    if (!active || e.pointerId !== active.id) return;
    const offset = along(e) - (opts.axis === 'x' ? active.x : active.y);
    if (!active.lifted) {
      // Before the hold elapses a moving finger is scrolling, not dragging.
      if (opts.hold) { if (Math.hypot(e.clientX - active.x, e.clientY - active.y) > SLOP + 4) cancel(); return; }
      if (Math.abs(offset) < SLOP) return;
      lift();
    }
    if (Math.abs(offset) >= SLOP) active.moved = true;
    active.at = along(e);
    place();
  }
  function finish(commit: boolean) {
    const a = active;
    if (!a) return;
    active = null;
    clearTimeout(a.timer);
    cancelAnimationFrame(a.frame);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    for (const el of a.items) translate(el, 0);
    a.item.removeAttribute('data-reorder-lifted');
    a.item.parentElement?.removeAttribute('data-reorder-active');
    if (!commit || !a.lifted) return;
    swallowClick = true;
    if (a.moved) { if (a.to !== a.from) opts.onmove(a.from, a.to); }
    else opts.onhold?.();
  }
  const up = (e: PointerEvent) => { if (active && e.pointerId === active.id) finish(true); };
  const cancel = () => finish(false);
  // Once lifted, the page must not scroll under the finger. Touch scrolling can only be refused
  // from a non-passive touchmove, and only before the browser has started to scroll.
  const holdScroll = (e: TouchEvent) => { if (active?.lifted && e.cancelable) e.preventDefault(); };
  const click = (e: MouseEvent) => { if (swallowClick) { swallowClick = false; e.preventDefault(); e.stopImmediatePropagation(); } };
  const menu = (e: Event) => { if (opts.hold) e.preventDefault(); };

  node.addEventListener('pointerdown', down);
  node.addEventListener('touchmove', holdScroll, { passive: false });
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', menu);
  return {
    update(next: ReorderOptions) { opts = next; },
    destroy() {
      finish(false);
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('touchmove', holdScroll);
      node.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', menu);
    },
  };
}
