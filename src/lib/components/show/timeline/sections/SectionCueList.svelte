<script lang="ts">
  /**
   * The Timeline's cue list: its sections and markers in time order with a
   * big GO. The row the playhead is in is lit, the next one is marked NEXT,
   * and what GO will do now is spelled out. Click a row to go to its start.
   */
  import { showTimeline, showSectionStatus } from '../../../../stores/showTimeline';
  import { cueList } from '../../../../show/cueList';
  import { SECTION_ACTION_GLYPHS, SECTION_ACTION_LABELS, sectionAt, type TimelineSection } from '../../../../timeline/sections/sectionModel';
  import { formatPrecise } from '../timeFormat';
  import { goLabel } from './sectionGoUi';

  interface Props {
    sections: TimelineSection[];
    currentTime: number;
    playing: boolean;
  }
  let { sections, currentTime, playing }: Props = $props();

  const markers = $derived($cueList.markers.filter((m) => m.doc === 'timeline'));
  type Item = { kind: 'section'; time: number; s: TimelineSection } | { kind: 'marker'; time: number; id: string; label: string };
  const items = $derived<Item[]>([
    ...sections.map((s) => ({ kind: 'section' as const, time: s.start, s })),
    ...markers.map((m) => ({ kind: 'marker' as const, time: m.time, id: m.id, label: m.label || 'Marker' })),
  ].sort((a, b) => a.time - b.time));
  const here = $derived(sectionAt(sections, currentTime));
  const status = $derived($showSectionStatus);
  const nextIndex = $derived(items.findIndex((i) => i.time > currentTime + 1e-5));
  const go = $derived(goLabel(sections, status, currentTime, playing));
</script>

<div class="sec-cues" data-section-cues>
  <button class="sec-go" class:waiting={!!status.holdId} onclick={() => showTimeline.go()} title="GO (Enter while the pointer is over the Timeline; MIDI/OSC show/go)" data-midi-path="show:go" data-section-go-big>
    <span class="sec-go-word">GO</span>
    <span class="sec-go-what">{go}</span>
  </button>
  <ol class="sec-list">
    {#each items as item, i (item.kind === 'section' ? item.s.id : item.id)}
      {#if item.kind === 'section'}
        <li>
          <button class="sec-row" class:here={here?.id === item.s.id} class:next={i === nextIndex} class:hold={status.holdId === item.s.id}
            style="--sec: {item.s.color}" onclick={() => showTimeline.seek(item.s.start)} data-section-row={item.s.name}>
            <span class="sec-swatch"></span>
            <span class="sec-row-name item-name">{item.s.name}</span>
            <span class="sec-row-time">{formatPrecise(item.s.start)}</span>
            <span class="sec-row-action" title={SECTION_ACTION_LABELS[item.s.action]}>{SECTION_ACTION_GLYPHS[item.s.action]} {SECTION_ACTION_LABELS[item.s.action]}</span>
            {#if i === nextIndex}<span class="sec-next">NEXT</span>{/if}
          </button>
        </li>
      {:else}
        <li>
          <button class="sec-row marker" class:next={i === nextIndex} onclick={() => showTimeline.seek(item.time)}>
            <span class="sec-swatch marker"></span>
            <span class="sec-row-name">{item.label}</span>
            <span class="sec-row-time">{formatPrecise(item.time)}</span>
            <span class="sec-row-action">Marker</span>
            {#if i === nextIndex}<span class="sec-next">NEXT</span>{/if}
          </button>
        </li>
      {/if}
    {:else}
      <li class="sec-none">No sections yet: double-click the Sections row, or Score this song.</li>
    {/each}
  </ol>
</div>

<style>
  .sec-cues {
    width: 300px; max-width: 34vw; flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); background: var(--ga-card, #121217);
  }
  .sec-go {
    margin: 8px; min-height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
    background: #1d6b3a; border: 1px solid #2fa35a; border-radius: 6px; color: #eaffef; cursor: pointer; font-family: inherit;
  }
  .sec-go.waiting { background: #2fa35a; box-shadow: 0 0 0 2px rgba(47, 163, 90, 0.4); }
  .sec-go:hover { filter: brightness(1.1); }
  .sec-go-word { font-size: 20px; font-weight: 700; letter-spacing: 0.08em; }
  .sec-go-what { font-size: 11px; opacity: 0.9; }
  .sec-list { list-style: none; margin: 0; padding: 0 6px 8px; overflow-y: auto; flex: 1; }
  .sec-row {
    width: 100%; display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px; border: 1px solid transparent;
    background: none; color: var(--ga-ink-1, #bbb); font: inherit; font-size: 12px; cursor: pointer; text-align: left;
  }
  .sec-row:hover { background: rgba(255, 255, 255, 0.04); }
  .sec-row.here { background: color-mix(in srgb, var(--sec, #5b8def) 22%, transparent); color: var(--ga-ink-0, #fff); }
  .sec-row.next { border-color: #ffd36b; }
  .sec-row.hold { box-shadow: inset 3px 0 0 #ffd36b; }
  .sec-swatch { width: 8px; height: 14px; border-radius: 2px; background: var(--sec, #888); flex: 0 0 auto; }
  .sec-swatch.marker { background: #ffd36b; width: 4px; }
  .sec-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .sec-row-time { font-family: var(--ga-font-mono, ui-monospace, monospace); font-size: 11px; color: var(--ga-ink-2, #888); }
  .sec-row-action { font-size: 11px; color: var(--ga-ink-2, #888); white-space: nowrap; }
  .sec-next { font-size: 9px; font-weight: 700; color: #ffd36b; letter-spacing: 0.06em; }
  .sec-none { font-size: 11px; color: var(--ga-ink-2, #888); padding: 8px; }
</style>
