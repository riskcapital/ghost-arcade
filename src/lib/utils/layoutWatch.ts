/**
 * Report when something may have moved or resized a set of elements on
 * screen, so their geometry is measured only then instead of on every
 * animation frame (each measurement forces a synchronous layout, which is
 * expensive while the UI is busy re-rendering).
 *
 * Covers what can change an element's box: its own size or any ancestor's
 * (a panel resizing), an ancestor's inline style or class (viewport pan and
 * zoom are transforms), a window resize, any scroll, and the display scale.
 * A CSS transition keeps moving things after the change that started it, so
 * callers should keep measuring for a short while after each report.
 */
export function watchLayout(
  targets: ReadonlyArray<Element | null | undefined>,
  onChange: () => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const chain = new Set<Element>();
  for (const target of targets) {
    for (let el: Element | null = target ?? null; el; el = el.parentElement) chain.add(el);
  }

  const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onChange) : null;
  const mutationObserver = typeof MutationObserver !== 'undefined' ? new MutationObserver(onChange) : null;
  for (const el of chain) {
    resizeObserver?.observe(el);
    mutationObserver?.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  window.addEventListener('resize', onChange);
  document.addEventListener('scroll', onChange, { capture: true, passive: true });

  // Moving the window to a display with another scale.
  let scaleQuery: MediaQueryList | null = null;
  const watchScale = () => {
    scaleQuery?.removeEventListener('change', onScaleChange);
    scaleQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
    scaleQuery?.addEventListener('change', onScaleChange);
  };
  const onScaleChange = () => {
    watchScale();
    onChange();
  };
  watchScale();

  return () => {
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    window.removeEventListener('resize', onChange);
    document.removeEventListener('scroll', onChange, { capture: true });
    scaleQuery?.removeEventListener('change', onScaleChange);
  };
}
