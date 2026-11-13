<script lang="ts">
  /**
   * Templates: ready-made maps with a visual on every surface, shown as pictures the app renders
   * itself (each template's stage with its visuals projected on it). Below them, the blank layouts
   * that used to sit in the Layouts menu. Choosing either replaces this set's surfaces; undo brings
   * them back.
   */
  import { onDestroy, onMount } from 'svelte';
  import Icon from './StudioIcon.svelte';
  import { MAPPING_TEMPLATES } from '../../mobile/studio/stageScenes';
  import { cachedStage, renderStages, type StageShot } from '../../mobile/studio/stageRenderer';

  export let onapply: (id: string) => void = () => {};
  export let onlayout: (preset: 'split' | 'triptych' | 'paint-box') => void = () => {};
  export let onclose: () => void = () => {};

  const shot = (template: string): StageShot => ({ template, width: 480, height: 270, content: true });
  let pictures: Record<string, string | null | undefined> = Object.fromEntries(MAPPING_TEMPLATES.map((t) => [t.id, cachedStage(shot(t.id))]));
  let root: HTMLElement;
  let returnFocus: HTMLElement | null = null;
  let alive = true;

  const LAYOUTS = [
    { id: 'split' as const, name: 'Two panels', blurb: 'Two screens side by side', panels: [[4, 12, 44, 76], [52, 12, 44, 76]] },
    { id: 'triptych' as const, name: 'Triptych', blurb: 'Three screens in a row', panels: [[4, 12, 29, 76], [35.5, 12, 29, 76], [67, 12, 29, 76]] },
    { id: 'paint-box' as const, name: 'Paint box', blurb: 'Three linked faces for Paint', panels: [] },
  ];

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled])')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  onMount(() => {
    returnFocus = document.activeElement as HTMLElement | null;
    root.querySelector<HTMLElement>('[data-gallery-close]')?.focus({ preventScroll: true });
    // One at a time, so each picture appears as soon as it is ready.
    void (async () => {
      for (const template of MAPPING_TEMPLATES) {
        if (!alive || pictures[template.id]) continue;
        const [url] = await renderStages([shot(template.id)]);
        if (alive) pictures = { ...pictures, [template.id]: url };
      }
    })();
  });
  onDestroy(() => {
    alive = false;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  });
</script>

<div class="gallery" bind:this={root} role="dialog" tabindex="-1" aria-modal="true" aria-label="Templates" data-template-gallery onkeydown={key}>
  <header>
    <button class="back" data-gallery-close aria-label="Close templates and go back to Map" onclick={onclose}><Icon name="left" size={18} />Map</button>
    <h2>Templates<small>Surfaces placed, a visual on each, moving to the music.</small></h2>
  </header>
  <div class="scroll">
    <p class="lead">Pick the one closest to your object, then drag its corners onto it. Your current surfaces are replaced; Undo brings them back.</p>
    <div class="grid">
      {#each MAPPING_TEMPLATES as template (template.id)}
        <button class="card" data-template={template.id} aria-label={`${template.name}: ${template.blurb}. ${template.surfaces.length} surfaces.`} onclick={() => onapply(template.id)}>
          <span class="picture" class:ready={!!pictures[template.id]}>
            {#if pictures[template.id]}<img src={pictures[template.id]} alt="" />{:else if pictures[template.id] === null}<span class="fallback">{template.name}</span>{/if}
          </span>
          <span class="text"><strong>{template.name}</strong><small>{template.blurb} · {template.surfaces.length} surfaces</small></span>
        </button>
      {/each}
    </div>
    <h3>Blank layouts</h3>
    <div class="layouts">
      {#each LAYOUTS as layout (layout.id)}
        <button class="layout" data-layout-preset={layout.id} onclick={() => onlayout(layout.id)}>
          <span class="diagram" aria-hidden="true">
            {#if layout.panels.length}{#each layout.panels as [x, y, w, h]}<i style:left={`${x}%`} style:top={`${y}%`} style:width={`${w}%`} style:height={`${h}%`}></i>{/each}
            {:else}<b class="top"></b><b class="left"></b><b class="right"></b>{/if}
          </span>
          <span class="text"><strong>{layout.name}</strong><small>{layout.blurb}</small></span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .gallery {
    position: fixed; inset: 0; z-index: 55; display: flex; flex-direction: column; min-height: 0;
    padding: max(10px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
    background: var(--ga-void); color: var(--ga-ink-0);
  }
  button { font: inherit; color: var(--ga-ink-0); background: var(--ga-hardware-bg); border: 1px solid var(--ga-line-2); border-radius: 6px; touch-action: manipulation; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  header { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 12px; margin-bottom: 8px; }
  .back { display: flex; align-items: center; gap: 4px; min-height: 44px; padding: 0 14px 0 8px; font-size: 13px; }
  h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin: 0; font-size: 18px; font-weight: 600; line-height: 1.2; }
  h2 small { font-size: 12px; font-weight: 500; color: var(--ga-ink-1); }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding-bottom: 16px; margin-bottom: env(safe-area-inset-bottom); }
  .lead { margin: 2px 2px 12px; font-size: 13px; line-height: 1.45; color: var(--ga-ink-1); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .card { display: grid; padding: 0; overflow: hidden; text-align: left; background: var(--ga-card); }
  .picture { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; background: linear-gradient(110deg, #0c0c10 30%, #17171d 50%, #0c0c10 70%) 0 0 / 300% 100%; animation: shimmer 1.6s linear infinite; }
  .picture.ready { animation: none; background: #000; }
  .picture img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
  .fallback { position: absolute; inset: 0; display: grid; place-items: center; font-size: 12px; color: var(--ga-ink-1); }
  .text { display: grid; gap: 2px; padding: 7px 9px 9px; min-width: 0; }
  .text strong { font-size: 14px; font-weight: 600; line-height: 1.2; }
  .text small { font-size: 12px; line-height: 1.3; color: var(--ga-ink-1); }
  h3 { margin: 18px 2px 8px; font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--ga-ink-1); }
  .layouts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  .layout { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: center; gap: 4px; min-height: 60px; padding: 6px; text-align: left; }
  .layout .text { padding: 0 4px; }
  .diagram { position: relative; display: block; width: 72px; aspect-ratio: 16 / 9; border-radius: 4px; background: #050507; overflow: hidden; }
  .diagram i, .diagram b { position: absolute; display: block; background: linear-gradient(160deg, #e9e6df, #8d8a84); box-shadow: 0 0 6px #fff3; }
  .diagram .top { left: 34%; top: 10%; width: 32%; height: 34%; transform: skewX(-20deg); }
  .diagram .left { left: 24%; top: 44%; width: 26%; height: 48%; transform: skewY(20deg); opacity: .8; }
  .diagram .right { left: 50%; top: 44%; width: 26%; height: 48%; transform: skewY(-20deg); opacity: .65; }
  @keyframes shimmer { to { background-position: -300% 0; } }
  @media (prefers-reduced-motion: reduce) { .picture { animation: none; } }
  @media (min-width: 700px) {
    .gallery { padding-left: max(24px, env(safe-area-inset-left)); padding-right: max(24px, env(safe-area-inset-right)); }
    .grid { grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
  }
</style>
