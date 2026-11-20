<script lang="ts">
  /**
   * The Timeline's Perform tab, everything for running the show in one
   * place:
   *
   * 1. GO, big, with the step on standby inside it and what GO will do;
   *    Back, Stop and Reset beside it. Space and Enter are GO while the list
   *    has focus (Enter anywhere over the Timeline), Shift+Space is Back.
   * 2. While anything is taken over: what took which row, how it returns,
   *    and Return (R).
   * 3. One cue list in show order: sections, markers and cues numbered once.
   *    NOW is the step the show is in, STANDBY the one GO acts on; steps
   *    passed are faded. Click a step to edit it, double-click to stand by
   *    on it.
   * 4. Pads (the VJ deck, takeover settings) and Phrases.
   *
   * It reads the show through slices and the Perform stores (NOW and STANDBY
   * change only when the step does), so a playing show only moves the
   * playhead here too.
   */
  import { get } from 'svelte/store';
  import { showTimeline, showSectionStatus } from '../../../../stores/showTimeline';
  import { cueList } from '../../../../show/cueList';
  import { compositions, layers as liveLayers } from '../../../../stores/layers';
  import { liveTakeover, takeoverSourceLabel, takeoverSummary, TAKEOVER_RELEASE_MODES, type TakeoverReleaseMode } from '../../../../show/takeover/liveTakeover';
  import { formatBarsBeats } from '../../../../show/tempoMap';
  import { makeSection, placeNewSection } from '../../../../timeline/sections/sectionModel';
  import { phraseSections } from '../../../../timeline/phrases/phraseModel';
  import { handStandby, nowId, performBack, performGo, performReset, performStack, performStop, standbyId, standByOn, goNowWords } from '../../../../timeline/perform/performGo';
  import { stackItemName, type StackItem } from '../../../../timeline/perform/cueStack';
  import { cueWords, sectionWords } from '../../../../timeline/perform/cueWords';
  import { showToast } from '../../../../stores/errorToast';
  import { showSlice } from '../timelineSlices';
  import { formatPrecise } from '../timeFormat';
  import { RELEASE_MODE_LABELS } from '../takeoverUi';
  import TimelineIcon from '../TimelineIcon.svelte';
  import TakeoverPads from '../../TakeoverPads.svelte';
  import PhrasePads from '../../PhrasePads.svelte';
  import CueListPanel from '../../CueListPanel.svelte';

  interface Props {
    selectedMarkerId: string | null;
    onselectmarker: (id: string | null) => void;
    onaddmarker: () => void;
  }
  let { selectedMarkerId, onselectmarker, onaddmarker }: Props = $props();

  const sectionsS = showSlice('sections');
  const selectionS = showSlice('selection');
  const playingS = showSlice('isPlaying');
  const tempoS = showSlice('tempo');
  const layerTracksS = showSlice('layerTracks');

  const stack = $derived($performStack);
  const status = $derived($showSectionStatus);
  const nowIndex = $derived(stack.findIndex((i) => i.id === $nowId));
  const standbyItem = $derived(stack.find((i) => i.id === $standbyId) ?? null);
  // What GO will do, worked out again only when a step or a status changes.
  const words = $derived.by(() => {
    void $standbyId; void $nowId; void status; void $playingS; void $handStandby; void stack;
    return goNowWords();
  });
  const fired = $derived(new Set($cueList.history.map((h) => h.cueId)));

  const names = {
    composition: (id: string) => $compositions.find((c) => c.id === id)?.name,
    layer: (id: string) => $liveLayers.find((l) => l.id === id)?.name,
  };

  function then(item: StackItem): string {
    if (item.kind === 'section') {
      const here = item.id === $nowId && $playingS;
      return sectionWords(item.section, $sectionsS, status.passes[item.id] ?? 0, here && item.section.action === 'vamp');
    }
    return cueWords(item.cue, names);
  }
  function at(item: StackItem): { bar: string; time: string } {
    if (item.time === null) return { bar: '', time: '' };
    return { bar: $tempoS ? formatBarsBeats($tempoS, item.time).split('.')[0] : '', time: formatPrecise(item.time) };
  }
  function isSelected(item: StackItem): boolean {
    if (item.kind === 'section') return $selectionS?.kind === 'section' && $selectionS.id === item.id;
    if (item.kind === 'marker') return selectedMarkerId === item.id;
    return $cueList.selectedCueId === item.id && !selectedMarkerId && $selectionS?.kind !== 'section';
  }
  function select(item: StackItem) {
    if (item.kind === 'section') {
      onselectmarker(null);
      showTimeline.select({ kind: 'section', id: item.id });
    } else if (item.kind === 'marker') {
      showTimeline.select(null);
      onselectmarker(item.id);
      if (item.marker.cueId) cueList.select(item.marker.cueId);
    } else {
      showTimeline.select(null);
      onselectmarker(null);
      cueList.select(item.cue.id);
    }
  }
  const selectedItem = $derived(stack.find((i) => isSelected(i)) ?? null);

  // ── Adding steps ──────────────────────────────────────────────────────
  function addCue() {
    const id = cueList.addCue({}, cueList.state.selectedCueId);
    cueList.select(id);
    onselectmarker(null);
    showTimeline.select(null);
  }
  function addSection() {
    const s = get(showTimeline);
    const span = placeNewSection(s.sections, s.tempo, s.currentTime);
    if (!span) {
      showToast('The playhead is inside a section already: move it to an empty stretch first.', 'info');
      return;
    }
    showTimeline.addSection(makeSection(s.sections, span.start, span.end));
  }

  // ── Taken over ─────────────────────────────────────────────────────────
  const takeover = $derived(takeoverSummary($liveTakeover));
  const release = $derived($liveTakeover.defaultRelease);
  const takenText = $derived.by(() => {
    if (!takeover.surfaces.length) return takeover.overlay ? `The VJ mix is over the show at ${Math.round(takeover.overlay.level * 100)}%` : '';
    const rowName = (trackId: string | null | undefined) => $layerTracksS.find((t) => t.id === trackId)?.layerName ?? 'A row';
    const first = takeover.surfaces[0];
    return `${rowName(first.trackId)} taken over by ${first.label}.`;
  });

  // ── Pads or phrases ────────────────────────────────────────────────────
  let padsTab: 'pads' | 'phrases' = $state('pads');
  const hasPhrases = $derived(phraseSections($sectionsS).length > 0);

  // ── Keys while the list has focus ──────────────────────────────────────
  function typing(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    const tag = el?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    // Ours: not the app-wide Space (play), nor a focused button's own click.
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.shiftKey) performBack();
    else performGo();
  }
  function onKeyup(e: KeyboardEvent) {
    if (e.code !== 'Space' || typing(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }
  const KIND_ICON = { section: null, marker: 'flag', cue: 'cues' } as const;
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="pf" tabindex="0" aria-label="Perform. Space or Enter is GO, Shift+Space is Back." onkeydown={onKeydown} onkeyup={onKeyup} data-perform>
  <div class="pf-go-block" data-help="GO: does the step on standby (or lets a holding or looping section go on). Space or Enter; MIDI or OSC show/go.">
    <button class="pf-go" class:waiting={!!status.holdId} onclick={() => performGo()} data-midi-path="show:go" data-midi-label="GO" data-midi-mode="toggle" data-perform-go data-section-go-big>
      <span class="pf-go-word">GO</span>
      <span class="pf-go-info">
        <span class="pf-tag">Standby</span>
        <b>{#if standbyItem}Q{standbyItem.q} · <span class="item-name">{stackItemName(standbyItem)}</span>{:else}End of the list{/if}</b>
        <small data-perform-go-words>{words}</small>
      </span>
    </button>
    <div class="pf-go-side">
      <button onclick={performBack} data-midi-path="show:back" data-midi-label="Back" data-midi-mode="toggle" title="Back: to the start of this step, or the one before (Shift+Space)"><TimelineIcon name="back" size={14} />Back</button>
      <button onclick={performStop} data-midi-path="show:stop" data-midi-label="Stop" data-midi-mode="toggle" title="Stop: the show pauses, the cue list stops; standby stays"><TimelineIcon name="stop" size={12} />Stop</button>
      <button onclick={performReset} data-midi-path="show:reset" data-midi-label="Reset" data-midi-mode="toggle" title="Reset: back to the start and the first cue"><TimelineIcon name="home" size={14} />Reset</button>
    </div>
  </div>

  {#if takeover.active}
    <div class="pf-taken" data-takeover-strip data-help="Taken over: rows playing the VJ decks instead of their blocks; the show runs on underneath. Return (R) hands them back, the way Return says.">
      <TimelineIcon name="live" size={16} />
      <p>{takenText}{#if takeover.surfaces.length > 1} <span>{takeover.surfaces.length - 1} more rows too.</span>{/if} <span>The show runs on underneath.</span></p>
      <label class="pf-ret-mode" title="How a row goes back to the Timeline: a cut, a fade, or on the next beat, bar, phrase (four bars) or marker">
        <span>Return:</span>
        <select value={release.mode} onchange={(e) => liveTakeover.setDefaultRelease({ mode: (e.currentTarget as HTMLSelectElement).value as TakeoverReleaseMode })} data-takeover-release-mode>
          {#each TAKEOVER_RELEASE_MODES as mode (mode)}<option value={mode}>{RELEASE_MODE_LABELS[mode]}</option>{/each}
        </select>
        {#if release.mode !== 'instant'}
          <input type="number" min="0" max="60" step="0.1" value={release.fadeSeconds}
            onchange={(e) => liveTakeover.setDefaultRelease({ fadeSeconds: parseFloat((e.currentTarget as HTMLInputElement).value) })}
            title="Fade length when a row goes back, seconds (0: a cut)" aria-label="Return fade, seconds" data-takeover-release-fade />
          <span>s</span>
        {/if}
      </label>
      <button class="pf-return" onclick={(e) => liveTakeover.release('all', e.shiftKey ? { mode: 'instant' } : undefined)} title="Hand every taken-over row back to the Timeline (R; Shift: instantly)" data-takeover-return-all>
        <TimelineIcon name="ret" size={14} />Return<span class="pf-key">R</span>
      </button>
    </div>
  {/if}

  <div class="pf-cues" data-help="The cue list: sections, markers and cues in show order. Click a step to edit it, double-click to stand by on it.">
    <div class="pf-head">
      <span class="pf-eyebrow">Cues</span>
      <span class="pf-hint">In show order. GO fires the one on standby.</span>
      <span class="pf-grow"></span>
      <button class="pf-add" onclick={addCue} title="A cue that waits for GO (its actions: presets, VJ, blackout…)" data-perform-add-cue><TimelineIcon name="plus" size={12} />Cue</button>
      <button class="pf-add" onclick={onaddmarker} title="A marker at the playhead: it fires the selected cue as the Timeline plays across it (M)" data-perform-add-marker><TimelineIcon name="flag" size={12} />Marker</button>
      <button class="pf-add" onclick={addSection} title="A section at the playhead (8 bars, or up to the next section)" data-perform-add-section><TimelineIcon name="sections" size={12} />Section</button>
    </div>
    <div class="pf-table" role="listbox" aria-label="Cue list">
      <div class="pf-row pf-cols" aria-hidden="true"><span>#</span><span>Name</span><span></span><span>At (bar · time)</span><span>Then</span></div>
      {#each stack as item, i (item.id)}
        {@const a = at(item)}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="pf-row"
          role="option"
          tabindex="-1"
          aria-selected={isSelected(item)}
          class:now={item.id === $nowId}
          class:standby={item.id === $standbyId}
          class:fired={(nowIndex >= 0 && i < nowIndex && item.time !== null) || (item.kind === 'cue' && fired.has(item.cue.id) && item.id !== $standbyId)}
          class:selected={isSelected(item)}
          onclick={() => select(item)}
          ondblclick={() => standByOn(item)}
          title="Click to edit, double-click to stand by on it"
          data-perform-row={item.kind}
          data-perform-q={item.q}
        >
          <span class="pf-q">{item.q < 10 ? `0${item.q}` : item.q}</span>
          <span class="pf-name">
            {#if item.kind === 'section'}<span class="pf-swatch" style:background={item.section.color}></span>{:else}<TimelineIcon name={KIND_ICON[item.kind]} size={13} />{/if}
            <span class="item-name">{stackItemName(item)}</span>
          </span>
          <span class="pf-badge">{#if item.id === $nowId}<b class="now">NOW</b>{:else if item.id === $standbyId}<b class="sb">STANDBY</b>{/if}</span>
          {#if item.time === null}
            <span class="pf-at"><span>On GO</span></span>
            <span class="pf-then"><span>Waits for GO</span> · <span>{then(item)}</span></span>
          {:else}
            <span class="pf-at"><span>{a.bar}</span><span class="pf-dot">·</span><span>{a.time}</span></span>
            <span class="pf-then">{then(item)}</span>
          {/if}
        </div>
      {:else}
        <p class="pf-none">No steps yet: + Section, + Marker or + Cue, or ✦ Auto show.</p>
      {/each}
    </div>
    {#if selectedItem && selectedItem.kind !== 'section'}
      <div class="pf-edit" data-perform-editor>
        {#if selectedItem.kind === 'marker'}
          {@const m = selectedItem.marker}
          <div class="pf-edit-row">
            <label>At <input type="number" min="0" step="0.25" value={m.time.toFixed(2)} onchange={(e) => cueList.updateMarker(m.id, { time: Math.max(0, parseFloat((e.currentTarget as HTMLInputElement).value) || 0) })} /> s</label>
            <label>Fires
              <select value={m.cueId ?? ''} onchange={(e) => cueList.updateMarker(m.id, { cueId: (e.currentTarget as HTMLSelectElement).value || null })} data-marker-cue>
                <option value="">No cue</option>
                {#each $cueList.cues as c (c.id)}<option value={c.id}>{c.number} {c.name}</option>{/each}
              </select>
            </label>
            <label>Label <input type="text" value={m.label} onchange={(e) => cueList.updateMarker(m.id, { label: (e.currentTarget as HTMLInputElement).value })} /></label>
            <button class="pf-del" onclick={() => { cueList.removeMarker(m.id); onselectmarker(null); }}>Delete marker</button>
          </div>
        {/if}
        {#if selectedItem.kind === 'cue' || (selectedItem.kind === 'marker' && selectedItem.marker.cueId)}
          <CueListPanel editorOnly stepNumber={selectedItem.q} />
        {/if}
      </div>
    {/if}
  </div>

  <div class="pf-pads" data-help="Pads: the VJ deck's clips. A row button takes the target row over with that row. Phrases: sections published as pads, launched on the next bar.">
    <div class="pf-head">
      <span class="pf-seg" role="tablist" aria-label="Pads or phrases">
        <button role="tab" class:on={padsTab === 'pads'} aria-selected={padsTab === 'pads'} onclick={() => (padsTab = 'pads')}><TimelineIcon name="pads" size={13} />Pads</button>
        <button role="tab" class:on={padsTab === 'phrases'} aria-selected={padsTab === 'phrases'} onclick={() => (padsTab = 'phrases')} data-perform-phrases-tab>Phrases</button>
      </span>
    </div>
    {#if padsTab === 'pads'}
      <TakeoverPads />
    {:else if hasPhrases}
      <PhrasePads variant="timeline" />
    {:else}
      <p class="pf-none">No phrases yet: publish a section as a phrase in its inspector, and it gets a pad here.</p>
    {/if}
  </div>
</section>

<style>
  .pf { display: flex; flex-direction: column; gap: 12px; outline: none; min-height: 100%; }
  .pf:focus-visible { box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .pf-go-block { display: flex; gap: 8px; }
  .pf-go {
    flex: 1;
    min-height: 76px;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 18px;
    border: 0;
    border-radius: var(--ga-r-soft, 8px);
    background: var(--ga-accent-gradient, linear-gradient(135deg, #f6fafd 0%, #cfdde9 42%, #92aabf 100%));
    color: #0b1020;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .pf-go:hover { filter: brightness(1.05); }
  .pf-go.waiting { box-shadow: 0 0 0 2px var(--tl-on, #ff725f); }
  .pf-go-word { font-size: 30px; font-weight: 850; letter-spacing: 0.04em; padding-right: 16px; border-right: 1px solid rgba(11, 16, 32, 0.2); }
  .pf-go-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .pf-tag { font-size: 10px; font-weight: 750; letter-spacing: 0.08em; text-transform: uppercase; color: #9a3a2c; }
  .pf-go-info b { font-size: var(--ga-text-heading, 16px); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-go-info small { font-size: var(--ga-text-meta, 11px); color: #2a3546; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-go-side { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; }
  .pf-go-side button, .pf-return, .pf-add {
    height: 24px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-card, #16140f);
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .pf-go-side button { min-width: 84px; }
  .pf-go-side button :global(.tl-icon), .pf-add :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .pf-go-side button:hover, .pf-add:hover { background: var(--ga-raise, #26221c); }
  .pf-taken {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--ga-r-hard, 5px);
    background: var(--tl-on-soft, rgba(255, 114, 95, 0.13));
    border: 1px solid var(--tl-on-line, rgba(255, 114, 95, 0.46));
    color: var(--tl-on-ink, #ffd9d2);
  }
  .pf-taken > :global(.tl-icon) { color: var(--tl-on, #ff725f); flex: 0 0 auto; }
  .pf-taken p { margin: 0; flex: 1; min-width: 0; font-size: var(--ga-text-control, 12px); line-height: 1.4; }
  .pf-ret-mode { display: inline-flex; align-items: center; gap: 4px; font-size: var(--ga-text-meta, 11px); white-space: nowrap; }
  .pf-ret-mode select, .pf-ret-mode input {
    height: 22px; background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: 4px; color: var(--ga-ink-0, #f2ede4); font: inherit;
  }
  .pf-ret-mode input { width: 44px; padding: 0 4px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .pf-return { border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); color: var(--tl-on, #ff725f); }
  .pf-return :global(.tl-icon) { color: var(--tl-on, #ff725f); }
  .pf-key { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 10px; padding: 0 4px; border: 1px solid var(--tl-on-line, rgba(255, 114, 95, 0.46)); border-radius: 3px; }
  .pf-head { display: flex; align-items: center; gap: 8px; min-height: 24px; }
  .pf-eyebrow { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #89857e); }
  .pf-hint { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-grow { flex: 1; }
  .pf-add { height: 22px; padding: 0 6px; border-color: transparent; background: transparent; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-meta, 11px); }
  .pf-cues { display: flex; flex-direction: column; gap: 4px; }
  .pf-table { display: flex; flex-direction: column; gap: 1px; }
  .pf-row {
    display: grid;
    grid-template-columns: 30px minmax(0, 1.2fr) 72px minmax(96px, 0.7fr) minmax(0, 1.3fr);
    align-items: center;
    gap: 8px;
    min-height: 25px;
    padding: 0 8px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 4px;
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #ada9a2);
    cursor: pointer;
  }
  .pf-row:not(.pf-cols):hover { background: rgba(245, 236, 222, 0.04); }
  .pf-cols { min-height: 20px; cursor: default; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #89857e); }
  .pf-row.fired { opacity: 0.42; }
  .pf-row.now { background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); box-shadow: inset 3px 0 0 var(--tl-on, #ff725f); color: var(--ga-ink-0, #f2ede4); }
  .pf-row.standby { border-color: var(--tl-on, #ff725f); color: var(--ga-ink-0, #f2ede4); }
  .pf-row.selected:not(.now) { background: var(--ga-raise, #26221c); }
  .pf-q { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 11px; color: var(--ga-ink-2, #89857e); }
  .pf-name { display: flex; align-items: center; gap: 8px; min-width: 0; color: var(--ga-ink-0, #f2ede4); font-weight: 600; }
  .pf-name :global(.tl-icon) { color: var(--ga-icon, #5278ff); flex: 0 0 auto; }
  .pf-name .item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pf-swatch { width: 8px; height: 14px; border-radius: 2px; flex: 0 0 auto; }
  .pf-badge b { display: inline-block; padding: 0 5px; border-radius: 3px; font-size: 9.5px; font-weight: 800; letter-spacing: 0.06em; line-height: 15px; }
  .pf-badge b.now { background: var(--tl-on, #ff725f); color: #1a0a06; }
  .pf-badge b.sb { box-shadow: inset 0 0 0 1px var(--tl-on, #ff725f); color: var(--tl-on, #ff725f); }
  .pf-at { display: flex; gap: 6px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 11px; color: var(--ga-ink-1, #ada9a2); white-space: nowrap; }
  .pf-dot { color: var(--ga-ink-3, #39342c); }
  .pf-then { font-size: var(--ga-text-meta, 11px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pf-none { margin: 4px 8px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .pf-edit { margin: 4px 0 2px; padding: 8px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card, #16140f); }
  .pf-edit-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .pf-edit-row label { display: inline-flex; align-items: center; gap: 6px; }
  .pf-edit-row input, .pf-edit-row select {
    height: 22px; background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: 4px; color: var(--ga-ink-0, #f2ede4); font: inherit; padding: 0 6px;
  }
  .pf-edit-row input[type='number'] { width: 64px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .pf-del { margin-left: auto; height: 22px; padding: 0 8px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: 4px; background: transparent; color: var(--tl-on, #ff725f); font: inherit; cursor: pointer; }
  .pf-pads { display: flex; flex-direction: column; gap: 8px; padding-top: 10px; border-top: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .pf-seg { display: inline-flex; padding: 2px; gap: 2px; background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: 5px; }
  .pf-seg button { height: 20px; padding: 0 8px; display: inline-flex; align-items: center; gap: 5px; border: 0; border-radius: 3px; background: transparent; color: var(--ga-ink-1, #ada9a2); font: inherit; font-size: var(--ga-text-control, 12px); font-weight: 600; cursor: pointer; }
  .pf-seg button :global(.tl-icon) { color: var(--ga-ink-1, #ada9a2); }
  .pf-seg button.on { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .pf-seg button.on :global(.tl-icon) { color: var(--ga-selection-ink, #e0e8ff); }
</style>
