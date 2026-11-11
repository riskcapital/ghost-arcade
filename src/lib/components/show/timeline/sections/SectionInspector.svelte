<script lang="ts">
  /**
   * The selected section: its name, colour, span (in bars when the Timeline
   * has a tempo) and what happens at its end: play through, hold for GO,
   * loop until GO, jump (after N passes), or Live (pieces to the VJ decks
   * until GO).
   */
  import type { ShowLayerTrack, ShowTempoMap } from '../../../../types';
  import { showTimeline } from '../../../../stores/showTimeline';
  import { vjClipLauncher } from '../../../../stores/vjClipLauncher';
  import {
    SECTION_ACTIONS,
    SECTION_ACTION_LABELS,
    SECTION_COLORS,
    SECTION_KINDS,
    SECTION_KIND_NAMES,
    type SectionAction,
    type SectionKind,
    type SectionLiveSource,
    type TimelineSection,
  } from '../../../../timeline/sections/sectionModel';
  import { formatBarsBeats } from '../../../../show/tempoMap';
  import { abletonBridge } from '../../../../ableton/abletonBridge';
  import { PHRASE_ENDS, PHRASE_END_LABELS, phraseNumber, type PhraseEnd } from '../../../../timeline/phrases/phraseModel';
  import { formatPrecise } from '../timeFormat';

  interface Props {
    section: TimelineSection;
    sections: TimelineSection[];
    rows: ShowLayerTrack[];
    tempo: ShowTempoMap | null;
    onclose: () => void;
  }
  let { section, sections, rows, tempo, onclose }: Props = $props();

  const pieces = $derived(rows.filter((r) => !r.subRow));
  const groups = $derived(($vjClipLauncher as { groups?: Array<{ id: string; name: string }> }).groups ?? []);
  const others = $derived(sections.filter((s) => s.id !== section.id));
  const chosen = $derived(new Set(section.livePieces === 'all' || !section.livePieces ? [] : section.livePieces));
  const bridge = $derived($abletonBridge);
  const padNumber = $derived(section.phrase ? phraseNumber(sections, section.id) : 0);
  /** The link that makes the section's Live scene launch this phrase. */
  const sceneLink = $derived(section.liveScene
    ? bridge.links.find((l) => l.source.kind === 'scene' && l.action.kind === 'phrase' && l.action.sectionId === section.id) ?? null
    : null);

  function setPublished(on: boolean) {
    patch({ phrase: on ? { end: section.action === 'through' ? 'loop' : 'section' } : undefined });
    if (!on && sceneLink) abletonBridge.removeLink(sceneLink.id);
  }
  function setScene(value: string) {
    if (sceneLink) abletonBridge.removeLink(sceneLink.id);
    if (value === '') { patch({ liveScene: undefined }); return; }
    const scene = Number(value);
    patch({ liveScene: { scene, name: bridge.scenes[scene]?.name ?? section.liveScene?.name ?? '' } });
  }
  function setSceneLaunches(on: boolean) {
    const ref = section.liveScene;
    if (!ref) return;
    if (sceneLink) abletonBridge.removeLink(sceneLink.id);
    if (on) abletonBridge.addLink({ kind: 'scene', scene: ref.scene, name: ref.name }, { kind: 'phrase', sectionId: section.id, name: section.name });
  }

  function patch(p: Partial<TimelineSection>) {
    showTimeline.updateSection(section.id, p);
  }
  function setAction(action: SectionAction) {
    const p: Partial<TimelineSection> = { action };
    if (action === 'jump') { p.jumpTo = section.jumpTo ?? others[0]?.id ?? null; p.passes = section.passes ?? 1; }
    if (action === 'vamp') p.exit = section.exit ?? 'end';
    if (action === 'live') { p.livePieces = section.livePieces ?? 'all'; p.liveSource = section.liveSource ?? { kind: 'vjMix' }; }
    patch(p);
  }
  function sourceValue(src: SectionLiveSource | undefined): string {
    if (!src || src.kind === 'vjMix') return 'mix';
    if (src.kind === 'black') return 'black';
    if (src.kind === 'vjRow') return `row:${src.deck}:${src.row}`;
    return `group:${src.groupId}`;
  }
  function setSource(value: string) {
    let src: SectionLiveSource = { kind: 'vjMix' };
    if (value === 'black') src = { kind: 'black' };
    else if (value.startsWith('row:')) { const [, deck, row] = value.split(':'); src = { kind: 'vjRow', deck: deck === 'B' ? 'B' : 'A', row: Number(row) || 0 }; }
    else if (value.startsWith('group:')) { const id = value.slice(6); src = { kind: 'vjGroup', groupId: id, name: groups.find((g) => g.id === id)?.name }; }
    patch({ liveSource: src });
  }
  function togglePiece(layerId: string, on: boolean) {
    const next = new Set(chosen);
    if (on) next.add(layerId); else next.delete(layerId);
    patch({ livePieces: [...next] });
  }
  const at = (t: number) => (tempo ? `${formatBarsBeats(tempo, t)}` : formatPrecise(t));
  function commitTime(e: Event, edge: 'start' | 'end') {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    patch(edge === 'start' ? { start: Math.max(0, Math.min(v, section.end - 0.25)) } : { end: Math.max(section.start + 0.25, v) });
  }
