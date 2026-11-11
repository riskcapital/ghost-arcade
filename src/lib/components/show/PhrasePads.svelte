<script lang="ts">
  /**
   * A/V phrase pads: one per published Timeline section, in time order, in
   * the section's colour. A press plays that section of the Timeline from
   * its start on the next bar (VJ launch quantise; whole bars); the pad
   * blinks while it waits and glows while it plays. Pressing the waiting pad
   * again calls it off; ■ stops the phrases on the next bar. Each pad is a
   * control path (show:phrase:<n>), so MIDI learn and OSC work on it.
   *
   * Shown in VJ mode's deck area and as the Timeline's phrase strip.
   */
  import { parkedShowDoc, showPhraseStatus } from '../../stores/showTimeline';
  import { showSlice } from './timeline/timelineSlices';
  import { phraseSections, PHRASE_END_LABELS } from '../../timeline/phrases/phraseModel';
  import { SECTION_ACTION_LABELS } from '../../timeline/sections/sectionModel';
  import { launchPhrase, stopPhrases } from '../../timeline/phrases/phraseRuntime';

  interface Props {
    /** 'vj': the strip over VJ mode's decks; 'timeline': under the Timeline's transport. */
    variant?: 'vj' | 'timeline';
  }
  let { variant = 'timeline' }: Props = $props();

  const docStore = showSlice('doc');
  const sectionsStore = showSlice('sections');
  // The Timeline's sections, also while the Show tab is the active document.
  const sections = $derived($docStore === 'timeline' ? $sectionsStore : $parkedShowDoc.sections ?? []);
  const pads = $derived(phraseSections(sections));
  const status = $derived($showPhraseStatus);
  const stopPending = $derived(status.pending !== null && status.pending.id === null);

  function endText(s: (typeof pads)[number]): string {
    const end = s.phrase?.end ?? 'section';
    return end === 'section' ? `At its end: ${SECTION_ACTION_LABELS[s.action]}` : `At its end: ${PHRASE_END_LABELS[end]}`;
  }
</script>

<div class="pp" class:vj={variant === 'vj'} data-phrase-pads={variant}>
  <span class="pp-title" title="A/V phrases: Timeline sections published as pads. A pad plays its section of the Timeline (pieces, looks, lines, LEDs, sound and Live clips) from its start on the next bar.">Phrases</span>
  {#if pads.length}
    <div class="pp-pads" role="group" aria-label="Phrases">
      {#each pads as s, i (s.id)}
        <button
          class="pp-pad"
          class:on={status.activeId === s.id}
          class:waiting={status.pending?.id === s.id}
          style="--pad: {s.color}"
          onclick={() => launchPhrase(s.id)}
          title="{s.name}: plays from its start on the next bar. {endText(s)}. MIDI/OSC show:phrase:{i + 1}"
          data-midi-path="show:phrase:{i + 1}"
          data-midi-label="Phrase {i + 1}: {s.name}"
          data-phrase-pad={i + 1}
          data-phrase-id={s.id}
        >
          <span class="pp-num">{i + 1}</span>
          <span class="pp-name">{s.name}</span>
          {#if s.liveScene}<span class="pp-scene" aria-hidden="true">▶</span>{/if}
        </button>
      {/each}
      <button
        class="pp-stop"
        class:waiting={stopPending}
        class:idle={!status.activeId}
        onclick={() => stopPhrases()}
        title="Stop the phrases on the next bar. MIDI/OSC show:phrase:stop"
        aria-label="Stop the phrases on the next bar"
        data-midi-path="show:phrase:stop"
        data-midi-label="Stop phrases"
        data-phrase-stop
      >■</button>
    </div>
  {:else}
    <span class="pp-empty">Publish Timeline sections as phrases: click a section on the Timeline → Phrase.</span>
  {/if}
</div>

<style>
  .pp {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 10px;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    min-width: 0;
    box-sizing: border-box;
  }
  .pp.vj { padding: 4px 8px; border-bottom: 0; border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); background: rgba(0, 0, 0, 0.18); }
  .pp-title { font-size: var(--ga-text-eyebrow, 10px); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ga-ink-2, #888); flex: 0 0 auto; }
  .pp-pads { display: flex; gap: 4px; overflow-x: auto; min-width: 0; flex: 1 1 auto; }
  .pp-pad, .pp-stop {
    flex: 0 0 auto;
    height: 28px;
    box-sizing: border-box;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  .pp-pad {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 92px;
    max-width: 160px;
    padding: 0 8px 0 4px;
    color: var(--ga-ink-0, #eee);
    background: color-mix(in srgb, var(--pad) 18%, transparent);
    border: 1px solid color-mix(in srgb, var(--pad) 70%, transparent);
    border-left: 4px solid var(--pad);
  }
  .pp-pad:hover { background: color-mix(in srgb, var(--pad) 32%, transparent); }
  .pp-pad.on { background: var(--pad); color: #0b0b0e; box-shadow: 0 0 10px color-mix(in srgb, var(--pad) 80%, transparent); }
  .pp-pad.waiting, .pp-stop.waiting { animation: pp-blink 0.5s steps(2, jump-none) infinite; }
  .pp-num { font-weight: 800; font-size: 10px; min-width: 14px; text-align: center; opacity: 0.85; }
  .pp-name { overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
  .pp-scene { font-size: 9px; opacity: 0.75; }
  .pp-stop {
    width: 30px;
    color: var(--ga-ink-1, #bbb);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
  }
  .pp-stop.idle { opacity: 0.5; }
  .pp-empty { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  @keyframes pp-blink {
    0% { filter: brightness(1.6); }
    100% { filter: brightness(0.8); }
  }
</style>
