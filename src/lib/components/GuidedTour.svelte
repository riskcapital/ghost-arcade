<script lang="ts">
  // Guided tour — a short, hands-on walk through playing the first visuals.
  // Each step points at the real control and the app stays fully usable
  // underneath: the dimming is drawn by the highlight ring and ignores the
  // pointer, so the user can do each step themselves. Opened only from the
  // welcome screen or the "?" overlay, never by itself.
  import { onDestroy, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { onboarding } from '$lib/stores/onboarding';
  import { vjClipLauncher } from '$lib/stores/vjClipLauncher';
  import { addLibraryShaderToDeck } from '$lib/onboarding/templates';

  type TourStep = {
    title: string;
    body: string;
    /** First selector that matches a visible element is highlighted. */
    targets?: string[];
    action?: { label: string; run: () => void | Promise<void> };
  };

  const steps: TourStep[] = [
    {
      title: 'Play your first visuals',
      body: 'This tour shows you how to put visuals on the deck, play them and get them onto your projector. It takes about two minutes, and every step can be skipped. Press Esc to leave at any time.',
    },
    {
      title: 'Your visuals',
      body: 'Shaders, videos, images and live inputs live in the Media Library. Drag any of them onto an empty cell in the deck. You can also drop video files straight from your computer onto a row.',
      targets: ['.right-panel-vj'],
      action: {
        label: 'Add one for me',
        run: async () => {
          const state = get(vjClipLauncher);
          if (!state.clipGrid[0]?.[0]) await addLibraryShaderToDeck('STAGE-BeamRig', 0, 0);
        },
      },
    },
    {
      title: 'Play a clip',
      body: 'Click a clip to play it. Clicking another clip in the same row switches to it — each row plays one clip at a time.',
      targets: ['.layer-row .clip-cell.has-clip', '.layer-row .clip-cell'],
      action: {
        label: 'Play it for me',
        run: () => {
          const state = get(vjClipLauncher);
          const row = state.clipGrid.findIndex((cells) => cells.some(Boolean));
          if (row < 0) return;
          const column = state.clipGrid[row].findIndex(Boolean);
          vjClipLauncher.triggerClip(row, column, 'A');
        },
      },
    },
    {
      title: 'What your audience sees',
      body: 'This preview is the finished picture. Everything that leaves the app — projector, screens and recordings — comes from here.',
      targets: ['.program-preview'],
    },
    {
      title: 'Layers stack from the top',
      body: 'Each row is a layer, and the top row sits on top. The fader sets how much of the row shows, S solos it, M mutes it and the square stops it. Drag the thumbnail on the left to move a row up or down.',
      targets: ['.layer-row .layer-controls'],
    },
    {
      title: 'Play to the music',
      body: 'Tap TAP in time with the band, or press Detect Tempo to follow the room. Set QUANT to 1 BAR and the clips you click wait for the next bar, so every change lands on the beat.',
      targets: ['.bpm-tap-widget'],
    },
    {
      title: 'Your projector',
      body: 'Open the Output Window from the main toolbar and drag it onto the projector screen — whatever plays here shows there. Stage Edit splits the picture across several screens.',
      targets: ['button[title^="Edit live 2D stage"]'],
      action: {
        label: 'Open the output window',
        run: () => { window.dispatchEvent(new CustomEvent('ga-open-output-window')); },
      },
    },
    {
      title: "You're ready",
      body: 'Want a head start? A template opens a deck already filled for a band, a club night, a liquid light show, Halloween or projection mapping. You can come back to this tour from the ? button.',
    },
  ];

  let rect: { x: number; y: number; w: number; h: number } | null = null;
  let cardEl: HTMLDivElement | null = null;
  let cardPos = { left: 0, top: 0 };
  let busy = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  $: open = $onboarding.tourOpen;
  $: index = Math.min($onboarding.tourStep, steps.length - 1);
  $: step = steps[index];
  $: isLast = index === steps.length - 1;

  function findTarget(selectors: string[] | undefined): DOMRect | null {
    for (const selector of selectors ?? []) {
      for (const el of document.querySelectorAll(selector)) {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width <= 4 || r.height <= 4) continue;
        // Skip copies hidden under another panel (the main toolbar keeps its
        // own tempo controls underneath VJ mode).
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (top && (el === top || el.contains(top))) return r;
      }
    }
    return null;
  }

  function measure() {
    if (!open) return;
    const target = findTarget(step?.targets);
    const pad = 6;
    rect = target
      ? { x: target.left - pad, y: target.top - pad, w: target.width + pad * 2, h: target.height + pad * 2 }
      : null;
    const cw = cardEl?.offsetWidth ?? 360;
    const ch = cardEl?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 14;
    let left = (vw - cw) / 2;
    let top = (vh - ch) / 2;
    if (rect) {
      left = rect.x + rect.w / 2 - cw / 2;
      if (rect.y + rect.h + margin + ch < vh) top = rect.y + rect.h + margin;
      else if (rect.y - margin - ch > 0) top = rect.y - margin - ch;
      else if (rect.x - margin - cw > 0) { left = rect.x - margin - cw; top = rect.y + rect.h / 2 - ch / 2; }
      else if (rect.x + rect.w + margin + cw < vw) { left = rect.x + rect.w + margin; top = rect.y + rect.h / 2 - ch / 2; }
    }
    cardPos = {
      left: Math.round(Math.max(margin, Math.min(vw - cw - margin, left))),
      top: Math.round(Math.max(margin, Math.min(vh - ch - margin, top))),
    };
  }

  // The tour lives in VJ mode: open it when the tour starts and again on
  // each step, in case something closed it in between.
  $: if (open && index >= 0 && !get(vjClipLauncher).isOpen) vjClipLauncher.setOpen(true);
  $: if (open) {
    if (!timer) timer = setInterval(measure, 250);
    void tick().then(measure);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
  $: if (open && index >= 0) void tick().then(measure);

  function go(to: number) {
    onboarding.setTourStep(Math.max(0, Math.min(steps.length - 1, to)));
  }

  async function runAction() {
    if (!step.action || busy) return;
    busy = true;
    try { await step.action.run(); } finally { busy = false; }
    setTimeout(measure, 300);
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); onboarding.endTour(); }
  }

  onDestroy(() => { if (timer) clearInterval(timer); });
