<script lang="ts">
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { vjLayerSequencer, type VJSequencerDeck, type VJSequencerPresetMode, type VJSequencerTarget } from '../stores/vjLayerSequencer';

  const DECKS: VJSequencerDeck[] = ['A', 'B'];

  $: state = $vjLayerSequencer;
  $: launcher = $vjClipLauncher;
  $: layerCount = launcher.numLayers;
  $: stepIndices = Array.from({ length: state.stepCount }, (_, i) => i);
  $: layerIndices = Array.from({ length: layerCount }, (_, i) => i);
  $: splitDeck = launcher.crossfaderEnabled;
  $: visibleDecks = splitDeck ? DECKS : (['A'] as VJSequencerDeck[]);
  $: vjLayerSequencer.syncLayerCount(layerCount);
  // Tempo shown in the BPM field: the live master clock when synced,
  // otherwise the sequencer's own manual value.
  $: shownBpm = state.syncToMaster && state.masterBPM > 0 ? state.masterBPM : state.bpm;

  function onPresetChange(e: Event, target: VJSequencerTarget = 'A') {
    const mode = (e.target as HTMLSelectElement).value as VJSequencerPresetMode;
    if (mode === 'custom') return;
    vjLayerSequencer.generate(mode, layerCount, target);
  }

  function deckCells(deck: VJSequencerDeck): boolean[][] {
    return deck === 'B' ? (state.bankBCells ?? state.cells) : state.cells;
  }

  function deckPresetMode(deck: VJSequencerDeck): VJSequencerPresetMode {
    return deck === 'B' ? (state.bankBPresetMode ?? 'custom') : state.presetMode;
  }
</script>

