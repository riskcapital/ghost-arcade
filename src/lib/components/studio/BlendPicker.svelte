<script lang="ts" context="module">
  import { SWATCH_SIZE, swatchPixels, type BlendMode } from '../../mobile/studio/blendModes';
  // Each swatch is worked out once, from the same formula the output uses, and shared by every
  // picker. New ones are drawn a few per frame, so the sheet opens at once and fills in.
  const sources = new Map<BlendMode, HTMLCanvasElement>();
  const waiting: (() => void)[] = [];
  let scheduled = false;
  function source(mode: BlendMode): HTMLCanvasElement {
    let canvas = sources.get(mode);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = SWATCH_SIZE.width * 2;
      canvas.height = SWATCH_SIZE.height * 2;
      canvas.getContext('2d')?.putImageData(new ImageData(swatchPixels(mode, canvas.width, canvas.height), canvas.width, canvas.height), 0, 0);
      sources.set(mode, canvas);
    }
    return canvas;
  }
  function drain() {
    scheduled = false;
    const until = performance.now() + 6;
    while (waiting.length && performance.now() < until) waiting.shift()!();
    if (waiting.length) { scheduled = true; requestAnimationFrame(drain); }
  }
  /** Draws `mode`'s swatch into a canvas, now if it is ready, otherwise in the next frames. */
  function swatch(canvas: HTMLCanvasElement, mode: BlendMode) {
    let current = mode;
    const draw = () => {
      if (!canvas.isConnected) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source(current), 0, 0, canvas.width, canvas.height);
    };
    const request = () => {
      if (sources.has(current)) return draw();
      waiting.push(draw);
      if (!scheduled) { scheduled = true; requestAnimationFrame(drain); }
    };
    try { request(); } catch { /* no swatch; the name and line still say what it does */ }
    return { update(next: BlendMode) { current = next; try { request(); } catch { /* as above */ } } };
  }
  /** Keeps the sheet above every panel, whatever the panel it opens from clips or stacks. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<script lang="ts">
  /**
   * How a layer or surface mixes with what is beneath it. The button shows the current mode; it
   * opens a sheet of every mode on six shelves, each with a picture of what it does and one plain
   * line. A tap tries the mode on the output at once; Done closes the sheet.
   */
  import { onDestroy, tick } from 'svelte';
  import Icon from './StudioIcon.svelte';
  import { BLEND_DESCRIPTIONS, BLEND_GROUPS, blendLabel, normalizeBlend } from '../../mobile/studio/blendModes';

  export let value: string | undefined = 'normal';
  /** What the blend belongs to, for example "Layer 2" or "Left wall". */
  export let scope = '';
  /** A narrow button for the mixer strip: the mode's name only. */
  export let compact = false;
  export let disabled = false;
  /** Before each change, so each try is one undo step. */
  export let onstart: () => void = () => {};
  export let onchange: (mode: BlendMode) => void = () => {};
  /** When the sheet opens, before any mode is tried: a chance to get the shader ready. */
  export let onopen: () => void = () => {};

  let open = false;
  let trigger: HTMLButtonElement;
  let sheet: HTMLElement;
  $: current = normalizeBlend(value);
  $: title = scope ? `${scope} blend` : 'Blend';

  async function show() {
    if (disabled) return;
    open = true;
    onopen();
    await tick();
    (sheet?.querySelector<HTMLElement>(`[data-blend="${current}"]`) ?? sheet?.querySelector<HTMLElement>('[data-blend-done]'))?.focus({ preventScroll: false });
    sheet?.querySelector<HTMLElement>(`[data-blend="${current}"]`)?.scrollIntoView({ block: 'center' });
  }
  function close() {
    open = false;
    tick().then(() => trigger?.isConnected && trigger.focus({ preventScroll: true }));
  }
  function choose(mode: BlendMode) {
    if (mode === current) return;
    onstart();
    onchange(mode);
  }
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...sheet.querySelectorAll<HTMLElement>('button:not([disabled])')];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  onDestroy(() => { open = false; });
</script>

