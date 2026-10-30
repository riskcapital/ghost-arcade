<script lang="ts">
  /**
   * A rack module: a lit header with its title, controls and jacks, then the
   * panel. `lead` takes the title's place (tabs, say).
   */
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle = '',
    led = null,
    grow = false,
    lead,
    head,
    children,
    class: extra = '',
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
  } = $props();
</script>

<section class="module {extra}" class:grow>
  <div class="head">
    {#if led !== null}<span class="led" class:on={led}></span>{/if}
    {#if lead}{@render lead()}{:else}<h2>{title}</h2>{/if}
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