{#if state.isOpen}
  <div class="vj-seq-tray" class:minimized={state.minimized}>
    <div class="vj-seq-head">
      <div class="vj-seq-left">
        <span class="vj-seq-title">LAYER SEQUENCER</span>
        {#if !splitDeck}
          <select value={state.presetMode} onchange={(e) => onPresetChange(e, 'A')} title="Pattern">
            <option value="custom">Custom</option>
            <option value="snake">Snake</option>
            <option value="everyOther">Every Other</option>
            <option value="random">Random</option>
          </select>
        {/if}
        <select value={state.stepCount} onchange={(e) => vjLayerSequencer.setStepCount(+(e.target as HTMLSelectElement).value)} title="Steps">
          <option value={8}>8</option>
          <option value={16}>16</option>
          <option value={24}>24</option>
          <option value={32}>32</option>
        </select>
      </div>

      <div class="vj-seq-transport">
        <button onclick={() => state.isPlaying ? vjLayerSequencer.pause() : vjLayerSequencer.play()} title={state.isPlaying ? 'Pause' : 'Play'}>
          {#if state.isPlaying}
            <svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          {:else}
            <svg viewBox="0 0 24 24"><path d="M7 4l12 8-12 8z"/></svg>
          {/if}
        </button>
        <button onclick={() => vjLayerSequencer.stop()} title="Stop"><svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/></svg></button>
        <button onclick={() => vjLayerSequencer.clear(splitDeck ? 'both' : 'A')} title={splitDeck ? 'Clear both deck sequences' : 'Clear'}><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M8 10v8M16 10v8"/></svg></button>
        <span>{state.currentStep + 1}/{state.stepCount}</span>
      </div>

      <div class="vj-seq-right">
        <button
          class="sync-btn"
          class:on={state.syncToMaster}
          onclick={() => vjLayerSequencer.updateConfig({ syncToMaster: !state.syncToMaster })}
          title={state.syncToMaster ? 'BPM follows the master clock — click to unlock' : 'Sync BPM to the master clock'}
        >SYNC</button>
        <label class:locked={state.syncToMaster}>
          BPM
          <input
            type="number"
            min="30"
            max="300"
            value={Math.round(shownBpm)}
            disabled={state.syncToMaster}
            title={state.syncToMaster ? 'Locked to master clock' : 'Manual BPM'}
            onchange={(e) => vjLayerSequencer.updateConfig({ bpm: +(e.target as HTMLInputElement).value })}
          />
        </label>
        <select value={state.subdivision} onchange={(e) => vjLayerSequencer.updateConfig({ subdivision: +(e.target as HTMLSelectElement).value as 1 | 2 | 4 })} title="Subdivision">
          <option value={1}>1/4</option>
          <option value={2}>1/8</option>
          <option value={4}>1/16</option>
        </select>
        <label class="vj-seq-check">
          <input type="checkbox" checked={state.crossfade} onchange={() => vjLayerSequencer.updateConfig({ crossfade: !state.crossfade })} />
          Xfade
        </label>
        <button
          class="vj-seq-min"
          onclick={() => vjLayerSequencer.toggleMinimized()}
          title={state.minimized ? 'Expand sequencer grid' : 'Minimize sequencer'}
          aria-label={state.minimized ? 'Expand sequencer' : 'Minimize sequencer'}
        >
          {#if state.minimized}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 15l6-6 6 6"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
          {/if}
        </button>
      </div>
    </div>

    {#if !state.minimized}
      <div class="vj-seq-body" class:split={splitDeck}>
        {#each visibleDecks as deck}
          {@const cells = deckCells(deck)}
          <section class="vj-seq-deck" class:deck-a={deck === 'A'} class:deck-b={deck === 'B'}>
            {#if splitDeck}
              <div class="vj-seq-deck-head">
                <span class="vj-seq-deck-title">DECK {deck}</span>
                <select value={deckPresetMode(deck)} onchange={(e) => onPresetChange(e, deck)} title="Deck {deck} pattern">
                  <option value="custom">Custom</option>
                  <option value="snake">Snake</option>
                  <option value="everyOther">Every Other</option>
                  <option value="random">Random</option>
                </select>
                <button class="vj-seq-deck-clear" onclick={() => vjLayerSequencer.clear(deck)} title="Clear Deck {deck} sequence">
                  <svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5h6v2M8 10v8M16 10v8"/></svg>
                </button>
              </div>
            {/if}
            <div class="vj-seq-grid" style="grid-template-columns: 72px repeat({state.stepCount}, 28px);">
              <div class="corner"></div>
              {#each stepIndices as step}
                <div class="step-head" class:current={step === state.currentStep}>{step + 1}</div>
              {/each}
              {#each layerIndices as layer}
                <div class="layer-label">
                  <span class="layer-dot"></span>
                  L{layer + 1}
                </div>
                {#each stepIndices as step}
                  <button
                    class="seq-cell"
                    class:on={!!cells[layer]?.[step]}
                    class:current={step === state.currentStep}
                    onclick={() => vjLayerSequencer.toggleCell(layer, step, deck)}
                    title="Deck {deck} Layer {layer + 1}, step {step + 1}"
                  ></button>
                {/each}
              {/each}
            </div>
          </section>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .vj-seq-tray {
    flex: 0 0 210px;
    border-top: 1px solid var(--ga-coral-line, rgba(255, 111, 94, .4));
    background: var(--ga-panel, #0b0d11);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  /* Minimized — collapse to just the transport/header bar. */
  .vj-seq-tray.minimized {
    flex: 0 0 auto;
  }
  .vj-seq-head {
    height: 40px;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid var(--ga-line, rgba(255,255,255,.07));
  }
  .vj-seq-left,
  .vj-seq-transport,
  .vj-seq-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .vj-seq-left { flex: 1; }
  .vj-seq-right { flex: 1; justify-content: flex-end; }
  .vj-seq-title {
    color: var(--ga-coral, #ff6f5e);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: .08em;
  }
  select,
  input {
    height: 24px;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,.12));
    background: var(--ga-slot, #050607);
    color: var(--ga-ink-0, #eef0f4);
    border-radius: var(--ga-r-hard, 2px);
    font: inherit;
    font-size: 13px;
  }
  input { width: 52px; padding: 0 6px; }
  .vj-seq-transport button {
    width: 28px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--ga-coral-line, rgba(255,111,94,.4));
    background: var(--ga-coral-soft, rgba(255,111,94,.11));
    color: var(--ga-coral, #ff6f5e);
    border-radius: var(--ga-r-hard, 2px);
    cursor: pointer;
  }
  .vj-seq-transport svg {
    width: 13px;
    height: 13px;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 2;
  }
  .vj-seq-transport span {
    min-width: 42px;
    color: var(--ga-ink-1, #9aa0ac);
    font-family: var(--ga-font-mono, ui-monospace);
    font-size: 13px;
  }
  .vj-seq-check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ga-ink-1, #9aa0ac);
    font-size: 13px;
  }
  .vj-seq-check input {
    width: 12px;
    height: 12px;
    accent-color: var(--ga-coral, #ff6f5e);
  }
  .sync-btn {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,.12));
    background: var(--ga-slot, #050607);
    color: var(--ga-ink-1, #9aa0ac);
    border-radius: var(--ga-r-hard, 2px);
    font: inherit;
    font-size: 12px;
    font-weight: 800;
    letter-spacing: .06em;
    cursor: pointer;
  }
  .sync-btn.on {
    border-color: var(--ga-coral, #ff6f5e);
    background: var(--ga-coral-soft, rgba(255,111,94,.11));
    color: var(--ga-coral, #ff6f5e);
  }
  .vj-seq-right label.locked input {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .vj-seq-min {
    width: 26px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,.12));
    background: transparent;
    color: var(--ga-ink-1, #9aa0ac);
    border-radius: var(--ga-r-hard, 2px);
    cursor: pointer;
  }
  .vj-seq-min:hover {
    border-color: var(--ga-coral-line, rgba(255,111,94,.4));
    color: var(--ga-ink-0, #eef0f4);
  }
  .vj-seq-min svg {
    width: 14px;
    height: 14px;
  }
  .vj-seq-body {
    display: block;
    min-height: 0;
    overflow: auto;
    padding: 8px 12px 12px;
  }
  .vj-seq-body.split {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .vj-seq-deck {
    flex: 0 0 auto;
    min-width: max-content;
  }
  .vj-seq-body.split .vj-seq-deck {
    padding: 8px;
    border: 1px solid var(--ga-line, rgba(255,255,255,.07));
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.025);
  }
  .vj-seq-deck-head {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 8px;
  }
  .vj-seq-deck-title {
    min-width: 54px;
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 0.12em;
  }
  .deck-a .vj-seq-deck-title { color: #7EC8E3; }
  .deck-b .vj-seq-deck-title { color: #FF8577; }
  .vj-seq-deck-clear {
    width: 26px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,.12));
    background: var(--ga-slot, #050607);
    color: var(--ga-ink-1, #9aa0ac);
    border-radius: var(--ga-r-hard, 2px);
    cursor: pointer;
  }
  .vj-seq-deck-clear:hover {
    color: var(--ga-ink-0, #eef0f4);
    border-color: var(--ga-coral-line, rgba(255,111,94,.4));
  }
  .vj-seq-deck-clear svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
  }
  .vj-seq-grid {
    display: grid;
    gap: 3px;
    overflow: auto;
    width: max-content;
    max-width: 100%;
  }
  .corner,
  .step-head,
  .layer-label {
    height: 22px;
    display: flex;
    align-items: center;
  }
  .step-head {
    justify-content: center;
    color: var(--ga-ink-2, #5e6571);
    font-family: var(--ga-font-mono, ui-monospace);
    font-size: 12px;
  }
  .step-head.current {
    color: var(--ga-green, #46d18a);
  }
  .layer-label {
    gap: 6px;
    color: var(--ga-ink-1, #9aa0ac);
    font-size: 13px;
    font-weight: 700;
  }
  .layer-dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--ga-coral, #ff6f5e);
  }
  .vj-seq-body.split .deck-a .layer-dot { background: #7EC8E3; }
  .vj-seq-body.split .deck-b .layer-dot { background: #FF8577; }
  .seq-cell {
    width: 26px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--ga-line, rgba(255,255,255,.07));
    background: var(--ga-card, #13161c);
    border-radius: var(--ga-r-hard, 2px);
    cursor: pointer;
  }
  .seq-cell:hover {
    border-color: var(--ga-coral-line, rgba(255,111,94,.4));
  }
  .seq-cell.on {
    background: var(--ga-coral, #ff6f5e);
    border-color: var(--ga-coral, #ff6f5e);
  }
  .vj-seq-body.split .deck-a .seq-cell.on {
    background: #7EC8E3;
    border-color: #7EC8E3;
  }
  .vj-seq-body.split .deck-b .seq-cell.on {
    background: #FF8577;
    border-color: #FF8577;
  }
  .seq-cell.current {
    box-shadow: inset 0 0 0 1px var(--ga-green, #46d18a);
  }
</style>
