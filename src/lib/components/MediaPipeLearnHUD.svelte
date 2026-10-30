<!--
  Floating learn-mode modal for MediaPipe bindings.

  Persistent while a learn session is active. The user picks a signal,
  optionally tunes range/invert/smoothing, then clicks any orange-
  outlined param in the underlying UI to bind. The signal selection is
  STICKY across taps — pick once, bind many. Change signal mid-session
  to swap which "instrument" the next taps wire up.

  Lives at the App level so it floats above everything (overlay + panels)
  and survives Settings closing.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { mediaPipeBus, type MediaPipeBinding } from '../mediapipe/mediaPipeBus';
  import { mediaPipeStore } from '../stores/mediaPipe';
  import { SIGNAL_DEFS, type GestureName, type SignalFrame, EMPTY_SIGNAL_FRAME } from '../mediapipe/signals';

  let active = false;
  let unsubLearn = () => {};
  let unsubBindings = () => {};
  let unsubFrame = () => {};
  let endSession: (() => void) | null = null;
  let frame: SignalFrame = EMPTY_SIGNAL_FRAME;

  // Form state — survives across taps within a session.
  let signalId = 'palm.right.x';
  let gestureName: GestureName = 'Open_Palm';
  let mode: 'continuous' | 'trigger' | 'latch' = 'continuous';
  let sourceMin = 0;
  let sourceMax = 1;
  let invert = false;
  let smoothing = 0.35;
  let showAdvanced = false;

  // Bindings created during this session (so the list shows what the
  // user actually just did, not their entire historical mapping table).
  let sessionBindings: MediaPipeBinding[] = [];

  $: continuousSignals = SIGNAL_DEFS.filter(s => s.kind === 'continuous');
  $: gestureSignals    = SIGNAL_DEFS.filter(s => s.kind === 'categorical');
  $: isGesture = signalId.startsWith('gesture.');
  $: if (isGesture && mode === 'continuous') mode = 'trigger';
  $: if (!isGesture && mode !== 'continuous') mode = 'continuous';
  $: liveVal = isGesture
    ? (frame.gestures[signalId] === gestureName ? 1 : 0)
    : (frame.values[signalId] ?? 0);

  function getSpec() {
    return {
      signalId,
      sourceMin,
      sourceMax,
      invert,
      smoothing,
      minConfidence: 0.5,
      mode,
      gestureName: isGesture ? gestureName : undefined,
    };
  }

  function startSession() {
    if (active) return;
    sessionBindings = [];
    endSession = mediaPipeBus.beginLearnSession(getSpec, (b) => {
      sessionBindings = [...sessionBindings, b];
    });
  }

  function stopSession() {
    if (endSession) endSession();
    endSession = null;
  }

  function removeBinding(id: string) {
    mediaPipeBus.remove(id);
    sessionBindings = sessionBindings.filter(b => b.id !== id);
  }

  onMount(() => {
    // Listen for an external "start a session" event. The MediaPipePanel
    // dispatches this when the user clicks "+ Add binding" (after closing
    // Settings so the orange outlines aren't covered).
    const onOpenLearn = () => startSession();
    window.addEventListener('mediapipe-open-learn', onOpenLearn);

    unsubLearn = mediaPipeBus.subscribeLearn(v => {
      active = v;
      if (!v) endSession = null;  // session ended externally (Esc)
    });
    unsubBindings = mediaPipeBus.subscribe(() => { /* triggers reactivity via $mediaPipeStore */ });
    unsubFrame = mediaPipeStore.subscribe(s => { frame = s.frame; });

    return () => {
      window.removeEventListener('mediapipe-open-learn', onOpenLearn);
    };
  });
  onDestroy(() => {
    try { unsubLearn(); } catch {}
    try { unsubBindings(); } catch {}
    try { unsubFrame(); } catch {}
  });
</script>

