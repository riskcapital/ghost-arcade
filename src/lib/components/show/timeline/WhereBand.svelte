<script lang="ts">
  /**
   * A block's where line, drawn inside the block: one thin stripe per piece
   * (LED fixture) in the block's spatial order, lit where and as much as the
   * where window lights it over time (the band: position ± spread, soft
   * edges fading). Hovering shows which pieces are lit at that moment and
   * highlights them on the stage preview.
   */
  import { onDestroy } from 'svelte';
  import { showSlice } from './timelineSlices';
  import { project } from '../../../stores/layers';
  import { whereHighlight, whereOrderView, whereSampler, litSpotsAt, type WhereBlockInfo } from './whereUi';
  import { formatPrecise } from './timeFormat';

  interface Props {
    info: WhereBlockInfo;
    zoom: number;
    /** Band colour (rgb triple). */
    tint?: [number, number, number];
  }
  let { info, zoom, tint = [255, 217, 107] }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let width = $state(0);
  let height = $state(0);
  let hover: { x: number; y: number; t: number; labels: string[] } | null = $state(null);

  // Slices, not $showTimeline: the store publishes every playhead frame and
  // the band only changes with these (redrawing it each frame cost a full
  // canvas of fills per frame while a show played).
  const tempoSlice = showSlice('tempo');
  const linesSlice = showSlice('lines');
  const ordersSlice = showSlice('whereOrders');

  const view = $derived.by(() => {
    void $project;
    return whereOrderView(info.where, info.pieces, $ordersSlice);
  });

  $effect(() => {
    const el = canvas;
    const tempo = $tempoSlice;
    const lines = $linesSlice;
    const v = view;
    const w = width;
    const h = height;
    if (!el || w <= 0 || h <= 0) return;
    const n = v.slots.length;
    const cw = Math.min(8000, Math.max(1, Math.round(w)));
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    el.width = cw;
    el.height = Math.max(1, Math.round(h * dpr));
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    if (n === 0) return;
    const sampler = whereSampler(info, n, tempo, lines);
    const rowH = el.height / n;
    // Stripes: the pieces in order, faint.
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.09)';
      ctx.fillRect(0, i * rowH, cw, Math.max(1, rowH - 1));
    }
    const step = 2;
    const pxPerS = (cw / w) * zoom;
    for (let x = 0; x < cw; x += step) {
      const t = info.start + (x + step / 2) / pxPerS;
      const weights = sampler.weights(t);
      for (let i = 0; i < n; i++) {
        const a = weights[i];
        if (a <= 0.004) continue;
        ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${(0.85 * a).toFixed(3)})`;
        ctx.fillRect(x, i * rowH, step, Math.max(1, rowH - 1));
      }
    }
  });

  function move(e: MouseEvent) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left;
    const t = info.start + x / zoom;
    const { lit, labels } = litSpotsAt(info, t);
    hover = { x: e.clientX, y: r.top, t, labels };
    whereHighlight.set(lit);
  }
  function leave() {
    hover = null;
    whereHighlight.set(null);
  }
  onDestroy(() => { if (hover) whereHighlight.set(null); });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="where-band" bind:clientWidth={width} bind:clientHeight={height} onmousemove={move} onmouseleave={leave} data-where-band>
  <canvas bind:this={canvas}></canvas>
  {#if hover}
    <span class="where-tip" style:left="{hover.x + 10}px" style:top="{hover.y - 24}px" data-where-tip>
      {formatPrecise(hover.t)}: {hover.labels.length ? hover.labels.join(', ') : 'nothing lit'}
    </span>
  {/if}
</div>

<style>
  .where-band { position: absolute; inset: 0; z-index: 0; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0.9; }
  .where-tip {
    position: fixed; z-index: 1000; pointer-events: none; white-space: nowrap;
    background: rgba(10, 10, 14, 0.94); color: #FFD96B; border: 1px solid rgba(255, 217, 107, 0.5);
    border-radius: 3px; padding: 1px 6px; font-size: 11px;
  }
</style>
