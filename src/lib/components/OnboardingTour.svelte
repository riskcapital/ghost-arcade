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
    const unsub = vjClipLauncher.subscribe(s => { on = s.crossfaderEnabled; });
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
    setTimeout(() => snapshots.save(0, 'Tour demo'), 200);
  }

  const steps: TourStep[] = [
    {
      eyebrow: 'WELCOME',
      title: 'Ghost Arcade · feature tour',
      body: '60-second walkthrough of what shipped in 0.3.x. Hit Skip if you\'re a returning user — or stick around for 10 quick steps covering everything new.',
      bullets: [
        'Dual-deck A/B crossfader (only VJ tool that has it)',
        'Beat-quantized clip launch + MIDI clock sync',
        '8-band audio analysis with kick/snare events',
        'Macros (one knob → many params)',
      ],
    },
    {
      eyebrow: '1 / 9',
      title: 'Three modes, one source of truth',
      body: 'Ghost Arcade has three modes that share the same audio input, MIDI router, and project file. Switch between them mid-set without losing state.',
      bullets: [
        'Mapping Mode — build the projection layout (warps, screens, edge blends, dome)',
        'VJ Mode — live clip launching with optional dual decks',
        'Performer Mode (SynthVision) — 36-key generative shaders for hands-free play',
      ],
      action: { label: 'Open VJ Mode', run: openVJMode },
    },
    {
      eyebrow: '2 / 9',
      title: 'Dual-deck A/B crossfader',
      body: 'Click the A/B toggle in the VJ header to split the deck into two completely independent banks. Cyan = Bank A, Coral = Bank B. Mix between them with the vertical fader using one of 10 transitions (dissolve, glitch, shatter, halftone, liquid…).',
      bullets: [
        'Per-block A+B scenes — each block stores its own pair of decks',
        'Stage mode + crossfader — different physical screens crossfade independently',
        'Right-click any block tab → Save Project (Ctrl+S equivalent)',
      ],
      action: { label: 'Try it: flip A/B on', run: flipCrossfader },
    },
    {
      eyebrow: '3 / 9',
      title: 'Quantized clip launch',
      body: 'Set the QUANT dropdown in the header to make clip triggers land on a beat boundary instead of firing instantly. Off = beginner-friendly instant trigger. 1/4 / 1/2 / 1 BAR / 2 BAR / 4 BAR for tight musical drops.',
      bullets: [
        'Anchored to detected audio beats when audio is active',
        'Falls back to BPM-based virtual clock when audio is off',
        'Click a queued cell again to cancel (no commitment to fire)',
        'STOP ALL flushes the queue (no surprise time-bombs)',
      ],
      action: { label: 'Try it: set QUANT to 1 BAR', run: () => setQuantize('1bar') },
    },
    {
      eyebrow: '4 / 9',
      title: 'Audio reactivity',
      body: 'Click the audio source picker (top-right) → Mic / System Audio / pick a specific device (BlackHole etc. for DAW routing). Tap tempo with TAP. Click the FFT bars to open the EQ tweaks panel.',
      bullets: [
        '8 frequency bands: sub · bass · lowMid · mid · highMid · treble · air · presence',
        'Kick + snare onset events (separate from the generic beat detector)',
        'Per-band gain sliders to boost the kick or cut harsh treble',
        'Sensitivity + smoothing globally tunable',
      ],
      action: { label: 'Try it: enable mic input', run: startMicAudio },
    },
    {
      eyebrow: '5 / 9',
      title: 'MIDI clock — sync to / from your DAW',
      body: 'Settings → MIDI → enable Receive MIDI Clock to follow a DAW or drum machine\'s tempo. Enable Send MIDI Clock to make Ghost Arcade the master and drive slaved gear. 24 PPQN, runs alongside any other MIDI Learn mappings.',
      bullets: [
        '0xF8 ticks averaged across 48 samples for fast lock + stable BPM',
        'Receive auto-flows into the master BPM (overrides tap tempo when running)',
        'Send respects manual BPM override / tap so you can override mid-set',
      ],
      keyHint: 'Settings → MIDI',
    },
    {
      eyebrow: '6 / 9',
      title: 'Macros — one knob, an effect bundle',
      body: '8 user-assignable knobs in the VJ header. Each macro is a wet/dry mix for a stack of effects that runs on the composite output. Right-click a knob → "Edit Macro" → add effects (same picker as layer effects), drag-reorder, toggle, set per-effect opacity.',
      bullets: [
        'Drag knob vertically (DAW-style) · mouse wheel = fine tune · double-click = reset',
        'Bind hardware CC to vj:macro:N:value to drive macros via controller',
        'All 8 macros stack on the composite — partial blends layer cleanly',
        'Auto-pulse a macro on a beat grid (1/4, 1/2, 1bar, 2bar) for hands-free movement',
      ],
      action: { label: 'Try it: bump ENERGY macro', run: nudgeMacro1 },
    },
    {
      eyebrow: '7 / 9',
      title: 'Right-click to resave anything',
      body: 'Three places now have right-click context menus that overwrite the saved version with the current state — no more delete-and-recreate workflow.',
      bullets: [
        'Block tabs → Save Project (Ctrl+S equivalent) + Rename / Duplicate / Delete',
        'Stage presets → Update Preset (overwrite snapshot) + Rename / Save Project / Delete',
        'SynthVision keyboard presets → Update / Rename / Delete',
      ],
      keyHint: 'Right-click',
    },
    {
      eyebrow: '8 / 9',
      title: 'Snapshots — instant scene recall',
      body: 'Bottom-right of the VJ overlay there\'s a "SNAPS" launcher with 16 slots. Each slot holds a complete capture of layer opacities, blend modes, solos / mutes (both decks), crossfader state, quantization, master opacity, and macro values. Shift-click any slot to save current state. Click to recall. Right-click for rename / overwrite / clear.',
      bullets: [
        'Different from blocks (clip-grid scenes) — snapshots are live-state freezes',
        'Different from macros — recalls all knobs at once instead of driving them continuously',
        'Save under the project (.gha) so they roll between sessions',
        'Bind hardware buttons to vj:snapshot:N (1-16) for instant scene jumps',
      ],
      action: { label: 'Try it: save current state to slot 1', run: saveDemoSnapshot },
    },
    {
      eyebrow: '9 / 9',
      title: 'You\'re ready',
      body: 'Hit Done to dive in. The full feature reference is at FEATURES.md in the install folder. Re-run this tour anytime via File → Help → Show feature tour.',
      bullets: [
        'Everything saves and reloads via Ctrl+S to the loaded .gha file',
        'Right-click block tabs / presets / SV presets to update in place',
        'Snapshots (▶/⇪ on slot 1-16) jump between full-state scenes',
        'Have a great show ⚡',
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
    const isEditable = tag === 'input' || tag === 'textarea' || tag === 'select'
      || (e.target as HTMLElement | null)?.isContentEditable === true;
    if (e.key === 'Escape') { e.preventDefault(); onboarding.close(); return; }
    if (isEditable) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  }
</script>

<svelte:window onkeydown={handleKey} />

{#if $onboarding.open}
  <div class="ot-backdrop" onclick={() => onboarding.close()} role="presentation"></div>

  <div class="ot-modal" role="dialog" aria-modal="true" aria-labelledby="ot-title">
    <button class="ot-close" onclick={() => onboarding.close()} title="Close (Esc) — picks up where you left off">×</button>

    <div class="ot-progress">
      {#each steps as _s, i}
        <button
          class="ot-progress-dot"
          class:active={i === currentStep}
          class:done={i < currentStep}
          onclick={() => onboarding.setStep(i)}
          title="Step {i + 1}"
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
          <span class="ot-keyhint-label">Where:</span>
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
        <button class="ot-skip" onclick={() => onboarding.skip()}>Skip tour</button>
      {:else}
        <button class="ot-skip" onclick={prev}>← Back</button>
      {/if}
      <span class="ot-counter">{currentStep + 1} / {steps.length}</span>
      <button class="ot-next" onclick={next}>
        {isLast ? 'Done · Start using' : 'Next →'}
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
  @keyframes ot-fade-in { from { opacity: 0; } to { opacity: 1; } }

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
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 133, 119, 0.06);
    z-index: 19001;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: ot-pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes ot-pop {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.94); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
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
    transition: background 0.15s, color 0.15s;
  }
  .ot-close:hover { background: rgba(255, 255, 255, 0.14); color: #fff; }

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
  .ot-progress-dot:hover { background: rgba(255, 255, 255, 0.18); }
  .ot-progress-dot.done { background: rgba(126, 200, 227, 0.45); }
  .ot-progress-dot.active {
    background: linear-gradient(90deg, #FF8577, #7EC8E3);
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
    color: #FF8577;
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
    color: #7EC8E3;
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
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 12px;
    color: #FF8577;
    background: rgba(255, 133, 119, 0.1);
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid rgba(255, 133, 119, 0.3);
  }

  .ot-action {
    display: inline-block;
    background: rgba(126, 200, 227, 0.12);
    border: 1px solid rgba(126, 200, 227, 0.45);
    color: #7EC8E3;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 8px 14px;
    border-radius: 5px;
    cursor: pointer;
    transition: background 0.15s, transform 0.12s;
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
  .ot-skip:hover { color: var(--text-primary, #ccc); border-color: rgba(255, 255, 255, 0.2); }

  .ot-counter {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    color: #666;
    text-align: center;
  }

  .ot-next {
    background: linear-gradient(135deg, #FF8577, #7EC8E3);
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
