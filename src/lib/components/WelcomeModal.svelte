<script lang="ts">
  // Welcome screen, shown on every launch. Offers the guided tour and the
  // starter templates but never starts either by itself: people who already
  // know VJ software go straight to a blank or saved project.
  import { onMount } from 'svelte';
  // The loading screen's wordmark (index.html inlines the same file).
  import wordmark from '$lib/brand/wordmark.svg?url';
  import BeamField from './BeamField.svelte';
  import { nativeRendererRuntime } from '$lib/stores/nativeRenderer';
  import { isDesktopApp } from '$lib/bridge';

  export let onClose: () => void = () => {};
  export let onTour: () => void = () => {};
  export let onTemplates: () => void = () => {};
  export let onOpenProject: () => void = () => {};
  export let onShowFromAudio: () => void = () => {};

  type Choice = { id: string; title: string; detail: string; run: () => void; primary?: boolean };
  const choices: Choice[] = [
    { id: 'tour', title: 'Show me around', detail: 'Short hands-on tours for VJ, projection mapping or music', run: () => onTour(), primary: true },
    { id: 'templates', title: 'Start from a template', detail: 'A deck already set up for a band, a club night, a light show or mapping', run: () => onTemplates() },
    { id: 'open', title: 'Open a project', detail: 'Carry on with a saved show', run: () => onOpenProject() },
    { id: 'song', title: 'Make a show to a song', detail: 'Pick a song and lay your looks over it', run: () => onShowFromAudio() },
    { id: 'blank', title: 'Blank project', detail: 'Straight in, nothing set up', run: () => {} },
  ];
  const blankChoice = choices[choices.length - 1];
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

  // The render core starts at launch too, and a first run spends a while
  // compiling its pipelines. The background waits until the core is up and
  // has finished warming up, so the two never compete for the GPU; until
  // then, or if the core never comes up, the screen keeps the field's plain
  // ground. On a software rasterizer it stays still.
  const CORE_SETTLE_MS = 2500;
  let fieldActive = !isDesktopApp;
  $: fieldStill = $nativeRendererRuntime.adapterIsSoftware;

  let ready = false;
  onMount(() => {
    requestAnimationFrame(() => { ready = true; });
    if (fieldActive) return;
    let settle = 0;
    const stopWatching = nativeRendererRuntime.subscribe((core) => {
      if (core.backendReady && !settle) settle = window.setTimeout(() => { fieldActive = true; }, CORE_SETTLE_MS);
    });
    return () => {
      stopWatching();
      clearTimeout(settle);
    };
  });

  function choose(choice: Choice) {
    onClose();
    choice.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const index = Number(e.key) - 1;
    if (index >= 0 && index < choices.length) {
      e.preventDefault();
      choose(choices[index]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      choose(blankChoice);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div data-help-page="getting-started" class="welcome" class:ready role="dialog" aria-modal="true" aria-labelledby="welcome-start-title">
  <BeamField active={fieldActive} still={fieldStill} />
  <div class="welcome-shade" aria-hidden="true"></div>

  <div class="welcome-content">
    <header class="welcome-brand">
      <h1 class="welcome-wordmark"><img src={wordmark} alt="Ghost Arcade" /></h1>
      {#if version}<p class="welcome-edition">Pro {version}</p>{/if}
    </header>

    <h2 id="welcome-start-title" class="welcome-start-title">How would you like to start?</h2>
    <div class="welcome-choices">
      {#each choices as choice, i (choice.id)}
        <button class="choice" class:primary={choice.primary} aria-keyshortcuts={String(i + 1)} onclick={() => choose(choice)}>
          <span class="choice-text">
            <span class="choice-title">{choice.title}</span>
            <span class="choice-detail">{choice.detail}</span>
          </span>
          <span class="choice-key" aria-hidden="true">{i + 1}</span>
        </button>
      {/each}
    </div>
    <p class="welcome-hint">The tour and templates are always under the ? button.</p>
  </div>
</div>

<style>
  .welcome {
    position: fixed;
    inset: 0;
    z-index: 20000;
    display: flex;
    padding: 48px 24px;
    box-sizing: border-box;
    overflow: auto;
    color: var(--text-primary, #eef0f4);
    /* The beam field's own ground, for the moment before it fades in and
       for machines where it does not run. */
    background: linear-gradient(180deg, #07080c 0%, #0b0d0f 100%);
  }

  /* Keeps the beams from washing out the text without boxing it in. */
  .welcome-shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse 36% 54% at 50% 50%, rgba(7, 8, 9, 0.74) 0%, rgba(7, 8, 9, 0.58) 52%, rgba(7, 8, 9, 0) 100%);
  }

  .welcome-content {
    position: relative;
    width: min(540px, 100%);
    margin: auto;
    opacity: 0;
    transition: opacity 0.5s ease 0.1s;
  }
  .ready .welcome-content { opacity: 1; }

  .welcome-brand { margin-bottom: 44px; }
  .welcome-wordmark {
    margin: 0;
    line-height: 0;
  }
  .welcome-wordmark img {
    display: block;
    width: 100%;
    height: auto;
  }
  .welcome-edition {
    margin: 12px 0 0;
    text-align: right;
    font-size: var(--ga-type-caption, 11px);
    color: var(--text-muted, #5e6571);
    font-variant-numeric: tabular-nums;
  }

  .welcome-start-title {
    margin: 0 0 10px;
    font-size: var(--ga-type-body, 13px);
    font-weight: var(--ga-font-ui-weight, 500);
    color: var(--text-secondary, #9aa0ac);
  }

  .welcome-choices { border-top: 1px solid var(--border-secondary, rgba(255, 255, 255, 0.12)); }

  .choice {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    margin: 0;
    padding: 13px 10px;
    border: 0;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.12s ease;
  }
  .choice:last-child { border-bottom-color: var(--border-secondary, rgba(255, 255, 255, 0.12)); }
  .choice:hover { background: rgba(255, 255, 255, 0.045); }
  .choice:focus-visible { outline-offset: -2px; }

  .choice-text {
    flex: 1;
    display: grid;
    gap: 3px;
    min-width: 0;
  }
  .choice-title {
    font-size: var(--ga-type-title, 14px);
    font-weight: 600;
    color: var(--text-primary, #eef0f4);
  }
  .choice.primary .choice-title { color: var(--accent-primary, #ff725f); }
  .choice-detail {
    font-size: var(--ga-type-control, 12px);
    line-height: 1.45;
    color: var(--text-secondary, #9aa0ac);
  }
  .choice-key {
    font-size: var(--ga-type-control, 12px);
    color: var(--text-muted, #5e6571);
    font-variant-numeric: tabular-nums;
  }
  .choice:hover .choice-key { color: var(--text-secondary, #9aa0ac); }

  .welcome-hint {
    margin: 16px 0 0;
    font-size: var(--ga-type-control, 12px);
    color: var(--text-muted, #5e6571);
  }

  @media (prefers-reduced-motion: reduce) {
    .welcome-content, .choice { transition: none; }
  }
</style>
