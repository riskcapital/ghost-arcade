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
    ['dissolve', 'Dissolve'], ['wipe', 'Wipe'], ['rgb-split', 'RGB Split'],
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
  .transition-controls { margin: 10px 0 12px; padding: 12px; border: 1px solid var(--ga-line-2, #303540); border-radius: var(--ga-r-soft, 8px); background: var(--ga-card, #16191f); }
  h4 { margin: 0 0 12px; font-size: var(--ga-type-caption, 11px); font-weight: 650; text-transform: uppercase; letter-spacing: .06em; color: var(--ga-ink-1, #adb3bf); }
  .duration-row, .style-row { display: flex; align-items: center; gap: 8px; font-size: var(--ga-type-control, 12px); line-height: 1.4; }
  .duration-row label, .style-row select { flex: 1; }
  .duration-row span { color: var(--ga-ink-1, #adb3bf); }
  input[type="text"] { width: 62px; text-align: right; font-variant-numeric: tabular-nums; }
  input[type="text"], select { min-width: 0; min-height: 30px; box-sizing: border-box; padding: 5px 8px; font: inherit; color: var(--ga-ink-0, #eef0f4); background: var(--ga-slot, #101218); border: 1px solid var(--ga-line-2, #303540); border-radius: var(--ga-r-hard, 5px); }
  .duration-slider { width: 100%; margin: 10px 0 12px; accent-color: var(--ga-selection-line, #3d59b8); }
  .inherit { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; font-size: var(--ga-type-control, 12px); }
  p { margin: 10px 0 0; font-size: var(--ga-type-caption, 11px); line-height: 1.45; color: var(--ga-ink-1, #adb3bf); }
  .duration-error { color: #e0b29d; }
  input[aria-invalid="true"] { border-color: #c88d74; }
  input:focus-visible { outline: 2px solid var(--ga-focus, #7996ff); outline-offset: 2px; }
  input:disabled { opacity: .45; }
</style>
