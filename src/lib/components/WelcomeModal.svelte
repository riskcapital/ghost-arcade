<script lang="ts">
  // Welcome screen, shown on every launch. Picking up a saved show or
  // starting blank come first, since that is where most launches go; the
  // guided tour, the starter templates and a show built around a song follow.
  // None of them starts by itself.
  import { onMount } from 'svelte';
  // The loading screen's wordmark (index.html inlines the same file).
  import wordmark from '$lib/brand/wordmark.svg?url';
  import BeamField from './BeamField.svelte';

  export let onClose: () => void = () => {};
  export let onTour: () => void = () => {};
  export let onTemplates: () => void = () => {};
  export let onOpenProject: () => void = () => {};
  export let onShowFromAudio: () => void = () => {};

  type Choice = { id: 'open' | 'blank' | 'tour' | 'templates' | 'song'; title: string; detail: string; run: () => void };
  const choices: Choice[] = [
    { id: 'open', title: 'Open a project', detail: 'Carry on with a saved show', run: () => onOpenProject() },
    { id: 'blank', title: 'Blank project', detail: 'Straight in, nothing set up', run: () => {} },
    { id: 'tour', title: 'Show me around', detail: 'Short hands-on tours for VJ, projection mapping or music', run: () => onTour() },
    { id: 'templates', title: 'Start from a template', detail: 'A deck already set up for a band, a club night, a light show or mapping', run: () => onTemplates() },
    { id: 'song', title: 'Make a show to a song', detail: 'Pick a song and lay your looks over it', run: () => onShowFromAudio() },
  ];
  const blankChoice = choices.find((choice) => choice.id === 'blank')!;
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

  let ready = false;
  onMount(() => { requestAnimationFrame(() => { ready = true; }); });

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
  <BeamField />
  <div class="welcome-shade" aria-hidden="true"></div>

  <div class="welcome-content">
    <header class="welcome-brand">
      <h1 class="welcome-wordmark"><img src={wordmark} alt="Ghost Arcade" /></h1>
      {#if version}<p class="welcome-edition">Studio {version}</p>{/if}
    </header>

    <h2 id="welcome-start-title" class="welcome-start-title">How would you like to start?</h2>
    <div class="welcome-choices">
      {#each choices as choice, i (choice.id)}
        <button class="choice" data-choice={choice.id} aria-keyshortcuts={String(i + 1)} onclick={() => choose(choice)}>
          <!-- Drawn in the wordmark's language: hairline traces, square
               nodes and round taps. -->
          <svg class="choice-icon" viewBox="0 0 32 32" aria-hidden="true">
            {#if choice.id === 'open'}
              <!-- a saved show, picked up where it was left -->
              <path d="M4 8h8l3 3h13v14H4z" />
              <path class="solid" d="M14 14.5v7l6-3.5z" />
            {:else if choice.id === 'blank'}
              <!-- an empty surface with its four corner pins -->
              <path d="M6 8h20v16H6z" />
              <path d="M16 13v6M13 16h6" />
              <rect class="solid" x="4.25" y="6.25" width="3.5" height="3.5" />
              <rect class="solid" x="24.25" y="6.25" width="3.5" height="3.5" />
              <rect class="solid" x="4.25" y="22.25" width="3.5" height="3.5" />
              <rect class="solid" x="24.25" y="22.25" width="3.5" height="3.5" />
            {:else if choice.id === 'tour'}
              <!-- a route through waypoints to where you are going -->
              <path d="M7 26v-7l6-6h7l4-4" />
              <rect class="solid" x="5.25" y="24.25" width="3.5" height="3.5" />
              <circle class="solid" cx="13" cy="13" r="1.7" />
              <circle class="solid" cx="20" cy="13" r="1.7" />
              <circle cx="26" cy="7" r="2.8" />
            {:else if choice.id === 'templates'}
              <!-- a deck with clips already loaded -->
              <path d="M4 8.5h6v6H4zM13 8.5h6v6h-6zM22 8.5h6v6h-6zM4 17.5h6v6H4zM13 17.5h6v6h-6zM22 17.5h6v6h-6z" />
              <rect class="solid" x="5.75" y="10.25" width="2.5" height="2.5" />
              <rect class="solid" x="23.75" y="10.25" width="2.5" height="2.5" />
              <rect class="solid" x="14.75" y="19.25" width="2.5" height="2.5" />
            {:else}
              <!-- a song, with looks laid along its beats -->
              <path d="M7 11v4M10 8v10M13 6v14M16 10v6M19 7v12M22 11v4M25 9v8" />
              <path d="M4 26h24" />
              <rect class="solid" x="6.25" y="24.25" width="3.5" height="3.5" />
              <rect class="solid" x="14.25" y="24.25" width="3.5" height="3.5" />
              <rect class="solid" x="22.25" y="24.25" width="3.5" height="3.5" />
            {/if}
          </svg>
          <span class="choice-text">
            <span class="choice-title">{choice.title}</span>
            <span class="choice-detail">{choice.detail}</span>
          </span>
          <svg class="choice-arrow" viewBox="0 0 30 16" aria-hidden="true"><path d="M2 8h25M20 1.5 26.5 8 20 14.5" /></svg>
        </button>
      {/each}
    </div>
    <footer class="welcome-hint">
      <span>The tour and templates are always under the ? button.</span>
      <span>Keys 1–5 pick a row, Esc starts blank.</span>
    </footer>
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
    background: radial-gradient(ellipse 38% 56% at 50% 50%, rgba(7, 8, 9, 0.76) 0%, rgba(7, 8, 9, 0.6) 52%, rgba(7, 8, 9, 0) 100%);
  }

  .welcome-content {
    position: relative;
    /* The loading screen's wordmark width, so the mark stays the same size. */
    width: min(620px, 100%);
    margin: auto;
    opacity: 0;
    transition: opacity 0.5s ease 0.1s;
  }
  .ready .welcome-content { opacity: 1; }

  .welcome-brand { margin-bottom: 40px; }
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
    margin: 0 0 14px;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: var(--text-primary, #eef0f4);
  }

  .welcome-choices { border-top: 1px solid var(--border-secondary, rgba(255, 255, 255, 0.12)); }

  .choice {
    display: flex;
    align-items: center;
    gap: 18px;
    width: 100%;
    margin: 0;
    padding: 16px 14px 16px 12px;
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

  .choice-icon {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: square;
    /* The deep royal blue of the toolbar's Stage and sim icons and the layer menu. */
    color: var(--ga-icon, #5278ff);
    transition: color 0.12s ease;
  }
  .choice-icon .solid {
    fill: currentColor;
    stroke: none;
  }

  .choice-text {
    flex: 1;
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .choice-title {
    font-size: 17px;
    line-height: 1.25;
    font-weight: 700;
    letter-spacing: -0.005em;
    color: var(--text-primary, #eef0f4);
  }
  .choice-detail {
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-secondary, #9aa0ac);
  }

  .choice-arrow {
    flex: 0 0 auto;
    width: 26px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: square;
    color: var(--text-muted, #5e6571);
    transition: color 0.12s ease, transform 0.18s ease;
  }

  /* The row being pointed at is the one place the accent shows. */
  .choice:is(:hover, :focus-visible) .choice-arrow { color: var(--accent-primary, #ff725f); }
  .choice:is(:hover, :focus-visible) .choice-arrow { transform: translateX(4px); }

  .welcome-hint {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 4px 24px;
    margin: 16px 0 0;
    font-size: var(--ga-type-control, 12px);
    color: var(--text-muted, #5e6571);
  }

  @media (prefers-reduced-motion: reduce) {
    .welcome-content, .choice, .choice-icon, .choice-arrow { transition: none; }
    .choice:is(:hover, :focus-visible) .choice-arrow { transform: none; }
  }
</style>
