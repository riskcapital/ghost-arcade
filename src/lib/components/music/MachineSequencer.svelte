<script lang="ts">
  /**
   * The drum machine's sequencer: the beat's parts, the steps of the part
   * being edited, and the song timeline that lays the parts end to end.
   *
   * A step: click turns it on or off; drag up or down on it sets how hard;
   * right-click adds a roll (2, 3, 4 hits, then back to 1); Alt-click lowers
   * its chance (100, 75, 50, 25%). A track's length handle makes it loop on
   * fewer steps than the part, for patterns that drift across the bar.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import {
    MAX_PARTS, PART_BARS, PART_KINDS, STEPS_PER_BAR, addBlock, clearTrack, duplicatePart, emptyPart, moveBlock,
    nudgeTrack, partSteps, removeBlock, resizeBlock, resizePart, setStep, setTrackLength, songBars, spreadHits,
    toggleMute, toggleStep, type PartBars, type PartKind,
  } from '../../music/drumMachine/machineBeat';
  import { machineKitById } from '../../music/drumMachine/machineKits';
  import { factoryBeats } from '../../music/drumMachine/machineFactory';
  import {
    deleteSavedBeat, editBeat, editPart, loadBeat, machineTransport, newBeat, playPad, saveBeatAs, savedBeats,
    selectPart, setMachineMode, toggleMachine,
  } from '../../music/drumMachine/machineRuntime';
  import { audioBpm } from '../../stores/audio';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';

  let { selected = $bindable(0) }: { selected?: number } = $props();

  const beat = $derived($musicStudio.machine);
  const t = $derived($machineTransport);
  const kit = $derived(machineKitById(beat.kitId));
  const partIndex = $derived(Math.min(t.part, beat.parts.length - 1));
  const part = $derived(beat.parts[partIndex]);
  const steps = $derived(part ? partSteps(part) : 16);

  let view = $state<'pattern' | 'song'>('pattern');
  /** The bar of a long part on screen. */
  let page = $state(0);
  let follow = $state(true);
  const pages = $derived(part ? part.bars : 1);
  const playingPage = $derived(t.step >= 0 && t.mode === 'part' ? Math.floor(t.step / STEPS_PER_BAR) : -1);
  const shownPage = $derived(follow && playingPage >= 0 ? playingPage : Math.min(page, pages - 1));

  // ── Steps ──
  let drag: { pad: number; step: number; y: number; vel: number; moved: boolean } | null = null;

  function stepDown(e: PointerEvent, pad: number, step: number) {
    if (!part) return;
    selected = pad;
    if (e.button === 2) return;
    if (e.altKey) {
      const c = part.tracks[pad].chance[step];
      const next = c > 0.8 ? 0.75 : c > 0.6 ? 0.5 : c > 0.3 ? 0.25 : 1;
      editPart((p) => setStep(p, pad, step, { chance: next, vel: p.tracks[pad].vel[step] || 0.85 }));
      return;
    }
    const vel = part.tracks[pad].vel[step];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { pad, step, y: e.clientY, vel, moved: false };
  }

  function stepMove(e: PointerEvent) {
    if (!drag || !part) return;
    const dy = drag.y - e.clientY;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    const base = drag.vel || 0.85;
    const vel = Math.max(0.05, Math.min(1, base + dy / 80));
    const { pad, step } = drag;
    editPart((p) => setStep(p, pad, step, { vel }));
  }

  function stepUp() {
    if (!drag) return;
    if (!drag.moved) {
      const { pad, step } = drag;
      editPart((p) => toggleStep(p, pad, step));
    }
    drag = null;
  }

  function stepRoll(e: MouseEvent, pad: number, step: number) {
    e.preventDefault();
    if (!part) return;
    const tr = part.tracks[pad];
    const roll = tr.vel[step] > 0 ? (tr.roll[step] % 4) + 1 : 2;
    editPart((p) => setStep(p, pad, step, { roll, vel: p.tracks[pad].vel[step] || 0.85 }));
  }

  // ── Track length handle ──
  let lenDrag: { pad: number; left: number; width: number } | null = null;
  function lenDown(e: PointerEvent, pad: number) {
    const row = (e.currentTarget as HTMLElement).parentElement!.querySelector('.cells') as HTMLElement;
    const r = row.getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    lenDrag = { pad, left: r.left, width: r.width };
    e.stopPropagation();
  }
  function lenMove(e: PointerEvent) {
    if (!lenDrag) return;
    const share = (e.clientX - lenDrag.left) / lenDrag.width;
    const length = shownPage * STEPS_PER_BAR + Math.max(1, Math.min(STEPS_PER_BAR, Math.round(share * STEPS_PER_BAR)));
    const pad = lenDrag.pad;
    editPart((p) => setTrackLength(p, pad, length));
  }

  // ── Parts ──
  function addPart() {
    if (beat.parts.length >= MAX_PARTS) return;
    const kinds: PartKind[] = ['loop', 'fill', 'break', 'build', 'drop'];
    const kind = kinds[beat.parts.length % kinds.length];
    const p = emptyPart(PART_KINDS.find((k) => k.id === kind)!.label, kind);
    editBeat((b) => ({ ...b, parts: [...b.parts, p] }));
    selectPart(beat.parts.length);
  }
  function copyPart() {
    if (!part || beat.parts.length >= MAX_PARTS) return;
    const copy = duplicatePart(part);
    editBeat((b) => ({ ...b, parts: [...b.parts.slice(0, partIndex + 1), copy, ...b.parts.slice(partIndex + 1)] }));
    selectPart(partIndex + 1);
  }
  function deletePart() {
    if (!part || beat.parts.length <= 1) return;
    const id = part.id;
    editBeat((b) => ({ ...b, parts: b.parts.filter((p) => p.id !== id), song: b.song.filter((x) => x.partId !== id) }));
    machineTransport.update((x) => ({ ...x, part: Math.max(0, partIndex - 1), queued: null }));
  }
  function renamePart(name: string) {
    editPart((p) => ({ ...p, name: name.slice(0, 40) || p.name }));
  }
  const LETTERS = 'ABCDEFGHIJKLMNOP';

  // ── Beats menu ──
  const factory = factoryBeats();
  let saving = $state(false);
  let saveName = $state('');
  function commitSave() {
    saveBeatAs(saveName);
    saving = false;
  }
  function onBeatMenu(value: string) {
    if (value === 'new') newBeat();
    else if (value === 'save') {
      saveName = beat.name;
      saving = true;
    } else if (value.startsWith('f:')) loadBeat(factory[Number(value.slice(2))]);
    else if (value.startsWith('s:')) {
      const saved = $savedBeats.find((x) => x.id === value.slice(2));
      if (saved) loadBeat(saved.beat);
    } else if (value.startsWith('d:')) {
      const saved = $savedBeats.find((x) => x.id === value.slice(2));
      if (saved) deleteSavedBeat(saved.id);
    }
  }

  // ── Song timeline ──
  const BAR_PX = 26;
  let laneEl = $state<HTMLElement | null>(null);
  type SongDrag = { kind: 'move'; from: number; x0: number; dx: number } | { kind: 'size'; id: string; x0: number; bars0: number };
  let songDrag = $state<SongDrag | null>(null);
  let dropAt = $state<number | null>(null);

  /** Where a point on the lane falls between blocks: the index a block dropped there goes to. */
  function insertIndex(clientX: number): number {
    if (!laneEl) return beat.song.length;
    const x = clientX - laneEl.getBoundingClientRect().left + laneEl.scrollLeft;
    let start = 0;
    for (let i = 0; i < beat.song.length; i++) {
      const w = beat.song[i].bars * BAR_PX;
      if (x < start + w / 2) return i;
      start += w;
    }
    return beat.song.length;
  }

  function blockDown(e: PointerEvent, i: number) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    songDrag = { kind: 'move', from: i, x0: e.clientX, dx: 0 };
  }
  function edgeDown(e: PointerEvent, id: string, bars: number) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    songDrag = { kind: 'size', id, x0: e.clientX, bars0: bars };
  }
  function songMove(e: PointerEvent) {
    const d = songDrag;
    if (!d) return;
    if (d.kind === 'size') {
      const bars = d.bars0 + Math.round((e.clientX - d.x0) / BAR_PX);
      editBeat((b) => ({ ...b, song: resizeBlock(b.song, d.id, bars) }));
    } else {
      songDrag = { ...d, dx: e.clientX - d.x0 };
      dropAt = Math.abs(e.clientX - d.x0) > 5 ? insertIndex(e.clientX) : null;
    }
  }
  function songUp() {
    const d = songDrag;
    if (d?.kind === 'move' && dropAt !== null) {
      const to = dropAt > d.from ? dropAt - 1 : dropAt;
      editBeat((b) => ({ ...b, song: moveBlock(b.song, d.from, to) }));
    }
    songDrag = null;
    dropAt = null;
  }

  // Parts dragged from the palette onto the lane.
  let paletteDrag = $state<{ partId: string } | null>(null);
  function paletteDown(e: PointerEvent, partId: string) {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    paletteDrag = { partId };
  }
  function paletteMove(e: PointerEvent) {
    if (!paletteDrag || !laneEl) return;
    const r = laneEl.getBoundingClientRect();
    dropAt = e.clientY >= r.top - 20 && e.clientY <= r.bottom + 20 ? insertIndex(e.clientX) : null;
  }
  function paletteUp() {
    if (!paletteDrag) return;
    const id = paletteDrag.partId;
    const p = beat.parts.find((x) => x.id === id);
    const at = dropAt ?? beat.song.length;
    editBeat((b) => ({ ...b, song: addBlock(b.song, id, p?.bars ?? 1, at) }));
    paletteDrag = null;
    dropAt = null;
  }

  const totalBars = $derived(songBars(beat.song));
  const songSeconds = $derived(Math.round((totalBars * 4 * 60) / Math.max(1, $audioBpm || 120)));
  function partOf(id: string) {
    return beat.parts.findIndex((p) => p.id === id);
  }
  const dropX = $derived(dropAt === null ? 0 : beat.song.slice(0, dropAt).reduce((s, b) => s + b.bars * BAR_PX, 0));
