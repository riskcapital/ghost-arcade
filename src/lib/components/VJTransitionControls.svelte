<script lang="ts">
  import { numericExpression } from '../utils/numericExpression';
  import type { CrossfaderTransition } from '../stores/vjClipLauncher';

  export let duration: number | undefined = undefined;
  export let style: CrossfaderTransition | undefined = undefined;
  export let inheritedDuration = 0;
  export let inheritedStyle: CrossfaderTransition = 'dissolve';
  export let clipOverride = false;
  export let contextKey = '';
  let draftContext = contextKey;
  export let onChange: (patch: { duration?: number | null; style?: CrossfaderTransition | null }) => void;
  const styles: [CrossfaderTransition, string][] = [
    ['dissolve', 'Dissolve'], ['wipe', 'Wipe'], ['rgb-split', 'RGB split'],
    ['cube', 'Cube'], ['shatter', 'Shatter'], ['halftone', 'Halftone'],
    ['glitch', 'Glitch'], ['liquid', 'Liquid'], ['strobe', 'Strobe'], ['slide', 'Slide'],
  ];
  $: useLayerDuration = clipOverride && duration === undefined;
  $: effectiveDuration = duration ?? (clipOverride ? inheritedDuration : 0);
  $: effectiveStyle = style ?? (clipOverride ? inheritedStyle : 'dissolve');

  let editingDuration = false;
  let durationDraft = '';
  let durationError = '';
  $: if (draftContext !== contextKey) {
    draftContext = contextKey; editingDuration = false; durationError = '';
  }
  $: if (!editingDuration) durationDraft = String(effectiveDuration);
  $: if (useLayerDuration) { editingDuration = false; durationError = ''; }

  function commitDuration(blurred = false): boolean {
    if (draftContext !== contextKey) { editingDuration = false; return true; }
    if (!editingDuration || useLayerDuration) return true;
    const value = numericExpression(durationDraft);
    if (value === null) {
      durationError = 'Enter a number or expression, such as 1/2. Duration unchanged.';
      if (blurred) editingDuration = false;
      return false;
    }
    editingDuration = false;
    durationError = '';
    const next = Math.max(0, Math.min(10, value));
    durationDraft = String(next);
    onChange({ duration: next });
    return true;
  }
  function durationKey(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (commitDuration()) (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      editingDuration = false;
      durationError = '';
      durationDraft = String(effectiveDuration);
      (event.currentTarget as HTMLInputElement).blur();
    }
  }
  function changeDuration(event: Event) {
    if (useLayerDuration) return;
    editingDuration = false;
    durationError = '';
    const value = (event.target as HTMLInputElement).valueAsNumber;
    if (Number.isFinite(value)) onChange({ duration: Math.max(0, Math.min(10, value)) });
  }
</script>

<section data-help-page="clip-launcher" class="transition-controls" aria-label={clipOverride ? 'Clip transition' : 'Layer transition'}>
  <h4>Transition</h4>
  {#if clipOverride}
    <label class="inherit">
      <input type="checkbox" checked={useLayerDuration}
        onchange={(event) => onChange({ duration: event.currentTarget.checked ? null : inheritedDuration })} />
      Use layer duration ({inheritedDuration.toFixed(2)} s)
    </label>
  {/if}
  <div class="duration-row">
    <label for={clipOverride ? 'clip-transition-duration' : 'layer-transition-duration'}>Duration</label>
    <input id={clipOverride ? 'clip-transition-duration' : 'layer-transition-duration'}
      aria-label={clipOverride ? 'Clip transition duration' : 'Layer transition duration'}
      type="text" inputmode="text" maxlength="256" bind:value={durationDraft}
      title="Seconds or expression (0–10), e.g. 1/2; Enter applies, Escape cancels"
      aria-invalid={!!durationError} disabled={useLayerDuration}
      onfocus={() => { editingDuration = true; durationError = ''; }}
      oninput={() => { editingDuration = true; durationError = ''; }}
      onblur={() => commitDuration(true)} onkeydown={durationKey} />
    <span>s</span>
  </div>
  {#if durationError}<p class="duration-error" role="status">{durationError}</p>{/if}
  <input data-help="Set the time to blend from the outgoing clip to the incoming clip. Zero seconds cuts immediately." class="duration-slider" type="range" min="0" max="10" step="0.05"
    aria-label={clipOverride ? 'Clip transition duration slider' : 'Layer transition duration slider'}
    value={effectiveDuration} disabled={useLayerDuration} oninput={changeDuration} />
  <label class="style-row">
    Style
    <select data-help="Choose the visual transition between clips. A clip can inherit the layer transition style." aria-label={clipOverride ? 'Clip transition style' : 'Layer transition style'}
      value={clipOverride ? style ?? '' : effectiveStyle}
      onchange={(event) => onChange({ style: (event.currentTarget.value || null) as CrossfaderTransition | null })}>
      {#if clipOverride}
        <option value="">Use layer ({styles.find(([id]) => id === inheritedStyle)?.[1] ?? 'Dissolve'})</option>
      {/if}
      {#each styles as [id, label]}
        <option value={id}>{label}</option>
      {/each}
    </select>
  </label>
  <p>{effectiveDuration === 0 ? 'Instant cut.' : `Blend into ${clipOverride ? "this" : "the next"} clip over ${effectiveDuration.toFixed(2)} seconds.`}</p>
</section>

<style>
  /* A flat section with an eyebrow, like the rest of the layer and clip settings. */
  .transition-controls { margin: 0; padding: 10px 12px 12px; border: 0; border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); background: transparent; }
  h4 { margin: 0 0 8px; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); line-height: 1.2; color: var(--ga-ink-2, #89857e); }
  .duration-row, .style-row { display: flex; align-items: center; gap: 8px; min-height: var(--ga-control-h, 26px); font-size: var(--ga-text-control, 12px); line-height: 1.4; color: var(--ga-ink-1, #ada9a2); }
  .duration-row label, .style-row select { flex: 1; }
  .duration-row span { color: var(--ga-ink-2, #89857e); }
  input[type="text"] { width: 62px; text-align: right; font-variant-numeric: tabular-nums; }
  input[type="text"], select { min-width: 0; height: var(--ga-control-h, 26px); box-sizing: border-box; padding: 0 8px; font: inherit; color: var(--ga-ink-0, #f2ede4); background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); }
  .duration-slider { width: 100%; margin: 8px 0 10px; accent-color: var(--ga-selection-line, var(--ga-blue-500)); }
  .inherit { display: flex; align-items: center; gap: 8px; min-height: var(--ga-control-h, 26px); margin-bottom: 6px; font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1, #ada9a2); }
  p { margin: 8px 0 0; font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--ga-ink-2, #89857e); }
  .duration-error { color: #e0b29d; }
  input[aria-invalid="true"] { border-color: #c88d74; }
  input:focus-visible { outline: 2px solid var(--ga-focus, var(--ga-blue-300)); outline-offset: 2px; }
  input:disabled { opacity: .45; }
</style>
