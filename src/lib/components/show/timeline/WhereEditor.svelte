<script lang="ts">
  /**
   * A block's where line: the "Where" button in a block's bar and its
   * popover. Order (left → right … by hand, or a named order of the show),
   * who takes part (pieces / LEDs), the motion (sweep, ping-pong, centre
   * burst, random piece, follow the kick, or drawn as a line), spread, soft
   * edge and wrap. "◆ Draw position" starts a where line at the playhead.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import { project } from '../../../stores/layers';
  import { addLineAtPlayhead } from '../../../timeline/lines/timelineLines';
  import type { ParamTarget } from '../../../timeline/lines/paramRegistry';
  import { defaultWhere, WHERE_KEYS, WHERE_MOTIONS, WHERE_ORDERS, type WhereMembers, type WhereMotion, type WhereSpec } from '../../../timeline/where/whereModel';
  import { WHERE_MEMBER_LABELS, WHERE_MOTION_LABELS, WHERE_ORDER_LABELS, whereOrderView, whereSummary } from './whereUi';
  import { generateUUID } from '../../../utils/uuid';

  interface Props {
    where: WhereSpec | null | undefined;
    /** Where the block's lines live. */
    target: ParamTarget;
    /** Who may take part (a look: all three; a content block: pieces; an LED block: LEDs). */
    members: readonly WhereMembers[];
    /** A look block's chosen pieces. */
    pieces?: ReadonlySet<string> | null;
    onchange: (where: WhereSpec | null) => void;
  }
  let { where, target, members, pieces = null, onchange }: Props = $props();

  let open = $state(false);
  let anchor: HTMLButtonElement | undefined = $state();
  let pos = $state({ left: 0, bottom: 0 });
  let naming = $state(false);
  let newName = $state('');
  let dragFrom: number | null = $state(null);

  const named = $derived($showTimeline.whereOrders);
  const order = $derived.by(() => {
    void $project;
    return where ? whereOrderView(where, pieces, named) : { slots: [] };
  });

  function toggle() {
    open = !open;
    if (open && anchor) {
      const r = anchor.getBoundingClientRect();
      pos = { left: Math.min(r.left, window.innerWidth - 340), bottom: window.innerHeight - r.top + 6 };
    }
  }
  function set(patch: Partial<WhereSpec>) {
    const base = where ?? defaultWhere(members[0]);
    onchange({ ...base, ...patch });
  }
  function setMotion(kind: WhereMotion['kind']) {
    const bars = where && 'bars' in where.motion ? where.motion.bars : 1;
    const motion: WhereMotion = kind === 'random' ? { kind, every: 'beat', seed: Math.floor(Math.random() * 100000) }
      : kind === 'kick' || kind === 'drawn' ? { kind }
      : { kind, bars } as WhereMotion;
    set({ motion, ...(kind === 'pingpong' || kind === 'burst' || kind === 'random' || kind === 'kick' ? { wrap: false } : {}) });
  }
  function setOrderValue(value: string) {
    if (value.startsWith('named:')) set({ namedOrder: value.slice(6) });
    else set({ order: value as WhereSpec['order'], namedOrder: undefined, ...(value === 'hand' && !where?.hand?.length ? { hand: order.slots.flatMap((s) => s.ids) } : {}) });
  }
  const orderValue = $derived(where?.namedOrder && named.some((o) => o.id === where.namedOrder) ? `named:${where.namedOrder}` : where?.order ?? 'left-right');

  function moveSlot(from: number, to: number) {
    if (!where || from === to) return;
    const ids = order.slots.map((s) => s.ids);
    const [it] = ids.splice(from, 1);
    ids.splice(to, 0, it);
    const hand = ids.flat();
    const namedHit = where.namedOrder ? named.find((o) => o.id === where.namedOrder) : null;
    if (namedHit) {
      showTimeline.setWhereOrders(named.map((o) => (o.id === namedHit.id ? { ...o, order: 'hand', hand } : o)));
    } else {
      set({ order: 'hand', hand });
    }
  }
  function saveNamed() {
    if (!where) return;
    const name = newName.trim() || `Order ${named.length + 1}`;
    const id = generateUUID();
    const spec = { order: where.order, angle: where.angle, hand: where.order === 'hand' ? order.slots.flatMap((s) => s.ids) : where.hand, groups: where.groups };
    showTimeline.setWhereOrders([...named, { id, name, ...spec }]);
    set({ namedOrder: id });
    naming = false;
    newName = '';
  }
  function drawPosition() {
    set({ motion: { kind: 'drawn' } });
    queueMicrotask(() => addLineAtPlayhead(target, WHERE_KEYS.position));
  }
  const bars = $derived(where && 'bars' in where.motion ? where.motion.bars : 1);
</script>

