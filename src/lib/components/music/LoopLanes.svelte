<script lang="ts">
  /**
   * Loop lanes: one lane per loop track across the bar grid, with a shared
   * playhead. MIDI lanes show their notes (layers tinted, the newest coral
   * while overdubbing), audio lanes their waveform. Click a lane to select the
   * track, double-click a MIDI lane to edit its notes.
   *
   * Drawn on two canvases: the lanes are redrawn only when what they show
   * changes (or the window turns a page), the playhead on its own layer each
   * frame, and nothing runs while the lanes are off screen or the window is
   * hidden. Waveforms come from each layer's cached overview.
   */
  import { onDestroy, onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { audioLayerPeaks, loopStationView, selectLoopTrack } from '../../music/loopStation';
  import { LOOP_TRACK_COUNT } from '../../music/loopTrack';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { launchClockPosition } from '../../stores/launchClock';

  let { onedit }: { onedit?: (i: number) => void } = $props();

  const HEAD_W = 150;
  let box = $state<HTMLDivElement | null>(null);
  let base = $state<HTMLCanvasElement | null>(null);
  let head = $state<HTMLCanvasElement | null>(null);
  let width = $state(0);
  let height = $state(0);
  let visible = true;
  let raf = 0;
  let dirty = true;
  let page = -1;

  const s = $derived($musicStudio);
  const view = $derived($loopStationView);
  /** The window: two passes of the longest loop, at least two bars. */
  const windowBeats = $derived(Math.max(8, 2 * Math.max(4, ...view.tracks.map((t) => t.beats || 0))));

  $effect(() => {
    // Anything the lanes show changing redraws them once.
    void s.loopStation.tracks;
    void view;
    void width;
    void height;
    dirty = true;
  });

  function css(name: string, fallback: string): string {
    return (box && getComputedStyle(box).getPropertyValue(name).trim()) || fallback;
  }

  function drawBase(startBeat: number): void {
    const c = base;
    if (!c || !width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const ink = css('--studio-ink', '#f2ede4');
    const muted = css('--studio-muted', '#89857e');
    const edge = css('--studio-edge', 'rgba(245,236,222,.13)');
    const soft = css('--studio-edge-soft', 'rgba(245,236,222,.07)');
    const accent = css('--studio-accent', '#5278ff');
    const rec = css('--studio-rec', '#ff6b57');
    const ruler = 20;
    const laneH = (height - ruler) / LOOP_TRACK_COUNT;
    const plotW = width - HEAD_W;
    const x = (beat: number) => HEAD_W + ((beat - startBeat) / windowBeats) * plotW;
    g.font = '10px system-ui, sans-serif';
    // Bar grid and ruler.
    for (let b = 0; b <= windowBeats; b++) {
      const bar = (startBeat + b) % 4 === 0;
      g.fillStyle = bar ? edge : soft;
      g.fillRect(Math.round(x(startBeat + b)), 0, 1, height);
      if (bar && b < windowBeats) {
        g.fillStyle = ink;
        g.fillText(String(Math.floor((startBeat + b) / 4) + 1), x(startBeat + b) + 4, 13);
      } else if (b < windowBeats && plotW / windowBeats > 26) {
        g.fillStyle = muted;
        g.fillText(`.${((startBeat + b) % 4) + 1}`, x(startBeat + b) + 4, 13);
      }
    }
    g.fillStyle = edge;
    g.fillRect(0, ruler, width, 1);
    for (let i = 0; i < LOOP_TRACK_COUNT; i++) {
      const t = s.loopStation.tracks[i];
      const v = view.tracks[i];
      const y0 = ruler + i * laneH;
      g.fillStyle = soft;
      g.fillRect(0, Math.round(y0 + laneH), width, 1);
      if (view.selected === i) {
        g.fillStyle = 'rgba(255,107,87,0.05)';
        g.fillRect(0, y0, width, laneH);
        g.fillStyle = rec;
        g.fillRect(0, y0, 3, laneH);
      }
      g.fillStyle = v.phase === 'empty' ? muted : ink;
      g.font = '600 12px system-ui, sans-serif';
      const name = t.name || (t.kind === 'audio' ? `Audio ${i + 1}` : t.instrument ? INSTRUMENT_LABELS[t.instrument] : `Track ${i + 1}`);
      g.fillText(`${i + 1} · ${name.split(' · ')[0]}`.slice(0, 22), 12, y0 + laneH / 2 + 4);
      g.font = '10px system-ui, sans-serif';
      if (v.phase === 'empty' || !(v.beats > 0)) continue;
      const loopBeats = v.beats;
      const padY = Math.min(8, laneH * 0.12);
      const top = y0 + padY;
      const h = laneH - padY * 2;
      g.save();
      g.beginPath();
      g.rect(HEAD_W, y0, plotW, laneH);
      g.clip();
      g.globalAlpha = t.muted ? 0.35 : v.phase === 'stopped' ? 0.5 : 1;
      // Each pass of the loop that falls in the window.
      const firstPass = Math.floor((startBeat - v.origin) / loopBeats);
      const lastPass = Math.floor((startBeat + windowBeats - v.origin) / loopBeats);
      if (t.kind === 'audio') {
        const layers = audioLayerPeaks(i);
        layers.forEach((peaks, li) => {
          const newest = li === layers.length - 1 && layers.length > 1;
          g.fillStyle = newest ? rec : accent;
          g.globalAlpha = (t.muted ? 0.35 : 1) * (newest ? 0.85 : 0.6);
          for (let p = firstPass; p <= lastPass; p++) {
            const ps = v.origin + p * loopBeats;
            const x0 = x(ps);
            const w = (loopBeats / windowBeats) * plotW;
            const mid = top + h / 2;
            const step = Math.max(1, Math.floor(peaks.length / Math.max(1, w)));
            for (let k = 0; k < peaks.length; k += step) {
              const px = x0 + (k / peaks.length) * w;
              if (px < HEAD_W - 2 || px > width) continue;
              const a = peaks[k] * h * 0.5;
              g.fillRect(px, mid - a, Math.max(1, w / peaks.length * step), a * 2 || 1);
            }
          }
        });
      } else {
        const notes = t.layers.flat();
        if (notes.length) {
          const lo = Math.min(...notes.map((n) => n.note));
          const hi = Math.max(lo + 12, ...notes.map((n) => n.note));
          const noteH = Math.max(2, Math.min(5, h / (hi - lo + 1)));
          t.layers.forEach((layer, li) => {
            const newest = li === t.layers.length - 1 && t.layers.length > 1;
            g.fillStyle = newest ? rec : accent;
            for (let p = firstPass; p <= lastPass; p++) {
              const ps = v.origin + p * loopBeats;
              for (const n of layer) {
                const nx = x(ps + n.beat);
                const nw = Math.max(2, (n.dur / windowBeats) * plotW);
                const ny = top + (1 - (n.note - lo) / (hi - lo)) * (h - noteH);
                g.fillRect(nx, ny, nw, noteH);
              }
            }
          });
        }
      }
      // Loop end markers.
      g.globalAlpha = 1;
      g.setLineDash([3, 3]);
      g.strokeStyle = muted;
      for (let p = firstPass + 1; p <= lastPass; p++) {
        const lx = Math.round(x(v.origin + p * loopBeats)) + 0.5;
        g.beginPath();
        g.moveTo(lx, y0 + 2);
        g.lineTo(lx, y0 + laneH - 2);
        g.stroke();
      }
      g.setLineDash([]);
      g.restore();
    }
    g.fillStyle = edge;
    g.fillRect(HEAD_W, ruler, 1, height - ruler);
  }

  function frame(): void {
    raf = 0;
    if (!visible || document.hidden) return;
    const { beat } = launchClockPosition();
    const p = Math.floor(beat / windowBeats);
    if (p !== page || dirty) {
      page = p;
      dirty = false;
      drawBase(p * windowBeats);
    }
    const c = head;
    if (c && width && height) {
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== Math.round(width * dpr)) {
        c.width = Math.round(width * dpr);
        c.height = Math.round(height * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, width, height);
      const xh = HEAD_W + ((beat - p * windowBeats) / windowBeats) * (width - HEAD_W);
      g.fillStyle = css('--studio-ink', '#f2ede4');
      g.fillRect(Math.round(xh), 0, 1, height);
    }
    raf = requestAnimationFrame(frame);
  }

  function wake(): void {
    if (!raf && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function laneAt(e: MouseEvent): number {
    const r = box!.getBoundingClientRect();
    const y = e.clientY - r.top - 20;
    return Math.max(0, Math.min(LOOP_TRACK_COUNT - 1, Math.floor(y / ((r.height - 20) / LOOP_TRACK_COUNT))));
  }

  let observer: IntersectionObserver | null = null;
  let sizer: ResizeObserver | null = null;
  onMount(() => {
    observer = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      if (visible) wake();
    });
    observer.observe(box!);
    sizer = new ResizeObserver(() => {
      width = box!.clientWidth;
      height = box!.clientHeight;
      dirty = true;
      wake();
    });
    sizer.observe(box!);
    document.addEventListener('visibilitychange', wake);
    wake();
  });
  onDestroy(() => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    observer?.disconnect();
    sizer?.disconnect();
    document.removeEventListener('visibilitychange', wake);
  });
</script>

<div class="lanes">
  <div class="head">
    <span class="ga-eyebrow title">Loop lanes</span>
    <span class="ga-eyebrow">{Math.round(windowBeats / 4)} bars shown</span>
    <span class="sp"></span>
    <span class="ga-eyebrow">Click a lane to select · double-click to edit notes</span>
  </div>
  <div
    class="plot"
    bind:this={box}
    role="grid"
    aria-label="Loop lanes"
    tabindex="-1"
    onclick={(e) => selectLoopTrack(laneAt(e))}
    ondblclick={(e) => {
      const i = laneAt(e);
      if (s.loopStation.tracks[i]?.kind === 'midi' && view.tracks[i].beats > 0) onedit?.(i);
    }}
    onkeydown={() => {}}
  >
    <canvas bind:this={base}></canvas>
    <canvas bind:this={head} class="overlay"></canvas>
  </div>
</div>

<style>
  .lanes { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--studio-slot); border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); overflow: hidden; }
  .head { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: var(--studio-panel); border-bottom: 1px solid var(--studio-edge-soft); }
  .title { color: var(--studio-ink); }
  .sp { flex: 1; }
  .plot { position: relative; flex: 1; min-height: 0; cursor: pointer; outline: none; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .overlay { pointer-events: none; }
</style>
