<script lang="ts">
  /**
   * MobileCrossfaderStrip — touch-optimized A/B crossfader.
   *
   * Lives between the Bank A and Bank B mixer columns when crossfader is
   * enabled. Vertical layout for tablets (sits between two stacks of
   * mixer strips), horizontal layout for phones (sits between deck rows).
   *
   * Mirrors the desktop crossfader behavior:
   *   • Drag the fader thumb to mix A→B (0..1)
   *   • Tap A / B buttons for instant cuts (or quantized snap if quant on)
   *   • Toggle on/off via the power button
   *   • Pick transition mode (cut / dissolve / wipe / etc.) and curve
   *     (linear / equal-power / sharp) from the small selectors.
   */
  import { onMount, onDestroy } from 'svelte';

  export let enabled: boolean = false;
  export let value: number = 0;            // 0 = full A · 1 = full B
  export let transition: string = 'dissolve';
  /** @deprecated kept for backward-compat only. The secondary dropdown
   *  now picks an output blend mode instead of a fader-response curve.
   *  curve still flows through to the desktop renderer (linear by
   *  default) but isn't editable from the mobile UI any more. */
  export let curve: string = 'equal-power';
  /** Output blend mode — how the dual-deck composite layers onto
   *  whatever's underneath (downstream FX, project layers, etc.). */
  export let blendMode: string = 'normal';
  export let selectedDeck: 'A' | 'B' = 'A';
  export let orientation: 'vertical' | 'horizontal' = 'vertical';
  export let compact: boolean = false;
  export let onChange: (v: number) => void = () => {};
  export let onToggleEnabled: (e: boolean) => void = () => {};
  export let onCutA: () => void = () => {};
  export let onCutB: () => void = () => {};
  export let onTransitionChange: (t: string) => void = () => {};
  export let onCurveChange: (c: string) => void = () => {};
  export let onBlendModeChange: (b: string) => void = () => {};

  // Transition list MUST match the CrossfaderTransition union in
  // src/lib/stores/vjClipLauncher.ts and the TRANSITIONS registry in
  // src/lib/renderer/crossfadeTransitions.ts. Any value the operator
  // picks here is sent verbatim to the desktop store; mismatched
  // strings (e.g. the old 'cut' / 'wipe-left' / 'fade-black' entries)
  // failed validation and silently fell back to dissolve, which is
  // why glitch + the other "cool" transitions disappeared on iPad.
  const TRANSITIONS = [
    { value: 'dissolve',  label: 'Dissolve' },
    { value: 'wipe',      label: 'Hard Wipe' },
    { value: 'rgb-split', label: 'RGB Split' },
    { value: 'cube',      label: 'Cube' },
    { value: 'shatter',   label: 'Shatter' },
    { value: 'halftone',  label: 'Halftone' },
    { value: 'glitch',    label: 'Glitch' },
    { value: 'liquid',    label: 'Liquid' },
    { value: 'strobe',    label: 'Strobe Mix' },
    { value: 'slide',     label: 'Slide' },
  ];
  // Output blend modes — must match the CrossfaderBlendMode union in
  // vjClipLauncher.ts (which mirrors what the renderer's
  // CROSSFADE_BLEND_MODE_INDEX recognises). Trimmed back from the
  // earlier 13-mode list to only the ones the shader actually
  // implements; extras silently fell back to 'normal' before.
  const BLEND_MODES = [
    'normal', 'multiply', 'screen', 'add',
    'difference', 'darken', 'lighten', 'overlay', 'exclusion',
  ];

  let trackEl: HTMLDivElement;
  let touchAreaEl: HTMLDivElement;
  let dragging = false;
  let cachedRect: DOMRect | null = null;

  // Local value decoupled while dragging so incoming WS sync doesn't yank
  let localValue = value;
  $: if (!dragging) localValue = value;

  // If `enabled` flips false mid-drag (e.g. desktop or another mobile
  // client disabled the crossfader), end the drag cleanly so we don't
  // keep emitting onChange for a disabled control.
  $: if (!enabled && dragging) endDrag();

  function startDrag() {
    dragging = true;
    cachedRect = trackEl?.getBoundingClientRect() ?? null;
  }
  function endDrag() {
    dragging = false;
    cachedRect = null;
  }
  function computeRatio(clientX: number, clientY: number): number {
    const rect = cachedRect || trackEl?.getBoundingClientRect();
    if (!rect) return localValue;
    let r: number;
    if (orientation === 'vertical') {
      // Top of track = A (0), bottom = B (1)
      r = (clientY - rect.top) / rect.height;
    } else {
      // Left = A (0), right = B (1)
      r = (clientX - rect.left) / rect.width;
    }
    return Math.max(0, Math.min(1, r));
  }
  function applyValue(clientX: number, clientY: number) {
    const v = computeRatio(clientX, clientY);
    localValue = v;
    onChange(v);
  }

  function handleTouchStart(e: TouchEvent) {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag();
    applyValue(e.touches[0].clientX, e.touches[0].clientY);
  }
  function handleTouchMove(e: TouchEvent) {
    if (!dragging || !enabled) return;
    e.preventDefault();
    e.stopPropagation();
    applyValue(e.touches[0].clientX, e.touches[0].clientY);
  }
  function handleTouchEnd(e: TouchEvent) {
    e.stopPropagation();
    endDrag();
  }
  // iOS interrupts touches when the system intervenes (incoming call,
  // gesture, app switch). Without a `touchcancel` listener `dragging`
  // stays true forever, suppressing all subsequent prop syncs.
  function handleTouchCancel(e: TouchEvent) {
    e.stopPropagation();
    endDrag();
  }
  function handleMouseDown(e: MouseEvent) {
    if (!enabled) return;
    e.preventDefault();
    e.stopPropagation();
    startDrag();
    applyValue(e.clientX, e.clientY);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }
  function handleMouseMove(e: MouseEvent) {
    if (!dragging) return;
    applyValue(e.clientX, e.clientY);
  }
  function handleMouseUp() {
    endDrag();
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  onMount(() => {
    if (touchAreaEl) {
      touchAreaEl.addEventListener('touchstart', handleTouchStart, { passive: false });
      touchAreaEl.addEventListener('touchmove', handleTouchMove, { passive: false });
      touchAreaEl.addEventListener('touchend', handleTouchEnd, { passive: false });
      touchAreaEl.addEventListener('touchcancel', handleTouchCancel, { passive: false });
    }
  });
  onDestroy(() => {
    if (touchAreaEl) {
      touchAreaEl.removeEventListener('touchstart', handleTouchStart);
      touchAreaEl.removeEventListener('touchmove', handleTouchMove);
      touchAreaEl.removeEventListener('touchend', handleTouchEnd);
      touchAreaEl.removeEventListener('touchcancel', handleTouchCancel);
    }
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  });

  $: deckABias = 1 - localValue;
  $: deckBBias = localValue;
</script>

<div class="xfade {orientation}" class:disabled={!enabled} class:compact>
  <div class="xfade-header">
    <button
      class="xfade-power"
      class:on={enabled}
      onclick={() => onToggleEnabled(!enabled)}
      title={enabled ? 'Disable crossfader' : 'Enable crossfader'}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
        <line x1="12" y1="2" x2="12" y2="12"/>
      </svg>
    </button>
    <span class="xfade-label">XFADE</span>
  </div>

  <!-- Cut buttons -->
  <div class="xfade-cuts">
    <button
      class="xfade-cut a"
      class:active={enabled && deckABias > 0.95}
      class:selected={selectedDeck === 'A'}
      onclick={onCutA}
      disabled={!enabled}
    >A</button>
    <button
      class="xfade-cut b"
      class:active={enabled && deckBBias > 0.95}
      class:selected={selectedDeck === 'B'}
      onclick={onCutB}
      disabled={!enabled}
    >B</button>
  </div>

  <!-- Fader -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="xfade-touch-area"
    bind:this={touchAreaEl}
    onmousedown={handleMouseDown}
    role="slider"
    aria-valuenow={Math.round(localValue * 100)}
    aria-valuemin={0}
    aria-valuemax={100}
    tabindex={0}
  >
    <div class="xfade-track" bind:this={trackEl}>
      <!-- A endpoint marker -->
      <div class="xfade-endpoint a"></div>
      <!-- B endpoint marker -->
      <div class="xfade-endpoint b"></div>
      <!-- Center detent -->
      <div class="xfade-center"></div>
      <!-- Fill from A side -->
      <div class="xfade-fill-a" style="{orientation === 'vertical' ? `height: ${deckABias * 100}%` : `width: ${deckABias * 100}%`}"></div>
      <!-- Fill from B side -->
      <div class="xfade-fill-b" style="{orientation === 'vertical' ? `height: ${deckBBias * 100}%` : `width: ${deckBBias * 100}%`}"></div>
      <!-- Thumb -->
      <div
        class="xfade-thumb"
        class:dragging
        style="{orientation === 'vertical' ? `top: calc(${localValue * 100}% - 12px)` : `left: calc(${localValue * 100}% - 12px)`}"
      ></div>
    </div>
  </div>

  <!-- Transition + Output Blend Mode dropdowns (compact).
       Both dropdowns work TOGETHER: transition picks the spatial
       journey from A → B (dissolve, wipe, glitch, shatter, etc.);
       blend mode picks the per-pixel math when both A and B are
       contributing (multiply, screen, add, etc.). With blend mode at
       'normal' the transition output passes through unchanged; at any
       other mode the blend math tints the transition's overlap zone
       so e.g. "glitch + multiply" gives multiplied scattered shards. -->
  <div class="xfade-modes">
    <select
      class="xfade-select"
      value={transition}
      onchange={(e) => onTransitionChange((e.target as HTMLSelectElement).value)}
      disabled={!enabled}
      title="Transition style — spatial journey from A to B"
    >
      {#each TRANSITIONS as t}
        <option value={t.value}>{t.label}</option>
      {/each}
    </select>
    <select
      class="xfade-select"
      value={blendMode}
      onchange={(e) => onBlendModeChange((e.target as HTMLSelectElement).value)}
      disabled={!enabled}
      title="Blend mode — A↔B math at the mix point (combines with the transition)"
    >
      {#each BLEND_MODES as b}
        <option value={b}>{b}</option>
      {/each}
    </select>
  </div>
</div>

<style>
  .xfade {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 10px 8px;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    border-top: 2px solid #ff8800;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: none;
  }
  .xfade.compact {
    gap: 5px;
    padding: 6px 5px;
    border-radius: 8px;
  }
  .xfade.disabled {
    opacity: 0.5;
    border-top-color: rgba(255, 136, 0, 0.3);
  }
  .xfade.horizontal {
    flex-direction: row;
    padding: 8px 12px;
    border-top: none;
    border-left: 2px solid #ff8800;
    width: 100%;
  }

  .xfade-header {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .xfade-label {
    font-size: 11px;
    font-weight: 800;
    color: rgba(255, 136, 0, 0.85);
    letter-spacing: 1px;
    text-shadow: 0 0 6px rgba(255, 136, 0, 0.4);
  }
  .xfade-power {
    width: 22px;
    height: 22px;
    border: 1px solid rgba(255, 136, 0, 0.25);
    border-radius: 11px;
    background: rgba(255, 136, 0, 0.08);
    color: rgba(255, 136, 0, 0.6);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s;
    -webkit-tap-highlight-color: transparent;
  }
  .xfade.compact .xfade-power {
    width: 20px;
    height: 20px;
  }
  .xfade-power.on {
    color: #ff8800;
    background: rgba(255, 136, 0, 0.18);
    box-shadow: 0 0 10px rgba(255, 136, 0, 0.45);
  }

  /* ── Cut buttons ── */
  .xfade-cuts {
    display: flex;
    gap: 4px;
    width: 100%;
    flex-shrink: 0;
  }
  .xfade.horizontal .xfade-cuts {
    flex-direction: column;
    width: auto;
  }
  .xfade-cut {
    flex: 1;
    padding: 6px 4px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    font-weight: 800;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: all 0.1s;
    min-width: 28px;
    min-height: 28px;
  }
  .xfade.compact .xfade-cut {
    padding: 4px 3px;
    min-height: 24px;
  }
  .xfade-cut.a.active, .xfade-cut.a.selected {
    background: rgba(79, 195, 247, 0.18);
    border-color: rgba(79, 195, 247, 0.6);
    color: #4FC3F7;
    box-shadow: 0 0 8px rgba(79, 195, 247, 0.4);
  }
  .xfade-cut.b.active, .xfade-cut.b.selected {
    background: rgba(206, 147, 216, 0.18);
    border-color: rgba(206, 147, 216, 0.6);
    color: #CE93D8;
    box-shadow: 0 0 8px rgba(206, 147, 216, 0.4);
  }
  .xfade-cut:active:not(:disabled) {
    transform: scale(0.92);
  }
  .xfade-cut:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ── Fader track ── */
  .xfade-touch-area {
    position: relative;
    cursor: pointer;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }
  .xfade.vertical .xfade-touch-area {
    width: 48px;
    height: 200px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .xfade.vertical.compact .xfade-touch-area {
    width: 44px;
    height: clamp(132px, 22vh, 170px);
  }
  .xfade.horizontal .xfade-touch-area {
    height: 44px;
    width: 100%;
    flex: 1;
    display: flex;
    align-items: center;
  }
  .xfade-track {
    position: relative;
    background: var(--bg-tertiary, #1a1a1e);
    border-radius: 6px;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
    overflow: visible;
  }
  .xfade.vertical .xfade-track {
    width: 12px;
    height: 100%;
  }
  .xfade.horizontal .xfade-track {
    height: 24px;
    width: 100%;
  }

  .xfade-endpoint {
    position: absolute;
    background: rgba(255, 255, 255, 0.15);
  }
  .xfade.vertical .xfade-endpoint {
    width: 100%;
    height: 2px;
    left: 0;
  }
  .xfade.vertical .xfade-endpoint.a { top: 0; background: #4FC3F7; }
  .xfade.vertical .xfade-endpoint.b { bottom: 0; background: #CE93D8; }
  .xfade.horizontal .xfade-endpoint {
    height: 100%;
    width: 2px;
    top: 0;
  }
  .xfade.horizontal .xfade-endpoint.a { left: 0; background: #4FC3F7; }
  .xfade.horizontal .xfade-endpoint.b { right: 0; background: #CE93D8; }

  .xfade-center {
    position: absolute;
    background: rgba(255, 255, 255, 0.25);
  }
  .xfade.vertical .xfade-center {
    top: 50%;
    left: -3px;
    right: -3px;
    height: 1px;
    transform: translateY(-50%);
  }
  .xfade.horizontal .xfade-center {
    left: 50%;
    top: -3px;
    bottom: -3px;
    width: 1px;
    transform: translateX(-50%);
  }

  .xfade-fill-a, .xfade-fill-b {
    position: absolute;
    will-change: width, height;
    pointer-events: none;
  }
  .xfade.vertical .xfade-fill-a {
    top: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to bottom, rgba(79, 195, 247, 0.4), rgba(79, 195, 247, 0.05));
    border-radius: 6px 6px 0 0;
  }
  .xfade.vertical .xfade-fill-b {
    bottom: 0;
    left: 0;
    right: 0;
    background: linear-gradient(to top, rgba(206, 147, 216, 0.4), rgba(206, 147, 216, 0.05));
    border-radius: 0 0 6px 6px;
  }
  .xfade.horizontal .xfade-fill-a {
    left: 0;
    top: 0;
    bottom: 0;
    background: linear-gradient(to right, rgba(79, 195, 247, 0.4), rgba(79, 195, 247, 0.05));
    border-radius: 6px 0 0 6px;
  }
  .xfade.horizontal .xfade-fill-b {
    right: 0;
    top: 0;
    bottom: 0;
    background: linear-gradient(to left, rgba(206, 147, 216, 0.4), rgba(206, 147, 216, 0.05));
    border-radius: 0 6px 6px 0;
  }

  .xfade-thumb {
    position: absolute;
    background: linear-gradient(to bottom, #ffaa44, #ff8800);
    box-shadow:
      0 0 8px rgba(255, 136, 0, 0.6),
      0 0 16px rgba(255, 136, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.3);
    z-index: 2;
    border-radius: 6px;
    transition: box-shadow 0.12s;
  }
  .xfade.vertical .xfade-thumb {
    width: 36px;
    height: 24px;
    left: 50%;
    transform: translateX(-50%);
    will-change: top;
  }
  .xfade.vertical.compact .xfade-thumb {
    width: 32px;
    height: 22px;
  }
  .xfade.horizontal .xfade-thumb {
    height: 36px;
    width: 24px;
    top: 50%;
    transform: translateY(-50%);
    will-change: left;
  }
  .xfade-thumb.dragging {
    box-shadow:
      0 0 16px rgba(255, 136, 0, 0.8),
      0 0 28px rgba(255, 136, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
  }

  /* ── Mode dropdowns ── */
  .xfade-modes {
    display: flex;
    gap: 4px;
    width: 100%;
    flex-shrink: 0;
  }
  .xfade.horizontal .xfade-modes {
    flex-direction: column;
    width: auto;
  }
  .xfade-select {
    flex: 1;
    padding: 4px 2px;
    background: #111;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    cursor: pointer;
    text-align: center;
    -webkit-appearance: none;
    min-width: 0;
  }
  .xfade.compact .xfade-select {
    padding: 3px 2px;
    font-size: 10px;
  }
  .xfade-select:focus { border-color: #ff8800; outline: none; }
  .xfade-select:disabled { opacity: 0.4; }
</style>
