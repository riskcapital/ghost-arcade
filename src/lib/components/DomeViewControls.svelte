<script lang="ts">
  /**
   * DomeViewControls — switches the editor canvas between the dome picture
   * (what the projectors get) and the Inside view (the dome as someone at
   * its center sees it), and steers the Inside view:
   *   - drag to look around (the dome follows the pointer);
   *   - scroll to zoom;
   *   - double-click, or Reset, to look back at the front.
   * The render core draws the view (dome_inside_view in heartbeat.wgsl) and
   * the editor preview shows it in place of the program; the output window
   * and every Screen keep the program. macOS and Windows only: the view
   * reaches the editor through the native presenter.
   */
  import { onDestroy } from 'svelte';
  import { invoke, isLinux } from '$lib/bridge';
  import { clampDomeView, domeView, DOME_VIEW_HOME } from '../stores/domeView';

  let view = $derived($domeView);
  let lookEl: HTMLDivElement | null = $state(null);

  // The editor preview follows the view: on while Inside is chosen.
  let sentInside: boolean | null = null;
  $effect(() => {
    const inside = view.inside && !isLinux;
    if (inside === sentInside) return;
    sentInside = inside;
    void invoke('native_preview_dome_view', { on: inside }).catch(() => {});
  });
  onDestroy(() => {
    if (sentInside) void invoke('native_preview_dome_view', { on: false }).catch(() => {});
    end();
  });

  function setInside(inside: boolean) {
    domeView.update((v) => ({ ...v, inside }));
  }

  function look(patch: Partial<typeof DOME_VIEW_HOME>) {
    domeView.update((v) => clampDomeView({ ...v, ...patch }));
  }

  // ─── Dragging and zooming ───────────────────────────────────────────
  let dragFrom: { x: number; y: number; azimuth: number; elevation: number } | null = null;

  function begin(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragFrom = { x: e.clientX, y: e.clientY, azimuth: view.azimuth, elevation: view.elevation };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function move(e: PointerEvent) {
    if (!dragFrom) return;
    // One pixel is the view's height in degrees over its height in pixels,
    // so the dome stays under the pointer near the middle of the view.
    const perPixel = view.fov / Math.max(lookEl?.clientHeight ?? 1, 1);
    look({
      azimuth: dragFrom.azimuth - (e.clientX - dragFrom.x) * perPixel,
      elevation: dragFrom.elevation + (e.clientY - dragFrom.y) * perPixel,
    });
  }

  function end() {
    dragFrom = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  }

  function zoom(e: WheelEvent) {
    // Ours, not the editor viewport's zoom.
    e.preventDefault();
    e.stopPropagation();
    look({ fov: view.fov * Math.exp(e.deltaY * 0.0012) });
  }

  // Not passive: scrolling zooms the view instead of moving the page.
  function wheelZoom(node: HTMLElement) {
    node.addEventListener('wheel', zoom, { passive: false });
    return { destroy: () => node.removeEventListener('wheel', zoom) };
  }
</script>

{#if !isLinux}
  <div class="dome-view-bar" role="group" aria-label="Editor view of the dome">
    <div class="dome-view-modes" role="radiogroup" aria-label="Show">
      <button type="button" role="radio" aria-checked={!view.inside} class:active={!view.inside}
        onclick={() => setInside(false)} title="The dome picture the projectors get">Dome picture</button>
      <button type="button" role="radio" aria-checked={view.inside} class:active={view.inside}
        onclick={() => setInside(true)} title="The dome as someone at its center sees it">Inside</button>
    </div>
  </div>

  {#if view.inside}
    <div
      class="dome-view-look"
      bind:this={lookEl}
      role="application"
      aria-label="Look around inside the dome: drag to turn, scroll to zoom, double-click to look at the front"
      onpointerdown={begin}
      use:wheelZoom
      ondblclick={() => look({ ...DOME_VIEW_HOME })}
    ></div>
    <div class="dome-view-status">
      <span>{Math.round(view.azimuth)}° around · {Math.round(view.elevation)}° up · {Math.round(view.fov)}° wide</span>
      <button type="button" onclick={() => look({ azimuth: 0, elevation: 20 })} title="Look at the front, low">Front</button>
      <button type="button" onclick={() => look({ elevation: 89 })} title="Look straight up at the zenith">Up</button>
      <button type="button" onclick={() => look({ ...DOME_VIEW_HOME })} title="Back to the starting view">Reset</button>
    </div>
  {/if}
{/if}

<style>
  .dome-view-bar {
    position: absolute;
    left: 10px;
    top: 10px;
    z-index: 14;
    pointer-events: auto;
  }
  .dome-view-modes {
    display: flex;
    padding: 2px;
    gap: 2px;
    background: rgba(10, 10, 12, 0.82);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
  }
  .dome-view-modes button,
  .dome-view-status button {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 10px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-1, #b8b2c2);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .dome-view-modes button:hover:not(.active),
  .dome-view-status button:hover { color: var(--ga-ink-0, #fff); }
  .dome-view-modes button.active {
    background: var(--ga-selection-bg, rgba(82, 120, 255, 0.16));
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }
  .dome-view-look {
    position: absolute;
    inset: 0;
    z-index: 13;
    pointer-events: auto;
    cursor: grab;
    touch-action: none;
  }
  .dome-view-look:active { cursor: grabbing; }
  .dome-view-status {
    position: absolute;
    left: 10px;
    bottom: 10px;
    z-index: 14;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 2px 2px 10px;
    background: rgba(10, 10, 12, 0.82);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    pointer-events: auto;
  }
  .dome-view-status span {
    margin-right: 6px;
    color: var(--ga-ink-1, #b8b2c2);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
  }
</style>
