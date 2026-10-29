<script lang="ts">
  /** A rack module: a lit header with its title, controls and jacks, then the panel. */
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle = '',
    led = null,
    grow = false,
    head,
    children,
    class: extra = '',
  }: {
    title: string;
    subtitle?: string;
    /** null: no light; false: dark; true: lit. */
    led?: boolean | null;
    grow?: boolean;
    head?: Snippet;
    children: Snippet;
    class?: string;
  } = $props();
</script>

<section class="module {extra}" class:grow>
  <div class="head">
    {#if led !== null}<span class="led" class:on={led}></span>{/if}
    <h2>{title}</h2>
    {#if subtitle}<span class="subtitle">{subtitle}</span>{/if}
    <span class="spacer"></span>
    {#if head}{@render head()}{/if}
  </div>
  <div class="panel">
    {@render children()}
  </div>
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
  .head {
    flex: 0 0 auto;
    height: 36px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 9px;
    border-bottom: 1px solid var(--studio-edge-soft);
    white-space: nowrap;
  }
  h2 { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: 0.16em; }
  .subtitle { color: var(--studio-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
  .spacer { flex: 1; }
  .led { width: 8px; height: 8px; border-radius: 50%; background: var(--studio-edge); flex: 0 0 auto; }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 8px var(--studio-accent); }
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }
</style>