</script>

<svelte:window onkeydown={onKey} onresize={measure} />

{#if open}
  <div class="tour-layer" aria-live="polite">
    {#if rect}
      <div class="tour-ring" style="left:{rect.x}px;top:{rect.y}px;width:{rect.w}px;height:{rect.h}px"></div>
    {:else}
      <div class="tour-dim"></div>
    {/if}
    <div class="tour-card" bind:this={cardEl} style="left:{cardPos.left}px;top:{cardPos.top}px"
      role="dialog" aria-labelledby="tour-title">
      <div class="tour-progress">{index + 1} / {steps.length}</div>
      <h2 id="tour-title">{step.title}</h2>
      <p>{step.body}</p>
      {#if step.action}
        <button class="tour-action" disabled={busy} onclick={runAction}>{step.action.label}</button>
      {/if}
      <div class="tour-nav">
        <button class="tour-skip" onclick={() => onboarding.endTour()}>End tour</button>
        <div class="tour-nav-right">
          {#if index > 0}
            <button class="tour-back" onclick={() => go(index - 1)}>Back</button>
          {/if}
          {#if isLast}
            <button class="tour-back" onclick={() => onboarding.openTemplates()}>Browse templates</button>
            <button class="tour-next" onclick={() => onboarding.endTour()}>Finish</button>
          {:else}
            <button class="tour-next" onclick={() => go(index + 1)}>Next</button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .tour-layer {
    position: fixed;
    inset: 0;
    z-index: 30000;
    pointer-events: none;
  }
  .tour-dim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
  }
  .tour-ring {
    position: absolute;
    border: 2px solid var(--ga-blue-200, #9ec5ff);
    border-radius: 10px;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55), 0 0 18px rgba(158, 197, 255, 0.5);
    transition: left 0.2s, top 0.2s, width 0.2s, height 0.2s;
  }
  .tour-card {
    position: absolute;
    width: 360px;
    max-width: calc(100vw - 28px);
    box-sizing: border-box;
    pointer-events: auto;
    background: #15171c;
    border: 1px solid #343842;
    border-radius: 12px;
    padding: 18px 18px 14px;
    color: var(--text-primary, #e6e6e6);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
    transition: left 0.2s, top 0.2s;
  }
  .tour-progress {
    font-size: 11px;
    letter-spacing: 0.08em;
    color: #8a93a3;
    margin-bottom: 6px;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 17px;
    font-weight: 700;
  }
  p {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.5;
    color: #c6cad3;
  }
  button {
    font: inherit;
    font-size: 12px;
    border-radius: 7px;
    padding: 7px 12px;
    cursor: pointer;
    border: 1px solid #3a3f4a;
    background: #1e2128;
    color: #dfe3ea;
  }
  button:hover { border-color: #5a6274; }
  .tour-action {
    width: 100%;
    margin-bottom: 12px;
    background: #1d2a40;
    border-color: #35507a;
  }
  .tour-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tour-nav-right { display: flex; gap: 6px; }
  .tour-skip {
    background: transparent;
    border-color: transparent;
    color: #8a93a3;
    padding-left: 0;
  }
  .tour-next {
    background: var(--ga-blue-200, #9ec5ff);
    border-color: var(--ga-blue-200, #9ec5ff);
    color: #0b1220;
    font-weight: 600;
  }
</style>
