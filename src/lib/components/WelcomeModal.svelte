<script lang="ts">
  // Welcome screen — every fresh launch. Offers the guided tour and the
  // starter templates but never starts either by itself: people who already
  // know VJ software go straight to a blank or saved project.
  import { onMount } from 'svelte';

  export let onClose: () => void = () => {};
  export let onTour: () => void = () => {};
  export let onTemplates: () => void = () => {};
  export let onOpenProject: () => void = () => {};

  type Choice = { id: string; title: string; detail: string; run: () => void; primary?: boolean };
  const choices: Choice[] = [
    { id: 'tour', title: 'Show me around', detail: 'Short hands-on tours for VJ, projection mapping or music', run: () => onTour(), primary: true },
    { id: 'templates', title: 'Start from a template', detail: 'A deck already set up for a band, a club night, a light show or mapping', run: () => onTemplates() },
    { id: 'open', title: 'Open a project', detail: 'Carry on with a saved show', run: () => onOpenProject() },
    { id: 'blank', title: 'Blank project', detail: 'Straight in, nothing set up', run: () => {} },
  ];

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
      choose(choices[3]);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div data-help-page="getting-started" class="welcome" class:ready role="dialog" aria-modal="true" aria-labelledby="welcome-title">
  <!-- Stage-light backdrop: a few slow beams and haze, drawn once in SVG. -->
  <svg class="welcome-stage" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="wb-beam-a" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8fb4ff" stop-opacity="0.8" />
        <stop offset="1" stop-color="#8fb4ff" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="wb-beam-b" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#c58bff" stop-opacity="0.7" />
        <stop offset="1" stop-color="#c58bff" stop-opacity="0" />
      </linearGradient>
      <linearGradient id="wb-beam-c" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#5ee6d0" stop-opacity="0.55" />
        <stop offset="1" stop-color="#5ee6d0" stop-opacity="0" />
      </linearGradient>
      <radialGradient id="wb-haze" cx="0.5" cy="1" r="0.8">
        <stop offset="0" stop-color="#3a4d8f" stop-opacity="0.45" />
        <stop offset="1" stop-color="#05060a" stop-opacity="0" />
      </radialGradient>
      <filter id="wb-soft"><feGaussianBlur stdDeviation="14" /></filter>
    </defs>
    <rect width="1600" height="900" fill="#05060a" />
    <rect width="1600" height="900" fill="url(#wb-haze)" />
    <g filter="url(#wb-soft)" style="mix-blend-mode: screen">
      <polygon class="beam beam-1" points="300,-20 340,-20 760,920 420,920" fill="url(#wb-beam-a)" />
      <polygon class="beam beam-2" points="800,-20 830,-20 1080,920 640,920" fill="url(#wb-beam-b)" />
      <polygon class="beam beam-3" points="1290,-20 1325,-20 1150,920 820,920" fill="url(#wb-beam-c)" />
      <polygon class="beam beam-4" points="560,-20 585,-20 260,920 40,920" fill="url(#wb-beam-b)" />
      <polygon class="beam beam-5" points="1060,-20 1085,-20 1560,920 1300,920" fill="url(#wb-beam-a)" />
    </g>
    <g class="fixtures" fill="#0d1018" stroke="#2a3142" stroke-width="2">
      <rect x="296" y="-6" width="48" height="22" rx="4" />
      <rect x="556" y="-6" width="34" height="18" rx="4" />
      <rect x="796" y="-6" width="40" height="20" rx="4" />
      <rect x="1056" y="-6" width="34" height="18" rx="4" />
      <rect x="1286" y="-6" width="44" height="22" rx="4" />
    </g>
  </svg>
  <div class="welcome-vignette" aria-hidden="true"></div>

  <div class="welcome-card">
    <section class="welcome-hero">
      <img src="{import.meta.env.BASE_URL}icon-new.png" alt="" class="welcome-mark" />
      <p class="welcome-eyebrow">Welcome to Ghost Arcade</p>
      <h1 id="welcome-title" class="welcome-title">Light up the room.</h1>
      <p class="welcome-lede">Live visuals, projection mapping and stage lighting, from your first clip to a full show.</p>
      <ul class="welcome-points">
        <li>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
          <span>Plays to the beat of the band</span>
        </li>
        <li>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3z" /><path d="M9 4v13M15 7v13" /></svg>
          <span>Maps onto stages, walls and objects</span>
        </li>
        <li>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
          <span>Drives every projector and screen</span>
        </li>
      </ul>
    </section>

    <section class="welcome-start">
      <h2 class="welcome-start-title">How would you like to start?</h2>
      <div class="welcome-choices">
        {#each choices as choice, i (choice.id)}
          <button class="choice" class:primary={choice.primary} style="--i:{i}" onclick={() => choose(choice)}>
            <span class="choice-icon" aria-hidden="true">
              {#if choice.id === 'tour'}
                <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg>
              {:else if choice.id === 'templates'}
                <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><path d="M17.25 14v6.5M14 17.25h6.5" /></svg>
              {:else if choice.id === 'open'}
                <svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" /><path d="M3 7v11a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L22 12H7.5a2 2 0 0 0-1.9 1.4L3 20" /></svg>
              {:else}
                <svg viewBox="0 0 24 24"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M12 12v6M9 15h6" /></svg>
              {/if}
            </span>
            <span class="choice-text">
              <span class="choice-title">{choice.title}</span>
              <span class="choice-detail">{choice.detail}</span>
            </span>
            <kbd class="choice-key" aria-hidden="true">{i + 1}</kbd>
            <svg class="choice-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        {/each}
      </div>
      <p class="welcome-hint">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" /></svg>
        The tour and templates are always under the ? button.
      </p>
    </section>
  </div>
</div>

<style>
  .welcome {
    position: fixed;
    inset: 0;
    z-index: 20000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    box-sizing: border-box;
    overflow: auto;
    color: #e9edf5;
    background: #05060a;
  }

  .welcome-stage {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 1.2s ease;
  }
  .ready .welcome-stage { opacity: 1; }
  .beam {
    transform-box: view-box;
    animation: sweep 9s ease-in-out infinite alternate;
  }
  .beam-1 { transform-origin: 320px 0; animation-duration: 11s; }
  .beam-2 { transform-origin: 815px 0; animation-duration: 8s; animation-delay: -3s; }
  .beam-3 { transform-origin: 1307px 0; animation-duration: 10s; animation-delay: -6s; }
  .beam-4 { transform-origin: 572px 0; animation-duration: 13s; animation-delay: -2s; }
  .beam-5 { transform-origin: 1072px 0; animation-duration: 12s; animation-delay: -8s; }
  @keyframes sweep {
    from { transform: rotate(-7deg); }
    to { transform: rotate(7deg); }
  }

  .welcome-vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at 50% 45%, rgba(5, 6, 10, 0) 0%, rgba(5, 6, 10, 0.55) 72%, rgba(5, 6, 10, 0.9) 100%);
    pointer-events: none;
  }

  .welcome-card {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1.08fr;
    width: min(980px, 100%);
    border-radius: 20px;
    overflow: hidden;
    background: rgba(13, 15, 21, 0.72);
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow:
      0 40px 120px rgba(0, 0, 0, 0.65),
      0 0 0 1px rgba(143, 180, 255, 0.04) inset;
    backdrop-filter: blur(22px) saturate(1.2);
    opacity: 0;
    transform: translateY(14px) scale(0.985);
    transition: opacity 0.6s ease 0.15s, transform 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) 0.15s;
  }
  .ready .welcome-card { opacity: 1; transform: none; }

  .welcome-hero {
    position: relative;
    padding: 44px 40px 40px;
    background:
      radial-gradient(120% 90% at 0% 0%, rgba(143, 180, 255, 0.16), transparent 60%),
      radial-gradient(90% 70% at 100% 100%, rgba(197, 139, 255, 0.12), transparent 65%);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
  }
  .welcome-mark {
    width: 64px;
    height: 64px;
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(60, 90, 255, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.08);
    margin-bottom: 26px;
  }
  .welcome-eyebrow {
    margin: 0 0 10px;
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--ga-blue-200, #a8bcff);
  }
  .welcome-title {
    margin: 0 0 14px;
    font-size: 40px;
    line-height: 1.2;
    /* Gradient text is clipped to the line box; leave room for the g. */
    padding-bottom: 0.08em;
    font-weight: 750;
    letter-spacing: -0.02em;
    background: linear-gradient(180deg, #ffffff 0%, #c9d4ee 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .welcome-lede {
    margin: 0 0 30px;
    max-width: 34ch;
    font-size: 14px;
    line-height: 1.6;
    color: #a9b2c4;
  }
  .welcome-points {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
  }
  .welcome-points li {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 13px;
    color: #c8cfdc;
  }
  .welcome-points svg {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    padding: 7px;
    box-sizing: border-box;
    border-radius: 9px;
    background: rgba(143, 180, 255, 0.09);
    border: 1px solid rgba(143, 180, 255, 0.16);
    fill: none;
    stroke: var(--ga-blue-200, #a8bcff);
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .welcome-start {
    padding: 40px 36px 30px;
    display: flex;
    flex-direction: column;
  }
  .welcome-start-title {
    margin: 0 0 18px;
    font-size: 15px;
    font-weight: 650;
    color: #e9edf5;
  }
  .welcome-choices {
    display: grid;
    gap: 10px;
  }

  .choice {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 14px;
    width: 100%;
    padding: 14px 14px 14px 14px;
    text-align: left;
    font: inherit;
    color: inherit;
    border-radius: 13px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.025);
    cursor: pointer;
    opacity: 0;
    transform: translateX(10px);
    transition:
      opacity 0.45s ease calc(0.35s + var(--i) * 0.07s),
      transform 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) calc(0.35s + var(--i) * 0.07s),
      background 0.15s, border-color 0.15s, box-shadow 0.15s;
  }
  .ready .choice { opacity: 1; transform: none; }
  .choice:hover, .choice:focus-visible {
    background: rgba(143, 180, 255, 0.07);
    border-color: rgba(143, 180, 255, 0.35);
    outline: none;
  }
  .choice:focus-visible { box-shadow: 0 0 0 3px rgba(143, 180, 255, 0.25); }
  .choice.primary {
    background: linear-gradient(135deg, rgba(110, 145, 255, 0.24), rgba(170, 120, 255, 0.16));
    border-color: rgba(143, 180, 255, 0.45);
    box-shadow: 0 10px 34px rgba(80, 110, 255, 0.18);
  }
  .choice.primary:hover { border-color: rgba(170, 200, 255, 0.8); }

  .choice-icon {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    border-radius: 11px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .choice.primary .choice-icon {
    background: linear-gradient(135deg, #7d9bff, #b48cff);
    border-color: transparent;
    box-shadow: 0 6px 18px rgba(110, 120, 255, 0.45);
  }
  .choice-icon svg {
    width: 21px;
    height: 21px;
    fill: none;
    stroke: #c9d4ee;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .choice.primary .choice-icon svg { stroke: #0b0f1d; stroke-width: 2; }

  .choice-text { display: grid; gap: 3px; min-width: 0; }
  .choice-title { font-size: 14px; font-weight: 650; color: #f1f4fa; }
  .choice-detail { font-size: 12px; line-height: 1.45; color: #98a1b3; }

  .choice-key {
    font: 600 11px/1 ui-monospace, 'SF Mono', Menlo, monospace;
    color: #7f889b;
    padding: 4px 7px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.03);
  }
  .choice-chevron {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: #6f788a;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform 0.15s, stroke 0.15s;
  }
  .choice:hover .choice-chevron { transform: translateX(3px); stroke: #c9d4ee; }

  .welcome-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: auto 0 0;
    padding-top: 22px;
    font-size: 12px;
    color: #7f889b;
  }
  .welcome-hint svg {
    width: 15px;
    height: 15px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  @media (max-width: 820px) {
    .welcome-card { grid-template-columns: 1fr; }
    .welcome-hero { border-right: none; border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding: 30px 26px 26px; }
    .welcome-title { font-size: 32px; }
    .welcome-start { padding: 26px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .beam { animation: none; }
    .welcome-card, .choice, .welcome-stage { transition: none; }
  }
</style>