<button bind:this={trigger} class="blend-trigger" class:compact {disabled} type="button" aria-haspopup="dialog" aria-expanded={open}
  aria-label={`${title}: ${blendLabel(current)}. Change`} data-blend-trigger={current} onclick={show}>
  {#if !compact}<canvas class="mini" use:swatch={current} width="56" height="36" aria-hidden="true"></canvas>{/if}
  <span class="name">{blendLabel(current)}</span>
  {#if !compact}<svg class="chevron" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>{/if}
</button>

{#if open}
  <div class="scrim" use:portal role="presentation" onclick={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div class="blend-sheet" bind:this={sheet} role="dialog" tabindex="-1" aria-modal="true" aria-label={`${title}, ${blendLabel(current)}`} data-blend-picker onkeydown={key}>
      <header>
        <h2>Blend mode{#if scope}<small>{scope}</small>{/if}</h2>
        <button class="done" data-blend-done onclick={close}>Done</button>
      </header>
      <p class="intro">How it mixes with what is beneath it. Tap one to try it on the output.</p>
      <div class="scroll">
        {#each BLEND_GROUPS as group (group.id)}
          <section class="shelf" aria-labelledby={`blend-shelf-${group.id}`}>
            <h3 id={`blend-shelf-${group.id}`}>{group.label}<small>{group.hint}</small></h3>
            <div class="options">
              {#each group.modes as mode (mode)}
                <button class="option" class:active={mode === current} aria-pressed={mode === current} data-blend={mode}
                  aria-label={`${blendLabel(mode)}. ${BLEND_DESCRIPTIONS[mode]}`} onclick={() => choose(mode)}>
                  <canvas class="swatch" use:swatch={mode} width={SWATCH_SIZE.width * 2} height={SWATCH_SIZE.height * 2} aria-hidden="true"></canvas>
                  <span class="text"><strong>{blendLabel(mode)}</strong><small>{BLEND_DESCRIPTIONS[mode]}</small></span>
                  {#if mode === current}<span class="tick" aria-hidden="true"><Icon name="check" size={16} /></span>{/if}
                </button>
              {/each}
            </div>
          </section>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .blend-trigger {
    display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; min-height: 44px; padding: 0 10px 0 8px;
    font: inherit; font-size: 16px; font-weight: 500; text-align: left; color: var(--ga-ink-0);
    background: var(--ga-slot, var(--ga-hardware-bg)); border: 1px solid var(--ga-line-2); border-radius: 8px;
    cursor: pointer; touch-action: manipulation;
  }
  .blend-trigger:disabled { opacity: .5; cursor: default; }
  .blend-trigger:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  .blend-trigger .mini { flex: none; width: 28px; height: 18px; border-radius: 3px; }
  .blend-trigger .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .blend-trigger .chevron { flex: none; color: var(--ga-ink-2); }
  .blend-trigger.compact { width: 100%; min-height: 40px; justify-content: center; padding: 0 4px; font-size: 11px; text-align: center; margin-top: 5px; border-radius: 5px; }

  .scrim { position: fixed; inset: 0; z-index: 70; display: flex; align-items: flex-end; justify-content: center; background: #0006; }
  .blend-sheet {
    display: flex; flex-direction: column; min-height: 0; width: min(100%, 720px); max-height: min(64dvh, 760px);
    padding: 10px max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
    border: 1px solid var(--ga-line-3); border-bottom: 0; border-radius: 14px 14px 0 0;
    background: var(--ga-inspector-bg, var(--ga-panel)); color: var(--ga-ink-0); font-family: inherit;
    animation: rise .18s ease-out;
  }
  @keyframes rise { from { transform: translateY(24px); opacity: 0; } }
  .blend-sheet button { font: inherit; color: var(--ga-ink-0); background: var(--ga-hardware-bg); border: 1px solid var(--ga-line-2); border-radius: 6px; touch-action: manipulation; cursor: pointer; }
  .blend-sheet button:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin: 0; font-size: 18px; font-weight: 600; }
  h2 small { font-size: 12px; font-weight: 500; color: var(--ga-ink-1); }
  .done { flex: none; min-width: 72px; min-height: 44px; padding: 0 14px; font-weight: 650; }
  .intro { flex: none; margin: 6px 2px 8px; font-size: 12px; line-height: 1.4; color: var(--ga-ink-1); }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding-bottom: 14px; margin-bottom: env(safe-area-inset-bottom); }
  .shelf { margin: 0 0 12px; }
  h3 { display: flex; align-items: baseline; gap: 8px; margin: 0 2px 6px; font-size: 12px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--ga-ink-1); }
  h3 small { font-size: 11px; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--ga-ink-2); }
  .options { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 6px; }
  .option { position: relative; display: grid; grid-template-columns: 56px minmax(0, 1fr); align-items: center; gap: 10px; min-height: 56px; padding: 8px 30px 8px 8px; text-align: left; }
  .option.active { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); }
  .swatch { display: block; width: 56px; height: 36px; border-radius: 4px; border: 1px solid var(--ga-line-2); box-sizing: border-box; }
  .text { display: grid; gap: 2px; min-width: 0; }
  .text strong { font-size: 13px; font-weight: 600; line-height: 1.2; }
  .text small { font-size: 11px; line-height: 1.35; color: var(--ga-ink-1); }
  .tick { position: absolute; top: 8px; right: 8px; color: var(--ga-selection-ink, var(--ga-ink-0)); }
  /* Wide screens: a floating sheet, still low, so the output above it stays in view. */
  @media (min-width: 700px) {
    .blend-sheet { margin-bottom: max(16px, env(safe-area-inset-bottom)); border-bottom: 1px solid var(--ga-line-3); border-radius: 14px; padding-bottom: 4px; }
  }
  /* The output stays in view above the sheet on a phone held upright; a short landscape screen gets more list. */
  @media (max-height: 520px) { .blend-sheet { max-height: 90dvh; } }
  @media (prefers-reduced-motion: reduce) { .blend-sheet { animation: none; } }
</style>
