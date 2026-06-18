<script lang="ts" module>
  /** Short chip label for the current source — shared by every
   *  surface that renders a mod chip so naming stays consistent. */
  export function modSourceLabel(source: string, isAuto: boolean): string {
    if (isAuto) return 'Auto';
    switch (source) {
      case 'manual': return 'Mod';
      case 'sub': return 'Sub';
      case 'bass': return 'Bass';
      case 'lowMid': return 'Lo Mid';
      case 'mid': return 'Mid';
      case 'highMid': return 'Hi Mid';
      case 'treble': return 'Treble';
      case 'air': return 'Air';
      case 'presence': return 'Pres';
      case 'high': return 'High';
      case 'amplitude': return 'Volume';
      case 'beatPhase': return 'Beat';
      case 'kick': return 'Kick';
      case 'snare': return 'Snare';
      case 'lfo-sine': return 'LFO ∿';
      case 'lfo-saw': return 'LFO ⊿';
      case 'lfo-square': return 'LFO ⊓';
      case 'lfo-tri': return 'LFO ⋀';
      default: return source;
    }
  }
</script>

<script lang="ts">
  /**
   * ModTray — the per-param modulation tray.
   *
   * One compact anchored popover replaces the old cramped UI (source
   * <select> + Depth/Speed sliders jammed under each param row). Open
   * it from the param's mod chip; pick a source TYPE first (Manual /
   * Audio / LFO / Sync / Auto), then fine-tune with the controls for
   * that type: depth, invert, LFO speed — free-running Hz or
   * BPM-synced musical divisions — and the Auto playhead transport.
   *
   * Rendered with position:fixed from the anchor's bounding rect so
   * no ancestor overflow/stacking context can clip it (the old
   * popovers used position:absolute and got buried behind panels).
   *
   * Purely presentational: all writes go through the callbacks, so
   * the same tray drives VJ shader params (clip-keyed store mods),
   * effect params (EffectParamRow's fx/edge/gpu routing), and any
   * future surface. The live signal meter reads the shared
   * Milkdrop-smoothed visualAudio bus directly — display only.
   */
  import { onMount, onDestroy } from 'svelte';
  import { scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import type { ModSource, ParamModulation } from '../audio/modulation';
  import { getVisualAudioSnapshot } from '../audio/visualAudio';
  import { audioStore } from '../stores/audio';
  import type { AutoConfig } from '../types';

  export let label: string;
  /** Anchor element (the mod chip button) the tray positions against. */
  export let anchor: HTMLElement;
  /** Current source ('manual' when nothing is assigned). */
  export let source: ModSource = 'manual';
  /** Current modulation entry (undefined when manual). */
  export let mod: ParamModulation | undefined = undefined;
  /** Current Auto sidecar (undefined when not in Auto mode). */
  export let auto: AutoConfig | undefined = undefined;
  /** Hide the Auto tab for surfaces that don't support the playhead. */
  export let supportsAuto = true;
  export let autoHint = 'Drag the cyan handles on the param slider to clip the sweep range.';
  export let onClose: () => void;
  export let onSetSource: (s: ModSource) => void;
  export let onPatchMod: (patch: Partial<ParamModulation>) => void;
  export let onPatchAuto: (patch: Partial<AutoConfig>) => void;

  // ─── Source catalog ────────────────────────────────────────────────
  type Category = 'manual' | 'audio' | 'lfo' | 'sync' | 'auto';

  const AUDIO_SOURCES: { v: ModSource; l: string }[] = [
    { v: 'sub', l: 'Sub' },
    { v: 'bass', l: 'Bass' },
    { v: 'lowMid', l: 'Lo Mid' },
    { v: 'mid', l: 'Mid' },
    { v: 'highMid', l: 'Hi Mid' },
    { v: 'treble', l: 'Treble' },
    { v: 'air', l: 'Air' },
    { v: 'presence', l: 'Pres' },
    { v: 'amplitude', l: 'Volume' },
  ];
  const ONSET_SOURCES: { v: ModSource; l: string }[] = [
    { v: 'kick', l: 'Kick' },
    { v: 'snare', l: 'Snare' },
  ];
  const LFO_SOURCES: { v: ModSource; l: string; glyph: string }[] = [
    { v: 'lfo-sine', l: 'Sine', glyph: '∿' },
    { v: 'lfo-tri', l: 'Tri', glyph: '⋀' },
    { v: 'lfo-saw', l: 'Saw', glyph: '⊿' },
    { v: 'lfo-square', l: 'Square', glyph: '⊓' },
  ];
  /** Musical divisions for BPM-synced LFOs. `speed` is cycles per
   *  beat (engine: rate = speed × bpm/60), so 0.25 = one cycle per
   *  4 beats = 1 bar in 4/4. */
  const SYNC_RATES: { v: number; l: string }[] = [
    { v: 0.0625, l: '4 bars' },
    { v: 0.125, l: '2 bars' },
    { v: 0.25, l: '1 bar' },
    { v: 0.5, l: '1/2' },
    { v: 1, l: 'Beat' },
    { v: 2, l: '1/8' },
    { v: 4, l: '1/16' },
  ];

  function categoryOf(s: ModSource | 'auto'): Category {
    if (s === 'manual') return 'manual';
    if (s === 'auto') return 'auto';
    if (s.startsWith('lfo-')) return 'lfo';
    if (s === 'beatPhase') return 'sync';
    return 'audio';
  }

  $: category = auto ? 'auto' : categoryOf(source);
  $: isLfo = category === 'lfo';
  $: bpmSynced = mod?.bpmSync === true;
  $: depth = mod?.amount ?? 0.5;
  $: invert = mod?.invert ?? false;
  $: speed = mod?.speed ?? 1;
  $: bpm = $audioStore.manualBPM || $audioStore.bpm || 0;

  function pickCategory(c: Category) {
    if (c === category) return;
    if (c === 'manual') onSetSource('manual');
    else if (c === 'audio') onSetSource('bass');
    else if (c === 'lfo') onSetSource('lfo-sine');
    else if (c === 'sync') onSetSource('beatPhase');
    else if (c === 'auto') onSetSource('auto' as ModSource);
  }

  /** Nearest catalog rate for the current speed so the segmented
   *  control highlights sensibly even for legacy free values. */
  function nearestRate(v: number): number {
    let best = SYNC_RATES[0].v;
    for (const r of SYNC_RATES) {
      if (Math.abs(Math.log(r.v / v)) < Math.abs(Math.log(best / v))) best = r.v;
    }
    return best;
  }
  $: activeRate = nearestRate(speed);

  // ─── Live signal preview ──────────────────────────────────────────
  // Approximates what the engine feeds the param: smoothed visualAudio
  // for bands/onsets, a local clock for free LFOs, the shared
  // beat-phase for synced ones. Display-only.
  let signal = 0;
  let rafId: number | null = null;
  let lfoT0 = performance.now();

  function sampleSignal(): number {
    const v = getVisualAudioSnapshot();
    switch (source) {
      case 'sub': return v.sub;
      case 'bass': return v.bass;
      case 'lowMid': return v.lowMid;
      case 'mid': return v.mid;
      case 'highMid': return v.highMid;
      case 'treble': return v.treble;
      case 'air': return v.air;
      case 'presence': return v.presence;
      case 'high': return v.high;
      case 'amplitude': return v.level;
      case 'kick': return v.kick;
      case 'snare': return v.snare;
      case 'beatPhase': return v.beatPhase;
      default: {
        if (!source.startsWith('lfo-')) return 0;
        const rate = bpmSynced && v.bpm > 0 ? speed * (v.bpm / 60) : speed;
        const t = ((performance.now() - lfoT0) / 1000) * rate;
        const phase = t % 1;
        switch (source) {
          case 'lfo-sine': return Math.sin(phase * Math.PI * 2) * 0.5 + 0.5;
          case 'lfo-saw': return phase;
          case 'lfo-square': return phase < 0.5 ? 1 : 0;
          case 'lfo-tri': return phase < 0.5 ? phase * 2 : 2 - phase * 2;
          default: return 0;
        }
      }
    }
  }

  function tickPreview() {
    signal = Math.max(0, Math.min(1, sampleSignal()));
    rafId = requestAnimationFrame(tickPreview);
  }

  // ─── Fixed positioning from anchor rect ───────────────────────────
  let trayEl: HTMLDivElement | null = null;
  let top = 0;
  let left = 0;
  const WIDTH = 252;

  let flipped = false;

  function position() {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = trayEl?.offsetHeight ?? 320;
    left = Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8));
    // Below the chip by default; flip above when there's no room.
    flipped = r.bottom + 6 + h > window.innerHeight - 8;
    top = flipped ? Math.max(8, r.top - h - 6) : r.bottom + 6;
  }

  function onWindowPointerDown(e: PointerEvent) {
    const t = e.target as Node;
    if (trayEl?.contains(t)) return;
    if (anchor?.contains(t)) return;
    onClose();
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
  function onReflow() {
    position();
  }

  onMount(() => {
    position();
    // Re-measure after first paint (height depends on category section).
    requestAnimationFrame(position);
    tickPreview();
    window.addEventListener('pointerdown', onWindowPointerDown, true);
    window.addEventListener('keydown', onKeydown, true);
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
  });
  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    window.removeEventListener('pointerdown', onWindowPointerDown, true);
    window.removeEventListener('keydown', onKeydown, true);
    window.removeEventListener('resize', onReflow);
    window.removeEventListener('scroll', onReflow, true);
  });

  // Reposition when the content section changes height.
  $: if (category && trayEl) requestAnimationFrame(position);
