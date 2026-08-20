<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { project } from '../stores/layers';
  import type { CropRegion, MediaSource } from '../types';
  import { createDefaultCropRegion } from '../types';
  import { t } from '../i18n';

  export let open = false;
  export let layerId = '';
  export let source: MediaSource | null = null;
  export let cropRegion: CropRegion | null = null;
  export let onClose: () => void = () => {};

  const MIN_CROP = 0.01;

  type DragHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

  let draft: CropRegion = createDefaultCropRegion();
  let initialCrop: CropRegion | null = null;
  let wasOpen = false;
  let previewEl: HTMLDivElement | null = null;
  let previewWidth = 1920;
  let previewHeight = 1080;
  let drag: {
        handle: DragHandle;
        startX: number;
        startY: number;
        startCrop: CropRegion;
        rect: DOMRect;
      }
    | null = null;
  let lastCropKey = '';

  $: sourceAspect = previewWidth > 0 && previewHeight > 0 ? previewWidth / previewHeight : 16 / 9;
  $: croppedAspect = sourceAspect * (draft.width / Math.max(MIN_CROP, draft.height));
  $: cropSummary = `${Math.round(draft.width * 100)} x ${Math.round(draft.height * 100)}%`;
  $: sourceLabel = source?.name || $t('effectTools.crop.mediaSource');

  $: {
    if (open && !wasOpen) {
      initialCrop = cropRegion ? { ...cropRegion } : null;
      draft = normalizeCrop(cropRegion || createDefaultCropRegion());
      lastCropKey = cropKey(cropRegion);
      wasOpen = true;
      syncPreviewSizeFromSource();
    } else if (!open && wasOpen) {
      wasOpen = false;
      endDrag();
    }
  }

  $: if (open && !drag) {
    const key = cropKey(cropRegion);
    if (key !== lastCropKey) {
      draft = normalizeCrop(cropRegion || createDefaultCropRegion());
      lastCropKey = key;
    }
  }

  function cropKey(crop: CropRegion | null | undefined) {
    if (!crop) return 'none';
    return `${crop.x.toFixed(5)}:${crop.y.toFixed(5)}:${crop.width.toFixed(5)}:${crop.height.toFixed(5)}`;
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  }

  function normalizeCrop(input: CropRegion): CropRegion {
    const width = clamp(input.width, MIN_CROP, 1);
    const height = clamp(input.height, MIN_CROP, 1);
    const x = clamp(input.x, 0, 1 - width);
    const y = clamp(input.y, 0, 1 - height);
    return { x, y, width, height };
  }

  function applyCrop(next: CropRegion | null) {
    if (!layerId) return;
    if (!next) {
      draft = createDefaultCropRegion();
      lastCropKey = 'none';
      project.resetCropRegion(layerId);
      return;
    }
    const normalized = normalizeCrop(next);
    draft = normalized;
    lastCropKey = cropKey(normalized);
    project.setCropRegion(layerId, normalized);
  }

  function restoreAndClose() {
    if (layerId) {
      if (initialCrop) project.setCropRegion(layerId, initialCrop);
      else project.resetCropRegion(layerId);
    }
    open = false;
    onClose();
  }

  function done() {
    open = false;
    onClose();
  }

  function resetCrop() {
    applyCrop(null);
  }

  function centerCrop() {
    applyCrop({
      ...draft,
      x: (1 - draft.width) / 2,
      y: (1 - draft.height) / 2,
    });
  }

  function setAspect(targetAspect: number) {
    const normalizedRatio = targetAspect / sourceAspect;
    let width = 1;
    let height = 1;
    if (normalizedRatio > 1) {
      height = 1 / normalizedRatio;
    } else {
      width = normalizedRatio;
    }
    applyCrop({
      x: (1 - width) / 2,
      y: (1 - height) / 2,
      width,
      height,
    });
  }

  function updateField(field: keyof CropRegion, rawValue: string) {
    const value = clamp(parseFloat(rawValue) / 100, 0, 1);
    const next = { ...draft, [field]: value };
    applyCrop(next);
  }

  function percent(value: number) {
    return Number.isFinite(value) ? (value * 100).toFixed(1) : '0.0';
  }

  function startDrag(e: MouseEvent, handle: DragHandle) {
    if (!previewEl) return;
    e.preventDefault();
    e.stopPropagation();
    drag = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...draft },
      rect: previewEl.getBoundingClientRect(),
    };
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', endDrag);
  }

  function moveDrag(e: MouseEvent) {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / Math.max(1, drag.rect.width);
    const dy = (e.clientY - drag.startY) / Math.max(1, drag.rect.height);
    const start = drag.startCrop;
    let next = { ...start };

    if (drag.handle === 'move') {
      next.x = clamp(start.x + dx, 0, 1 - start.width);
      next.y = clamp(start.y + dy, 0, 1 - start.height);
      applyCrop(next);
      return;
    }

    if (drag.handle.includes('w')) {
      const right = start.x + start.width;
      next.x = clamp(start.x + dx, 0, right - MIN_CROP);
      next.width = right - next.x;
    }
    if (drag.handle.includes('e')) {
      next.width = clamp(start.width + dx, MIN_CROP, 1 - start.x);
    }
    if (drag.handle.includes('n')) {
      const bottom = start.y + start.height;
      next.y = clamp(start.y + dy, 0, bottom - MIN_CROP);
      next.height = bottom - next.y;
    }
    if (drag.handle.includes('s')) {
      next.height = clamp(start.height + dy, MIN_CROP, 1 - start.y);
    }

    applyCrop(next);
  }

  function endDrag() {
    drag = null;
    window.removeEventListener('mousemove', moveDrag);
    window.removeEventListener('mouseup', endDrag);
  }

  function onVisibilityChange() {
    if (document.hidden) endDrag();
  }

  onMount(() => {
    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', endDrag);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  });

  onDestroy(() => {
    endDrag();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') restoreAndClose();
  }

  function syncPreviewSizeFromSource() {
    const video = source?.videoElement;
    if (video?.videoWidth && video.videoHeight) {
      previewWidth = video.videoWidth;
      previewHeight = video.videoHeight;
      return;
    }
    const image = (source?.texture as any)?.image;
    if (image?.videoWidth && image.videoHeight) {
      previewWidth = image.videoWidth;
      previewHeight = image.videoHeight;
    } else if (image?.naturalWidth && image.naturalHeight) {
      previewWidth = image.naturalWidth;
      previewHeight = image.naturalHeight;
    } else if (image?.width && image.height) {
      previewWidth = image.width;
      previewHeight = image.height;
    }
  }

  function previewVideo(node: HTMLVideoElement, media: MediaSource | null) {
    const apply = (next: MediaSource | null) => {
      const srcVideo = next?.videoElement;
      if (srcVideo?.srcObject) {
        node.srcObject = srcVideo.srcObject;
      } else {
        node.srcObject = null;
        node.src = next?.src || '';
      }
      node.muted = true;
      node.playsInline = true;
      node.loop = true;
      const updateSize = () => {
        if (node.videoWidth && node.videoHeight) {
          previewWidth = node.videoWidth;
          previewHeight = node.videoHeight;
        }
      };
      node.onloadedmetadata = updateSize;
      node.onresize = updateSize;
      updateSize();
      node.play().catch(() => {});
    };
    apply(media);
    return {
      update(next: MediaSource | null) {
        apply(next);
      },
      destroy() {
        node.pause();
        node.srcObject = null;
        node.removeAttribute('src');
      },
    };
  }

  function handleImageLoad(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    if (img.naturalWidth && img.naturalHeight) {
      previewWidth = img.naturalWidth;
      previewHeight = img.naturalHeight;
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="source-crop-overlay"
    onclick={restoreAndClose}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-label={$t('effectTools.crop.dialogAria')}
    tabindex="-1"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="source-crop-modal" onclick={(e) => e.stopPropagation()}>
      <header class="source-crop-header">
        <div>
          <h2>{$t('effectTools.crop.title')}</h2>
          <p>{sourceLabel} - {previewWidth} x {previewHeight}</p>
        </div>
        <button class="source-crop-close" onclick={restoreAndClose} aria-label={$t('effectTools.crop.close')}>x</button>
      </header>

      <div class="source-crop-body">
        <div class="source-crop-preview-shell">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="source-crop-stage"
            bind:this={previewEl}
            style="aspect-ratio: {sourceAspect};"
          >
            {#if source?.videoElement}
              <!-- svelte-ignore a11y_media_has_caption -->
              <video class="source-crop-media" use:previewVideo={source} muted playsinline autoplay></video>
            {:else if source?.type === 'image' && source.src}
              <img class="source-crop-media" src={source.src} alt="" onload={handleImageLoad} />
            {:else}
              <div class="source-crop-placeholder">
                <span>{$t('effectTools.crop.liveTexture')}</span>
                <small>{$t('effectTools.crop.unavailablePreview')}</small>
              </div>
            {/if}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="source-crop-box"
              style="left: {draft.x * 100}%; top: {draft.y * 100}%; width: {draft.width * 100}%; height: {draft.height *
                100}%;"
              onmousedown={(e) => startDrag(e, 'move')}
              role="presentation"
            >
              {#each ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as handle}
                <button
                  class="source-crop-handle {handle}"
                  aria-label={$t('effectTools.crop.resizeHandle', { values: { handle } })}
                  onmousedown={(e) => startDrag(e, handle as DragHandle)}
                ></button>
              {/each}
            </div>
          </div>
        </div>

        <aside class="source-crop-controls">
          <div class="source-crop-stat">
            <span>{$t('effectTools.crop.crop')}</span>
            <strong>{cropSummary}</strong>
          </div>
          <div class="source-crop-stat">
            <span>{$t('effectTools.crop.aspect')}</span>
            <strong>{croppedAspect.toFixed(2)}:1</strong>
          </div>

          <div class="source-crop-presets">
            <button onclick={() => setAspect(16 / 9)}>16:9</button>
            <button onclick={() => setAspect(4 / 3)}>4:3</button>
            <button onclick={() => setAspect(1)}>1:1</button>
            <button onclick={centerCrop}>{$t('effectTools.crop.center')}</button>
          </div>

          <div class="source-crop-fields">
            <label>
              {$t('effectTools.crop.left')}
              <input type="number" min="0" max="100" step="0.1" value={percent(draft.x)} oninput={(e) => updateField('x', (e.target as HTMLInputElement).value)} />
            </label>
            <label>
              {$t('effectTools.crop.top')}
              <input type="number" min="0" max="100" step="0.1" value={percent(draft.y)} oninput={(e) => updateField('y', (e.target as HTMLInputElement).value)} />
            </label>
            <label>
              {$t('effectTools.crop.width')}
              <input type="number" min="1" max="100" step="0.1" value={percent(draft.width)} oninput={(e) => updateField('width', (e.target as HTMLInputElement).value)} />
            </label>
            <label>
              {$t('effectTools.crop.height')}
              <input type="number" min="1" max="100" step="0.1" value={percent(draft.height)} oninput={(e) => updateField('height', (e.target as HTMLInputElement).value)} />
            </label>
          </div>
        </aside>
      </div>

      <footer class="source-crop-footer">
        <button class="source-crop-secondary" onclick={resetCrop}>{$t('effectTools.crop.reset')}</button>
        <div class="source-crop-footer-actions">
          <button class="source-crop-secondary" onclick={restoreAndClose}>{$t('effectTools.crop.cancel')}</button>
          <button class="source-crop-primary" onclick={done}>{$t('effectTools.crop.done')}</button>
        </div>
      </footer>
    </div>
  </div>
{/if}

<style>
  .source-crop-overlay {
    position: fixed;
    inset: 0;
    z-index: 1400;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 28px;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(5px);
  }

  .source-crop-modal {
    width: min(980px, calc(100vw - 56px));
    max-height: calc(100vh - 56px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--ga-panel, #0b0d11);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    box-shadow: 0 24px 72px rgba(0, 0, 0, 0.55);
    color: var(--ga-ink-0, #eef0f4);
  }

  .source-crop-header,
  .source-crop-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .source-crop-footer {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    border-bottom: 0;
  }

  .source-crop-header h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
  }

  .source-crop-header p {
    margin: 4px 0 0;
    color: var(--ga-ink-2, #5e6571);
    font-size: 13px;
  }

  .source-crop-close {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--ga-ink-1, #9aa0ac);
    cursor: pointer;
    font-size: 17px;
  }

  .source-crop-close:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.25);
  }

  .source-crop-body {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: 16px;
    padding: 16px;
    overflow: auto;
  }

  .source-crop-preview-shell {
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background:
      linear-gradient(45deg, rgba(255, 255, 255, 0.04) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(255, 255, 255, 0.04) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.04) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.04) 75%);
    background-size: 18px 18px;
    background-position: 0 0, 0 9px, 9px -9px, -9px 0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 14px;
  }

  .source-crop-stage {
    position: relative;
    width: 100%;
    max-height: min(64vh, 620px);
    overflow: hidden;
    background: #050607;
    border: 1px solid rgba(255, 255, 255, 0.16);
    border-radius: 4px;
  }

  .source-crop-media,
  .source-crop-placeholder {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .source-crop-media {
    object-fit: fill;
  }

  .source-crop-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: var(--ga-ink-1, #9aa0ac);
    text-align: center;
    padding: 20px;
  }

  .source-crop-placeholder span {
    font-size: 14px;
    font-weight: 700;
  }

  .source-crop-placeholder small {
    max-width: 260px;
    color: var(--ga-ink-2, #5e6571);
    font-size: 12px;
    line-height: 1.4;
  }

  .source-crop-box {
    position: absolute;
    min-width: 18px;
    min-height: 18px;
    border: 2px solid #4cd1ff;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.56);
    cursor: move;
  }

  .source-crop-box::before,
  .source-crop-box::after {
    content: '';
    position: absolute;
    inset: 33.333% 0 auto 0;
    height: 1px;
    background: rgba(255, 255, 255, 0.55);
    pointer-events: none;
  }

  .source-crop-box::after {
    inset: 66.666% 0 auto 0;
  }

  .source-crop-handle {
    position: absolute;
    width: 12px;
    height: 12px;
    padding: 0;
    border: 2px solid #050607;
    border-radius: 50%;
    background: #4cd1ff;
    cursor: pointer;
  }

  .source-crop-handle.nw { left: -7px; top: -7px; cursor: nwse-resize; }
  .source-crop-handle.n { left: calc(50% - 6px); top: -7px; cursor: ns-resize; }
  .source-crop-handle.ne { right: -7px; top: -7px; cursor: nesw-resize; }
  .source-crop-handle.e { right: -7px; top: calc(50% - 6px); cursor: ew-resize; }
  .source-crop-handle.se { right: -7px; bottom: -7px; cursor: nwse-resize; }
  .source-crop-handle.s { left: calc(50% - 6px); bottom: -7px; cursor: ns-resize; }
  .source-crop-handle.sw { left: -7px; bottom: -7px; cursor: nesw-resize; }
  .source-crop-handle.w { left: -7px; top: calc(50% - 6px); cursor: ew-resize; }

  .source-crop-controls {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .source-crop-stat {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 13px;
    color: var(--ga-ink-2, #5e6571);
  }

  .source-crop-stat strong {
    color: var(--ga-ink-0, #eef0f4);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 13px;
  }

  .source-crop-presets {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .source-crop-presets button,
  .source-crop-secondary,
  .source-crop-primary {
    min-height: 30px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
  }

  .source-crop-presets button,
  .source-crop-secondary {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--ga-ink-1, #9aa0ac);
  }

  .source-crop-presets button:hover,
  .source-crop-secondary:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
  }

  .source-crop-fields {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .source-crop-fields label {
    display: grid;
    grid-template-columns: 58px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    color: var(--ga-ink-1, #9aa0ac);
    font-size: 13px;
  }

  .source-crop-fields input {
    width: 100%;
    min-width: 0;
    height: 30px;
    background: var(--ga-slot, #050607);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: var(--ga-ink-0, #eef0f4);
    padding: 0 8px;
    font: inherit;
    font-size: 13px;
  }

  .source-crop-footer-actions {
    display: flex;
    gap: 8px;
  }

  .source-crop-secondary {
    padding: 0 12px;
  }

  .source-crop-primary {
    min-width: 82px;
    padding: 0 14px;
    background: #4cd1ff;
    border: 1px solid #4cd1ff;
    color: #041116;
    font-weight: 700;
  }

  .source-crop-primary:hover {
    filter: brightness(1.08);
  }

  @media (max-width: 760px) {
    .source-crop-overlay {
      padding: 12px;
    }

    .source-crop-modal {
      width: calc(100vw - 24px);
      max-height: calc(100vh - 24px);
    }

    .source-crop-body {
      grid-template-columns: 1fr;
    }

    .source-crop-controls {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }

    .source-crop-fields {
      grid-column: 1 / -1;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
