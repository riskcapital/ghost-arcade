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
                  <div class="vt-transform">
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
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .vt-section-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #777;
    margin-bottom: 2px;
  }

  .vt-tf-row {
    display: grid;
    grid-template-columns: 56px 1fr 44px;
    align-items: center;
    gap: 8px;
  }

  .vt-tf-label {
    font-size: 11px;
    color: var(--text-secondary, #aaa);
  }

  .vt-tf-num {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    color: #6df;
    text-align: right;
  }

  .vt-tf-row input[type="range"] {
    width: 100%;
    accent-color: #6df;
  }

  .vt-tf-select {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #ddd);
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
    width: 100%;
  }

  .vt-tf-row:has(.vt-tf-select) {
    grid-template-columns: 56px 1fr;
  }

  .vt-tf-toggle-row {
    grid-template-columns: 56px 1fr;
  }

  .vt-toggle-btn {
    width: 100%;
    height: 24px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .vt-toggle-btn.active {
    border-color: rgba(109, 240, 255, 0.45);
    background: rgba(109, 240, 255, 0.16);
    color: #6df;
  }

  .vt-tf-reset {
    margin-top: 4px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-secondary, #aaa);
    padding: 5px;
    border-radius: 3px;
    font-size: 11px;
    cursor: pointer;
  }

  .vt-tf-reset:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }
</style>
