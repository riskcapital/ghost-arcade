<script lang="ts">
  /**
   * The selected block on an LED row: what it shows (Follow the stage, LED
   * effect, Colour, Gradient, Chase, Look), its colours, pattern and params,
   * speed and brightness, timing and fades, its where line, and ◆ buttons
   * that start a control line for a value at the playhead.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import { LED_BLOCK_KINDS, type LedBlockKind, type TimelineLedClip } from '../../../timeline/leds/ledClips';
  import { getWLEDPatternDefinition, WLED_PATTERN_CATALOG, WLED_PATTERN_CATEGORIES } from '../../../wled/effects';
  import { LOOK_PALETTES, type Rgba } from '../../../looks/edgeLooks';
  import { addLineAtPlayhead } from '../../../timeline/lines/timelineLines';
  import { ledBlockParams } from '../../../timeline/lines/paramRegistry';
  import WhereEditor from './WhereEditor.svelte';
  import { LED_KIND_LABELS, ledRows } from './ledRowsUi';

  interface Props {
    clip: TimelineLedClip;
    onclose: () => void;
  }
  let { clip, onclose }: Props = $props();

  const rowName = $derived($ledRows.find((r) => r.id === clip.rowId)?.name ?? 'LED row');
  const def = $derived(clip.kind === 'effect' ? getWLEDPatternDefinition(clip.pattern ?? 'chase') : null);
  const params = $derived(def ? { ...def.params, ...(clip.params ?? {}) } : {});
  const lineParams = $derived(ledBlockParams(clip).filter((p) => !p.key.startsWith('ledblock:param:')));
  const css = (c: Rgba) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

  function patch(p: Partial<TimelineLedClip>, continuous = false) {
    showTimeline.updateLedClip(clip.id, p, { discrete: !continuous });
  }
  function commit(e: Event, apply: (v: number) => void) {
    const input = e.currentTarget as HTMLInputElement;
    apply(parseFloat(input.value));
  }
  function setKind(kind: LedBlockKind) {
    patch({ kind, ...(kind === 'effect' && !clip.pattern ? { pattern: 'comet', speed: 0.5 } : {}), ...(kind === 'chase' && !clip.speed ? { speed: 0.5 } : {}) });
  }
</script>

<div class="show-inspector" data-led-inspector>
  <span class="insp-title">LED block · {rowName}</span>
  <label class="insp-field">
    <span>Shows</span>
    <select value={clip.kind} onchange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as LedBlockKind)} data-led-kind>
      {#each LED_BLOCK_KINDS as k (k)}<option value={k}>{LED_KIND_LABELS[k]}</option>{/each}
    </select>
  </label>
  {#if clip.kind === 'effect'}
    <label class="insp-field">
      <span>Pattern</span>
      <select class="wide" value={clip.pattern ?? 'chase'} onchange={(e) => patch({ pattern: (e.currentTarget as HTMLSelectElement).value as TimelineLedClip['pattern'], params: undefined })} data-led-pattern>
        {#each WLED_PATTERN_CATEGORIES as cat (cat.id)}
          <optgroup label={cat.label}>
            {#each WLED_PATTERN_CATALOG.filter((p) => p.category === cat.id) as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
          </optgroup>
        {/each}
      </select>
    </label>
    {#each Object.entries(params) as [name, value] (name)}
      <label class="insp-field" title={`Pattern control: ${name}`}>
        <span>{name}</span>
        <input type="range" min="0" max={name === 'colorCount' ? 4 : 1} step="0.01" value={value}
          oninput={(e) => patch({ params: { ...(clip.params ?? {}), [name]: parseFloat((e.currentTarget as HTMLInputElement).value) } }, true)} />
      </label>
    {/each}
  {/if}
  {#if clip.kind === 'look'}
    <span class="insp-palettes" role="radiogroup" aria-label="Colors">
      {#each LOOK_PALETTES as p (p.id)}
        <button type="button" role="radio" class="insp-palette" class:on={(clip.paletteId ?? 'neon') === p.id} aria-checked={(clip.paletteId ?? 'neon') === p.id}
          title={p.name} aria-label={`${p.name} colors`} onclick={() => patch({ paletteId: p.id })}>
          {#each p.colors as c, i (i)}<span style:background={css(c)}></span>{/each}
        </button>
      {/each}
    </span>
  {/if}
  {#if clip.kind !== 'follow' && clip.kind !== 'look'}
    <label class="insp-field"><span>Color</span><input type="color" value={clip.color} onchange={(e) => patch({ color: (e.currentTarget as HTMLInputElement).value })} data-led-color /></label>
  {/if}
  {#if clip.kind === 'gradient' || clip.kind === 'effect'}
    <label class="insp-field"><span>Second</span><input type="color" value={clip.color2} onchange={(e) => patch({ color2: (e.currentTarget as HTMLInputElement).value })} data-led-color2 /></label>
  {/if}
  {#if clip.kind !== 'follow' && clip.kind !== 'colour'}
    <label class="insp-field" title={clip.kind === 'effect' ? 'The pattern\'s speed' : 'Cycles a second (0 = still)'}>
      <span>Speed</span>
      <input type="number" min="0" max="8" step="0.05" value={clip.speed.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ speed: Math.max(0, v || 0) }))} data-led-speed />
    </label>
  {/if}
  {#if clip.kind === 'chase'}
    <label class="insp-field"><span>Width</span><input type="range" min="0.01" max="1" step="0.01" value={clip.width} oninput={(e) => patch({ width: parseFloat((e.currentTarget as HTMLInputElement).value) }, true)} /></label>
  {/if}
  {#if clip.kind === 'effect'}
    <label class="insp-field"><span>Amount</span><input type="range" min="0" max="1" step="0.01" value={clip.amount} oninput={(e) => patch({ amount: parseFloat((e.currentTarget as HTMLInputElement).value) }, true)} /></label>
  {/if}
  <label class="insp-field">
    <span>Brightness</span>
    <input type="range" min="0" max="1" step="0.01" value={clip.brightness} oninput={(e) => patch({ brightness: parseFloat((e.currentTarget as HTMLInputElement).value) }, true)} data-led-brightness />
  </label>
  <WhereEditor where={clip.where} target={{ scope: 'block', id: clip.id }} members={['leds']} onchange={(where) => patch({ where })} />
  <span class="insp-lines" role="group" aria-label="Control lines for this LED block">
    {#each lineParams as p (p.key)}
      <button type="button" class="insp-line" onclick={() => addLineAtPlayhead({ scope: 'block', id: clip.id }, p.key)}
        title={`◆ ${p.label}: a point at the playhead on this block's line`} data-line-key={p.key} data-line-scope="block" data-line-target={clip.id}>◆ {p.label.replace('LED ', '')}</button>
    {/each}
  </span>
  <label class="insp-field"><span>Start</span><input type="number" min="0" step="0.1" value={clip.startTime.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ startTime: Math.max(0, v || 0) }))} /><span class="insp-unit">s</span></label>
  <label class="insp-field"><span>Length</span><input type="number" min="0.1" step="0.1" value={clip.duration.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ duration: Math.max(0.1, v || 0) }))} data-led-length /><span class="insp-unit">s</span></label>
  <label class="insp-field"><span>Fade in</span><input type="number" min="0" step="0.1" value={clip.fadeIn.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ fadeIn: Math.max(0, v || 0) }))} /><span class="insp-unit">s</span></label>
  <label class="insp-field"><span>Fade out</span><input type="number" min="0" step="0.1" value={clip.fadeOut.toFixed(2)} onchange={(e) => commit(e, (v) => patch({ fadeOut: Math.max(0, v || 0) }))} /><span class="insp-unit">s</span></label>
  <span class="insp-hint">Between blocks this row is dark.</span>
  <button class="insp-delete" onclick={() => showTimeline.removeLedClip(clip.id)} data-led-delete>Delete</button>
  <button aria-label="Close LED block inspector" class="insp-close" onclick={onclose}>×</button>
</div>

<style>
  .show-inspector {
    display: flex; align-items: center; gap: 8px 12px; min-height: 36px; padding: 4px 12px; flex: 0 0 auto; flex-wrap: wrap;
    background: var(--ga-card, #121217); border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1, #bbb);
  }
  .insp-title { color: #ff9f43; font-weight: var(--ga-weight-control, 600); padding-right: 12px; border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-field input[type="number"], .insp-field select {
    height: var(--ga-control-h-sm, 22px); background: var(--ga-slot, rgba(255, 255, 255, 0.04)); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px); color: var(--ga-ink-0, #e8e8e8); font-size: var(--ga-text-control, 12px); padding: 0 6px; width: 64px; outline: none; font-family: inherit;
  }
  .insp-field select { width: 120px; }
  .insp-field select.wide { width: 140px; }
  .insp-field input[type="range"] { width: 70px; }
  .insp-field input[type="color"] { width: 28px; height: 20px; padding: 0; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); background: none; }
  .insp-unit, .insp-hint { color: var(--ga-ink-2, #888); }
  .insp-hint { font-size: var(--ga-text-meta, 11px); }
  .insp-palettes { display: flex; gap: 3px; }
  .insp-palette { display: flex; height: 22px; box-sizing: border-box; align-items: center; padding: 3px; gap: 1px; border-radius: 3px; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); background: var(--ga-slot, #0b0b0f); cursor: pointer; }
  .insp-palette span { width: 6px; height: 100%; border-radius: 1px; }
  .insp-palette.on { border-color: var(--ga-selection-line, #5278ff); box-shadow: 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .insp-lines { display: inline-flex; flex-wrap: wrap; gap: 3px; }
  .insp-line { background: var(--ga-sunk, #0c0c10); border: 1px solid rgba(255, 217, 107, 0.4); color: rgba(255, 217, 107, 0.85); border-radius: 3px; font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
  .insp-delete {
    margin-left: auto; height: 22px; background: transparent; border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4757) 40%, transparent);
    color: var(--ga-rec, #FF4757); font-size: 12px; font-weight: 600; padding: 0 10px; border-radius: 3px; cursor: pointer; font-family: inherit;
  }
  .insp-close { background: none; border: none; color: var(--ga-ink-2, #888); font-size: 16px; cursor: pointer; padding: 2px 6px; line-height: 1; }
</style>
