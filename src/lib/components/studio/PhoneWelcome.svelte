<script lang="ts">
  // The phone's welcome screen: the desktop welcome's look (the website's beam field, the
  // loading wordmark, plain rows with blue line icons) with the phone's three ways in.
  // It owns nothing; a choice hands the path to the studio and the screen goes away, taking
  // its WebGL context with it.
  import { onMount } from 'svelte';
  import wordmark from '$lib/brand/wordmark.svg?url';
  import BeamField from '../BeamField.svelte';
  import type { LaunchPath } from '../../mobile/studio/launchIntent';
  import { allowMappingRotation } from '../../mobile/studio/captureToolkit';

  export let onchoose: (path: LaunchPath) => void = () => {};

  type Choice = { id: LaunchPath; title: string; detail: string };
  const choices: Choice[] = [
    { id: 'vj', title: 'VJ', detail: 'Play clips and effects live, with the mixer' },
    { id: 'mapping', title: 'Mapping', detail: 'Fit visuals to walls and objects with a projector' },
    { id: 'control', title: 'Mobile Control', detail: 'Pair with the desktop app and control its show' },
  ];

  let ready = false;
  let leaving = false;
  // Portrait puts the light high on the left like the desktop; landscape moves it overhead so
  // the shafts fall between the wordmark and the rows instead of behind the text.
  let landscape = false;
  $: sweep = landscape ? 0.42 : 0.3;

  onMount(() => {
    const orientation = window.matchMedia('(orientation: landscape)');
    const sync = () => { landscape = orientation.matches; };
    sync();
    orientation.addEventListener('change', sync);
    requestAnimationFrame(() => { ready = true; });
    // The phone app is held upright outside Map; the welcome screen may turn. The studio sets
    // its own rule again once it opens, so the lock goes back on as this screen leaves.
    void allowMappingRotation(true);
    return () => {
      orientation.removeEventListener('change', sync);
      release();
    };
  });

  // The lock goes back on the moment a path is picked, before the studio states its own rule
  // (Mapping allows rotation), so the studio's call is always the later one.
  let released = false;
  function release() {
    if (released) return;
    released = true;
    void allowMappingRotation(false);
  }

  function choose(choice: Choice) {
    if (leaving) return;
    leaving = true;
    release();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // The fade is short; the studio only starts once the field has stopped drawing.
    window.setTimeout(() => onchoose(choice.id), reduce ? 0 : 220);
  }
</script>

