<script lang="ts">
  /**
   * A rack module: a lit header with its title, controls and jacks, then the
   * panel. `lead` takes the title's place (tabs, say). In a side rack the
   * header folds the panel away (remembered per module), so a short window
   * can make room for the module that matters now.
   */
  import type { Snippet } from 'svelte';

  const FOLD_KEY = 'ga.studio.folded';
  function readFolded(): Set<string> {
    try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]')); } catch { return new Set(); }
  }

  let {
    title,
    subtitle = '',
    led = null,
    grow = false,
    lead,
    head,
    children,
    class: extra = '',
    foldKey = '',
  }: {
    title: string;
    subtitle?: string;
    /** null: no light; false: dark; true: lit. */
    led?: boolean | null;
    grow?: boolean;
    lead?: Snippet;
    head?: Snippet;
    children: Snippet;
    class?: string;
    /** Names the module for folding; defaults to its title. */
    foldKey?: string;
  } = $props();

  const key = $derived(foldKey || title);
  let folded = $state(false);
  $effect(() => { folded = !!key && readFolded().has(key); });
  function toggleFold() {
    folded = !folded;
    try {
      const all = readFolded();
      if (folded) all.add(key); else all.delete(key);
      localStorage.setItem(FOLD_KEY, JSON.stringify([...all]));
    } catch { /* folding still works for this session */ }
  }
</script>

<section class="module {extra}" class:grow class:folded>
  <div class="head">
    {#if key}
      <button class="fold" onclick={toggleFold} aria-expanded={!folded} aria-label={folded ? `Open ${key}` : `Fold ${key} away`} title={folded ? 'Open this panel' : 'Fold this panel away to make room'}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d={folded ? 'M4.5 3l3 3-3 3' : 'M3 4.5l3 3 3-3'} /></svg>
      </button>
    {/if}
    {#if led !== null}<span class="led" class:on={led}></span>{/if}
    {#if lead}{@render lead()}{:else if title}<h2>{title}</h2>{/if}
    {#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
    <span class="spacer"></span>
    {#if head}{@render head()}{/if}
  </div>
  {#if !folded}
    <div class="panel">
      {@render children()}
    </div>
  {/if}
</section>

<style>
  .module {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
  }
  .module.grow { flex: 1; }
  .module.folded, .module.grow.folded { flex: 0 0 auto !important; min-height: 0 !important; }
  .module.folded .head { border-bottom: 0; }
  /* The fold arrow only shows in the side racks, where modules stack. */
  .fold { display: none; }
  :global(.rack) .fold {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    margin-left: -4px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--studio-muted);
    cursor: pointer;
  }
  :global(.rack) .fold:hover { color: var(--studio-ink); }
  .fold svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .head {
    flex: 0 0 auto;
    height: 32px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    gap: var(--ga-space-2, 6px);
    border-bottom: 1px solid var(--studio-edge-soft);
    white-space: nowrap;
  }
  /* The module's name is its faceplate eyebrow: the app's eyebrow, in the face's ink. */
  h2 {
    margin: 0;
    font-family: var(--studio-title-font, inherit);
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    line-height: 1.2;
    text-transform: uppercase;
    color: var(--studio-ink);
  }
  .subtitle { min-width: 0; color: var(--studio-muted); font-size: var(--ga-text-meta, 11px); overflow: hidden; text-overflow: ellipsis; }
  .spacer { flex: 1; }
  .led { width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); flex: 0 0 auto; }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 8px var(--studio-accent); }
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 10px 10px;
  }
</style>
