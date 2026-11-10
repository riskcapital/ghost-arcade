<script lang="ts">
  /**
   * The show ruler's ticks, in time (m:ss) or, with a tempo map, in bars and
   * beats. Only the visible stretch is drawn. In bars, bar 1 is marked (it is
   * what "Bar 1 here" moves) and beats carry their number once there is room.
   */
  import type { ShowTempoMap } from '../../../types';
  import { rulerTicks } from '../../../show/tempoMap';

  interface Props {
    zoom: number;
    rulerSeconds: number;
    viewStart: number;
    viewEnd: number;
    mode: 'time' | 'bars';
    tempo: ShowTempoMap | null;
  }

  let { zoom, rulerSeconds, viewStart, viewEnd, mode, tempo }: Props = $props();

  function formatTime(t: number): string {
    const safe = Math.max(0, t);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const ticks = $derived.by(() => {
    const t0 = Math.max(0, viewStart);
    const t1 = Math.min(rulerSeconds, viewEnd);
    const out: { x: number; label?: string; major: boolean; minor?: boolean; first?: boolean; beatLabel?: string }[] = [];
    if (mode === 'bars' && tempo) {
      const ticks = rulerTicks(tempo, t0, t1, zoom);
      // Beat numbers once beats are ~30 px apart.
      const beatPx = ticks.length > 1 ? Math.min(...ticks.slice(1).map((t, i) => t.time - ticks[i].time)) * zoom : 0;
      for (const tick of ticks) {
        out.push({
          x: tick.time * zoom,
          label: tick.label,
          major: tick.kind === 'bar',
          minor: tick.kind !== 'bar',
          first: tick.kind === 'bar' && tick.bar === 1,
          beatLabel: tick.kind === 'beat' && beatPx >= 30 ? String(tick.beat) : undefined,
        });
      }
      return out;
    }
    // A step that keeps labels ~60 px apart at any zoom.
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = candidates.find((c) => c * zoom >= 60) ?? 600;
    for (let t = Math.floor(t0 / step) * step; t <= t1 + 1e-6; t += step) {
      out.push({ x: t * zoom, label: formatTime(t), major: t % (step * 4) === 0 });
    }
    return out;
  });
</script>

{#each ticks as tick}
  <div class="ruler-tick" class:major={tick.major} class:minor={tick.minor} class:first={tick.first} style:left="{tick.x}px" data-ruler-bar={tick.first ? '1' : undefined}>
    {#if tick.label}<span class="ruler-label">{tick.label}</span>{/if}
    {#if tick.beatLabel}<span class="ruler-beat">{tick.beatLabel}</span>{/if}
  </div>
{/each}

<style>
  .ruler-tick {
    position: absolute;
    top: 0;
    height: 100%;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    pointer-events: none;
  }
  .ruler-tick.major { border-left-color: rgba(255, 255, 255, 0.2); }
  .ruler-tick.minor { top: 55%; height: 45%; }
  .ruler-tick.first { border-left-color: rgba(255, 217, 107, 0.75); }
  .ruler-tick.first .ruler-label { color: #FFD96B; font-weight: 700; }
  .ruler-beat {
    position: absolute;
    top: -1px;
    left: 2px;
    font-size: 8px;
    line-height: 1;
    color: var(--ga-ink-3, #4c4c56);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .ruler-label {
    position: absolute;
    top: 4px;
    left: 3px;
    font-size: 9px;
    color: var(--ga-ink-2, #666);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    white-space: nowrap;
  }
</style>
