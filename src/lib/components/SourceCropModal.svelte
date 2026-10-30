<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { getNativeRendererFrameSnapshot } from '../api/native-renderer';
  import { project } from '../stores/layers';
  import type { CropRegion, MediaSource } from '../types';
  import { createDefaultCropRegion } from '../types';

  export let open = false;
  export let layerId = '';
  export let source: MediaSource | null = null;
  export let cropRegion: CropRegion | null = null;
  export let onClose: () => void = () => {};

  const MIN_CROP = 0.01;
  // This is an editing guide, not a second program output. Downsample on
  // the GPU before readback; keep crop handles at full UI resolution.
  const PREVIEW_MAX_DIM = 384;
  const PREVIEW_INTERVAL_MS = 1000 / 12;

  type DragHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

  let draft: CropRegion = createDefaultCropRegion();
  let initialCrop: CropRegion | null = null;
  let wasOpen = false;
  let previewEl: HTMLDivElement | null = null;
  let previewWidth = 1920;
  let previewHeight = 1080;
  let drag:
    | {
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

  $: {
    if (open && !wasOpen) {
      initialCrop = cropRegion ? { ...cropRegion } : null;
      draft = normalizeCrop(cropRegion || createDefaultCropRegion());
      lastCropKey = cropKey(cropRegion);
      wasOpen = true;
      syncPreviewSizeFromSource();
    } else if (!open && wasOpen) {
      wasOpen = false;
      drag = null;
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

  onDestroy(() => {
    endDrag();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') restoreAndClose();
  }

  function syncPreviewSizeFromSource() {
    const composition = get(project);
    previewWidth = source?.videoWidth || composition.width || 1920;
    previewHeight = source?.videoHeight || composition.height || 1080;
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

  let previewReady = false;
  let previewMessage = 'Preparing source preview…';

  function nativeSourcePreview(node: HTMLCanvasElement, media: MediaSource | null) {
    let key = '';
    let revision = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = (next: MediaSource | null) => {
      const nextKey = `${next?.id ?? ''}:${next?.src ?? ''}`;
      if (nextKey === key) return;
      key = nextKey;
      const generation = ++revision;
      clearTimeout(timer);
      previewReady = false;
      previewMessage = 'Preparing source preview…';
      const id = next?.id;
      let failures = 0;
      const draw = async () => {
        const startedAt = performance.now();
        try {
          if (!id) return;
          const frame = await getNativeRendererFrameSnapshot(true, { source_id: id, layer_id: layerId, max_dim: PREVIEW_MAX_DIM });
          if (generation !== revision) return;
          if (!frame?.rgba_b64) throw new Error('Preview is not ready');
          const binary = atob(frame.rgba_b64);
          const bytes = new Uint8ClampedArray(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          if (bytes.length !== frame.width * frame.height * 4) throw new Error('Incomplete preview');
          if (node.width !== frame.width) node.width = frame.width;
          if (node.height !== frame.height) node.height = frame.height;
          node.getContext('2d')?.putImageData(new ImageData(bytes, frame.width, frame.height), 0, 0);
          if (next?.type === 'video') {
            previewWidth = next.videoWidth || frame.width;
            previewHeight = next.videoHeight || frame.height;
          }
          previewReady = true;
          failures = 0;
        } catch {
          if (generation !== revision) return;
          if (++failures >= 5) previewMessage = 'Waiting for the source to render…';
        } finally {
          // One request at a time, only while this modal is mounted. Never
          // decode a second video or capture the cropped program output.
          // Include capture time in the refresh interval instead of adding
          // another full delay after every frame. Never queue overlapping reads.
          if (generation === revision) timer = setTimeout(draw,
            failures ? 250 : Math.max(16, PREVIEW_INTERVAL_MS - (performance.now() - startedAt)));
        }
      };
      void draw();
    };
    start(media);
    return { update: start, destroy() { revision++; clearTimeout(timer); } };
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div data-help-page="masks-slices"
    class="source-crop-overlay"
    onclick={restoreAndClose}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-label="Source crop"
    tabindex="-1"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="source-crop-modal" onclick={(e) => e.stopPropagation()}>
      <header class="source-crop-header modal-header">
        <div>
          <h2>Source crop</h2>
          <p>{source?.name || 'Media source'} - {previewWidth} x {previewHeight}</p>
        </div>
        <button class="source-crop-close" onclick={restoreAndClose} aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
      </header>

      <div class="source-crop-body">
        <div class="source-crop-preview-shell">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="source-crop-stage"
            bind:this={previewEl}
            style="aspect-ratio: {sourceAspect};"
          >
            <canvas class="source-crop-media" use:nativeSourcePreview={source} aria-label="Full uncropped source preview"></canvas>
            {#if !previewReady}
              <div class="source-crop-placeholder" role="status"><span>{previewMessage}</span></div>
            {/if}

            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="source-crop-box"
              style="left: {draft.x * 100}%; top: {draft.y * 100}%; width: {draft.width * 100}%; height: {draft.height * 100}%;"
              onmousedown={(e) => startDrag(e, 'move')}
              role="presentation"
            >
              {#each ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as handle}
                <button
                  class="source-crop-handle {handle}"
                  aria-label={`Resize crop ${handle}`}
                  onmousedown={(e) => startDrag(e, handle as DragHandle)}
                ></button>
              {/each}
            </div>
          </div>
        </div>

        <aside class="source-crop-controls">
          <div class="source-crop-stat">
            <span>Crop</span>
            <strong>{cropSummary}</strong>
          </div>
          <div class="source-crop-stat">
            <span>Aspect</span>
            <strong>{croppedAspect.toFixed(2)}:1</strong>
          </div>

          <div class="source-crop-presets">
            <button onclick={() => setAspect(16 / 9)}>16:9</button>
            <button onclick={() => setAspect(4 / 3)}>4:3</button>
            <button onclick={() => setAspect(1)}>1:1</button>
            <button onclick={centerCrop}>Center</button>
          </div>

          <div class="source-crop-fields">
            <label>
              Left
              <input type="number" min="0" max="100" step="0.1" value={percent(draft.x)} oninput={(e) => updateField('x', (e.target as HTMLInputElement).value)} />
            </label>
            <label>
              Top
              <input type="number" min="0" max="100" step="0.1" value={percent(draft.y)} oninput={(e) => updateField('y', (e.target as HTMLInputElement).value)} />
            </label>
            <label>
              Width
              <input type="number" min="1" max="100" step="0.1" value={percent(draft.width)} oninput={(e) => updateField('width', (e.target as HTMLInputElement).value)} />
            </label>
            <label>
              Height
              <input type="number" min="1" max="100" step="0.1" value={percent(draft.height)} oninput={(e) => updateField('height', (e.target as HTMLInputElement).value)} />
            </label>
          </div>
        </aside>
      </div>

      <footer class="source-crop-footer">
        <button class="source-crop-secondary secondary-btn" onclick={resetCrop}>Reset</button>
        <div class="source-crop-footer-actions">
          <button class="source-crop-secondary secondary-btn" onclick={restoreAndClose}>Cancel</button>
          <button class="source-crop-primary primary-btn" onclick={done}>Done</button>
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
    padding: 24px;
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
  }

  .source-crop-modal {
    width: min(980px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--ga-faceplate-bg, var(--ga-panel, #100f0d));
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: inset 0 1px 0 var(--ga-metal-hi, rgba(255, 255, 255, 0.08)), 0 24px 80px rgba(0, 0, 0, 0.58);
    color: var(--ga-ink-1, #ada9a2);
    font-size: var(--ga-text-body);
  }

  .source-crop-header,
  .source-crop-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }

  .source-crop-footer {
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    border-bottom: 0;
  }

  .source-crop-header h2 {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    line-height: 1.3;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ga-ink-0, #f2ede4);
  }

  .source-crop-header p {
    margin: 2px 0 0;
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-meta);
  }

  .source-crop-close {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
  }
  .source-crop-close:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c);
    border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .source-crop-close:disabled { opacity: 0.35; cursor: not-allowed; }

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
    border: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    border-radius: var(--ga-r-hard, 5px);
    padding: 12px;
  }

  .source-crop-stage {
    position: relative;
    width: 100%;
    max-height: min(64vh, 620px);
    overflow: hidden;
    background: repeating-conic-gradient(var(--ga-blue-900) 0% 25%, #101217 0% 50%) 0 / 16px 16px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: 3px;
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
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
  }


  .source-crop-box {
    position: absolute;
    min-width: 18px;
    min-height: 18px;
    border: 2px solid var(--ga-blue-300);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.56);
    cursor: move;
  }

  .source-crop-box::before,
  .source-crop-box::after {
    content: "";
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
    background: var(--ga-blue-300);
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
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    font-size: var(--ga-text-control);
    color: var(--ga-ink-2, #89857e);
  }

  .source-crop-stat strong {
    color: var(--ga-ink-0, #f2ede4);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
  }

  .source-crop-presets {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 6px;
  }

  .source-crop-presets button {
    box-sizing: border-box;
    height: var(--ga-control-h);
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }

  .source-crop-presets button:hover {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
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
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-control);
  }

  .source-crop-fields input {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: var(--ga-control-h);
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-0, #f2ede4);
    padding: 0 8px;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-control);
  }

  .source-crop-footer-actions {
    display: flex;
    gap: 8px;
  }

  .source-crop-secondary,
  .source-crop-primary {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--ga-bar-control-h);
    padding: 0 14px;
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s, filter 0.12s;
  }
  .source-crop-secondary {
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
  }
  .source-crop-secondary:hover:not(:disabled) {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }
  .source-crop-primary {
    background: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-ink-0, #f2ede4);
    color: var(--ga-void, #0a0908);
  }
  .source-crop-primary:hover:not(:disabled) { filter: brightness(1.06); }
  .source-crop-secondary:disabled,
  .source-crop-primary:disabled { opacity: 0.4; cursor: not-allowed; }

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
