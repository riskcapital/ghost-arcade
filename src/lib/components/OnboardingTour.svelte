<script lang="ts">
  /**
   * OnboardingTour — first-run feature tour.
   *
   * Shows on first launch (driven by `onboarding.autoStartIfNew()` from
   * App.svelte's onMount). Walks the user through the major feature
   * surfaces shipped in 0.3.x — many of them invisible without
   * a guided intro (Bank B dual decks, quantized launch, macros,
   * MIDI clock, kick/snare events, right-click resave).
   *
   * Each step has: title, body copy, optional "try it" button that
   * triggers the relevant feature live, optional keyboard-shortcut
   * sigils. Persists current step so closing/reopening picks up where
   * the user left off.
   */
  import { onboarding } from '../stores/onboarding';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { audioStore } from '../stores/audio';
  import { macros } from '../stores/macros';
  import { snapshots } from '../stores/snapshots';
  import { t } from '../i18n';

  interface TourStep {
    title: string;
    eyebrow?: string;
    body: string;
    bullets?: string[];
    /** Sigil text shown in the keyboard hint chip (e.g. "Ctrl+S", "PageDown"). */
    keyHint?: string;
    /** Optional one-shot "try it" action — wires a button at the bottom of the step. */
    action?: { label: string; run: () => void | Promise<void> };
  }

  // Trigger functions for the "try it" buttons. Each is intentionally
  // best-effort: they never throw or block the tour if a target isn't
  // available (e.g. user hasn't opened VJ mode yet).
  function openVJMode() {
    vjClipLauncher.setOpen(true);
  }
  function flipCrossfader() {
    openVJMode();
    setTimeout(() => {
      vjClipLauncher.setCrossfaderEnabled(!getCurrentCrossfaderEnabled());
    }, 200);
  }
  function getCurrentCrossfaderEnabled(): boolean {
    let on = false;
    const unsub = vjClipLauncher.subscribe((s) => {
      on = s.crossfaderEnabled;
    });
    unsub();
    return on;
  }
  function setQuantize(grid: 'off' | '1bar') {
    openVJMode();
    setTimeout(() => vjClipLauncher.setQuantization(grid), 200);
  }
  function nudgeMacro1() {
    openVJMode();
    setTimeout(() => macros.setMacroValue('macro-1', 0.5), 200);
  }
  function startMicAudio() {
    audioStore.startMicrophone().catch(() => {});
  }
  function saveDemoSnapshot() {
    openVJMode();
    setTimeout(() => snapshots.save(0, $t('tourTimeline.onboarding.demoSnapshotName')), 200);
  }

  let steps: TourStep[] = [];
  $: steps = [
    {
      eyebrow: $t('tourTimeline.onboarding.steps.welcome.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.welcome.title'),
      body: $t('tourTimeline.onboarding.steps.welcome.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.welcome.bullets.dualDeck'),
        $t('tourTimeline.onboarding.steps.welcome.bullets.quantizedLaunch'),
        $t('tourTimeline.onboarding.steps.welcome.bullets.audioAnalysis'),
        $t('tourTimeline.onboarding.steps.welcome.bullets.macros'),
      ],
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.modes.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.modes.title'),
      body: $t('tourTimeline.onboarding.steps.modes.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.modes.bullets.mapping'),
        $t('tourTimeline.onboarding.steps.modes.bullets.vj'),
        $t('tourTimeline.onboarding.steps.modes.bullets.performer'),
      ],
      action: { label: $t('tourTimeline.onboarding.steps.modes.action'), run: openVJMode },
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.crossfader.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.crossfader.title'),
      body: $t('tourTimeline.onboarding.steps.crossfader.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.crossfader.bullets.scenes'),
        $t('tourTimeline.onboarding.steps.crossfader.bullets.stage'),
        $t('tourTimeline.onboarding.steps.crossfader.bullets.save'),
      ],
      action: { label: $t('tourTimeline.onboarding.steps.crossfader.action'), run: flipCrossfader },
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.quantizedLaunch.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.quantizedLaunch.title'),
      body: $t('tourTimeline.onboarding.steps.quantizedLaunch.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.quantizedLaunch.bullets.audioBeat'),
        $t('tourTimeline.onboarding.steps.quantizedLaunch.bullets.virtualClock'),
        $t('tourTimeline.onboarding.steps.quantizedLaunch.bullets.cancel'),
        $t('tourTimeline.onboarding.steps.quantizedLaunch.bullets.stopAll'),
      ],
      action: { label: $t('tourTimeline.onboarding.steps.quantizedLaunch.action'), run: () => setQuantize('1bar') },
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.audio.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.audio.title'),
      body: $t('tourTimeline.onboarding.steps.audio.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.audio.bullets.bands'),
        $t('tourTimeline.onboarding.steps.audio.bullets.onset'),
        $t('tourTimeline.onboarding.steps.audio.bullets.gain'),
        $t('tourTimeline.onboarding.steps.audio.bullets.tuning'),
      ],
      action: { label: $t('tourTimeline.onboarding.steps.audio.action'), run: startMicAudio },
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.midiClock.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.midiClock.title'),
      body: $t('tourTimeline.onboarding.steps.midiClock.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.midiClock.bullets.ticks'),
        $t('tourTimeline.onboarding.steps.midiClock.bullets.receive'),
        $t('tourTimeline.onboarding.steps.midiClock.bullets.send'),
      ],
      keyHint: $t('tourTimeline.onboarding.steps.midiClock.keyHint'),
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.macros.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.macros.title'),
      body: $t('tourTimeline.onboarding.steps.macros.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.macros.bullets.controls'),
        $t('tourTimeline.onboarding.steps.macros.bullets.cc'),
        $t('tourTimeline.onboarding.steps.macros.bullets.stack'),
        $t('tourTimeline.onboarding.steps.macros.bullets.pulse'),
      ],
      action: { label: $t('tourTimeline.onboarding.steps.macros.action'), run: nudgeMacro1 },
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.resave.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.resave.title'),
      body: $t('tourTimeline.onboarding.steps.resave.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.resave.bullets.blocks'),
        $t('tourTimeline.onboarding.steps.resave.bullets.stage'),
        $t('tourTimeline.onboarding.steps.resave.bullets.synthVision'),
      ],
      keyHint: $t('tourTimeline.onboarding.steps.resave.keyHint'),
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.snapshots.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.snapshots.title'),
      body: $t('tourTimeline.onboarding.steps.snapshots.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.snapshots.bullets.blocks'),
        $t('tourTimeline.onboarding.steps.snapshots.bullets.macros'),
        $t('tourTimeline.onboarding.steps.snapshots.bullets.project'),
        $t('tourTimeline.onboarding.steps.snapshots.bullets.hardware'),
      ],
      action: { label: $t('tourTimeline.onboarding.steps.snapshots.action'), run: saveDemoSnapshot },
    },
    {
      eyebrow: $t('tourTimeline.onboarding.steps.ready.eyebrow'),
      title: $t('tourTimeline.onboarding.steps.ready.title'),
      body: $t('tourTimeline.onboarding.steps.ready.body'),
      bullets: [
        $t('tourTimeline.onboarding.steps.ready.bullets.save'),
        $t('tourTimeline.onboarding.steps.ready.bullets.update'),
        $t('tourTimeline.onboarding.steps.ready.bullets.snapshots'),
        $t('tourTimeline.onboarding.steps.ready.bullets.show'),
      ],
    },
  ];

  // Shorthand for the current step (clamped to bounds)
  $: currentStep = Math.min(Math.max(0, $onboarding.step), steps.length - 1);
  $: step = steps[currentStep];
  $: isLast = currentStep === steps.length - 1;
  $: isFirst = currentStep === 0;

  function next() {
    if (isLast) onboarding.finish();
    else onboarding.next(steps.length);
  }
  function prev() {
    onboarding.prev();
  }

  // Esc closes (saves progress); arrow keys navigate.
  // Skip when the user is typing in any field — they likely just hit
  // Enter to commit a value and don't want to also advance the tour.
  function handleKey(e: KeyboardEvent) {
    if (!$onboarding.open) return;
    const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
    const isEditable =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      (e.target as HTMLElement | null)?.isContentEditable === true;
    if (e.key === 'Escape') {
      e.preventDefault();
      onboarding.close();
      return;
    }
    if (isEditable) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') {
      e.preventDefault();
      next();
  } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
  }
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if $onboarding.open}
  <div class="ot-backdrop" onclick={() => onboarding.close()} role="presentation"></div>

  <div class="ot-modal" role="dialog" aria-modal="true" aria-labelledby="ot-title">
    <button class="ot-close" onclick={() => onboarding.close()} title={$t('tourTimeline.onboarding.closeTitle')}
      >×</button
    >

    <div class="ot-progress">
      {#each steps as _s, i}
        <button
          class="ot-progress-dot"
          class:active={i === currentStep}
          class:done={i < currentStep}
          onclick={() => onboarding.setStep(i)}
          title={$t('tourTimeline.onboarding.progressStepTitle', { values: { step: i + 1 } })}
        ></button>
      {/each}
    </div>

    <div class="ot-content">
      {#if step.eyebrow}
        <div class="ot-eyebrow">{step.eyebrow}</div>
      {/if}
      <h2 class="ot-title" id="ot-title">{step.title}</h2>
      <p class="ot-body">{step.body}</p>

      {#if step.bullets && step.bullets.length}
        <ul class="ot-bullets">
          {#each step.bullets as b}
            <li>{b}</li>
          {/each}
        </ul>
      {/if}

      {#if step.keyHint}
        <div class="ot-keyhint">
          <span class="ot-keyhint-label">{$t('tourTimeline.onboarding.whereLabel')}</span>
          <kbd>{step.keyHint}</kbd>
        </div>
      {/if}

      {#if step.action}
        <button class="ot-action" onclick={() => step.action!.run()}>
          {step.action.label} →
        </button>
      {/if}
    </div>

    <div class="ot-footer">
      {#if isFirst}
        <button class="ot-skip" onclick={() => onboarding.skip()}>{$t('tourTimeline.onboarding.actions.skip')}</button>
      {:else}
        <button class="ot-skip" onclick={prev}>← {$t('tourTimeline.onboarding.actions.back')}</button>
      {/if}
      <span class="ot-counter">{currentStep + 1} / {steps.length}</span>
      <button class="ot-next" onclick={next}>
        {isLast ? $t('tourTimeline.onboarding.actions.done') : `${$t('tourTimeline.onboarding.actions.next')} →`}
      </button>
    </div>
  </div>
{/if}

<style>
  .ot-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    z-index: 19000;
    animation: ot-fade-in 0.2s ease-out;
  }
  @keyframes ot-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .ot-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, calc(100vw - 32px));
    max-height: 85vh;
    background: linear-gradient(180deg, #1a1a22 0%, #14141a 100%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 14px;
    box-shadow:
      0 24px 80px rgba(0, 0, 0, 0.7),
      0 0 0 1px rgba(255, 133, 119, 0.06);
    z-index: 19001;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: ot-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes ot-pop {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.94);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }

  .ot-close {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    color: var(--text-secondary, #aaa);
    cursor: pointer;
    font-size: 17px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .ot-close:hover {
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
  }

  /* Progress dot strip */
  .ot-progress {
    display: flex;
    gap: 6px;
    padding: 14px 18px 0;
  }
  .ot-progress-dot {
    flex: 1;
    height: 3px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 2px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .ot-progress-dot:hover {
    background: rgba(255, 255, 255, 0.18);
  }
  .ot-progress-dot.done {
    background: rgba(126, 200, 227, 0.45);
  }
  .ot-progress-dot.active {
    background: linear-gradient(90deg, #ff8577, #7ec8e3);
  }

  .ot-content {
    padding: 24px 32px 12px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .ot-eyebrow {
    font-size: 11px;
    font-weight: 700;
    color: #ff8577;
    letter-spacing: 0.18em;
    margin-bottom: 6px;
  }
  .ot-title {
    font-size: 23px;
    font-weight: 700;
    color: #fff;
    margin: 0 0 12px;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .ot-body {
    font-size: 15px;
    color: var(--text-primary, #ccc);
    line-height: 1.55;
    margin: 0 0 16px;
  }

  .ot-bullets {
    list-style: none;
    padding: 0;
    margin: 0 0 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ot-bullets li {
    position: relative;
    padding-left: 18px;
    font-size: 13px;
    color: var(--text-secondary, #aaa);
    line-height: 1.5;
  }
  .ot-bullets li::before {
    content: '▸';
    position: absolute;
    left: 0;
    top: 0;
    color: #7ec8e3;
    font-size: 11px;
  }

  .ot-keyhint {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 6px 10px;
    border-radius: 4px;
    margin-bottom: 14px;
  }
  .ot-keyhint-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-muted, #888);
    letter-spacing: 0.16em;
  }
  .ot-keyhint kbd {
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 12px;
    color: #ff8577;
    background: rgba(255, 133, 119, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid rgba(255, 133, 119, 0.3);
  }

  .ot-action {
    display: inline-block;
    background: rgba(126, 200, 227, 0.12);
    border: 1px solid rgba(126, 200, 227, 0.45);
    color: #7ec8e3;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 8px 14px;
    border-radius: 5px;
    cursor: pointer;
    transition:
      background 0.15s,
      transform 0.12s;
  }
  .ot-action:hover {
    background: rgba(126, 200, 227, 0.22);
    transform: translateY(-1px);
  }

  .ot-footer {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 14px 24px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(0, 0, 0, 0.2);
  }
  .ot-skip {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-muted, #888);
    font-size: 12px;
    font-weight: 600;
    padding: 7px 12px;
    border-radius: 4px;
    cursor: pointer;
  }
  .ot-skip:hover {
    color: var(--text-primary, #ccc);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .ot-counter {
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 11px;
    color: #666;
    text-align: center;
  }

  .ot-next {
    background: linear-gradient(135deg, #ff8577, #7ec8e3);
    border: none;
    color: #0a0a0a;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 9px 18px;
    border-radius: 5px;
    cursor: pointer;
    transition: filter 0.15s, transform 0.12s, box-shadow 0.15s;
    box-shadow: 0 4px 12px rgba(255, 133, 119, 0.3);
  }
  .ot-next:hover {
    filter: brightness(1.08);
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(255, 133, 119, 0.45);
  }
</style>
