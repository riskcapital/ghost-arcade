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
  <div class="mp-learn-modal" role="dialog" aria-label="MediaPipe Learn">
    <header class="mp-learn-head">
      <span class="mp-learn-dot"></span>
      <span class="mp-learn-title">MediaPipe Learn</span>
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
            <option value="Open_Palm">Open Palm</option>
            <option value="Closed_Fist">Closed Fist</option>
            <option value="Pointing_Up">Pointing Up</option>
            <option value="Thumb_Up">Thumb Up</option>
            <option value="Thumb_Down">Thumb Down</option>
            <option value="Victory">Victory</option>
            <option value="ILoveYou">I Love You</option>
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
            <input type="checkbox" bind:checked={invert} /> invert
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
  .mp-learn-modal {
    position: fixed;
    bottom: 60px;
    right: 16px;
    width: 280px;
    z-index: 99999;
    background: rgba(14, 8, 22, 0.97);
    color: #ddd;
    border: 1px solid rgba(255, 107, 107, 0.55);
    border-radius: 6px;
    box-shadow: 0 6px 28px rgba(255, 107, 107, 0.25), 0 2px 6px rgba(0, 0, 0, 0.6);
    font-size: 11px;
    pointer-events: auto;
    backdrop-filter: blur(6px);
  }
  .mp-learn-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 107, 107, 0.20);
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
    color: var(--accent-secondary, #FF8585);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    font-weight: 700;
  }
  .mp-learn-done {
    background: rgba(255, 107, 107, 0.12);
    border: 1px solid rgba(255, 107, 107, 0.55);
    color: var(--accent-primary, #FF6B6B);
    padding: 3px 10px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
  }
  .mp-learn-done:hover { background: rgba(255, 107, 107, 0.22); }

  .mp-learn-body {
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mp-learn-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: #888;
  }
  .mp-learn-row > span:first-child {
    width: 56px;
    flex-shrink: 0;
    font-size: 9px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .mp-learn-row select,
  .mp-learn-row input[type="number"] {
    flex: 1;
    background: #050507;
    border: 1px solid #2a1a35;
    color: #ddd;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 10px;
    outline: none;
    min-width: 0;
  }
  .mp-learn-row input[type="number"] { max-width: 60px; flex: 0 0 auto; }
  .mp-learn-row input[type="range"] { flex: 1; min-width: 0; }
  .mp-learn-row select:focus,
  .mp-learn-row input:focus { border-color: var(--accent-primary, #FF6B6B); }

  .mp-learn-meter {
    position: relative;
    height: 6px;
    background: #15102a;
    border-radius: 2px;
    overflow: hidden;
    margin-left: 62px;
  }
  .mp-learn-meter-bar {
    height: 100%;
    background: linear-gradient(to right, #5a2a4a, var(--accent-primary, #FF6B6B));
    transition: width 0.05s linear;
  }
  .mp-learn-meter-val {
    position: absolute;
    right: 4px;
    top: -1px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 8px;
    color: #aaa;
    line-height: 8px;
  }

  .mp-learn-dash { color: #555; font-size: 11px; }
  .mp-learn-check { display: flex; align-items: center; gap: 3px; font-size: 9px; color: #aaa; cursor: pointer; }
  .mp-learn-val { font-family: 'JetBrains Mono', monospace; font-size: 10px; color: #aaa; width: 32px; text-align: right; }

  .mp-learn-toggle {
    background: transparent;
    border: none;
    color: #777;
    text-align: left;
    padding: 2px 0;
    font-size: 9px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .mp-learn-toggle:hover { color: #aaa; }

  .mp-learn-prompt {
    font-size: 10px;
    color: #888;
    line-height: 1.5;
    padding: 4px 0;
  }
  .mp-learn-tag-inline {
    color: var(--accent-primary, #FF6B6B);
    font-weight: 700;
  }

  .mp-learn-list-head {
    display: flex;
    justify-content: space-between;
    font-size: 8px;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding-top: 4px;
    border-top: 1px solid #1a1428;
    margin-top: 4px;
  }
  .mp-learn-count { color: #888; font-family: 'JetBrains Mono', monospace; }

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
    font-size: 10px;
    padding: 2px 0;
  }
  .mp-learn-item-sig {
    color: #ffd166;
    font-family: 'JetBrains Mono', monospace;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mp-learn-item-arr { color: #444; text-align: center; }
  .mp-learn-item-path {
    color: #ddd;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mp-learn-item-del {
    background: transparent;
    border: none;
    color: #555;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
  }
  .mp-learn-item-del:hover { color: #f87171; }
</style>
