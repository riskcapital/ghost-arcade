<script lang="ts">
  /**
   * A block's pattern, opened where the block is: double-click the pattern
   * drawn in a block (or its ⇄ Where button in the inspector). The groups
   * of pieces are rows with the pattern over the block's span drawn beside
   * them as a step grid (like the Sequencer: click or drag across squares
   * to light a group on a step), the motion is a row of pictures, and the
   * block's content can be swapped by dropping a card from the Media
   * Library on it. A motion other than Steps shows its own steps in the
   * grid; changing a square turns it into Steps.
   *
   * One instance, mounted with the Timeline; `whereEditing` says which
   * block is open.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { showSlice } from './timelineSlices';
  import { project } from '../../../stores/layers';
  import { addLineAtPlayhead } from '../../../timeline/lines/timelineLines';
  import type { ParamTarget } from '../../../timeline/lines/paramRegistry';
  import { defaultWhere, WHERE_KEYS, WHERE_ORDERS, type WhereMembers, type WhereMotion, type WhereSpec } from '../../../timeline/where/whereModel';
  import {
    lookPieces, stageNow, whereEditing, whereHighlight, whereOrderView, whereSampler,
    WHERE_MEMBER_LABELS, WHERE_ORDER_LABELS,
  } from './whereUi';
  import { slotsFromPieces, wherePick } from '../../../timeline/where/wherePick';
  import { generateUUID } from '../../../utils/uuid';
  import { edgeLook } from '../../../looks/edgeLookCatalog';
  import { blockName } from './stageFxRowsUi';
  import { clipMediaFromTrayPayload, MEDIA_SOURCE_DRAG_TYPE } from './clipMedia';
  import { motionContext } from '../../../timeline/where/whereRuntime';
  import { stepIndexAt } from '../../../timeline/where/whereMotion';
  import TimelineIcon from './TimelineIcon.svelte';

  // Slices: the store publishes every playhead frame.
  const tracksSlice = showSlice('layerTracks');
  const looksSlice = showSlice('lookClips');
  const ledSlice = showSlice('ledClips');
  const stageSlice = showSlice('stageClips');
  const ordersSlice = showSlice('whereOrders');
  const tempoSlice = showSlice('tempo');
  const linesSlice = showSlice('lines');
  const timeSlice = showSlice('currentTime');

  interface Block {
    kind: 'layer' | 'look' | 'led' | 'stage';
    id: string;
    name: string;
    where: WhereSpec | null;
    target: ParamTarget;
    members: readonly WhereMembers[];
    pieces: ReadonlySet<string> | null;
    start: number;
    duration: number;
    /** A content block's media name (it can be swapped here). */
    content: string | null;
    save: (where: WhereSpec | null) => void;
  }

  const req = $derived($whereEditing);
  const block = $derived.by((): Block | null => {
    if (!req) return null;
    const id = req.id;
    if (req.scope === 'look') {
      const c = $looksSlice.find((x) => x.id === id);
      if (!c) return null;
      return {
        kind: 'look', id, name: edgeLook(c.lookId)?.name ?? 'Look', where: c.where ?? null,
        target: { scope: 'look', id }, members: ['pieces', 'leds', 'both'],
        pieces: lookPieces($project.layers ?? [], c.scope, c.layerIds),
        start: c.startTime, duration: c.duration, content: null,
        save: (where) => showTimeline.updateLookClip(id, { where }, { discrete: true }),
      };
    }
    for (const t of $tracksSlice) {
      const c = t.clips.find((x) => x.id === id);
      if (c) return {
        kind: 'layer', id, name: c.label || c.media.name, where: c.where ?? null,
        target: { scope: 'block', id }, members: ['pieces'], pieces: null,
        start: c.startTime, duration: c.duration, content: c.media.name,
        save: (where) => showTimeline.updateLayerClip(id, { where }, { discrete: true }),
      };
    }
    const led = $ledSlice.find((x) => x.id === id);
    if (led) return {
      kind: 'led', id, name: led.label || 'LED block', where: led.where ?? null,
      target: { scope: 'block', id }, members: ['leds'], pieces: null,
      start: led.startTime, duration: led.duration, content: null,
      save: (where) => showTimeline.updateLedClip(id, { where }, { discrete: true }),
    };
    const st = $stageSlice.find((x) => x.id === id);
    if (st) return {
      kind: 'stage', id, name: blockName(st), where: st.where ?? null,
      target: { scope: 'block', id }, members: ['pieces'], pieces: null,
      start: st.startTime, duration: st.duration, content: null,
      save: (where) => showTimeline.updateStageClip(id, { where }, { discrete: true }),
    };
    return null;
  });
  const where = $derived(block?.where ?? null);
  const named = $derived($ordersSlice);
  const order = $derived.by(() => {
    void $project;
    return block && where ? whereOrderView(where, block.pieces, named) : { slots: [] };
  });

  // ── Placement: under the block when there is room, else above it ──────
  const W = 460;
  let el: HTMLDivElement | undefined = $state();
  let h = $state(420);
  const place = $derived.by(() => {
    if (!req) return { left: 0, top: 0 };
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1600;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const left = Math.max(8, Math.min(req.anchor.left, vw - W - 8));
    const below = req.anchor.bottom + 6;
    const top = below + h <= vh - 8 ? below : Math.max(8, req.anchor.top - 6 - h);
    return { left, top };
  });

  function close() {
    whereEditing.set(null);
    whereHighlight.set(null);
  }
  function onWindowDown(e: MouseEvent) {
    if (!req || !el) return;
    const t = e.target as Node;
    if (el.contains(t)) return;
    // Another block's pattern opens over this one; its own handler sets it.
    if ((t as Element).closest?.('[data-where-band], [data-where-button]')) return;
    close();
  }
  function onKey(e: KeyboardEvent) {
    if (req && e.key === 'Escape') { e.stopPropagation(); close(); }
  }

  // ── Edits ─────────────────────────────────────────────────────────────
  function set(patch: Partial<WhereSpec>) {
    if (!block) return;
    block.save({ ...(where ?? defaultWhere(block.members[0])), ...patch });
  }
  function setMotion(kind: WhereMotion['kind']) {
    if (kind === 'steps') { set({ motion: shown }); return; }
    const bars = where && 'bars' in where.motion ? where.motion.bars : 1;
    const motion: WhereMotion = kind === 'random' ? { kind, every: 'beat', seed: Math.floor(Math.random() * 100000) }
      : kind === 'kick' || kind === 'drawn' ? { kind }
      : { kind, bars } as WhereMotion;
    set({ motion, ...(kind === 'pingpong' || kind === 'burst' || kind === 'random' || kind === 'kick' ? { wrap: false } : {}) });
  }
  function setBars(b: number) {
    if (where && 'bars' in where.motion) set({ motion: { ...where.motion, bars: b } as WhereMotion });
  }
  const bars = $derived(where && 'bars' in where.motion ? where.motion.bars : 1);
  const BAR_STEPS = [0.25, 0.5, 1, 2, 4, 8];
  const barLabel = (b: number) => (b === 0.25 ? '¼' : b === 0.5 ? '½' : String(b));

  const namedNow = $derived(where?.namedOrder ? named.find((o) => o.id === where.namedOrder) ?? null : null);
  const orderValue = $derived(namedNow ? `named:${namedNow.id}` : where?.slots?.length ? 'picked' : where?.order ?? 'left-right');
  function setOrderValue(value: string) {
    if (value === 'picked') return;
    if (value.startsWith('named:')) set({ namedOrder: value.slice(6) });
    else set({ order: value as WhereSpec['order'], namedOrder: undefined, slots: undefined, ...(value === 'hand' && !where?.hand?.length ? { hand: order.slots.flatMap((s) => s.ids) } : {}) });
  }

  /** Choose the pieces on the canvas (the block's own, or its named group's). */
  function pickPieces() {
    if (!block || !where) return;
    const current = where;
    const save = block.save;
    const group = namedNow;
    const { spots } = stageNow();
    const pieceSpots = spots.filter((s) => s.kind === 'piece');
    const given = group?.slots ?? current.slots;
    wherePick.set({
      ids: order.slots.flatMap((slot) => slot.ids).filter((id) => pieceSpots.some((s) => s.id === id)),
      together: !!given && given.length === 1 && given[0].length > 1,
      groupName: group?.name ?? null,
      commit: (ids, together, name) => {
        const slots = slotsFromPieces(ids, pieceSpots, together);
        if (!slots.length) return;
        const orders = get(showTimeline).whereOrders ?? [];
        if (group) {
          showTimeline.setWhereOrders(orders.map((o) => (o.id === group.id ? { ...o, name: name ?? o.name, slots } : o)));
        } else if (name) {
          const id = generateUUID();
          showTimeline.setWhereOrders([...orders, { id, name, order: 'left-right', slots }]);
          save({ ...current, namedOrder: id, slots: undefined });
        } else {
          save({ ...current, namedOrder: undefined, slots });
        }
      },
    });
    close();
  }

  let dragFrom: number | null = $state(null);
  function moveSlot(from: number, to: number) {
    if (!where || from === to) return;
    const ids = order.slots.map((s) => s.ids);
    const [it] = ids.splice(from, 1);
    ids.splice(to, 0, it);
    const hand = ids.flat();
    // Picked pieces and named groups keep their pieces: only the order of
    // their slots changes. Otherwise it becomes an order by hand.
    if (namedNow?.slots?.length) showTimeline.setWhereOrders(named.map((o) => (o.id === namedNow.id ? { ...o, slots: ids } : o)));
    else if (namedNow) showTimeline.setWhereOrders(named.map((o) => (o.id === namedNow.id ? { ...o, order: 'hand', hand } : o)));
    else if (where.slots?.length) set({ slots: ids });
    else set({ order: 'hand', hand });
  }

  let naming = $state(false);
  let newName = $state('');
  function saveNamed() {
    if (!where) return;
    const name = newName.trim() || `Group ${named.length + 1}`;
    const id = generateUUID();
    const spec = { order: where.order, angle: where.angle, hand: where.order === 'hand' ? order.slots.flatMap((s) => s.ids) : where.hand, groups: where.groups, ...(where.slots?.length ? { slots: where.slots } : {}) };
    showTimeline.setWhereOrders([...named, { id, name, ...spec }]);
    set({ namedOrder: id, slots: undefined });
    naming = false;
    newName = '';
  }

  function drawLine(key: string) {
    if (!block) return;
    const target = block.target;
    if (key === WHERE_KEYS.position) set({ motion: { kind: 'drawn' } });
    queueMicrotask(() => addLineAtPlayhead(target, key));
  }

  // Swapping a content block's media: a Media Library card dropped here.
  let dropHover = $state(false);
  function contentOver(e: DragEvent) {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes(MEDIA_SOURCE_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropHover = true;
  }
  function contentDrop(e: DragEvent) {
    dropHover = false;
    const raw = e.dataTransfer?.getData(MEDIA_SOURCE_DRAG_TYPE);
    if (!raw || !block || block.kind !== 'layer') return;
    e.preventDefault();
    let media = null;
    try { media = clipMediaFromTrayPayload(JSON.parse(raw)); } catch { media = null; }
    if (media) showTimeline.replaceLayerClipMedia(block.id, media);
  }

  // ── The step grid ─────────────────────────────────────────────────
  type Steps = Extract<WhereMotion, { kind: 'steps' }>;
  const ROW = 20;
  const STEP_COUNTS = [4, 8, 16, 32];
  /** Step lengths in quarter notes. */
  const STEP_LENGTHS: Array<{ per: number; label: string }> = [
    { per: 0.25, label: '1/16' }, { per: 0.5, label: '1/8' }, { per: 1, label: '1/4' }, { per: 2, label: '1/2' }, { per: 4, label: 'Bar' },
  ];

  /** Show time at a beat count from the block's start (the tempo map only rises). */
  function timeAtBeats(ctx: ReturnType<typeof motionContext>, start: number, beats: number): number {
    const target = ctx.beatAt(start) + beats;
    let lo = start;
    let hi = start + Math.max(1, beats) * 4;
    while (ctx.beatAt(hi) < target && hi - start < 36000) hi = start + (hi - start) * 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (ctx.beatAt(mid) < target) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** The block's motion as steps: its own, or one cycle of another motion sampled on the beat. */
  const shown = $derived.by((): Steps => {
    if (!block || !where) return { kind: 'steps', per: 1, steps: [[0]] };
    const m = where.motion;
    if (m.kind === 'steps') return m;
    const n = order.slots.length;
    const cycleBeats = 'bars' in m ? m.bars * 4 : m.kind === 'random' && m.every === 'bar' ? 32 : 16;
    let per = m.kind === 'random' && m.every === 'bar' ? 4 : 1;
    if (cycleBeats < 4) per = cycleBeats / 4;
    const want = Math.round(cycleBeats / per);
    const count = STEP_COUNTS.reduce((best, c) => (Math.abs(c - want) < Math.abs(best - want) ? c : best), 16);
    const ctx = motionContext($tempoSlice, null);
    const sampler = whereSampler({ target: block.target, where, start: block.start, duration: block.duration, pieces: block.pieces }, n, $tempoSlice, $linesSlice);
    const steps: number[][] = [];
    for (let k = 0; k < count; k++) {
      const w = sampler.weights(timeAtBeats(ctx, block.start, (k + 0.5) * per));
      steps.push(w.flatMap((v, i) => (v >= 0.5 ? [i] : [])));
    }
    return { kind: 'steps', per, steps };
  });
  const isSteps = $derived(where?.motion.kind === 'steps');

  // A drag paints squares into a draft; it is saved once, on release.
  let draft: number[][] | null = $state(null);
  let paint = true;
  const cells = $derived(draft ?? shown.steps);
  function cellOn(step: number, slot: number) {
    return cells[step]?.includes(slot) ?? false;
  }
  function paintCell(step: number, slot: number) {
    if (!draft) return;
    const has = draft[step].includes(slot);
    if (paint === has) return;
    const next = draft.map((x) => x.slice());
    next[step] = paint ? [...next[step], slot].sort((x, y) => x - y) : next[step].filter((i) => i !== slot);
    draft = next;
  }
  function cellDown(e: MouseEvent, step: number, slot: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    paint = !cellOn(step, slot);
    draft = shown.steps.map((x) => x.slice());
    paintCell(step, slot);
  }
  function cellEnter(step: number, slot: number) {
    if (draft) paintCell(step, slot);
  }
  function commitDraft() {
    if (!draft) return;
    const steps = draft;
    draft = null;
    set({ motion: { kind: 'steps', per: shown.per, steps } });
  }
  function setSteps(steps: number[][], per = shown.per) {
    set({ motion: { kind: 'steps', per, steps } });
  }
  function setStepCount(count: number) {
    const src = shown.steps;
    setSteps(Array.from({ length: count }, (_, k) => src[k % src.length].slice()));
  }
  /** The Sequencer's fills, over the groups. */
  function preset(kind: 'snake' | 'everyOther' | 'random' | 'clear') {
    const n = Math.max(1, order.slots.length);
    const all = Array.from({ length: n }, (_, i) => i);
    const steps = Array.from({ length: shown.steps.length }, (_, k): number[] => {
      if (kind === 'snake') {
        const cycle = Math.max(1, 2 * n - 2);
        const p = k % cycle;
        return [p < n ? p : cycle - p];
      }
      if (kind === 'everyOther') return all.filter((i) => (i + k) % 2 === 0);
      if (kind === 'random') return all.filter(() => Math.random() < 0.4);
      return [];
    });
    setSteps(steps);
  }

  const nowStep = $derived.by(() => {
    if (!block || !where) return -1;
    const t = $timeSlice;
    if (t < block.start || t > block.start + block.duration) return -1;
    return stepIndexAt(shown, t, block.start, motionContext($tempoSlice, null));
  });

  function lightRow(i: number | null) {
    if (i === null || !order.slots[i]) { whereHighlight.set(null); return; }
    whereHighlight.set(new Map(order.slots[i].ids.map((id) => [id, 1])));
  }

  // ── Motion pictures: a few steps of each, as lit cells ────────────────
  const MOTIONS: Array<{ kind: WhereMotion['kind']; label: string; hint: string; cells?: number[][] }> = [
    { kind: 'sweep', label: 'Sweep', hint: 'One group after another, along the order', cells: [[0], [1], [2], [3], [0], [1]] },
    { kind: 'pingpong', label: 'Back and forth', hint: 'Along the order and back again', cells: [[0], [1], [2], [3], [2], [1]] },
    { kind: 'burst', label: 'Burst', hint: 'Grows from the middle groups out to all of them', cells: [[1, 2], [0, 1, 2, 3], [1, 2], [0, 1, 2, 3], [1, 2], [0, 1, 2, 3]] },
    { kind: 'random', label: 'Random', hint: 'A random group every beat or bar (the same every time it plays)', cells: [[2], [0], [3], [1], [3], [0]] },
    { kind: 'kick', label: 'On the kick', hint: 'Steps to the next group on every kick of the song', cells: [[0], [0], [1], [2], [2], [3]] },
    { kind: 'reveal', label: 'One by one', hint: 'Groups light up one after another and stay lit', cells: [[0], [0, 1], [0, 1], [0, 1, 2], [0, 1, 2, 3], [0, 1, 2, 3]] },
    { kind: 'steps', label: 'Steps', hint: 'Your own steps: click squares in the grid, like the Sequencer', cells: [[0, 2], [1], [0, 3], [2], [1, 3], [0]] },
    { kind: 'drawn', label: 'Draw it', hint: 'Draw where it is as a line on the block (or record it from a knob)' },
  ];
  const motionKind = $derived(where?.motion.kind ?? null);
</script>

<svelte:window onmousedown={onWindowDown} onkeydown={onKey} onmouseup={commitDraft} />

{#if req && block}
  <div class="wp" bind:this={el} bind:clientHeight={h} style:left="{place.left}px" style:top="{place.top}px" style:width="{W}px"
    role="dialog" aria-label="Pattern for {block.name}" data-where-popover data-where-editor={block.kind}>
    <div class="wp-head">
      <span class="wp-mark"><TimelineIcon name="phrases" size={16} /></span>
      <span class="wp-titles">
        <span class="wp-title">{block.name}</span>
        <span class="wp-sub">{where ? 'Which pieces light, and when' : 'Plays on its own piece'}</span>
      </span>
      <button type="button" class="wp-x" onclick={close} aria-label="Close">×</button>
    </div>

    {#if block.content !== null}
      <div class="wp-content" class:hover={dropHover} ondragover={contentOver} ondragleave={() => (dropHover = false)} ondrop={contentDrop}
        role="group" aria-label="Content" data-where-content>
        <TimelineIcon name="media" size={14} />
        <span class="wp-content-name">{block.content}</span>
        <span class="wp-content-hint">{dropHover ? 'Drop to swap it' : 'Drag a card from the Media Library here to swap it'}</span>
      </div>
    {/if}

    {#if !where}
      <p class="wp-empty">Make it travel across the stage: choose how.</p>
    {:else}
      {#if block.members.length > 1}
        <div class="wp-row">
          <span class="wp-lbl">Lights</span>
          <span class="wp-seg">
            {#each block.members as m (m)}
              <button type="button" class:on={where.members === m} onclick={() => set({ members: m })} data-where-members={m}>{WHERE_MEMBER_LABELS[m]}</button>
            {/each}
          </span>
        </div>
      {/if}

      <div class="wp-plot" data-where-slots>
        <ol class="wp-labels" style:padding-top="{ROW - 4}px">
          {#each order.slots as slot, i (i)}
            <li draggable="true" class:over={dragFrom !== null && dragFrom !== i} class:led={slot.kind === 'led'}
              style:height="{ROW}px"
              onmouseenter={() => lightRow(i)} onmouseleave={() => lightRow(null)}
              ondragstart={(e) => { dragFrom = i; e.dataTransfer?.setData('text/plain', String(i)); }}
              ondragover={(e) => e.preventDefault()}
              ondrop={(e) => { e.preventDefault(); if (dragFrom !== null) moveSlot(dragFrom, i); dragFrom = null; }}
              ondragend={() => (dragFrom = null)}
              title="{slot.label}. Drag to change the order; hover to see it on the stage." data-where-slot={i}>
              <span class="wp-grip" aria-hidden="true">⋮⋮</span><span class="wp-slot-name">{slot.label}</span>
            </li>
          {:else}
            <li class="wp-none">No pieces yet. Pick some on the canvas.</li>
          {/each}
        </ol>
        {#if order.slots.length}
          <div class="wp-grid" style:grid-template-columns="repeat({cells.length}, minmax(0, 1fr))" style:grid-template-rows="{ROW - 4}px repeat({order.slots.length}, {ROW}px)"
            role="grid" aria-label="Steps" data-where-grid>
            {#each cells as _, k (k)}
              <span class="wp-step-n" class:now={k === nowStep}>{k % 4 === 0 || cells.length <= 8 ? k + 1 : ''}</span>
            {/each}
            {#each order.slots as slot, i (i)}
              {#each cells as _, k (k)}
                <button type="button" class="wp-cell" class:on={cellOn(k, i)} class:now={k === nowStep} class:beat={k % 4 === 0}
                  onmousedown={(e) => cellDown(e, k, i)} onmouseenter={() => cellEnter(k, i)}
                  aria-label="{slot.label}, step {k + 1}" aria-pressed={cellOn(k, i)} data-where-cell="{k}:{i}"></button>
              {/each}
            {/each}
          </div>
        {/if}
      </div>
      {#if !isSteps}
        <p class="wp-gridhint">The steps of {where.motion.kind === 'drawn' ? 'the drawn line' : 'this motion'}. Click or drag across squares to make your own.</p>
      {/if}

      <div class="wp-row wp-order">
        <span class="wp-lbl">Order</span>
        <select value={orderValue} onchange={(e) => setOrderValue((e.currentTarget as HTMLSelectElement).value)} data-where-order>
          {#if orderValue === 'picked'}<option value="picked">Picked pieces ({where.slots?.flat().length ?? 0})</option>{/if}
          {#each WHERE_ORDERS as o (o)}<option value={o}>{WHERE_ORDER_LABELS[o]}</option>{/each}
          {#each named as o (o.id)}<option value={`named:${o.id}`}>{o.name}</option>{/each}
        </select>
        {#if where.order === 'around' && !where.namedOrder}
          <label class="wp-num">from <input type="number" step="15" value={where.angle ?? 0} onchange={(e) => set({ angle: parseFloat((e.currentTarget as HTMLInputElement).value) || 0 })} />°</label>
        {/if}
        {#if block.members.includes('pieces')}
          <button type="button" class="wp-btn" onclick={pickPieces}
            title={namedNow ? `Choose the pieces of ${namedNow.name} on the canvas (every block using it changes)` : 'Choose the pieces it plays on, on the canvas'}
            data-where-pick-pieces><TimelineIcon name="eye" size={13} />{namedNow ? 'Edit pieces' : 'Pick pieces'}</button>
        {/if}
      </div>
      <div class="wp-row wp-quiet">
        <label class="wp-chk" title="Pieces in a group light together"><input type="checkbox" checked={!!where.groups} onchange={(e) => set({ groups: (e.currentTarget as HTMLInputElement).checked })} /> Groups light together</label>
        {#if naming}
          <input class="wp-name" placeholder="Name" bind:value={newName} onkeydown={(e) => { if (e.key === 'Enter') saveNamed(); }} />
          <button type="button" class="wp-btn" onclick={saveNamed}>Save</button>
        {:else}
          <button type="button" class="wp-link" onclick={() => (naming = true)} title="Keep this order with the show to use it on other blocks">Save this order</button>
        {/if}
      </div>
    {/if}

    <div class="wp-motions" role="group" aria-label="Motion" data-where-motion>
      {#each MOTIONS as m (m.kind)}
        <button type="button" class="wp-motion" class:on={motionKind === m.kind} title={m.hint} onclick={() => setMotion(m.kind)} data-where-motion-kind={m.kind}>
          <svg width="36" height="22" viewBox="0 0 36 22" aria-hidden="true">
            {#if m.cells}
              {#each m.cells as col, c (c)}
                {#each [0, 1, 2, 3] as r (r)}
                  <rect x={c * 6} y={r * 5.5} width="5" height="4.5" rx="1" fill="currentColor" opacity={col.includes(r) ? 1 : 0.16} />
                {/each}
              {/each}
            {:else}
              <path d="M1 17 C 8 17, 9 4, 16 6 S 26 18, 35 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            {/if}
          </svg>
          <span>{m.label}</span>
        </button>
      {/each}
    </div>

    {#if where}
      <div class="wp-row">
        {#if where.motion.kind === 'steps'}
          <span class="wp-lbl">Steps</span>
          <span class="wp-seg">
            {#each STEP_COUNTS as c (c)}
              <button type="button" class:on={where.motion.steps.length === c} onclick={() => setStepCount(c)} data-where-step-count={c}>{c}</button>
            {/each}
          </span>
          <span class="wp-unit">each</span>
          <span class="wp-seg" title="How long each step lasts">
            {#each STEP_LENGTHS as l (l.per)}
              <button type="button" class:on={where.motion.per === l.per} onclick={() => setSteps(shown.steps, l.per)} data-where-step-length={l.per}>{l.label}</button>
            {/each}
          </span>
        {:else if where.motion.kind === 'sweep' || where.motion.kind === 'pingpong' || where.motion.kind === 'burst' || where.motion.kind === 'reveal'}
          <span class="wp-lbl">Speed</span>
          <span class="wp-seg" title="Bars for one pass">
            {#each BAR_STEPS as b (b)}
              <button type="button" class:on={bars === b} onclick={() => setBars(b)} data-where-bars={b}>{barLabel(b)}</button>
            {/each}
          </span>
          <span class="wp-unit">{bars === 1 ? 'bar' : 'bars'} a pass</span>
          {#if where.motion.kind === 'sweep'}
            <label class="wp-chk"><input type="checkbox" checked={!!where.motion.reverse} onchange={(e) => set({ motion: { kind: 'sweep', bars, reverse: (e.currentTarget as HTMLInputElement).checked } })} /> Backwards</label>
          {/if}
          {#if where.motion.kind === 'reveal'}
            <label class="wp-chk" title="All lit at the start, then they go dark one after another"><input type="checkbox" checked={!!where.motion.reverse} onchange={(e) => set({ motion: { kind: 'reveal', bars, reverse: (e.currentTarget as HTMLInputElement).checked } })} data-where-reveal-out /> Drop out</label>
          {/if}
        {:else if where.motion.kind === 'random'}
          <span class="wp-lbl">Every</span>
          <span class="wp-seg">
            <button type="button" class:on={where.motion.every === 'beat'} onclick={() => set({ motion: { ...(where.motion as Extract<WhereMotion, { kind: 'random' }>), every: 'beat' } })}>Beat</button>
            <button type="button" class:on={where.motion.every === 'bar'} onclick={() => set({ motion: { ...(where.motion as Extract<WhereMotion, { kind: 'random' }>), every: 'bar' } })}>Bar</button>
          </span>
          <button type="button" class="wp-btn" onclick={() => setMotion('random')} title="Another random order">Shuffle</button>
        {:else if where.motion.kind === 'drawn'}
          <button type="button" class="wp-btn" onclick={() => drawLine(WHERE_KEYS.position)} data-where-draw><TimelineIcon name="line-add" size={13} />Position line</button>
          <button type="button" class="wp-btn" onclick={() => drawLine(WHERE_KEYS.spread)}><TimelineIcon name="line-add" size={13} />Width line</button>
        {:else}
          <span class="wp-unit">Needs a song with kicks; steps on the beat otherwise.</span>
        {/if}
      </div>

      {#if where.motion.kind === 'steps'}
        <div class="wp-row wp-quiet">
          <span class="wp-lbl">Fill</span>
          <button type="button" class="wp-btn" onclick={() => preset('snake')} title="One group at a time, there and back" data-where-preset="snake">Snake</button>
          <button type="button" class="wp-btn" onclick={() => preset('everyOther')} title="Alternate groups on every step" data-where-preset="everyOther">Every other</button>
          <button type="button" class="wp-btn" onclick={() => preset('random')} title="A new random pattern" data-where-preset="random">Random</button>
          <button type="button" class="wp-link" onclick={() => preset('clear')} data-where-preset="clear">Clear</button>
        </div>
      {:else}
      <div class="wp-row">
        <label class="wp-rng" title="How many groups are lit at once">Width <input type="range" min="0" max="1" step="0.01" value={where.spread} oninput={(e) => set({ spread: parseFloat((e.currentTarget as HTMLInputElement).value) })} data-where-spread /></label>
        <label class="wp-rng" title="How softly neighbors fade in and out">Soft edge <input type="range" min="0" max="1" step="0.01" value={where.soft} oninput={(e) => set({ soft: parseFloat((e.currentTarget as HTMLInputElement).value) })} data-where-soft /></label>
        {#if where.motion.kind === 'sweep' || where.motion.kind === 'drawn'}
          <label class="wp-chk" title="The last group neighbors the first: a sweep loops without a jump"><input type="checkbox" checked={!!where.wrap} onchange={(e) => set({ wrap: (e.currentTarget as HTMLInputElement).checked })} data-where-wrap /> Loop around</label>
        {/if}
      </div>
      {/if}
      {#if block.members.length === 1 && block.members[0] === 'pieces'}
        <div class="wp-row wp-quiet">
          <label class="wp-chk" title="Its pieces show only this block while it plays: the unlit ones go dark"><input type="checkbox" checked={!!where.dark} onchange={(e) => set({ dark: (e.currentTarget as HTMLInputElement).checked })} data-where-dark /> Unlit pieces go dark</label>
          <label class="wp-chk" title="One picture across the pieces: each shows its part of it, where it sits on the stage"><input type="checkbox" checked={!!where.span} onchange={(e) => set({ span: (e.currentTarget as HTMLInputElement).checked })} data-where-span /> One picture across them</label>
        </div>
      {/if}
    {/if}

    <div class="wp-foot">
      {#if where}
        <button type="button" class="wp-link" onclick={() => block.save(null)} title="Play on its own piece again" data-where-off>Stop traveling</button>
      {/if}
      <button type="button" class="wp-done" onclick={close}>Done</button>
    </div>
  </div>
{/if}

<style>
  .wp {
    position: fixed; z-index: 950; max-height: calc(100vh - 16px); overflow-y: auto;
    background: var(--ga-card, #16161c); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5); padding: 12px 14px; color: var(--ga-ink-1, #ccc); font-size: 12px;
    display: flex; flex-direction: column; gap: 8px;
  }
  .wp-head { display: flex; align-items: center; gap: 10px; }
  .wp-mark { display: inline-flex; color: var(--ga-icon, #5278ff); }
  .wp-titles { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .wp-title { color: var(--ga-ink-0, #fff); font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wp-sub { color: var(--ga-ink-2, #999); font-size: 11.5px; }
  .wp-x { width: 26px; height: 26px; background: none; border: 0; color: var(--ga-ink-2, #888); font-size: 18px; cursor: pointer; align-self: flex-start; }
  .wp-x:hover { color: var(--ga-ink-0, #fff); }
  .wp-content {
    display: flex; align-items: center; gap: 8px; padding: 7px 10px; border: 1px dashed var(--ga-line-2, rgba(255, 255, 255, 0.16)); border-radius: 6px;
    color: var(--ga-ink-0, #f2ede4);
  }
  .wp-content.hover { border-color: var(--ga-icon, #5278ff); background: color-mix(in srgb, var(--ga-icon, #5278ff) 10%, transparent); }
  .wp-content-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
  .wp-content-hint { color: var(--ga-ink-2, #999); font-size: 11px; margin-left: auto; text-align: right; }
  .wp-empty { margin: 2px 0; color: var(--ga-ink-1, #ccc); }
  .wp-plot { display: grid; grid-template-columns: 140px minmax(0, 1fr); gap: 8px; max-height: 240px; overflow-y: auto; user-select: none; }
  .wp-labels { list-style: none; margin: 0; padding: 0; }
  .wp-labels li { display: flex; align-items: center; gap: 4px; cursor: grab; color: var(--ga-ink-1, #ccc); font-size: 11px; white-space: nowrap; overflow: hidden; }
  .wp-labels li:hover { color: var(--ga-ink-0, #fff); }
  .wp-labels li.over:hover { outline: 1px dashed var(--ga-icon, #5278ff); }
  .wp-labels li.led .wp-slot-name::after { content: ' (LED)'; color: var(--ga-ink-2, #888); }
  .wp-labels .wp-none { cursor: default; color: var(--ga-ink-2, #888); white-space: normal; }
  .wp-grip { color: var(--ga-ink-2, #666); font-size: 9px; letter-spacing: -2px; flex-shrink: 0; }
  .wp-slot-name { overflow: hidden; text-overflow: ellipsis; }
  .wp-grid { display: grid; column-gap: 2px; min-width: 0; }
  .wp-step-n { align-self: center; color: var(--ga-ink-2, #777); font-size: 9.5px; font-family: var(--ga-font-mono, ui-monospace, monospace); white-space: nowrap; overflow: visible; }
  .wp-step-n.now { color: var(--ga-ink-0, #fff); }
  .wp-cell {
    margin: 2px 0; padding: 0; min-width: 0; border: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); border-radius: 3px;
    background: var(--ga-sunk, #0f0f13); cursor: pointer;
  }
  .wp-cell.beat:not(.on) { background: color-mix(in srgb, var(--ga-sunk, #0f0f13) 88%, #fff); }
  .wp-cell:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.28)); }
  .wp-cell.on { background: var(--ga-icon, #5278ff); border-color: color-mix(in srgb, var(--ga-icon, #5278ff) 60%, #fff); }
  .wp-cell.now { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.6); }
  .wp-gridhint { margin: -2px 0 0 148px; color: var(--ga-ink-2, #888); font-size: 11px; }
  .wp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .wp-quiet { color: var(--ga-ink-2, #999); }
  .wp-lbl { width: 46px; color: var(--ga-ink-2, #999); flex-shrink: 0; }
  .wp-unit { color: var(--ga-ink-2, #999); font-size: 11px; }
  select, .wp-num input, .wp-name {
    height: 26px; background: var(--ga-sunk, #0c0c10); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
    border-radius: 5px; color: var(--ga-ink-0, #e8e8e8); font: inherit; font-size: 12px; padding: 0 6px;
  }
  .wp-num { display: inline-flex; align-items: center; gap: 4px; }
  .wp-num input { width: 56px; }
  .wp-name { width: 110px; }
  .wp-seg { display: inline-flex; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14)); border-radius: 5px; overflow: hidden; }
  .wp-seg button {
    height: 24px; min-width: 28px; padding: 0 8px; background: transparent; border: 0; border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.08));
    color: var(--ga-ink-1, #ccc); font: inherit; font-size: 12px; cursor: pointer;
  }
  .wp-seg button:last-child { border-right: 0; }
  .wp-seg button:hover:not(.on) { color: var(--ga-ink-0, #fff); }
  .wp-seg button.on { background: var(--ga-icon, #5278ff); color: #fff; }
  .wp-btn {
    height: 26px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.16)); border-radius: 5px; color: var(--ga-ink-1, #ccc); font: inherit; font-size: 12px; cursor: pointer;
  }
  .wp-btn:hover { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.3)); }
  .wp-link { background: none; border: 0; padding: 0; color: var(--ga-ink-2, #999); font: inherit; font-size: 12px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
  .wp-link:hover { color: var(--ga-ink-0, #fff); }
  .wp-chk { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
  .wp-rng { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  .wp-rng input { width: 96px; accent-color: var(--ga-icon, #5278ff); }
  .wp-motions { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 3px; padding: 8px 0; border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); }
  .wp-motion {
    display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 6px 2px; background: transparent;
    border: 1px solid transparent; border-radius: 6px; color: var(--ga-ink-2, #999); font: inherit; font-size: 10.5px; cursor: pointer; text-align: center; line-height: 1.15;
  }
  .wp-motion:hover:not(.on) { color: var(--ga-ink-0, #fff); background: rgba(255, 255, 255, 0.04); }
  .wp-motion.on { color: var(--ga-icon, #5278ff); border-color: color-mix(in srgb, var(--ga-icon, #5278ff) 60%, transparent); background: color-mix(in srgb, var(--ga-icon, #5278ff) 10%, transparent); }
  .wp-motion.on span { color: var(--ga-ink-0, #fff); }
  .wp-foot { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 2px; }
  .wp-foot .wp-link { margin-right: auto; }
  .wp-done { height: 28px; padding: 0 16px; background: var(--ga-icon, #5278ff); border: 0; border-radius: 5px; color: #fff; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
</style>
