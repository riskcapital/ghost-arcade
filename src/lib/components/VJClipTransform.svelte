<script lang="ts">
  import { vjClipLauncher, type VJClip, type VJDeck } from '../stores/vjClipLauncher';

  /**
   * Per-clip transform for a VJ clip: fit, mirror, zoom, anchor, rotation,
   * opacity.
   *
   * Lives in its own component because it applies to more than video. The
   * transform is baked into the layer's warp-quad corners, which is media
   * agnostic — but it used to sit inside the video-only controls panel, so an
   * image clip had no way to be scaled or positioned at all. Pulling it out
   * lets the image path reuse it verbatim instead of growing a second copy
   * that would drift.
   */

  export let clip: VJClip;
  export let layerIndex: number;
  export let deck: VJDeck = 'A';

  $: zoom = clip.zoom ?? 1;
  $: fit = clip.fit ?? 'cover';
  $: mirrorX = !!clip.mirrorX;
  $: anchorX = clip.anchorX ?? 0.5;
  $: anchorY = clip.anchorY ?? 0.5;
  $: rotation = clip.rotation ?? 0;
  $: opacity = clip.opacity ?? 1;
</script>

                  <!-- Per-clip transform: zoom, fit, anchor, rotation, opacity.
                       Maps to VJClip.zoom/fit/anchorX/anchorY/rotation/opacity
                       which Layer construction in vjOutputLayers translates to
                       the engine's existing position/scale/rotation/opacity/
                       contentFit fields. Each input writes immediately via
                       vjClipLauncher.updateActiveClipVideoProps so the change
                       is visible on the next frame. -->
                  <div data-help-page="vj-mode" class="vt-transform">
                    <div class="vt-section-title">Transform</div>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Fit</span>
                      <select
                        class="vt-tf-select"
                        value={fit}
                        onchange={(e) => vjClipLauncher.updateActiveClipVideoProps(layerIndex, { fit: (e.target as HTMLSelectElement).value as any }, deck)}
                      >
                        <option value="cover">Cover (fill + crop)</option>
                        <option value="contain">Contain (letterbox)</option>
                        <option value="fill">Fill (stretch)</option>
                      </select>
                    </label>

                    <label class="vt-tf-row vt-tf-toggle-row">
                      <span class="vt-tf-label">Mirror</span>
                      <button
                        class="vt-toggle-btn"
                        class:active={mirrorX}
                        onclick={() => vjClipLauncher.updateActiveClipVideoProps(layerIndex, { mirrorX: !mirrorX }, deck)}
                        title="Mirror horizontally"
                        data-midi-path={deck === 'B' ? `vj-b:${layerIndex}:video:mirror` : `vj:${layerIndex}:video:mirror`}
                        data-midi-label="{clip.name} Mirror"
                        data-midi-discrete="true"
                      >
                        {mirrorX ? 'On' : 'Off'}
                      </button>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Zoom</span>
                      <input
                        type="range"
                        min="0.1" max="4" step="0.05"
                        value={zoom}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(layerIndex, { zoom: +(e.target as HTMLInputElement).value }, deck)}
                      />
                      <span class="vt-tf-num">{zoom.toFixed(2)}×</span>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Anchor X</span>
                      <input
                        type="range"
                        min="0" max="1" step="0.01"
                        value={anchorX}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(layerIndex, { anchorX: +(e.target as HTMLInputElement).value }, deck)}
                      />
                      <span class="vt-tf-num">{anchorX.toFixed(2)}</span>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Anchor Y</span>
                      <input
                        type="range"
                        min="0" max="1" step="0.01"
                        value={anchorY}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(layerIndex, { anchorY: +(e.target as HTMLInputElement).value }, deck)}
                      />
                      <span class="vt-tf-num">{anchorY.toFixed(2)}</span>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Rotation</span>
                      <input
                        type="range"
                        min="-180" max="180" step="1"
                        value={rotation}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(layerIndex, { rotation: +(e.target as HTMLInputElement).value }, deck)}
                      />
                      <span class="vt-tf-num">{rotation}°</span>
                    </label>

                    <label class="vt-tf-row">
                      <span class="vt-tf-label">Opacity</span>
                      <input
                        type="range"
                        min="0" max="1" step="0.01"
                        value={opacity}
                        oninput={(e) => vjClipLauncher.updateActiveClipVideoProps(layerIndex, { opacity: +(e.target as HTMLInputElement).value }, deck)}
                      />
                      <span class="vt-tf-num">{Math.round(opacity * 100)}%</span>
                    </label>

                    <button
                      class="vt-tf-reset"
                      onclick={() => vjClipLauncher.updateActiveClipVideoProps(layerIndex, { zoom: 1, fit: 'cover', anchorX: 0.5, anchorY: 0.5, rotation: 0, opacity: 1, mirrorX: false }, deck)}
                      title="Reset transform to defaults"
                    >
                      Reset transform
                    </button>
                  </div>

<style>
  /* Copied from VJModePanel when this section moved into its own component.
     Svelte styles are component-scoped, so the markup would otherwise render
     unstyled here. The panel keeps its own copies because its audio and mode
     rows still use .vt-tf-row / .vt-toggle-btn. */
  .vt-transform {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }

  .vt-section-title {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    line-height: 1.2;
    color: var(--ga-ink-2, #89857e);
    margin-bottom: 2px;
  }

  .vt-tf-row {
    display: grid;
    grid-template-columns: 56px 1fr 44px;
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h-sm, 22px);
  }

  .vt-tf-label {
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #ada9a2);
  }

  .vt-tf-num {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    font-variant-numeric: tabular-nums;
    color: var(--ga-ink-1, #ada9a2);
    text-align: right;
  }

  .vt-tf-row input[type="range"] {
    width: 100%;
    accent-color: var(--ga-slider-fill, var(--ga-selection-line, #5278ff));
  }

  .vt-tf-select {
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-0, #f2ede4);
    padding: 0 8px;
    border-radius: var(--ga-r-hard, 5px);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
    cursor: pointer;
    width: 100%;
  }

  .vt-tf-row:has(.vt-tf-select) {
    grid-template-columns: 56px 1fr;
  }

  .vt-tf-toggle-row {
    grid-template-columns: 56px 1fr;
  }

  .vt-toggle-btn,
  .vt-tf-reset {
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    background: var(--ga-card, #16140f);
    color: var(--ga-ink-1, #ada9a2);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }

  .vt-toggle-btn { width: 100%; }

  .vt-toggle-btn:hover:not(.active),
  .vt-tf-reset:hover {
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
    color: var(--ga-ink-0, #f2ede4);
  }

  .vt-toggle-btn.active {
    border-color: var(--ga-selection-line, #5278ff);
    background: var(--ga-selection-bg, #1f3170);
    color: var(--ga-selection-ink, #e0e8ff);
  }

  .vt-tf-reset {
    margin-top: 4px;
  }
</style>