<div class="welcome" class:ready class:leaving role="dialog" aria-modal="true" aria-labelledby="phone-welcome-title" data-phone-welcome>
  <BeamField active={!leaving} {sweep} />
  <div class="shade" aria-hidden="true"></div>

  <div class="content">
    <div class="group">
    <header class="brand">
      <h1 class="wordmark"><img src={wordmark} alt="Ghost Arcade" /></h1>
      <p class="edition">Mobile</p>
    </header>

    <section class="start">
      <h2 id="phone-welcome-title" class="start-title">How would you like to start?</h2>
      <div class="choices">
        {#each choices as choice (choice.id)}
          <button class="choice" data-choice={choice.id} onclick={() => choose(choice)}>
            <!-- Drawn in the wordmark's language, like the desktop's rows: hairline traces,
                 square nodes and round taps. -->
            <svg class="choice-icon" viewBox="0 0 32 32" aria-hidden="true">
              {#if choice.id === 'vj'}
                <!-- a bank of clips over a crossfader -->
                <path d="M4 6.5h6.5v6.5H4zM12.75 6.5h6.5v6.5h-6.5zM21.5 6.5H28v6.5h-6.5z" />
                <path class="solid" d="M14.75 7.9v3.7l3.1-1.85z" />
                <path d="M4 22h24" />
                <rect class="solid" x="17.25" y="18.75" width="3.5" height="6.5" />
              {:else if choice.id === 'mapping'}
                <!-- a projector throwing onto a surface seen at an angle, pinned at its corners -->
                <path d="M14 7.5 27 10v12l-13 2.5z" />
                <path d="M7.6 15 14 7.5M7.6 17 14 24.5" />
                <circle cx="5" cy="16" r="2.6" />
                <rect class="solid" x="12.25" y="5.75" width="3.5" height="3.5" />
                <rect class="solid" x="25.25" y="8.25" width="3.5" height="3.5" />
                <rect class="solid" x="25.25" y="20.25" width="3.5" height="3.5" />
                <rect class="solid" x="12.25" y="22.75" width="3.5" height="3.5" />
              {:else}
                <!-- the phone, linked to the desktop it drives -->
                <path d="M4 5h9v22H4z" />
                <path d="M8.5 9.5v9" />
                <rect class="solid" x="6.75" y="11.25" width="3.5" height="3.5" />
                <circle class="solid" cx="8.5" cy="23" r="1.5" />
                <path d="M18 8h11v9H18zM23.5 17v4M20.5 21h6" />
                <path d="M13 12.5h5" />
                <circle class="solid" cx="15.5" cy="12.5" r="1.3" />
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
    </section>
    </div>
  </div>
</div>

<style>
  .welcome {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    /* Safe areas first, then the desktop's breathing room scaled to a phone. */
    padding:
      calc(env(safe-area-inset-top, 0px) + 20px)
      calc(env(safe-area-inset-right, 0px) + 20px)
      calc(env(safe-area-inset-bottom, 0px) + 16px)
      calc(env(safe-area-inset-left, 0px) + 20px);
    box-sizing: border-box;
    overflow: auto;
    overscroll-behavior: none;
    color: #eef0f4;
    font-family: var(--ga-font-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    -webkit-tap-highlight-color: transparent;
    -webkit-user-select: none;
    user-select: none;
    /* The beam field's own ground, for the moment before it fades in. */
    background: linear-gradient(180deg, #07080c 0%, #0b0d0f 100%);
    transition: opacity 0.22s ease;
  }
  .welcome.leaving { opacity: 0; pointer-events: none; }

  /* Keeps the beams from washing out the text without boxing it in. Wider than the desktop's,
     since the content takes most of a phone's width. */
  .shade {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(ellipse 75% 50% at 50% 50%, rgba(7, 8, 9, 0.74) 0%, rgba(7, 8, 9, 0.56) 55%, rgba(7, 8, 9, 0) 100%);
  }

  .content {
    position: relative;
    display: flex;
    flex-direction: column;
    /* The mark, the question and the rows are one group, centred in the screen. */
    justify-content: center;
    width: min(520px, 100%);
    min-height: 100%;
    padding-block: 34px;
    box-sizing: border-box;
    margin: 0 auto;
    opacity: 0;
    transition: opacity 0.5s ease 0.1s;
  }
  .ready .content { opacity: 1; }

  .group { display: flex; flex-direction: column; }
  .brand { margin-bottom: 28px; }
  .wordmark { margin: 0; line-height: 0; }
  .wordmark img { display: block; width: 100%; height: auto; }
  .edition {
    margin: 10px 0 0;
    text-align: right;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: #5e6571;
  }

  .start-title {
    margin: 0 0 12px;
    font-size: 20px;
    line-height: 1.25;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #eef0f4;
  }

  .choices { border-top: 1px solid rgba(255, 255, 255, 0.12); }

  .choice {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    min-height: 76px;
    margin: 0;
    padding: 14px 6px 14px 4px;
    border: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background-color 0.12s ease;
    touch-action: manipulation;
  }
  .choice:last-child { border-bottom-color: rgba(255, 255, 255, 0.12); }
  .choice:active { background: rgba(255, 255, 255, 0.06); }

  .choice-icon {
    flex: 0 0 auto;
    width: 38px;
    height: 38px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.75;
    stroke-linecap: square;
    /* The desktop's icon blue (--ga-icon), the same as the phone's own icons. */
    color: var(--ga-icon, #5278ff);
  }
  .choice-icon .solid { fill: currentColor; stroke: none; }

  .choice-text { flex: 1; display: grid; gap: 3px; min-width: 0; }
  .choice-title {
    font-size: 18px;
    line-height: 1.25;
    font-weight: 700;
    letter-spacing: -0.005em;
    color: #eef0f4;
  }
  .choice-detail { font-size: 13.5px; line-height: 1.4; color: #9aa0ac; }

  .choice-arrow {
    flex: 0 0 auto;
    width: 24px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: square;
    color: #5e6571;
    transition: color 0.12s ease, transform 0.18s ease;
  }
  /* The row under the finger is the one place the coral shows, as on the desktop. */
  .choice:is(:active, :focus-visible) .choice-arrow { color: var(--accent-primary, #ff725f); transform: translateX(3px); }


  /* A phone on its side is too short for the stack: the mark on the left, the rows on the
     right, both centred in the height. Taller landscape screens keep the stack. */
  @media (orientation: landscape) and (max-height: 600px) {
    .content { width: min(900px, 100%); }
    .group {
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: clamp(24px, 6vw, 64px);
    }
    .brand { flex: 1 1 0; margin-bottom: 0; max-width: 380px; }
    .start { flex: 1 1 0; max-width: 420px; }
    .shade { background: radial-gradient(ellipse 60% 75% at 50% 50%, rgba(7, 8, 9, 0.74) 0%, rgba(7, 8, 9, 0.56) 55%, rgba(7, 8, 9, 0) 100%); }
    .choice { min-height: 64px; padding-block: 10px; }
    .start-title { font-size: 18px; margin-bottom: 8px; }
  }

  /* Short portrait screens (iPhone SE): a little tighter. */
  @media (orientation: portrait) and (max-height: 700px) {
    .brand { margin-bottom: 22px; }
    .choice { min-height: 68px; padding-block: 10px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .welcome, .content, .choice, .choice-arrow { transition: none; }
    .choice:is(:active, :focus-visible) .choice-arrow { transform: none; }
  }
</style>
