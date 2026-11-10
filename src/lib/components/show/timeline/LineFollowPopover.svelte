<script lang="ts">
  /**
   * What a line follows: nothing (drawn only), the song (level, energy,
   * bands, kick / snare / hats), a stem, the beat (an LFO on the bar grid),
   * a Live knob or track level, or a MIDI CC; plus how much it moves the
   * line (depth, which can be drawn as its own thin line), centred or not,
   * and smoothing. The drawn line is the resting value; the source moves it
   * from there.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import type { BeatShape, ControlLine, FollowSource, LineFollow } from '../../../timeline/lines/lineModel';
  import { BEAT_SHAPES } from '../../../timeline/lines/lineModel';
  import { addMidiTap } from '../../../midi/midiTaps';
  import { FOLLOW_CHOICES, followChoiceId } from './lineUi';
  import { portal } from './trackLayout';

  interface Props {
    line: ControlLine;
    x: number;
    y: number;
    onclose: () => void;
  }
  let { line, x, y, onclose }: Props = $props();

  const follow = $derived(line.follow ?? null);
  const choice = $derived(followChoiceId(follow?.source));
  const SHAPE_NAMES: Record<BeatShape, string> = { sine: 'Sine', triangle: 'Triangle', saw: 'Saw up', ramp: 'Saw down', square: 'Square', pulse: 'Pulse' };
  let learning = $state(false);
  let stopLearn: (() => void) | null = null;

  function put(next: LineFollow | null, key?: string) {
    showTimeline.editLines((list) => list.map((l) => (l.id === line.id ? { ...l, follow: next } : l)), key);
  }
  function setSource(id: string) {
    const c = FOLLOW_CHOICES.find((x) => x.id === id);
    if (!c?.source) { put(null); return; }
    put({ depth: follow?.depth ?? 0.5, ...(follow ?? {}), source: { ...c.source } as FollowSource });
  }
  function patchSource(patch: Partial<Record<string, number | string>>) {
    if (!follow) return;
    put({ ...follow, source: { ...follow.source, ...patch } as FollowSource }, `follow-src:${line.id}`);
  }
  function patch(p: Partial<LineFollow>, key?: string) {
    if (!follow) return;
    put({ ...follow, ...p }, key);
  }
  function toggleDepthLine(on: boolean) {
    if (!follow) return;
    if (on) {
      const at = $showTimeline.currentTime;
      put({ ...follow, depthPoints: [{ t: Math.max(0, at), v: Math.min(1, Math.abs(follow.depth || 0.5)) }] });
    } else {
      const { depthPoints: _d, ...rest } = follow;
      put(rest);
    }
  }
  function learnCC() {
    stopLearn?.();
    learning = true;
    stopLearn = addMidiTap((channel, type, number) => {
      if (type !== 'cc') return false;
      patchSource({ cc: number, channel });
      learning = false;
      const s = stopLearn;
      stopLearn = null;
      queueMicrotask(() => s?.());
      return true;
    });
  }
  $effect(() => () => stopLearn?.());

  $effect(() => {
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.('[data-line-follow]')) return;
      onclose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onclose(); };
    const t = setTimeout(() => window.addEventListener('mousedown', close, true), 0);
    window.addEventListener('keydown', esc, true);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close, true); window.removeEventListener('keydown', esc, true); };
  });

  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lf" use:portal style:left="{x}px" style:top="{y}px" onmousedown={(e) => e.stopPropagation()} data-line-follow>
  <div class="lf-head">{line.label ?? line.key} follows</div>
  <label class="lf-row">
    <span>Source</span>
    <select value={choice} onchange={(e) => setSource((e.currentTarget as HTMLSelectElement).value)} data-line-follow-source>
      {#each FOLLOW_CHOICES as c (c.id)}<option value={c.id}>{c.label}</option>{/each}
    </select>
  </label>
  {#if follow}
    {#if follow.source.kind === 'beat'}
      <label class="lf-row">
        <span>Shape</span>
        <select value={follow.source.shape} onchange={(e) => patchSource({ shape: (e.currentTarget as HTMLSelectElement).value })} data-line-follow-shape>
          {#each BEAT_SHAPES as s (s)}<option value={s}>{SHAPE_NAMES[s]}</option>{/each}
        </select>
      </label>
      <label class="lf-row">
        <span>Bars per cycle</span>
        <input type="number" min="0.0625" max="64" step="0.25" value={follow.source.beats / 4} onchange={(e) => patchSource({ beats: Math.max(0.0625, num(e)) * 4 })} data-line-follow-bars />
      </label>
    {:else if follow.source.kind === 'midi'}
      <label class="lf-row">
        <span>CC</span>
        <input type="number" min="0" max="127" step="1" value={follow.source.cc} onchange={(e) => patchSource({ cc: Math.round(num(e)) })} />
      </label>
      <label class="lf-row">
        <span>Channel</span>
        <select value={follow.source.channel} onchange={(e) => patchSource({ channel: Number((e.currentTarget as HTMLSelectElement).value) })}>
          <option value={-1}>Any</option>
          {#each Array.from({ length: 16 }, (_, i) => i) as ch (ch)}<option value={ch}>{ch + 1}</option>{/each}
        </select>
      </label>
      <button class="lf-btn" class:on={learning} onclick={learnCC}>{learning ? 'Move a knob…' : 'Learn: move a knob'}</button>
    {:else if follow.source.kind === 'live-param'}
      <label class="lf-row"><span>Live track</span><input type="number" min="1" step="1" value={follow.source.track + 1} onchange={(e) => patchSource({ track: Math.max(0, Math.round(num(e)) - 1) })} /></label>
      <label class="lf-row"><span>Device</span><input type="number" min="1" step="1" value={follow.source.device + 1} onchange={(e) => patchSource({ device: Math.max(0, Math.round(num(e)) - 1) })} /></label>
      <label class="lf-row"><span>Knob</span><input type="number" min="1" step="1" value={follow.source.param + 1} onchange={(e) => patchSource({ param: Math.max(0, Math.round(num(e)) - 1) })} /></label>
    {:else if follow.source.kind === 'live-level'}
      <label class="lf-row"><span>Live track</span><input type="number" min="1" step="1" value={follow.source.track + 1} onchange={(e) => patchSource({ track: Math.max(0, Math.round(num(e)) - 1) })} /></label>
    {/if}
    <label class="lf-row">
      <span>Depth</span>
      <input type="range" min="-1" max="1" step="0.01" value={follow.depth} oninput={(e) => patch({ depth: num(e) }, `follow-depth:${line.id}`)} data-line-follow-depth />
      <span class="lf-val">{Math.round(follow.depth * 100)}%</span>
    </label>
    <label class="lf-check">
      <input type="checkbox" checked={!!follow.depthPoints} onchange={(e) => toggleDepthLine((e.currentTarget as HTMLInputElement).checked)} data-line-follow-draw-depth />
      <span>Draw the depth as a line (expand the row to edit it)</span>
    </label>
    <label class="lf-check">
      <input type="checkbox" checked={!!follow.bipolar} onchange={(e) => patch({ bipolar: (e.currentTarget as HTMLInputElement).checked })} />
      <span>Centred: moves up and down around the line</span>
    </label>
    <label class="lf-row">
      <span>Smooth</span>
      <input type="range" min="0" max="1" step="0.01" value={follow.smooth ?? 0} oninput={(e) => patch({ smooth: num(e) || undefined }, `follow-smooth:${line.id}`)} />
      <span class="lf-val">{(follow.smooth ?? 0).toFixed(2)} s</span>
    </label>
  {/if}
</div>

<style>
  .lf {
    position: fixed;
    z-index: 10000;
    width: 250px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    transform: translateY(-100%);
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-0, #ddd);
  }
  .lf-head {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
  }
  .lf-row { display: flex; align-items: center; gap: 6px; }
  .lf-row > span:first-child { width: 86px; flex: none; color: var(--ga-ink-1, #aaa); }
  .lf-row select, .lf-row input[type='number'] { flex: 1; min-width: 0; background: var(--ga-sunk, #0c0c10); color: inherit; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 3px; padding: 2px 4px; font: inherit; }
  .lf-row input[type='range'] { flex: 1; min-width: 0; }
  .lf-val { width: 44px; text-align: right; font-variant-numeric: tabular-nums; color: var(--ga-ink-1, #aaa); }
  .lf-check { display: flex; gap: 6px; align-items: flex-start; color: var(--ga-ink-1, #aaa); }
  .lf-btn { background: var(--ga-sunk, #0c0c10); color: inherit; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 3px; padding: 3px 6px; font: inherit; cursor: pointer; }
  .lf-btn.on { border-color: var(--ga-rec, #ff4757); color: var(--ga-rec, #ff4757); }
</style>