</script>

<div
  class="mt"
  bind:this={trayEl}
  style="top:{top}px; left:{left}px; width:{WIDTH}px; transform-origin: {flipped ? 'bottom' : 'top'} right"
  role="dialog"
  aria-label="Modulation settings for {label}"
  in:scale={{ duration: 160, start: 0.94, opacity: 0, easing: quintOut }}
  out:scale={{ duration: 110, start: 0.96, opacity: 0 }}
>
  <div class="mt-head">
    <span class="mt-title" title={label}>{label}</span>
    <button class="mt-close" onclick={onClose} title="Close" aria-label="Close">✕</button>
  </div>

  <!-- Category row -->
  <div class="mt-cats">
    <button class:active={category === 'manual'} onclick={() => pickCategory('manual')}>Manual</button>
    <button class:active={category === 'audio'} class="cat-audio" onclick={() => pickCategory('audio')}>Audio</button>
    <button class:active={category === 'lfo'} class="cat-lfo" onclick={() => pickCategory('lfo')}>LFO</button>
    <button class:active={category === 'sync'} class="cat-sync" onclick={() => pickCategory('sync')}>Beat</button>
    {#if supportsAuto}
      <button class:active={category === 'auto'} class="cat-auto" onclick={() => pickCategory('auto')}>Auto</button>
    {/if}
  </div>

  {#if category === 'manual'}
    <div class="mt-hint">No modulation — the slider value is used as-is.</div>
  {/if}

  {#if category === 'audio'}
    <div class="mt-section-label">Band</div>
    <div class="mt-grid">
      {#each AUDIO_SOURCES as s (s.v)}
        <button class="mt-cell" class:active={source === s.v} onclick={() => onSetSource(s.v)}>{s.l}</button>
      {/each}
    </div>
    <div class="mt-section-label">Onsets — fire on the hit, decay smooth</div>
    <div class="mt-grid mt-grid-2">
      {#each ONSET_SOURCES as s (s.v)}
        <button class="mt-cell" class:active={source === s.v} onclick={() => onSetSource(s.v)}>{s.l}</button>
      {/each}
    </div>
  {/if}

  {#if category === 'lfo'}
    <div class="mt-section-label">Shape</div>
    <div class="mt-grid mt-grid-4">
      {#each LFO_SOURCES as s (s.v)}
        <button class="mt-cell" class:active={source === s.v} title={s.l} onclick={() => onSetSource(s.v)}>
          <span class="mt-glyph">{s.glyph}</span>{s.l}
        </button>
      {/each}
    </div>

    <label class="mt-check">
      <input type="checkbox" checked={bpmSynced} onchange={(e) => onPatchMod({ bpmSync: (e.target as HTMLInputElement).checked, speed: (e.target as HTMLInputElement).checked ? nearestRate(speed) : speed })} />
      <span>Sync to BPM {#if bpmSynced && bpm > 0}<em class="mt-bpm">{bpm.toFixed(0)}</em>{/if}</span>
    </label>

    {#if bpmSynced}
      <div class="mt-section-label">Rate</div>
      <div class="mt-grid mt-grid-rates">
        {#each SYNC_RATES as r (r.v)}
          <button class="mt-cell" class:active={activeRate === r.v} onclick={() => onPatchMod({ speed: r.v })}>{r.l}</button>
        {/each}
      </div>
      {#if bpm <= 0}
        <div class="mt-hint mt-warn">No BPM detected — tap tempo or enable audio. The LFO free-runs at the slider speed until then.</div>
      {/if}
    {:else}
      <div class="mt-row">
        <span class="mt-row-label">Speed</span>
        <input type="range" min="0.05" max="10" step="0.05" value={speed}
          oninput={(e) => onPatchMod({ speed: parseFloat((e.target as HTMLInputElement).value) })} />
        <span class="mt-row-val">{speed.toFixed(2)}Hz</span>
      </div>
    {/if}
  {/if}

  {#if category === 'sync'}
    <div class="mt-hint">Beat phase — a 0→1 ramp locked to each detected beat. Great for sweeps that restart on the pulse.</div>
  {/if}

  {#if (category === 'audio' || category === 'lfo' || category === 'sync')}
    <div class="mt-row">
      <span class="mt-row-label">Depth</span>
      <input type="range" min="0" max="1" step="0.01" value={depth}
        oninput={(e) => onPatchMod({ amount: parseFloat((e.target as HTMLInputElement).value) })} />
      <span class="mt-row-val">{(depth * 100).toFixed(0)}%</span>
    </div>
    <label class="mt-check">
      <input type="checkbox" checked={invert} onchange={(e) => onPatchMod({ invert: (e.target as HTMLInputElement).checked })} />
      <span>Invert response</span>
    </label>

    <!-- Live signal preview -->
    <div class="mt-meter" title="Live source signal">
      <div class="mt-meter-fill" style="width:{signal * 100}%"></div>
    </div>
  {/if}

  {#if category === 'auto' && auto}
    <div class="mt-auto">
      <div class="mt-row mt-auto-transport">
        <button class="mt-play" class:playing={auto.playing}
          onclick={() => onPatchAuto({ playing: !auto!.playing })}
          title={auto.playing ? 'Pause' : 'Play'}>{auto.playing ? '❚❚' : '▶'}</button>
        <div class="mt-mode">
          <button class:active={auto.mode === 'loop'} onclick={() => onPatchAuto({ mode: 'loop' })}>Loop</button>
          <button class:active={auto.mode === 'pingpong'} onclick={() => onPatchAuto({ mode: 'pingpong' })}>Ping-pong</button>
        </div>
      </div>
      <div class="mt-row">
        <span class="mt-row-label">Speed</span>
        <input type="range" min="0.01" max="1" step="0.005" value={auto.speedHz}
          oninput={(e) => onPatchAuto({ speedHz: parseFloat((e.target as HTMLInputElement).value) })} />
        <span class="mt-row-val">{auto.speedHz.toFixed(2)}Hz</span>
      </div>
      <div class="mt-hint">{autoHint}</div>
    </div>
  {/if}
</div>

<style>
  .mt {
    position: fixed;
    z-index: 4000;
    background: var(--bg-tertiary, #17171b);
    border: 1px solid rgba(255, 255, 255, 0.13);
    border-radius: 8px;
    padding: 10px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 13px;
    color: var(--text-primary, #ccc);
  }

  .mt-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .mt-title {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted, #999);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mt-close {
    background: transparent;
    border: none;
    color: var(--text-muted, #777);
    font-size: 13px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .mt-close:hover { color: #fff; background: rgba(255, 255, 255, 0.08); }

  /* Category segmented row */
  .mt-cats {
    display: flex;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 5px;
    overflow: hidden;
  }
  .mt-cats button {
    flex: 1;
    background: transparent;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.5);
    font-size: 12px;
    font-weight: 600;
    padding: 5px 0;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .mt-cats button:last-child { border-right: none; }
  .mt-cats button:hover { color: #fff; background: rgba(255, 255, 255, 0.05); }
  .mt-cats button.active { background: rgba(255, 255, 255, 0.12); color: #fff; }
  .mt-cats button.cat-audio.active { background: rgba(255, 0, 255, 0.18); color: #ff7af5; }
  .mt-cats button.cat-lfo.active { background: rgba(255, 159, 67, 0.18); color: #ffb86b; }
  .mt-cats button.cat-sync.active { background: rgba(244, 63, 94, 0.18); color: #fb7185; }
  .mt-cats button.cat-auto.active { background: rgba(92, 225, 230, 0.18); color: #5ce1e6; }

  .mt-section-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted, #777);
  }

  /* Source cells */
  .mt-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
  }
  .mt-grid-2 { grid-template-columns: repeat(2, 1fr); }
  .mt-grid-4 { grid-template-columns: repeat(4, 1fr); }
  .mt-grid-rates { grid-template-columns: repeat(4, 1fr); }
  .mt-cell {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 4px;
    color: rgba(255, 255, 255, 0.65);
    font-size: 12px;
    padding: 4px 2px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .mt-cell:hover { border-color: rgba(255, 255, 255, 0.3); color: #fff; }
  .mt-cell.active {
    background: rgba(255, 0, 255, 0.14);
    border-color: #ff00ff;
    color: #ff7af5;
  }
  .mt-glyph { font-size: 14px; line-height: 1; }

  /* Tune rows */
  .mt-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mt-row-label {
    flex: 0 0 42px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted, #888);
  }
  .mt-row input[type='range'] {
    flex: 1;
    accent-color: #ff00ff;
    min-width: 0;
  }
  .mt-row-val {
    flex: 0 0 46px;
    text-align: right;
    font-size: 12px;
    color: #ff7af5;
    font-variant-numeric: tabular-nums;
  }

  .mt-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    user-select: none;
  }
  .mt-check input[type='checkbox'] { accent-color: #ff00ff; margin: 0; cursor: pointer; }
  .mt-bpm {
    font-style: normal;
    color: #ff7af5;
    font-variant-numeric: tabular-nums;
    padding-left: 4px;
  }

  .mt-hint {
    font-size: 12px;
    line-height: 1.45;
    color: var(--text-muted, #888);
  }
  .mt-warn { color: #fbbf24; }

  /* Live signal meter */
  .mt-meter {
    height: 4px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }
  .mt-meter-fill {
    height: 100%;
    background: linear-gradient(to right, #ff00ff, #ff7af5);
    border-radius: 2px;
  }

  /* Auto transport */
  .mt-auto { display: flex; flex-direction: column; gap: 8px; }
  .mt-play {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: var(--text-primary, #ccc);
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .mt-play.playing { background: rgba(92, 225, 230, 0.18); border-color: #5ce1e6; color: #5ce1e6; }
  .mt-mode {
    display: flex;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    overflow: hidden;
  }
  .mt-mode button {
    background: transparent;
    border: none;
    padding: 3px 9px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    cursor: pointer;
  }
  .mt-mode button.active { background: rgba(92, 225, 230, 0.18); color: #5ce1e6; }
  .mt-auto .mt-row input[type='range'] { accent-color: #5ce1e6; }
  .mt-auto .mt-row-val { color: #5ce1e6; }
</style>
