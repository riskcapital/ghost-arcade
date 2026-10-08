// Shared horizontal range interaction for the mobile studio.
//
// A slider is a full-width strip in a scrolling panel, so a touch on it has to be read before it
// is obeyed: a vertical pan scrolls the panel, a horizontal drag adjusts the value *relative to
// where it was* (the value never jumps to the finger), and a double-tap returns to `data-default`.
// The native control ignores pointers (see touchSliders.css) so neither WebKit nor Chromium can
// apply its own jump-to-touch; keyboard and assistive adjustments still go through the input.

/** Pixels of travel before a touch is read as a drag or a scroll. */
export const SLIDER_SLOP = 6;
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_PX = 24;
const THUMB = 26;

/** Which way a touch is heading once it has left the slop circle. */
export function gestureAxis(dx: number, dy: number, slop = SLIDER_SLOP): 'pending' | 'adjust' | 'scroll' {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < slop && ay < slop) return 'pending';
  return ax > ay ? 'adjust' : 'scroll';
}

/** Value after dragging `deltaPx` along a track `trackPx` wide, starting from `start`. */
export function relativeValue(start: number, deltaPx: number, trackPx: number, min: number, max: number, step = 0): number {
  const span = max - min;
  if (!(span > 0)) return min;
  let value = start + (deltaPx / Math.max(1, trackPx)) * span;
  if (step > 0) value = min + Math.round((value - min) / step) * step;
  return Math.max(min, Math.min(max, Number(value.toFixed(8))));
}

/** Vertical fader: dragging up by the full track adds 1. `start` and the result are 0..1. */
export function faderValue(start: number, deltaPx: number, trackPx: number): number {
  return Math.max(0, Math.min(1, start - deltaPx / Math.max(1, trackPx)));
}

/** True when two taps are close enough in time and place to be a double-tap. */
export function isDoubleTap(previous: { time: number; x: number; y: number } | null, time: number, x: number, y: number): boolean {
  return !!previous && time - previous.time <= DOUBLE_TAP_MS && Math.hypot(x - previous.x, y - previous.y) <= DOUBLE_TAP_PX;
}

type Gesture = { el: HTMLInputElement; x: number; y: number; start: number; mode: 'pending' | 'adjust'; refX: number };

