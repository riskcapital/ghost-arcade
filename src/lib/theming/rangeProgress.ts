let installed = false;

function updateRangeSliderVisual(input: HTMLInputElement) {
  if (input.type !== 'range') return;

  // `valueAsNumber` is a real DOM property; min/max are strings on
  // HTMLInputElement. Parse them ourselves so sliders with custom
  // ranges (-1..1, 0..2π, etc.) compute a correct fill — the old code
  // read non-existent `minAsNumber`/`maxAsNumber` properties which
  // were always `undefined`, defaulting min/max to 0/100 and leaving
  // a visible gap between the fill end and the knob.
  const rawMin = parseFloat(input.min);
  const rawMax = parseFloat(input.max);
  const min = Number.isFinite(rawMin) ? rawMin : 0;
  const max = Number.isFinite(rawMax) ? rawMax : 100;
  const value = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : min;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const clamped = Math.max(0, Math.min(100, pct));

  // Set both a %-string (used directly by gradient stops) and a
  // unitless number (used by calc() that needs to mix with px for
  // the thumb-width offset, see studio-skin.css).
  input.style.setProperty('--ga-range-progress', `${clamped}%`);
  input.style.setProperty('--ga-range-pct', `${clamped / 100}`);
}

function updateRangeSliderVisuals(root: ParentNode = document) {
  root.querySelectorAll('input[type="range"]').forEach((input) => {
    updateRangeSliderVisual(input as HTMLInputElement);
  });
}

export function installRangeProgressSync() {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  installed = true;

  // Intercept programmatic `.value` writes. Svelte (and the modulation
  // engine driving sliders through Svelte re-renders) sets `value` as a
  // DOM PROPERTY — which fires no event and no attribute mutation, so
  // neither the listeners nor the MutationObserver below ever see it.
  // That left the gradient fill frozen at its last user-interaction
  // position while the knob moved ("green fill not following the knob").
  const proto = HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc?.set && desc.configurable) {
    const nativeSet = desc.set;
    Object.defineProperty(proto, 'value', {
      ...desc,
      set(this: HTMLInputElement, v: string) {
        nativeSet.call(this, v);
        if (this.type === 'range') updateRangeSliderVisual(this);
      },
    });
  }

  let raf = 0;
  const scheduleSync = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      updateRangeSliderVisuals();
    });
  };

  const onRangeValueChanged = (event: Event) => {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (input?.type === 'range') updateRangeSliderVisual(input);
  };

  window.addEventListener('input', onRangeValueChanged, true);
  window.addEventListener('change', onRangeValueChanged, true);
  window.addEventListener('pointerdown', onRangeValueChanged, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target instanceof HTMLInputElement && mutation.target.type === 'range') {
        updateRangeSliderVisual(mutation.target);
        continue;
      }

      if (mutation.type === 'childList') {
        scheduleSync();
        return;
      }
    }
  });

  const observe = () => {
    if (!document.body) {
      requestAnimationFrame(observe);
      return;
    }

    // Initial sync after body is ready so every slider already in the
    // DOM gets its --ga-range-progress on first paint. Without this the
    // fill stayed at 0% until the user interacted, leaving a visible
    // gap between the fill end and the knob.
    updateRangeSliderVisuals();

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['value', 'min', 'max'],
    });

    // Belt-and-braces: rAF a couple more syncs over the first second
    // so components that paint their sliders late (effects with
    // dynamic param lists, lazy-loaded panels) pick up correct fill.
    let ticks = 0;
    const reSync = () => {
      updateRangeSliderVisuals();
      ticks += 1;
      if (ticks < 4) setTimeout(() => requestAnimationFrame(reSync), 100);
    };
    requestAnimationFrame(reSync);
  };

  observe();
}