<span class="where-wrap">
  <button type="button" class="where-btn" class:on={!!where} bind:this={anchor} onclick={toggle}
    title={where ? `Where: ${whereSummary(where, named)}. Click to change.` : 'Where: make this block travel across the pieces (a sweep, a burst, a random piece on the beat…)'}
    data-where-button>
    ⇄ Where{where ? `: ${whereSummary(where, named)}` : ''}
  </button>
  {#if open}
    <div class="where-pop" style:left="{pos.left}px" style:bottom="{pos.bottom}px" data-where-popover>
      <div class="row">
        <span class="title">Where</span>
        <label class="chk"><input type="checkbox" checked={!!where} onchange={(e) => onchange((e.currentTarget as HTMLInputElement).checked ? defaultWhere(members[0]) : null)} data-where-on /> Travels across the stage</label>
        <button type="button" class="x" aria-label="Close" onclick={() => (open = false)}>×</button>
      </div>
      {#if where}
        {#if members.length > 1}
          <div class="row">
            <span class="lbl">Who</span>
            <span class="seg">
              {#each members as m (m)}
                <button type="button" class:on={where.members === m} onclick={() => set({ members: m })} data-where-members={m}>{WHERE_MEMBER_LABELS[m]}</button>
              {/each}
            </span>
          </div>
        {/if}
        <div class="row">
          <span class="lbl">Motion</span>
          <select value={where.motion.kind} onchange={(e) => setMotion((e.currentTarget as HTMLSelectElement).value as WhereMotion['kind'])} data-where-motion>
            {#each WHERE_MOTIONS as m (m)}<option value={m}>{WHERE_MOTION_LABELS[m]}</option>{/each}
          </select>
          {#if where.motion.kind === 'sweep' || where.motion.kind === 'pingpong' || where.motion.kind === 'burst'}
            <label class="num"><input type="number" min="0.25" step="0.25" value={bars} onkeydown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
              onchange={(e) => { const b = Math.max(0.0625, parseFloat((e.currentTarget as HTMLInputElement).value) || 1); set({ motion: { ...(where!.motion as any), bars: b } }); }} data-where-bars /> bars a pass</label>
          {/if}
          {#if where.motion.kind === 'sweep'}
            <label class="chk"><input type="checkbox" checked={!!where.motion.reverse} onchange={(e) => set({ motion: { kind: 'sweep', bars, reverse: (e.currentTarget as HTMLInputElement).checked } })} /> Backwards</label>
          {/if}
          {#if where.motion.kind === 'random'}
            <span class="seg">
              <button type="button" class:on={where.motion.every === 'beat'} onclick={() => set({ motion: { ...(where!.motion as any), every: 'beat' } })}>Every beat</button>
              <button type="button" class:on={where.motion.every === 'bar'} onclick={() => set({ motion: { ...(where!.motion as any), every: 'bar' } })}>Every bar</button>
            </span>
            <label class="num">Seed <input type="number" min="0" step="1" value={where.motion.seed}
              onchange={(e) => set({ motion: { ...(where!.motion as any), seed: Math.max(0, Math.floor(parseFloat((e.currentTarget as HTMLInputElement).value) || 0)) } })} /></label>
          {/if}
          {#if where.motion.kind === 'drawn'}
            <button type="button" class="line" onclick={drawPosition} data-where-draw>◆ Draw position</button>
            <button type="button" class="line" onclick={() => addLineAtPlayhead(target, WHERE_KEYS.spread)}>◆ Spread line</button>
          {/if}
        </div>
        <div class="row">
          <span class="lbl">Order</span>
          <select value={orderValue} onchange={(e) => setOrderValue((e.currentTarget as HTMLSelectElement).value)} data-where-order>
            {#each WHERE_ORDERS as o (o)}<option value={o}>{WHERE_ORDER_LABELS[o]}</option>{/each}
            {#each named as o (o.id)}<option value={`named:${o.id}`}>★ {o.name}</option>{/each}
          </select>
          {#if where.order === 'around' && !where.namedOrder}
            <label class="num">from <input type="number" step="15" value={where.angle ?? 0} onchange={(e) => set({ angle: parseFloat((e.currentTarget as HTMLInputElement).value) || 0 })} />°</label>
          {/if}
          <label class="chk" title="Pieces in a group light together"><input type="checkbox" checked={!!where.groups} onchange={(e) => set({ groups: (e.currentTarget as HTMLInputElement).checked })} /> Groups as one</label>
          {#if naming}
            <input class="name" placeholder="Name" bind:value={newName} onkeydown={(e) => { if (e.key === 'Enter') saveNamed(); }} />
            <button type="button" class="line" onclick={saveNamed}>Save</button>
          {:else}
            <button type="button" class="line" onclick={() => (naming = true)} title="Keep this order with the show to use it on other blocks">Save as a named order</button>
          {/if}
        </div>
        <ol class="slots" data-where-slots>
          {#each order.slots as slot, i (slot.ids.join('+'))}
            <li draggable="true" class:led={slot.kind === 'led'} class:over={dragFrom !== null && dragFrom !== i}
              ondragstart={(e) => { dragFrom = i; e.dataTransfer?.setData('text/plain', String(i)); }}
              ondragover={(e) => e.preventDefault()}
              ondrop={(e) => { e.preventDefault(); if (dragFrom !== null) moveSlot(dragFrom, i); dragFrom = null; }}
              ondragend={() => (dragFrom = null)}
              title="Drag to change the order (makes it a hand order)" data-where-slot={i}>
              <span class="n">{i + 1}</span> {slot.label}
            </li>
          {:else}
            <li class="empty">No pieces here yet.</li>
          {/each}
        </ol>
        <div class="row">
          <label class="rng">Spread <input type="range" min="0" max="1" step="0.01" value={where.spread} oninput={(e) => set({ spread: parseFloat((e.currentTarget as HTMLInputElement).value) })} data-where-spread /> {Math.round(where.spread * 100)}%</label>
          <label class="rng">Soft edge <input type="range" min="0" max="1" step="0.01" value={where.soft} oninput={(e) => set({ soft: parseFloat((e.currentTarget as HTMLInputElement).value) })} data-where-soft /> {Math.round(where.soft * 100)}%</label>
          {#if where.motion.kind === 'sweep' || where.motion.kind === 'drawn'}
            <label class="chk" title="The last piece neighbours the first: a sweep loops without a jump"><input type="checkbox" checked={!!where.wrap} onchange={(e) => set({ wrap: (e.currentTarget as HTMLInputElement).checked })} data-where-wrap /> Wrap</label>
          {/if}
        </div>
        <div class="hint">Lines on the block (◆ Where: position / spread / soft edge) win over these, and can follow the music or be recorded from a knob.</div>
      {/if}
    </div>
  {/if}
</span>

<style>
  .where-wrap { display: inline-flex; position: relative; }
  .where-btn {
    height: var(--ga-control-h-sm, 22px); background: var(--ga-sunk, #0c0c10); border: 1px solid rgba(92, 225, 230, 0.4);
    color: rgba(92, 225, 230, 0.9); border-radius: 3px; font: inherit; font-size: 11px; padding: 0 8px; cursor: pointer;
    max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .where-btn.on { border-color: #5ce1e6; color: #5ce1e6; background: rgba(92, 225, 230, 0.1); }
  .where-pop {
    position: fixed; z-index: 900; width: 330px; display: flex; flex-direction: column; gap: 6px;
    background: var(--ga-card, #121217); border: 1px solid rgba(92, 225, 230, 0.45); border-radius: 6px;
    padding: 8px 10px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6); font-size: 12px; color: var(--ga-ink-1, #bbb);
  }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .title { color: #5ce1e6; font-weight: 600; }
  .lbl { color: var(--ga-ink-2, #888); width: 46px; }
  .x { margin-left: auto; background: none; border: 0; color: var(--ga-ink-2, #888); font-size: 16px; cursor: pointer; }
  select, .num input, .name {
    height: 22px; background: var(--ga-slot, rgba(255, 255, 255, 0.04)); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 3px; color: var(--ga-ink-0, #e8e8e8); font: inherit; font-size: 12px; padding: 0 4px;
  }
  .num input { width: 52px; }
  .name { width: 90px; }
  .num, .chk, .rng { display: inline-flex; align-items: center; gap: 4px; }
  .rng input { width: 70px; }
  .seg { display: inline-flex; gap: 1px; padding: 1px; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 3px; }
  .seg button { background: none; border: 0; color: var(--ga-ink-1, #b9bdc8); padding: 1px 6px; cursor: pointer; font: inherit; font-size: 11px; border-radius: 2px; }
  .seg button.on { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .line { background: var(--ga-sunk, #0c0c10); border: 1px solid rgba(255, 217, 107, 0.4); color: rgba(255, 217, 107, 0.85); border-radius: 3px; font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
  .slots { list-style: none; margin: 0; padding: 0; max-height: 132px; overflow: auto; display: flex; flex-direction: column; gap: 2px; }
  .slots li { display: flex; gap: 6px; align-items: center; padding: 2px 6px; background: rgba(255, 255, 255, 0.04); border-radius: 3px; cursor: grab; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .slots li.led { border-left: 2px solid #ff9f43; }
  .slots li.over:hover { outline: 1px dashed rgba(92, 225, 230, 0.7); }
  .slots li.empty { cursor: default; color: var(--ga-ink-2, #888); }
  .slots .n { color: #5ce1e6; font-family: var(--ga-font-mono, ui-monospace, monospace); width: 16px; text-align: right; }
  .hint { font-size: 11px; color: var(--ga-ink-2, #888); }
</style>