export function touchSliders(root: HTMLElement, _state?: unknown) {
  const active = new Map<number, Gesture>();
  const guarded = new Set<HTMLElement>();
  const adjusting = () => [...active.values()].some(g => g.mode === 'adjust');
  // iOS starts a vertical scroll late if the finger drifts while adjusting; hold the panel still
  // for the rest of that drag. Registered on the slider's own strip only, so scrolling elsewhere
  // never waits on script.
  const holdScroll = (e: TouchEvent) => { if (adjusting() && e.cancelable) e.preventDefault(); };
  let lastTap: { el: HTMLInputElement; time: number; x: number; y: number } | null = null;
  const ranges = () => Array.from(root.querySelectorAll<HTMLInputElement>('input[type="range"]'));
  const bounds = (el: HTMLInputElement) => ({ min: Number(el.min || 0), max: Number(el.max || 100), step: el.step === 'any' ? 0 : Number(el.step || 1) });
  const fill = (el: HTMLInputElement) => {
    const { min, max } = bounds(el);
    el.style.setProperty('--touch-fill', String(Math.max(0, Math.min(1, (el.valueAsNumber - min) / (max - min || 1)))));
    el.classList.add('studio-range');
    // The touch lands on the slider's container: let it scroll vertically, keep horizontal for us.
    const strip = el.parentElement;
    if (!strip || strip === root || guarded.has(strip)) return;
    guarded.add(strip);
    strip.style.touchAction = 'pan-y';
    strip.addEventListener('touchmove', holdScroll, { passive: false });
  };
  const refresh = () => {
    ranges().forEach(fill);
    for (const strip of guarded) if (!strip.isConnected) { strip.removeEventListener('touchmove', holdScroll); guarded.delete(strip); }
  };
  const commit = (el: HTMLInputElement, value: number) => {
    const next = String(value);
    if (el.value === next) return;
    el.value = next;
    fill(el);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  /** Tell the page an edit is starting, the way a pointerdown on the native control used to. */
  const announce = (el: HTMLInputElement, e: PointerEvent) =>
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: e.pointerId, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY }));
  const sliderAt = (e: PointerEvent) => {
    const target = e.target;
    if (!(target instanceof Element)) return null;
    for (const el of ranges()) {
      if (el.disabled || !target.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return el;
    }
    return null;
  };
  const release = (id: number) => { if (root.hasPointerCapture(id)) root.releasePointerCapture(id); };
  const down = (e: PointerEvent) => {
    if (!e.isTrusted || e.button !== 0) return;
    const el = sliderAt(e);
    if (!el || [...active.values()].some(g => g.el === el)) return;
    active.set(e.pointerId, { el, x: e.clientX, y: e.clientY, start: el.valueAsNumber, mode: 'pending', refX: e.clientX });
    // A mouse cannot scroll by dragging, so there is nothing to wait for.
    if (e.pointerType === 'mouse') e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    const g = active.get(e.pointerId);
    if (!g) return;
    if (g.mode === 'pending') {
      const axis = gestureAxis(e.clientX - g.x, e.clientY - g.y);
      if (axis === 'pending') return;
      if (axis === 'scroll') { active.delete(e.pointerId); return; }
      g.mode = 'adjust'; g.refX = e.clientX; g.start = g.el.valueAsNumber; lastTap = null;
      try { root.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      g.el.focus({ preventScroll: true });
      announce(g.el, e);
    }
    e.preventDefault();
    const { min, max, step } = bounds(g.el);
    commit(g.el, relativeValue(g.start, e.clientX - g.refX, g.el.getBoundingClientRect().width - THUMB, min, max, step));
  };
  const end = (e: PointerEvent) => {
    const g = active.get(e.pointerId);
    if (!g) return;
    active.delete(e.pointerId);
    release(e.pointerId);
    if (g.mode === 'adjust') { g.el.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (e.type !== 'pointerup') return;
    const now = performance.now();
    if (lastTap?.el === g.el && isDoubleTap(lastTap, now, e.clientX, e.clientY)) {
      lastTap = null;
      const fallback = g.el.dataset.default;
      if (fallback === undefined || fallback === '') return;
      const { min, max } = bounds(g.el);
      const value = Math.max(min, Math.min(max, Number(fallback)));
      if (!Number.isFinite(value) || value === g.el.valueAsNumber) return;
      announce(g.el, e);
      commit(g.el, value);
      g.el.dispatchEvent(new Event('change', { bubbles: true }));
    } else lastTap = { el: g.el, time: now, x: e.clientX, y: e.clientY };
  };
  const input = (e: Event) => { if (e.target instanceof HTMLInputElement && e.target.type === 'range') fill(e.target); };
  const observer = new MutationObserver(refresh);
  observer.observe(root, { childList: true, subtree: true });
  refresh();
  root.addEventListener('pointerdown', down, { capture: true, passive: false });
  root.addEventListener('pointermove', move, { capture: true, passive: false });
  root.addEventListener('pointerup', end, true);
  root.addEventListener('pointercancel', end, true);
  root.addEventListener('input', input);
  return {
    update() { queueMicrotask(refresh); },
    destroy() {
      observer.disconnect();
      for (const id of active.keys()) release(id);
      active.clear();
      for (const strip of guarded) strip.removeEventListener('touchmove', holdScroll);
      guarded.clear();
      root.removeEventListener('pointerdown', down, true);
      root.removeEventListener('pointermove', move, true);
      root.removeEventListener('pointerup', end, true);
      root.removeEventListener('pointercancel', end, true);
      root.removeEventListener('input', input);
    },
  };
}