</script>

<StudioModule title="Drum machine" subtitle={beat.name} grow class="machine-seq">
  {#snippet head()}
    <div class="seg" role="tablist" aria-label="Sequencer view">
      <button role="tab" aria-selected={view === 'pattern'} class:on={view === 'pattern'} onclick={() => (view = 'pattern')}>Pattern</button>
      <button role="tab" aria-selected={view === 'song'} class:on={view === 'song'} onclick={() => (view = 'song')}>Song {totalBars ? `· ${totalBars} bars` : ''}</button>
    </div>
    {#if saving}
      <form class="save-form" onsubmit={(e) => { e.preventDefault(); commitSave(); }}>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="name-in" bind:value={saveName} autofocus aria-label="Beat name" onkeydown={(e) => { if (e.key === 'Escape') saving = false; }} />
        <button class="studio-btn" type="submit">Save</button>
        <button class="studio-btn" type="button" onclick={() => (saving = false)}>Cancel</button>
      </form>
    {/if}
    <select class="beats" value="" onchange={(e) => { const el = e.target as HTMLSelectElement; onBeatMenu(el.value); el.value = ''; }} aria-label="Beats" title="Load a beat, start a new one or save this one">
      <option value="" disabled>Beats…</option>
      <option value="save">Save beat as…</option>
      <option value="new">New beat</option>
      <optgroup label="Factory">
        {#each factory as f, i (i)}<option value="f:{i}">{f.name}</option>{/each}
      </optgroup>
      {#if $savedBeats.length}
        <optgroup label="Saved on this computer">
          {#each $savedBeats as sb (sb.id)}<option value="s:{sb.id}">{sb.name}</option>{/each}
        </optgroup>
        <optgroup label="Delete">
          {#each $savedBeats as sb (sb.id)}<option value="d:{sb.id}">Delete {sb.name}</option>{/each}
        </optgroup>
      {/if}
    </select>
    <div class="seg" role="radiogroup" aria-label="What plays">
      <button role="radio" aria-checked={t.mode === 'part'} class:on={t.mode === 'part'} onclick={() => setMachineMode('part')} title="Loop the selected part; picking another part switches on the next bar">Loop part</button>
      <button role="radio" aria-checked={t.mode === 'song'} class:on={t.mode === 'song'} onclick={() => setMachineMode('song')} title="Play the song timeline from the top, then round again">Play song</button>
    </div>
    <button class="studio-btn rec" class:on={t.record} aria-pressed={t.record} onclick={() => machineTransport.update((x) => ({ ...x, record: !x.record }))} title="Pads you play go onto the part, on the nearest step, while it plays">Rec</button>
    <button class="studio-btn play" class:on={t.playing} aria-pressed={t.playing} onclick={toggleMachine} title={t.playing ? 'Stop the drum machine' : 'Start the drum machine; it keeps playing in every set'} data-midi-path="studio:machine.toggle" data-midi-label="Drum machine play or stop" data-midi-mode="toggle">{t.playing ? 'Stop' : 'Play'}</button>
  {/snippet}

  {#if view === 'pattern' && part}
    <div class="pattern">
      <div class="parts">
        {#each beat.parts as p, i (p.id)}
          <button
            class="part"
            class:on={i === partIndex}
            class:queued={t.queued === i}
            class:live={t.playing && t.mode === 'part' && i === partIndex}
            onclick={() => selectPart(i)}
            title="{p.name}: {p.bars} bar{p.bars > 1 ? 's' : ''}. While playing, it comes in on the next bar."
          ><span class="letter">{LETTERS[i]}</span><span class="pname">{p.name}</span></button>
        {/each}
        <div class="part-tools">
          <button class="studio-btn" onclick={addPart} disabled={beat.parts.length >= MAX_PARTS} title="A new empty part">New</button>
          <button class="studio-btn" onclick={copyPart} disabled={beat.parts.length >= MAX_PARTS} title="A copy of this part, to make a variation">Copy</button>
          <button class="studio-btn" onclick={deletePart} disabled={beat.parts.length <= 1} title="Delete this part (and its blocks in the song)">Delete</button>
        </div>
      </div>

      <div class="grid-wrap">
        <div class="part-bar">
          <input class="name-in" value={part.name} onchange={(e) => renamePart((e.target as HTMLInputElement).value)} aria-label="Part name" />
          <select value={part.kind} onchange={(e) => editPart((p) => ({ ...p, kind: (e.target as HTMLSelectElement).value as PartKind }))} aria-label="What the part is">
            {#each PART_KINDS as k (k.id)}<option value={k.id}>{k.label}</option>{/each}
          </select>
          <div class="seg small" role="radiogroup" aria-label="Length in bars">
            {#each PART_BARS as n (n)}
              <button role="radio" aria-checked={part.bars === n} class:on={part.bars === n} onclick={() => editPart((p) => resizePart(p, n as PartBars))}>{n} bar{n > 1 ? 's' : ''}</button>
            {/each}
          </div>
          {#if pages > 1}
            <div class="seg small" role="tablist" aria-label="Bar shown">
              {#each Array.from({ length: pages }, (_, i) => i) as pg (pg)}
                <button role="tab" aria-selected={shownPage === pg} class:on={shownPage === pg} class:playing={playingPage === pg} onclick={() => { page = pg; follow = false; }}>{pg + 1}</button>
              {/each}
              <button class:on={follow} aria-pressed={follow} onclick={() => (follow = !follow)} title="Show the bar that is playing">Follow</button>
            </div>
          {/if}
          <span class="spacer"></span>
          <StudioKnob label="Swing" value={part.swing / 0.5} defaultValue={0} size={26} onchange={(v) => editPart((p) => ({ ...p, swing: v * 0.5 }))} format={(v) => `${Math.round(v * 100)}%`} />
          <span class="hint">Drag a step for velocity · right-click: roll · Alt-click: chance</span>
        </div>

        <div class="rows" role="grid" aria-label="Steps">
          {#each part.tracks as tr, pad (pad)}
            {@const solo = t.solo === pad}
            <div class="row" class:sel={selected === pad} class:muted={tr.mute || (t.solo !== null && !solo)} role="row">
              <button class="rname" onclick={() => { selected = pad; playPad(pad, 0.85); }} title="Play {kit.pads[pad].name}">{kit.pads[pad].name}</button>
              <button class="tiny" class:on={tr.mute} aria-pressed={tr.mute} onclick={() => editPart((p) => toggleMute(p, pad))} title="Mute this track">M</button>
              <button class="tiny" class:on={solo} aria-pressed={solo} onclick={() => machineTransport.update((x) => ({ ...x, solo: x.solo === pad ? null : pad }))} title="Hear only this track">S</button>
              <div class="cells" role="presentation">
                {#each Array.from({ length: STEPS_PER_BAR }, (_, i) => shownPage * STEPS_PER_BAR + i) as st (st)}
                  {@const vel = tr.vel[st] ?? 0}
                  {@const outside = st >= tr.length}
                  <button
                    class="cell g{Math.floor((st % 16) / 4)}"
                    class:on={vel > 0}
                    class:outside
                    class:head={t.step >= 0 && (t.mode === 'part' || t.block >= 0) && st === t.step % steps && !outside}
                    class:chance={vel > 0 && tr.chance[st] < 1}
                    style="--vel: {vel}"
                    onpointerdown={(e) => stepDown(e, pad, st)}
                    onpointermove={stepMove}
                    onpointerup={stepUp}
                    oncontextmenu={(e) => stepRoll(e, pad, st)}
                    role="gridcell"
                    aria-label="{kit.pads[pad].name} step {st + 1}{vel > 0 ? `, on at ${Math.round(vel * 100)}%` : ', off'}"
                    title={vel > 0 ? `${Math.round(vel * 100)}%${tr.roll[st] > 1 ? `, roll of ${tr.roll[st]}` : ''}${tr.chance[st] < 1 ? `, plays ${Math.round(tr.chance[st] * 100)}% of the time` : ''}` : ''}
                  >{#if vel > 0 && tr.roll[st] > 1}<span class="roll">{tr.roll[st]}</span>{/if}</button>
                {/each}
                {#if tr.length < steps && Math.floor((tr.length - 1) / STEPS_PER_BAR) === shownPage}
                  <span class="len" style="left: calc({((tr.length - shownPage * STEPS_PER_BAR) / STEPS_PER_BAR) * 100}% - 3px)" onpointerdown={(e) => lenDown(e, pad)} onpointermove={lenMove} onpointerup={() => (lenDrag = null)} role="slider" aria-label="Track length" aria-valuenow={tr.length} tabindex="-1" title="Track length: {tr.length} steps. Drag to change."></span>
                {/if}
              </div>
              <span class="lenval" title="Steps before this track loops; drag the handle on the right of a step to set">
                <button class="tiny" onclick={() => editPart((p) => setTrackLength(p, pad, tr.length - 1))} aria-label="Shorter track">−</button>{tr.length}<button class="tiny" onclick={() => editPart((p) => setTrackLength(p, pad, tr.length + 1))} aria-label="Longer track">+</button>
              </span>
            </div>
          {/each}
        </div>
        <div class="track-tools">
          <span class="ga-eyebrow">{kit.pads[selected].name}</span>
          <button class="studio-btn" onclick={() => editPart((p) => nudgeTrack(p, selected, -1))} title="Move this track's hits a step earlier">← Shift</button>
          <button class="studio-btn" onclick={() => editPart((p) => nudgeTrack(p, selected, 1))} title="Move this track's hits a step later">Shift →</button>
          <span class="ga-eyebrow legend">Spread</span>
          {#each [3, 4, 5, 7] as n (n)}
            <button class="studio-btn" onclick={() => editPart((p) => spreadHits(p, selected, n))} title="Put {n} hits as evenly as they go over this track's length">{n}</button>
          {/each}
          <button class="studio-btn" onclick={() => editPart((p) => clearTrack(p, selected))} title="Clear this track">Clear</button>
        </div>
      </div>
    </div>
  {:else if view === 'song'}
    <div class="song">
      <div class="palette">
        <span class="ga-eyebrow">Parts: drag onto the timeline, or click to add at the end</span>
        <div class="chips">
          {#each beat.parts as p, i (p.id)}
            <button
              class="chip k-{p.kind}"
              onpointerdown={(e) => paletteDown(e, p.id)}
              onpointermove={paletteMove}
              onpointerup={paletteUp}
              title="{p.name}: {p.bars} bar{p.bars > 1 ? 's' : ''}"
            ><span class="letter">{LETTERS[i]}</span>{p.name}</button>
          {/each}
        </div>
        <span class="meta">{totalBars} bars · {Math.floor(songSeconds / 60)}:{String(songSeconds % 60).padStart(2, '0')} at {Math.round($audioBpm || 120)} BPM</span>
      </div>
      <div class="lane" bind:this={laneEl} onpointermove={songMove} onpointerup={songUp} role="list" aria-label="Song timeline">
        <div class="ruler" style="width: {Math.max(totalBars + 8, 32) * BAR_PX}px">
          {#each Array.from({ length: Math.max(totalBars + 8, 32) }, (_, i) => i) as b (b)}
            <span class="tick" class:four={b % 4 === 0} style="left: {b * BAR_PX}px">{b % 4 === 0 ? b + 1 : ''}</span>
          {/each}
        </div>
        <div class="blocks">
          {#each beat.song as blk, i (blk.id)}
            {@const pi = partOf(blk.partId)}
            {@const p = beat.parts[pi]}
            <div
              class="block k-{p?.kind ?? 'loop'}"
              class:live={t.playing && t.mode === 'song' && t.block === i}
              class:lifted={songDrag?.kind === 'move' && songDrag.from === i && dropAt !== null}
              style="width: {blk.bars * BAR_PX - 2}px"
              onpointerdown={(e) => blockDown(e, i)}
              oncontextmenu={(e) => { e.preventDefault(); editBeat((b) => ({ ...b, song: removeBlock(b.song, blk.id) })); }}
              role="listitem"
              title="{p?.name}: {blk.bars} bar{blk.bars > 1 ? 's' : ''}. Drag to move, drag its right edge to lengthen or shorten, right-click to remove."
            >
              <span class="bname"><span class="letter">{LETTERS[pi]}</span>{p?.name}</span>
              <span class="bbars">{blk.bars}</span>
              <span class="edge" onpointerdown={(e) => edgeDown(e, blk.id, blk.bars)} role="slider" aria-label="Block length" aria-valuenow={blk.bars} tabindex="-1"></span>
            </div>
          {/each}
          {#if dropAt !== null}<span class="drop-at" style="left: {dropX}px"></span>{/if}
          {#if t.playing && t.mode === 'song' && t.songBar >= 0}
            <span class="song-head" style="left: {t.songBar * BAR_PX}px"></span>
          {/if}
        </div>
        {#if !beat.song.length}<p class="empty">Drag parts here to build the song.</p>{/if}
      </div>
    </div>
  {/if}
</StudioModule>

<style>
  .seg { display: inline-flex; border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); overflow: hidden; }
  .seg button { border: 0; background: transparent; color: var(--studio-ink-1); padding: 0 8px; height: 22px; font: inherit; font-size: 11px; cursor: pointer; }
  .seg button + button { border-left: 1px solid var(--studio-edge-soft); }
  .seg button.on { color: var(--studio-on-accent); background: var(--studio-accent); }
  .seg button.playing:not(.on) { color: var(--studio-accent); }
  .seg.small button { padding: 0 6px; font-size: 10px; height: 20px; }
  .beats { max-width: 120px; }
  .save-form { display: inline-flex; gap: 4px; }
  .play { min-width: 52px; }

  .pattern { display: flex; gap: 10px; min-height: 0; height: 100%; }
  .parts { flex: 0 0 132px; display: flex; flex-direction: column; gap: 3px; overflow-y: auto; scrollbar-width: thin; }
  .part {
    display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 6px;
    border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius);
    background: var(--studio-cell); color: var(--studio-ink); font: inherit; font-size: 11px; cursor: pointer; text-align: left;
  }
  .part.on { border-color: var(--studio-accent); }
  .part.queued { border-style: dashed; border-color: var(--studio-accent); }
  .part.live .letter { background: var(--studio-accent); color: var(--studio-on-accent); }
  .letter { display: inline-grid; place-items: center; width: 15px; height: 15px; border-radius: 2px; background: var(--studio-slot); font-size: 9px; flex: 0 0 auto; }
  .pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .part-tools { display: flex; gap: 3px; margin-top: 4px; flex-wrap: wrap; }
  .part-tools .studio-btn { flex: 1; padding: 0 4px; font-size: 10px; }

  .grid-wrap { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .part-bar { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; min-width: 0; }
  .name-in { width: 92px; height: 22px; border: 1px solid var(--studio-edge); background: var(--studio-slot); color: var(--studio-ink); border-radius: var(--studio-radius); padding: 0 6px; font: inherit; font-size: 11px; }
  .spacer { flex: 1; }
  .hint { font-size: 10px; color: var(--studio-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; flex: 0 1 auto; }

  .rows { display: flex; flex-direction: column; gap: 1px; flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; }
  .row { display: flex; align-items: center; gap: 3px; height: 13px; flex: 0 0 auto; }
  .row.muted { opacity: 0.4; }
  .rname { flex: 0 0 76px; height: 13px; padding: 0 4px; border: 0; background: transparent; color: var(--studio-ink-1); font: inherit; font-size: 10px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
  .row.sel .rname { color: var(--studio-accent); }
  .tiny { flex: 0 0 auto; width: 15px; height: 13px; padding: 0; border: 1px solid var(--studio-edge-soft); border-radius: 2px; background: transparent; color: var(--studio-muted); font: inherit; font-size: 8px; cursor: pointer; line-height: 1; }
  .tiny.on { color: var(--studio-on-accent); background: var(--studio-accent); border-color: var(--studio-accent); }
  .cells { position: relative; flex: 1; display: grid; grid-template-columns: repeat(16, 1fr); gap: 2px; height: 13px; }
  .cells > .cell:nth-child(4n + 1):not(:first-child) { margin-left: 3px; }
  .cell { position: relative; padding: 0; border: 1px solid var(--studio-edge-soft); border-radius: 2px; background: var(--studio-slot); cursor: pointer; overflow: hidden; touch-action: none; }
  /* The four groups of a bar, each in its own tint, as on the old rhythm machines. */
  .cell.g0 { --tint: #e8492f; }
  .cell.g1 { --tint: #f08a2c; }
  .cell.g2 { --tint: #f2c84b; }
  .cell.g3 { --tint: #efe6d2; }
  .cell.on { background: color-mix(in srgb, var(--tint) calc(35% + var(--vel) * 65%), var(--studio-slot)); border-color: var(--tint); }
  .cell.chance { border-style: dashed; }
  .cell.outside { opacity: 0.25; }
  .cell.head { box-shadow: inset 0 0 0 1px var(--studio-ink); }
  .roll { position: absolute; inset: 0; font-size: 8px; line-height: 11px; color: #111; text-align: center; }
  .len { position: absolute; top: -1px; bottom: -1px; width: 6px; border-radius: 2px; background: var(--studio-ink); cursor: ew-resize; touch-action: none; }
  .lenval { flex: 0 0 44px; display: inline-flex; align-items: center; justify-content: space-between; font-size: 9px; color: var(--studio-muted); }
  .track-tools { display: flex; align-items: center; gap: 4px; }
  .track-tools .studio-btn { padding: 0 6px; font-size: 10px; height: 20px; }

  .song { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
  .palette { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px 0 4px; border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); background: var(--studio-cell); color: var(--studio-ink); font: inherit; font-size: 11px; cursor: grab; touch-action: none; }
  .meta { margin-left: auto; font-size: 11px; color: var(--studio-muted); }
  .lane { position: relative; flex: 1; min-height: 90px; overflow-x: auto; overflow-y: hidden; border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius); background: var(--studio-slot); scrollbar-width: thin; }
  .ruler { position: relative; height: 16px; border-bottom: 1px solid var(--studio-edge-soft); }
  .tick { position: absolute; top: 0; height: 100%; border-left: 1px solid var(--studio-edge-soft); padding-left: 3px; font-size: 9px; color: var(--studio-muted); }
  .tick.four { border-left-color: var(--studio-edge); }
  .blocks { position: relative; display: flex; gap: 2px; padding: 8px 0; height: 60px; }
  .block {
    position: relative; flex: 0 0 auto; height: 100%; box-sizing: border-box; padding: 4px 8px 4px 5px;
    border: 1px solid var(--studio-edge); border-radius: var(--studio-radius);
    background: var(--studio-cell); color: var(--studio-ink); cursor: grab; overflow: hidden; touch-action: none;
    display: flex; flex-direction: column; justify-content: space-between;
  }
  .block.live { border-color: var(--studio-accent); }
  .block.lifted { opacity: 0.5; }
  .bname { display: flex; align-items: center; gap: 4px; font-size: 11px; white-space: nowrap; }
  .bbars { font-size: 9px; color: var(--studio-muted); }
  .edge { position: absolute; top: 0; right: 0; bottom: 0; width: 8px; cursor: ew-resize; border-right: 2px solid var(--studio-edge); }
  .edge:hover { border-right-color: var(--studio-accent); }
  /* Each kind of part keeps one tint from the step row, so a song reads at a glance. */
  .k-loop, .k-drop { --kt: #e8492f; }
  .k-fill, .k-build { --kt: #f08a2c; }
  .k-break { --kt: #f2c84b; }
  .k-intro, .k-outro { --kt: #efe6d2; }
  .block, .chip { background: color-mix(in srgb, var(--kt) 18%, var(--studio-cell)); }
  .block .letter, .chip .letter { background: var(--kt); color: #111; }
  .drop-at { position: absolute; top: 4px; bottom: 4px; width: 2px; margin-left: -2px; background: var(--studio-accent); }
  .song-head { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--studio-ink); pointer-events: none; transition: left 0.1s linear; }
  .empty { position: absolute; left: 12px; top: 40px; margin: 0; color: var(--studio-muted); font-size: 11px; }
</style>