{#if active}
  <div data-help-page="midi-audio" class="mp-learn-modal" role="dialog" aria-label="MediaPipe learn">
    <header class="mp-learn-head">
      <span class="mp-learn-dot"></span>
      <span class="mp-learn-title">MediaPipe learn</span>
      <button class="mp-learn-done" onclick={stopSession} title="End learn session (Esc)">Done</button>
    </header>

    <div class="mp-learn-body">
      <label class="mp-learn-row">
        <span>Signal</span>
        <select bind:value={signalId}>
          <optgroup label="Continuous">
            {#each continuousSignals as s (s.id)}
              <option value={s.id}>{s.label}</option>
            {/each}
          </optgroup>
          <optgroup label="Gesture">
            {#each gestureSignals as s (s.id)}
              <option value={s.id}>{s.label}</option>
            {/each}
          </optgroup>
        </select>
      </label>

      <div class="mp-learn-meter">
        <div class="mp-learn-meter-bar" style:width="{Math.max(0, Math.min(1, liveVal)) * 100}%"></div>
        <span class="mp-learn-meter-val">{liveVal.toFixed(2)}</span>
      </div>

      {#if isGesture}
        <label class="mp-learn-row">
          <span>Gesture</span>
          <select bind:value={gestureName}>
            <option value="Open_Palm">Open palm</option>
            <option value="Closed_Fist">Closed fist</option>
            <option value="Pointing_Up">Pointing up</option>
            <option value="Thumb_Up">Thumb up</option>
            <option value="Thumb_Down">Thumb down</option>
            <option value="Victory">Victory</option>
            <option value="ILoveYou">I love you</option>
          </select>
        </label>
        <label class="mp-learn-row">
          <span>Mode</span>
          <select bind:value={mode}>
            <option value="trigger">Trigger (pulse)</option>
            <option value="latch">Latch (toggle)</option>
          </select>
        </label>
      {/if}

      <button class="mp-learn-toggle" onclick={() => showAdvanced = !showAdvanced}>
        {showAdvanced ? '▾' : '▸'} Advanced
      </button>
      {#if showAdvanced && !isGesture}
        <div class="mp-learn-row mp-learn-row-narrow">
          <span>Range</span>
          <input type="number" step="0.01" min="0" max="1" bind:value={sourceMin} />
          <span class="mp-learn-dash">→</span>
          <input type="number" step="0.01" min="0" max="1" bind:value={sourceMax} />
          <label class="mp-learn-check">
            <input type="checkbox" bind:checked={invert} /> Invert
          </label>
        </div>
        <div class="mp-learn-row mp-learn-row-narrow">
          <span>Smooth</span>
          <input type="range" min="0" max="0.9" step="0.05" bind:value={smoothing} aria-label="Smoothing" />
          <span class="mp-learn-val">{smoothing.toFixed(2)}</span>
        </div>
      {/if}

      <div class="mp-learn-prompt">
        Click any <span class="mp-learn-tag-inline">orange-outlined</span> param to bind. Pick again to keep going.
        {#if !isGesture}
          Clips, tabs and buttons keep working, so you can move to another layer or shader and keep binding.
        {/if}
      </div>

      {#if sessionBindings.length > 0}
        <div class="mp-learn-list-head">
          <span>Bound this session</span>
          <span class="mp-learn-count">{sessionBindings.length}</span>
        </div>
        <div class="mp-learn-list">
          {#each sessionBindings as b (b.id)}
            <div class="mp-learn-item">
              <span class="mp-learn-item-sig" title={b.signalId}>{b.signalId.replace(/^(palm|pinch|spread|gesture)\./, '')}</span>
              <span class="mp-learn-item-arr">→</span>
              <span class="mp-learn-item-path" title={b.path}>{b.label ?? b.path}</span>
              <button class="mp-learn-item-del" onclick={() => removeBinding(b.id)} title="Remove">×</button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* The coral accent marks learn mode, matching the outlines on bindable controls. */
  .mp-learn-modal {
    position: fixed;
    bottom: 60px;
    right: 16px;
    width: 280px;
    z-index: 99999;
    background: var(--ga-panel);
    color: var(--ga-ink-0);
    border: 1px solid rgba(255, 107, 107, 0.55);
    border-radius: var(--ga-r-soft);
    box-shadow: 0 6px 28px rgba(0, 0, 0, 0.6);
    font-size: var(--ga-text-control);
    pointer-events: auto;
  }
  .mp-learn-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border-bottom: 1px solid var(--ga-line-1);
  }
  .mp-learn-dot {
    width: 7px; height: 7px;
    background: var(--accent-primary, #FF6B6B);
    border-radius: 50%;
    box-shadow: 0 0 6px rgba(255, 107, 107, 0.8);
    animation: mpLearnDot 1.2s infinite;
    flex-shrink: 0;
  }
  @keyframes mpLearnDot { 0%,100%{opacity:1} 50%{opacity:.35} }
  .mp-learn-title {
    flex: 1;
    color: var(--ga-ink-0);
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-title);
  }
  .mp-learn-done {
    height: var(--ga-control-h-sm);
    background: var(--ga-accent-gradient, var(--ga-violet));
    border: 1px solid transparent;
    color: var(--ga-blue-800);
    padding: 0 10px;
    border-radius: var(--ga-r-soft);
    font-size: var(--ga-text-control);
    font-weight: 700;
    cursor: pointer;
  }
  .mp-learn-done:hover { filter: brightness(1.06); }

  .mp-learn-body {
    padding: 8px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mp-learn-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--ga-control-h);
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1);
  }
  .mp-learn-row > span:first-child {
    width: 56px;
    flex-shrink: 0;
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1);
  }
  .mp-learn-row select,
  .mp-learn-row input[type="number"] {
    flex: 1;
    height: var(--ga-control-h);
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-0);
    padding: 0 6px;
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-control);
    outline: none;
    min-width: 0;
  }
  .mp-learn-row input[type="number"] { max-width: 60px; flex: 0 0 auto; }
  .mp-learn-row input[type="range"] { flex: 1; min-width: 0; }
  .mp-learn-row select:focus,
  .mp-learn-row input:focus { border-color: var(--ga-focus); }

  .mp-learn-meter {
    position: relative;
    height: 6px;
    background: var(--ga-card);
    border-radius: 2px;
    overflow: hidden;
    margin-left: 62px;
  }
  .mp-learn-meter-bar {
    height: 100%;
    background: var(--ga-selection-line);
    transition: width 0.05s linear;
  }
  .mp-learn-meter-val {
    position: absolute;
    right: 4px;
    top: -1px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-micro);
    color: var(--ga-ink-1);
    line-height: 8px;
  }

  .mp-learn-dash { color: var(--ga-ink-3); font-size: var(--ga-text-control); }
  .mp-learn-check { display: flex; align-items: center; gap: 4px; font-size: var(--ga-text-meta); color: var(--ga-ink-1); cursor: pointer; }
  .mp-learn-val { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: var(--ga-text-meta); color: var(--ga-ink-1); width: 32px; text-align: right; }

  .mp-learn-toggle {
    align-self: flex-start;
    background: transparent;
    border: none;
    color: var(--ga-ink-1);
    text-align: left;
    padding: 2px 0;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .mp-learn-toggle:hover { color: var(--ga-ink-0); }

  .mp-learn-prompt {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
    line-height: 1.5;
    padding: 2px 0;
  }
  .mp-learn-tag-inline {
    color: var(--accent-primary, #FF6B6B);
    font-weight: 700;
  }

  .mp-learn-list-head {
    display: flex;
    justify-content: space-between;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    color: var(--ga-ink-2);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
    padding-top: 8px;
    border-top: 1px solid var(--ga-line-1);
    margin-top: 4px;
  }
  .mp-learn-count { color: var(--ga-ink-1); }

  .mp-learn-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 140px;
    overflow-y: auto;
  }
  .mp-learn-item {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1.4fr) 16px;
    gap: 4px;
    align-items: center;
    font-size: var(--ga-text-meta);
    padding: 2px 0;
  }
  .mp-learn-item-sig {
    color: #ffd166;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mp-learn-item-arr { color: var(--ga-ink-3); text-align: center; }
  .mp-learn-item-path {
    color: var(--ga-ink-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mp-learn-item-del {
    background: transparent;
    border: none;
    color: var(--ga-ink-2);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
  }
  .mp-learn-item-del:hover { color: var(--ga-rec); }
</style>