</script>

<div class="show-inspector" data-section-inspector>
  <span class="insp-title">Section</span>
  <label class="insp-field">
    <span>Name</span>
    <input class="insp-name" type="text" value={section.name} onchange={(e) => patch({ name: (e.currentTarget as HTMLInputElement).value.trim() || section.name })} data-section-name-input />
  </label>
  <span class="insp-colors" role="radiogroup" aria-label="Colour">
    {#each SECTION_COLORS as c (c)}
      <button type="button" role="radio" class="insp-color" class:on={section.color === c} aria-checked={section.color === c} aria-label="Section colour" style:background={c} onclick={() => patch({ color: c })}></button>
    {/each}
  </span>
  <label class="insp-field">
    <span>Is</span>
    <select value={section.kind ?? 'other'} onchange={(e) => patch({ kind: (e.currentTarget as HTMLSelectElement).value as SectionKind })}>
      {#each SECTION_KINDS as k (k)}<option value={k}>{SECTION_KIND_NAMES[k]}</option>{/each}
    </select>
  </label>
  <label class="insp-field">
    <span>From</span>
    <input type="number" min="0" step="0.25" value={section.start.toFixed(2)} onchange={(e) => commitTime(e, 'start')} />
    <span class="insp-unit">s · {at(section.start)}</span>
  </label>
  <label class="insp-field">
    <span>To</span>
    <input type="number" min="0" step="0.25" value={section.end.toFixed(2)} onchange={(e) => commitTime(e, 'end')} />
    <span class="insp-unit">s · {at(section.end)}</span>
  </label>
  <label class="insp-field">
    <span>At the end</span>
    <select class="insp-action" value={section.action} onchange={(e) => setAction((e.currentTarget as HTMLSelectElement).value as SectionAction)} data-section-action>
      {#each SECTION_ACTIONS as a (a)}<option value={a}>{SECTION_ACTION_LABELS[a]}</option>{/each}
    </select>
  </label>
  {#if section.action === 'jump'}
    <label class="insp-field">
      <span>to</span>
      <select value={section.jumpTo ?? ''} onchange={(e) => patch({ jumpTo: (e.currentTarget as HTMLSelectElement).value || null })} data-section-jump>
        <option value="">Nothing (play through)</option>
        <option value={section.id}>{section.name} (itself)</option>
        {#each others as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
      </select>
    </label>
    <label class="insp-field" title="The section plays this many times, then jumps">
      <span>after</span>
      <input type="number" min="1" max="99" step="1" value={section.passes ?? 1} onchange={(e) => patch({ passes: Math.max(1, Math.round(parseFloat((e.currentTarget as HTMLInputElement).value) || 1)) })} data-section-passes />
      <span class="insp-unit">passes</span>
    </label>
  {:else if section.action === 'vamp'}
    <span class="insp-seg" role="radiogroup" aria-label="GO leaves the loop">
      <button type="button" role="radio" class:on={(section.exit ?? 'end') === 'end'} aria-checked={(section.exit ?? 'end') === 'end'} onclick={() => patch({ exit: 'end' })}>GO: at the end of the pass</button>
      <button type="button" role="radio" class:on={section.exit === 'bar'} aria-checked={section.exit === 'bar'} onclick={() => patch({ exit: 'bar' })}>GO: at the next bar</button>
    </span>
  {:else if section.action === 'live'}
    <label class="insp-field">
      <span>Shows</span>
      <select value={sourceValue(section.liveSource)} onchange={(e) => setSource((e.currentTarget as HTMLSelectElement).value)} data-section-live-source>
        <option value="mix">VJ mix</option>
        {#each [0, 1, 2, 3] as r (r)}<option value={`row:A:${r}`}>Deck A row {r + 1}</option>{/each}
        {#each [0, 1, 2, 3] as r (r)}<option value={`row:B:${r}`}>Deck B row {r + 1}</option>{/each}
        {#each groups as g (g.id)}<option value={`group:${g.id}`}>{g.name}</option>{/each}
        <option value="black">Black</option>
      </select>
    </label>
    <span class="insp-seg" role="radiogroup" aria-label="Pieces handed over">
      <button type="button" role="radio" class:on={section.livePieces === 'all' || !section.livePieces} aria-checked={section.livePieces === 'all'} onclick={() => patch({ livePieces: 'all' })}>All pieces</button>
      <button type="button" role="radio" class:on={Array.isArray(section.livePieces)} aria-checked={Array.isArray(section.livePieces)} onclick={() => patch({ livePieces: [...chosen] })}>Chosen ({chosen.size})</button>
    </span>
    {#if Array.isArray(section.livePieces)}
      <span class="insp-pieces" role="group" aria-label="Pieces the VJ decks take">
        {#each pieces as r (r.id)}
          <label class="insp-piece"><input type="checkbox" checked={chosen.has(r.layerId)} onchange={(e) => togglePiece(r.layerId, (e.currentTarget as HTMLInputElement).checked)} /><span class="layer-name">{r.layerName}</span></label>
        {/each}
      </span>
    {/if}
  {/if}
  <label class="insp-field insp-phrase" title="A pad that plays this section from its start on the next bar: VJ mode's Phrases strip, the Timeline's phrase strip, MIDI/OSC show:phrase:{padNumber || 'n'}">
    <input type="checkbox" checked={!!section.phrase} onchange={(e) => setPublished((e.currentTarget as HTMLInputElement).checked)} data-section-phrase />
    <span>Phrase{padNumber ? ` (pad ${padNumber})` : ''}</span>
  </label>
  {#if section.phrase}
    <label class="insp-field" title="What the phrase does at the section's end, until another phrase is launched">
      <span>As a phrase, at its end</span>
      <select value={section.phrase.end} onchange={(e) => patch({ phrase: { end: (e.currentTarget as HTMLSelectElement).value as PhraseEnd } })} data-section-phrase-end>
        {#each PHRASE_ENDS as end (end)}<option value={end}>{end === 'section' ? `${PHRASE_END_LABELS.section} (${SECTION_ACTION_LABELS[section.action]})` : PHRASE_END_LABELS[end]}</option>{/each}
      </select>
    </label>
  {/if}
  <label class="insp-field" title="Fires this Live scene where the section starts: when the Timeline plays into it, and when it is launched as a phrase">
    <span>Fires Live scene</span>
    <select value={section.liveScene ? String(section.liveScene.scene) : ''} onchange={(e) => setScene((e.currentTarget as HTMLSelectElement).value)} disabled={!bridge.connected && !section.liveScene} data-section-live-scene>
      <option value="">None</option>
      {#if section.liveScene && !bridge.scenes[section.liveScene.scene]}<option value={String(section.liveScene.scene)}>{section.liveScene.name || `Scene ${section.liveScene.scene + 1}`} (not in the set)</option>{/if}
      {#each bridge.scenes as sc, i (i)}<option value={String(i)}>{sc.name || `Scene ${i + 1}`}</option>{/each}
    </select>
  </label>
  {#if section.liveScene && section.phrase}
    <label class="insp-field insp-phrase" title="Launching the scene in Live (or from a controller) launches this phrase at once">
      <input type="checkbox" checked={!!sceneLink} onchange={(e) => setSceneLaunches((e.currentTarget as HTMLInputElement).checked)} data-section-scene-launches />
      <span>The scene in Live launches the phrase</span>
    </label>
  {/if}
  <span class="insp-hint">
    {#if section.action === 'hold'}The playhead stops on the section's end until GO; the song stops there too, blocks keep animating.
    {:else if section.action === 'vamp'}The section loops (its own bars) until GO; the song loops with it.
    {:else if section.action === 'jump'}Plays the section, then carries on from the start of the other one.
    {:else if section.action === 'live'}The pieces go to the VJ decks for the section; at its end the Timeline waits for GO, then takes them back.
    {:else}Plays on into what follows.{/if}
    Render to Video plays straight through.
  </span>
  <button class="insp-delete" onclick={() => showTimeline.removeSection(section.id)} data-section-delete>Delete</button>
  <button aria-label="Close section inspector" class="insp-close" onclick={onclose}>×</button>
</div>

<style>
  .show-inspector {
    display: flex; align-items: center; gap: 8px 12px; min-height: 36px; padding: 4px 12px;
    background: var(--ga-card, #121217); border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1, #bbb); flex: 0 0 auto; flex-wrap: wrap;
  }
  .insp-title { color: #FFD96B; font-weight: var(--ga-weight-control, 600); padding-right: 12px; border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-field input, .insp-field select {
    height: var(--ga-control-h-sm, 22px); background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8); font-size: var(--ga-text-control, 12px); padding: 0 6px; width: 64px; outline: none; font-family: inherit;
  }
  .insp-field input.insp-name { width: 120px; }
  .insp-field select { width: auto; }
  .insp-unit { color: var(--ga-ink-2, #888); }
  .insp-hint { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); }
  .insp-colors { display: flex; gap: 3px; }
  .insp-color { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.2); cursor: pointer; padding: 0; }
  .insp-color.on { box-shadow: 0 0 0 2px var(--ga-selection-line, #5278ff); }
  .insp-seg {
    display: flex; height: var(--ga-control-h-sm, 22px); padding: 1px; gap: 1px; box-sizing: border-box;
    background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: var(--ga-r-hard, 3px);
  }
  .insp-seg button { background: none; border: 0; border-radius: 2px; color: var(--ga-ink-1, #b9bdc8); padding: 0 8px; cursor: pointer; font: inherit; font-size: var(--ga-text-control, 12px); }
  .insp-seg button.on { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .insp-pieces { display: flex; flex-wrap: wrap; gap: 4px 10px; max-width: 520px; }
  .insp-phrase input { width: auto; height: auto; }
  .insp-piece { display: flex; align-items: center; gap: 4px; }
  .insp-delete {
    margin-left: auto; height: var(--ga-control-h-sm, 22px); background: transparent;
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4757) 40%, transparent); color: var(--ga-rec, #FF4757);
    font-size: var(--ga-text-control, 12px); padding: 0 10px; border-radius: var(--ga-r-hard, 3px); cursor: pointer; font-family: inherit;
  }
  .insp-close { background: none; border: none; color: var(--ga-ink-2, #888); font-size: 16px; cursor: pointer; padding: 2px 6px; line-height: 1; }
  .insp-close:hover { color: var(--ga-ink-0, #fff); }
</style>
