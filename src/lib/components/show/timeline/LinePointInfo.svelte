<script lang="ts">
  /**
   * The selected point of a control line in the inspector: which point of
   * which line, its time and value, and the curve to the next point as a
   * choice (Linear, Ease in/out, Hold, Bezier…), so a curve no longer needs
   * the right-click menu on the lane (which stays).
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import { LINE_CURVES, type LineCurve } from '../../../timeline/lines/lineModel';
  import { lineSelection, selectedLinePoints } from '../../../timeline/lines/timelineLines';
  import { formatBarsBeats } from '../../../show/tempoMap';
  import { showSlice } from './timelineSlices';
  import { formatLineValue, setPointCurves } from './lineUi';
  import { formatPrecise } from './timeFormat';

  interface Props {
    /** Only lines for which this is true (the block's own, say); all when absent. */
    only?: (lineId: string) => boolean;
  }
  let { only }: Props = $props();

  const CURVE_NAMES: Record<LineCurve, string> = {
    hold: 'Hold', linear: 'Linear', smooth: 'Smooth', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Ease in and out',
    sine: 'Sine', exponential: 'Exponential', bounce: 'Bounce', elastic: 'Elastic', bezier: 'Bezier (drag its handles)',
  };

  const linesSlice = showSlice('lines');
  const tempoSlice = showSlice('tempo');
  const sel = $derived($lineSelection);
  const line = $derived(sel && (!only || only(sel.lineId)) ? $linesSlice.find((l) => l.id === sel.lineId) ?? null : null);
  const channel = $derived(sel?.channel ?? 'points');
  const indices = $derived(line && channel === 'points' ? selectedLinePoints(sel, line) : []);
  const first = $derived(line && indices.length ? line.points[indices[0]] ?? null : null);
  const curve = $derived(first ? (first.c ?? (line?.kind === 'bool' ? 'hold' : 'linear')) : 'linear');
  const mixed = $derived(!!line && indices.some((i) => (line!.points[i]?.c ?? 'linear') !== (first?.c ?? 'linear')));

  function setCurve(c: LineCurve) {
    if (!line || !indices.length) return;
    const id = line.id;
    const next = setPointCurves(line.points, indices, c);
    showTimeline.editLines((list) => list.map((l) => (l.id === id ? { ...l, points: next } : l)));
  }
</script>

{#if line && first}
  <div class="lp" data-line-point-info>
    <span class="lp-what">
      {#if indices.length > 1}{indices.length} points of {line.label ?? line.key}{:else}Point {indices[0] + 1} of {line.label ?? line.key}{/if}:
      <span class="lp-num">{$tempoSlice ? formatBarsBeats($tempoSlice, first.t, true) : formatPrecise(first.t)}</span>
      · <span class="lp-num">{formatLineValue(line, first.v)}</span>
    </span>
    <label class="lp-curve">
      <span>Curve</span>
      <select value={mixed ? '' : curve} onchange={(e) => setCurve((e.currentTarget as HTMLSelectElement).value as LineCurve)} title="The curve from this point to the next" data-line-point-curve>
        {#if mixed}<option value="" disabled>Mixed</option>{/if}
        {#each LINE_CURVES as c (c)}<option value={c}>{CURVE_NAMES[c]}</option>{/each}
      </select>
    </label>
  </div>
{/if}

<style>
  .lp { display: flex; flex-direction: column; gap: 6px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .lp-num { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); color: var(--ga-ink-0, #f2ede4); }
  .lp-curve { display: grid; grid-template-columns: 76px 1fr; align-items: center; gap: 8px; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-control, 12px); }
  .lp-curve select {
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: 4px;
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    padding: 0 6px;
  }
</style>
