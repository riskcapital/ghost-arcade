<script lang="ts">
  /**
   * The quick MIDI editor, docked under the loop tracks: a small piano roll
   * for one track's loop. Draw adds a note where you click (double-click a
   * note to delete it), Erase deletes what you click, Select picks a note to
   * nudge with the arrows (Shift: a bar or an octave). Drag a note's right
   * edge to change its length and a velocity bar to change how hard it plays.
   * Quantise snaps (all of it, or the shown layer) by a strength; Transpose,
   * Halve and Double change the whole loop. Layer chips show one layer at a
   * time (edits then go to it). Open full editor puts the loop in the session
   * and opens the clip editor on it.
   */
  import { get } from 'svelte/store';
  import { musicStudio } from '../../music/musicStudioStore';
  import { loopStationView, setTrackLayers } from '../../music/loopStation';
  import { beatNow, trackProgress } from '../../music/loopUi';
  import { flattenMidi, type MidiLayer } from '../../music/loopTrack';
  import { addNote, doubleLoop, halveLoop, nudgeNote, quantizeLayer, removeNote, resizeNote, setVelocity, transposeLayer } from '../../music/quickEdit';
  import { isBlackKey, noteName } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { clipEditorId } from '../../music/studioUi';
  import { clipFromRecording } from '../../music/session';
  import { roleForRecording, type RecordedLoop } from '../../music/loopRecorder';
  import { generateUUID } from '../../utils/uuid';

  let { index, onclose, onsave }: { index: number; onclose?: () => void; onsave?: () => void } = $props();

  type Tool = 'draw' | 'erase' | 'select';
  const GRIDS = [
    { id: '1/32', beats: 1 / 8 },
    { id: '1/16', beats: 1 / 4 },
    { id: '1/8', beats: 1 / 2 },
    { id: '1/4', beats: 1 },
  ];
  const STRENGTHS = [1, 0.75, 0.5];
  const ROW = 16;
  const VEL_H = 54;

  const s = $derived($musicStudio);
  const t = $derived(s.loopStation.tracks[index]);
  const v = $derived($loopStationView.tracks[index]);
  const beats = $derived(t.beats);
  const bars = $derived(Math.max(1, Math.round(beats / 4)));

  let tool = $state<Tool>('draw');
  let grid = $state(1 / 4);
  let strength = $state(1);
  /** -1 shows every layer. */
  let shownLayer = $state(-1);
  let selected = $state<{ layer: number; i: number } | null>(null);
  let rollEl = $state<HTMLDivElement | null>(null);

  const notes = $derived(flattenMidi({ layers: t.layers, redo: [] }));
  const range = $derived.by(() => {
    const pitches = notes.map((n) => n.note);
    let lo = pitches.length ? Math.min(...pitches) - 3 : 55;
    let hi = pitches.length ? Math.max(...pitches) + 3 : 79;
    while (hi - lo < 15) {
      lo--;
      hi++;
    }
    return { lo: Math.max(0, lo), hi: Math.min(127, hi) };
  });
  const rows = $derived(Array.from({ length: range.hi - range.lo + 1 }, (_, k) => range.hi - k));
  const editLayer = $derived(shownLayer >= 0 ? Math.min(shownLayer, t.layers.length - 1) : t.layers.length - 1);
  const sel = $derived(selected && t.layers[selected.layer]?.[selected.i] ? { ...t.layers[selected.layer][selected.i], ...selected } : null);

  function commit(layers: MidiLayer[], newBeats = beats) {
    setTrackLayers(index, layers, newBeats);
  }

  function withLayer(li: number, edit: (l: MidiLayer) => MidiLayer): MidiLayer[] {
    return t.layers.map((l, k) => (k === li ? edit(l) : l));
  }

  function pos(e: PointerEvent | MouseEvent): { beat: number; note: number } | null {
    const r = rollEl?.getBoundingClientRect();
    if (!r) return null;
    const beat = ((e.clientX - r.left) / r.width) * beats;
    const note = range.hi - Math.floor((e.clientY - r.top) / ROW);
    return { beat, note };
  }

  function clickRoll(e: MouseEvent) {
    if (e.target !== e.currentTarget) return;
    const p = pos(e);
    if (!p || tool !== 'draw' || editLayer < 0) return;
    const beat = Math.floor(p.beat / grid) * grid;
    const layers = withLayer(editLayer, (l) => addNote(l, beat, p.note, grid, 0.8, beats));
    commit(layers);
    const i = layers[editLayer].findIndex((n) => Math.abs(n.beat - beat) < 1e-6 && n.note === p.note);
    selected = { layer: editLayer, i };
  }

  function clickNote(e: MouseEvent, layer: number, i: number) {
    e.stopPropagation();
    if (tool === 'erase') {
      commit(withLayer(layer, (l) => removeNote(l, i)));
      selected = null;
    } else selected = { layer, i };
  }

  function dblNote(e: MouseEvent, layer: number, i: number) {
    e.stopPropagation();
    commit(withLayer(layer, (l) => removeNote(l, i)));
    selected = null;
  }

  let resizing: { layer: number; i: number; startX: number; dur: number } | null = null;
  function edgeDown(e: PointerEvent, layer: number, i: number) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizing = { layer, i, startX: e.clientX, dur: t.layers[layer][i].dur };
  }
  function edgeMove(e: PointerEvent) {
    if (!resizing || !rollEl) return;
    const perBeat = rollEl.getBoundingClientRect().width / beats;
    const raw = resizing.dur + (e.clientX - resizing.startX) / perBeat;
    const dur = Math.max(grid, Math.round(raw / grid) * grid);
    const r = resizing;
    commit(withLayer(r.layer, (l) => resizeNote(l, r.i, dur, beats)));
  }
  function edgeUp() {
    resizing = null;
  }

  function velDown(e: PointerEvent, layer: number, i: number) {
    const lane = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const set = (y: number) => commit(withLayer(layer, (l) => setVelocity(l, i, 1 - (y - lane.top) / lane.height)));
    set(e.clientY);
    selected = { layer, i };
    const move = (ev: PointerEvent) => set(ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function key(e: KeyboardEvent) {
    if (!sel || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    const big = e.shiftKey;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-(big ? 4 : grid), 0],
      ArrowRight: [big ? 4 : grid, 0],
      ArrowUp: [0, big ? 12 : 1],
      ArrowDown: [0, big ? -12 : -1],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      e.stopPropagation();
      const { layer, i } = sel;
      commit(withLayer(layer, (l) => nudgeNote(l, i, m[0], m[1], beats)));
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      e.stopPropagation();
      const { layer, i } = sel;
      commit(withLayer(layer, (l) => removeNote(l, i)));
      selected = null;
    }
  }

  function quantise() {
    commit(t.layers.map((l, k) => (shownLayer < 0 || k === shownLayer ? quantizeLayer(l, grid, strength, beats) : l)));
  }

  function transpose(n: number) {
    commit(t.layers.map((l, k) => (shownLayer < 0 || k === shownLayer ? transposeLayer(l, n) : l)));
  }

  function halve() {
    const r = halveLoop(t.layers, beats);
    commit(r.layers, r.beats);
  }

  function double() {
    const r = doubleLoop(t.layers, beats);
    commit(r.layers, r.beats);
  }

  /** The full clip editor works on session clips: the loop goes into the session and opens there. */
  function openFull() {
    const st = get(musicStudio);
    const instrument = t.instrument ?? st.instrument;
    const flat = notes.map(({ layer: _l, ...n }) => n);
    const loop: RecordedLoop = { kind: 'recorded', id: generateUUID(), name: t.name || INSTRUMENT_LABELS[instrument], role: roleForRecording(instrument, flat), instrument, beats, notes: flat, createdAt: Date.now() };
    musicStudio.addSessionClip(loop.role, clipFromRecording(loop));
    clipEditorId.set(loop.id);
    onclose?.();
  }

  const selInfo = $derived(sel ? `${noteName(sel.note)} · ${Math.floor(sel.beat / 4) + 1}.${(Math.floor(sel.beat) % 4) + 1}.${Math.floor((sel.beat % 1) * 4) + 1} · ${sel.dur >= 1 ? sel.dur : `1/${Math.round(4 / sel.dur)}`} · vel ${Math.round(sel.velocity * 127)}` : '');
</script>

<svelte:window onkeydown={key} />

<div class="qe">
  <div class="tools">
    <span class="ga-eyebrow">{t.name || 'Loop'}</span>
    <div class="ga-segmented small" role="group" aria-label="Tool">
      <button class:active={tool === 'draw'} onclick={() => (tool = 'draw')}>Draw</button>
      <button class:active={tool === 'erase'} onclick={() => (tool = 'erase')}>Erase</button>
      <button class:active={tool === 'select'} onclick={() => (tool = 'select')}>Select</button>
    </div>
    <span class="ga-eyebrow">Quantise</span>
    <div class="ga-segmented small" role="group" aria-label="Grid">
      {#each GRIDS as g}<button class:active={grid === g.beats} onclick={() => (grid = g.beats)}>{g.id}</button>{/each}
    </div>
    <div class="ga-segmented small" role="group" aria-label="Strength">
      {#each STRENGTHS as k}<button class:active={strength === k} onclick={() => (strength = k)} title="How far notes move to the grid">{Math.round(k * 100)}%</button>{/each}
    </div>
    <button class="text-btn small" onclick={quantise} title="Snap the notes (the shown layer, or all) to the grid">Apply</button>
    <span class="ga-eyebrow">Transpose</span>
    <div class="ga-segmented small" role="group" aria-label="Transpose">
      <button onclick={() => transpose(-12)}>−12</button><button onclick={() => transpose(-1)}>−1</button><button onclick={() => transpose(1)}>+1</button><button onclick={() => transpose(12)}>+12</button>
    </div>
    <div class="ga-segmented small" role="group" aria-label="Length">
      <button onclick={halve} disabled={beats <= 4} title="Keep the first half">Halve</button>
      <button onclick={double} title="Play it twice, as a loop twice as long">Double</button>
    </div>
    <span class="ga-eyebrow">Layers</span>
    <div class="ga-segmented small" role="group" aria-label="Layers">
      <button class:active={shownLayer < 0} onclick={() => (shownLayer = -1)}>All</button>
      {#each t.layers as _, li}<button class:active={shownLayer === li} onclick={() => (shownLayer = li)}>L{li + 1}</button>{/each}
    </div>
    <span class="sp"></span>
    <button class="text-btn small" onclick={openFull} title="Put the loop in the session and open it in the clip editor">Open full editor</button>
    <button class="text-btn small pri" onclick={() => onsave?.()}>Save to library</button>
    <button class="text-btn small" onclick={() => onclose?.()} aria-label="Close the editor">Close</button>
  </div>

  <div class="ruler" style="grid-template-columns: repeat({bars}, 1fr)">
    {#each { length: bars } as _, b}<span>{b + 1}</span>{/each}
    <i class="brace"></i>
  </div>
  <div class="body">
    <div class="keys">
      {#each rows as n}<span class:black={isBlackKey(n)} style="height: {ROW}px">{n % 12 === 0 || n % 12 === 9 || n % 12 === 7 || n % 12 === 4 || n % 12 === 2 || n % 12 === 5 || n % 12 === 11 ? noteName(n) : ''}</span>{/each}
    </div>
    <div class="roll" bind:this={rollEl} role="application" aria-label="Notes" style="height: {rows.length * ROW}px" onclick={clickRoll} onkeydown={() => {}} onpointermove={edgeMove} onpointerup={edgeUp}>
      {#each rows as n, k}<div class="row" class:black={isBlackKey(n)} style="top: {k * ROW}px; height: {ROW}px"></div>{/each}
      {#each { length: bars * 4 } as _, b}<div class="beat" class:bar={b % 4 === 0} style="left: {(b / (bars * 4)) * 100}%"></div>{/each}
      {#each t.layers as layer, li}
        {#each layer as n, i}
          {#if n.note >= range.lo && n.note <= range.hi}
            <div
              class="note"
              class:dim={shownLayer >= 0 && shownLayer !== li}
              class:newest={li === t.layers.length - 1 && t.layers.length > 1}
              class:sel={selected?.layer === li && selected?.i === i}
              style="left: {(n.beat / beats) * 100}%; width: {(n.dur / beats) * 100}%; top: {(range.hi - n.note) * ROW + 2}px; height: {ROW - 4}px"
              role="button"
              tabindex="-1"
              onclick={(e) => clickNote(e, li, i)}
              ondblclick={(e) => dblNote(e, li, i)}
              onkeydown={() => {}}
            >
              <span class="edge" role="presentation" onpointerdown={(e) => edgeDown(e, li, i)}></span>
            </div>
          {/if}
        {/each}
      {/each}
      {#if v.phase === 'play' || v.phase === 'overdub'}<div class="ph" style="left: {trackProgress(v, $beatNow) * 100}%"></div>{/if}
    </div>
  </div>
  <div class="vel">
    <span class="ga-eyebrow lab">Vel</span>
    <div class="lane" style="height: {VEL_H}px">
      {#each t.layers as layer, li}
        {#each layer as n, i}
          <span
            class="stem"
            class:newest={li === t.layers.length - 1 && t.layers.length > 1}
            class:sel={selected?.layer === li && selected?.i === i}
            class:dim={shownLayer >= 0 && shownLayer !== li}
            style="left: {(n.beat / beats) * 100}%; height: {n.velocity * 100}%"
            role="presentation"
            onpointerdown={(e) => velDown(e, li, i)}
          ></span>
        {/each}
      {/each}
    </div>
  </div>
  <div class="foot">
    <span>Click to add · double-click to delete · drag edge to resize · arrows nudge · coral = last overdub</span>
    <span class="sp"></span>
    <span>{#if sel}1 note selected · {selInfo}{:else}{notes.length} notes · {bars} bars{/if}</span>
  </div>
</div>

<style>
  .qe { border-top: 1px solid var(--studio-edge); background: var(--studio-slot); display: flex; flex-direction: column; }
  .tools { display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--studio-panel); flex-wrap: wrap; border-bottom: 1px solid var(--studio-edge-soft); }
  .tools .ga-eyebrow { margin-left: 6px; }
  .sp { flex: 1; }
  .pri { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); }
  .ruler { position: relative; display: grid; margin-left: 44px; height: 22px; border-bottom: 1px solid var(--studio-edge-soft); font-size: 11px; font-weight: 600; }
  .ruler span { padding: 2px 4px; border-left: 1px solid var(--studio-edge); }
  .brace { position: absolute; left: 0; right: 0; bottom: 0; height: 5px; background: var(--studio-accent-soft); border-top: 1px solid var(--studio-accent); }
  .body { display: flex; max-height: 260px; overflow: auto; }
  .keys { flex: 0 0 44px; display: flex; flex-direction: column; }
  .keys span { font-size: 9px; color: var(--studio-muted); padding-left: 4px; line-height: 16px; border-bottom: 1px solid var(--studio-edge-soft); box-sizing: border-box; }
  .keys span.black { background: var(--studio-panel); }
  .roll { position: relative; flex: 1; cursor: crosshair; }
  .row { position: absolute; left: 0; right: 0; border-bottom: 1px solid var(--studio-edge-soft); box-sizing: border-box; pointer-events: none; }
  .row.black { background: rgba(255, 255, 255, 0.015); }
  .beat { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--studio-edge-soft); pointer-events: none; }
  .beat.bar { background: var(--studio-edge); }
  .note { position: absolute; background: var(--studio-accent); border-radius: 3px; box-sizing: border-box; cursor: pointer; min-width: 4px; }
  .note.newest { background: var(--studio-rec); }
  .note.sel { outline: 2px solid var(--studio-ink); outline-offset: -1px; }
  .note.dim { opacity: 0.25; }
  .edge { position: absolute; right: 0; top: 0; bottom: 0; width: 6px; cursor: ew-resize; }
  .ph { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--studio-ink); pointer-events: none; }
  .vel { display: flex; border-top: 1px solid var(--studio-edge); }
  .lab { flex: 0 0 44px; padding: 4px; }
  .lane { position: relative; flex: 1; }
  .stem { position: absolute; bottom: 0; width: 3px; background: var(--studio-accent); cursor: ns-resize; }
  .stem.newest { background: var(--studio-rec); }
  .stem.sel { background: var(--studio-ink); }
  .stem.dim { opacity: 0.25; }
  .foot { display: flex; gap: 8px; padding: 6px 10px; background: var(--studio-panel); border-top: 1px solid var(--studio-edge-soft); font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
</style>
