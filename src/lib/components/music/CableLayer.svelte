<script lang="ts">
  /**
   * Draws the patch cables over the Studio view, sagging between their jacks,
   * and finishes a drag: dropped on an input of the same kind it plugs in,
   * dropped anywhere else it is gone.
   */
  import { onDestroy } from 'svelte';
  import { cableDrag, lastUnplugged } from '../../music/cablePatching';
  import type { Cable } from '../../music/studioSets';
  import { macros } from '../../stores/macros';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import type { InstrumentId } from '../../music/noteEvents';
  import { cableView } from '../../music/cableView';
  import { canConnect } from '../../music/studioSets';
  import { musicStudio } from '../../music/musicStudioStore';
  import { generateUUID } from '../../utils/uuid';
  import { CABLE_COLORS, CABLE_LIVE_COLOR, cablePath } from '../../music/cableLook';
  import './cableStyles.css';

  let { root }: { root: HTMLElement | null } = $props();

  interface Drawn { id: string; d: string; color: string; ends: [number, number, number, number] }

  const COLORS = CABLE_COLORS;

  let drawn = $state<Drawn[]>([]);
  let live = $state<{ d: string; color: string } | null>(null);
  let frame: number | null = null;
  let signature = '';
  /** Something may have moved a jack: measure on the next frame. */
  let stale = true;
  let measuredAt = 0;
  const invalidate = () => (stale = true);
  /** Between those events, jacks are looked at again this often, in case a panel moved without saying so. */
  const RECHECK_MS = 250;

  const cables = $derived($musicStudio.cables[$musicStudio.set]);

  function centre(jacks: Map<string, HTMLElement>, jack: string, origin: DOMRect): [number, number] | null {
    const el = jacks.get(jack);
    if (!el || !el.offsetParent) return null;
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2 - origin.left, r.top + r.height / 2 - origin.top];
  }

  const path = cablePath;

  function colorFor(id: string, index: number): string {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[(h + index) % COLORS.length];
  }

  /**
   * Where the cables hang. Reading jack positions makes the browser lay the
   * page out, so this runs only when something may have moved them (a
   * resize, a scroll, a panel opening, a cable plugged, a drag) and a few
   * times a second otherwise, never every frame. Hidden cables are not
   * measured at all.
   */
  function measure(now: number) {
    frame = requestAnimationFrame(measure);
    if (!root) return;
    const drag = $cableDrag;
    if (!drag && (!cables.length || $cableView === 'hide')) {
      if (drawn.length || live) { drawn = []; live = null; signature = ''; }
      return;
    }
    if (!drag && !stale && now - measuredAt < RECHECK_MS) return;
    stale = false;
    measuredAt = now;
    const origin = root.getBoundingClientRect();
    const jacks = new Map<string, HTMLElement>();
    for (const el of root.querySelectorAll<HTMLElement>('[data-jack]:not([data-bay])')) {
      const id = el.dataset.jack;
      if (id && !jacks.has(id)) jacks.set(id, el);
    }
    const next: Drawn[] = [];
    cables.forEach((c, i) => {
      const a = centre(jacks, c.from, origin);
      const b = centre(jacks, c.to, origin);
      if (!a || !b) return;
      next.push({ id: c.id, d: path(a[0], a[1], b[0], b[1]), color: colorFor(c.id, i), ends: [a[0], a[1], b[0], b[1]] });
    });
    let nextLive: typeof live = null;
    if (drag) {
      const a = centre(jacks, drag.from, origin);
      if (a) nextLive = { d: path(a[0], a[1], drag.x - origin.left, drag.y - origin.top), color: CABLE_LIVE_COLOR };
    }
    const sig = next.map((n) => n.d).join('|') + (nextLive?.d ?? '');
    if (sig === signature) return;
    signature = sig;
    drawn = next;
    live = nextLive;
  }

  // Right-click on a cable: its amount, smoothing and mode. Hit-tested here so
  // the cables never get in the way of a click on what is under them.
  let editing = $state<{ id: string; x: number; y: number } | null>(null);
  let svgEl = $state<SVGSVGElement | null>(null);
  const editCable = $derived(editing ? cables.find((c) => c.id === editing!.id) ?? null : null);

  function onContext(e: MouseEvent) {
    const jack = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-jack]:not([data-bay])')?.dataset.jack;
    if (jack && root?.contains(e.target as Node) && cables.some((c) => c.from === jack || c.to === jack)) {
      e.preventDefault();
      e.stopPropagation();
      editing = null;
      jackMenu = { jack, x: Math.min(e.clientX, innerWidth - 300), y: Math.min(e.clientY, innerHeight - 200) };
      return;
    }
    const hit = cableAt(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    jackMenu = null;
    editing = { id: hit, x: Math.min(e.clientX, innerWidth - 300), y: Math.min(e.clientY, innerHeight - 260) };
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  /** A jack as people say it: "Echo shots", "Energy", "Synth pan". */
  function jackName(j: string): string {
    if (j.startsWith('dest:macro:')) return $macros.macros.find((m) => m.id === j.slice(11))?.name ?? 'Macro';
    const inst = /^cv:(?:inst\.)?([a-z]+)\.(?:level|ring)$/.exec(j);
    if (inst && inst[1] in INSTRUMENT_LABELS) return INSTRUMENT_LABELS[inst[1] as InstrumentId];
    if (j === 'fx:in') return 'Effects';
    const t = j.replace(/^(cv|dest|audio):/, '').replace(/\.level$/, '').replace(/[.:]/g, ' ');
    const word = t.split(' ')[0];
    return (word in INSTRUMENT_LABELS ? INSTRUMENT_LABELS[word as InstrumentId] + t.slice(word.length) : t).replace(/^./, (c) => c.toUpperCase());
  }

  frame = requestAnimationFrame(measure);
  onDestroy(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    cableDrag.set(null);
  });

  // What can move a jack: the window or the view changing size, a scroll, a
  // panel or tab opening or closing, a cable plugged, the cables shown again.
  $effect(() => {
    void cables;
    void $cableView;
    invalidate();
  });
  $effect(() => {
    const el = root;
    if (!el) return;
    invalidate();
    const sizes = new ResizeObserver(invalidate);
    sizes.observe(el);
    const panels = new MutationObserver(invalidate);
    panels.observe(el, { childList: true, subtree: true });
    window.addEventListener('scroll', invalidate, { capture: true, passive: true });
    window.addEventListener('resize', invalidate);
    return () => {
      sizes.disconnect();
      panels.disconnect();
      window.removeEventListener('scroll', invalidate, { capture: true });
      window.removeEventListener('resize', invalidate);
    };
  });

  // The cable under the pointer lights up, with its plugs, so it is clear which one a grab or right-click takes.
  let hovered = $state<string | null>(null);
  function cableAt(x: number, y: number): string | null {
    if (!svgEl || !root || $cableView === 'hide') return null;
    const origin = root.getBoundingClientRect();
    const pt = new DOMPoint(x - origin.left, y - origin.top);
    return [...svgEl.querySelectorAll<SVGPathElement>('path.hit')].reverse().find((p) => p.isPointInStroke(pt))?.dataset.cable ?? null;
  }

  function onMove(e: PointerEvent) {
    const drag = $cableDrag;
    if (drag) cableDrag.set({ ...drag, x: e.clientX, y: e.clientY });
    else if (e.buttons === 0) {
      const next = cableAt(e.clientX, e.clientY);
      if (next !== hovered) hovered = next;
    }
  }

  function onUp(e: PointerEvent) {
    const drag = $cableDrag;
    if (!drag) return;
    cableDrag.set(null);
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-jack]')?.dataset.jack;
    if (target && canConnect(drag.from, target)) {
      // A carried cable keeps its id and settings wherever it goes.
      musicStudio.connectCable(drag.carry ? { ...drag.carry, to: target } : { id: generateUUID(), from: drag.from, to: target });
    } else if (drag.carry) {
      lastUnplugged.set({ cables: [drag.carry], at: Date.now() });
    }
  }

  function unplug(list: Cable[]) {
    for (const c of list) musicStudio.disconnectCable(c.id);
    if (list.length) lastUnplugged.set({ cables: list, at: Date.now() });
    editing = null;
    jackMenu = null;
  }

  function undoUnplug() {
    const u = $lastUnplugged;
    if (!u) return;
    for (const c of u.cables) musicStudio.connectCable(c);
    lastUnplugged.set(null);
  }

  // The undo offer stays for a few seconds.
  $effect(() => {
    const u = $lastUnplugged;
    if (!u) return;
    const t = setTimeout(() => lastUnplugged.update((x) => (x === u ? null : x)), 6000);
    return () => clearTimeout(t);
  });

  // Right-click on a plugged jack: its cables, each to unplug, or all of them.
  let jackMenu = $state<{ jack: string; x: number; y: number } | null>(null);
  const jackCables = $derived(jackMenu ? cables.filter((c) => c.from === jackMenu!.jack || c.to === jackMenu!.jack) : []);
</script>

<svelte:window onpointermove={onMove} onpointerup={onUp} onpointercancel={() => cableDrag.set(null)} oncontextmenucapture={onContext} />

<svg class="cables" aria-hidden="true" bind:this={svgEl}>
  <g class="patched {$cableView}">
  {#each drawn as c (c.id)}
    <path d={c.d} class="hit" data-cable={c.id} />
    <path d={c.d} class="shadow studio-cable-shadow" />
    <path d={c.d} stroke={c.color} class="cable studio-cable" class:hover={hovered === c.id} />
    <circle cx={c.ends[0]} cy={c.ends[1]} r={hovered === c.id ? 9 : 6} class="plug studio-cable-plug" class:hover={hovered === c.id} stroke={c.color} />
    <circle cx={c.ends[2]} cy={c.ends[3]} r={hovered === c.id ? 9 : 6} class="plug studio-cable-plug" class:hover={hovered === c.id} stroke={c.color} />
  {/each}
  </g>
  <g>
  {#if live}
    <path d={live.d} class="shadow studio-cable-shadow" />
    <path d={live.d} stroke={live.color} class="cable studio-cable live" />
  {/if}
  </g>
</svg>

{#if editing && editCable}
  {@const amount = editCable.amount ?? 1}
  {@const control = editCable.from.startsWith('cv:')}
  <div class="cable-editor" role="dialog" aria-label="Cable" style="left: {editing.x}px; top: {editing.y}px">
    <div class="row">
      <p class="route">{jackName(editCable.from)} <span class="muted">to</span> {jackName(editCable.to)}</p>
      <span class="spacer"></span>
      <button class="text-btn" onclick={() => unplug([editCable])}>Unplug</button>
    </div>
    {#if control}
      <div class="ga-segmented small" role="group" aria-label="Mode">
        <button class:active={(editCable.mode ?? 'env') === 'env'} onclick={() => musicStudio.shapeCable(editCable.id, { mode: 'env' })} title="Follows the sound's level">Envelope</button>
        <button class:active={editCable.mode === 'trig'} onclick={() => musicStudio.shapeCable(editCable.id, { mode: 'trig' })} title="A pulse on every hit or note, falling away over the release">Trigger</button>
      </div>
      <label>Amount <input type="range" min="-1" max="1" step="0.01" value={amount} oninput={(e) => musicStudio.shapeCable(editCable.id, { amount: +(e.target as HTMLInputElement).value })} /> <span class="val">{amount > 0 ? '+' : ''}{pct(amount)}</span></label>
      <label>Attack <input type="range" min="0" max="0.5" step="0.005" value={editCable.attack ?? 0.005} oninput={(e) => musicStudio.shapeCable(editCable.id, { attack: +(e.target as HTMLInputElement).value })} /> <span class="val">{Math.round((editCable.attack ?? 0.005) * 1000)} ms</span></label>
      <label>Release <input type="range" min="0" max="2" step="0.01" value={editCable.release ?? 0.12} oninput={(e) => musicStudio.shapeCable(editCable.id, { release: +(e.target as HTMLInputElement).value })} /> <span class="val">{Math.round((editCable.release ?? 0.12) * 1000)} ms</span></label>
    {:else}
      <p class="muted">A sound cable: it carries the sound as it is.</p>
    {/if}
    <div class="row">
      <span class="spacer"></span>
      <button class="text-btn" onclick={() => (editing = null)}>Done</button>
    </div>
  </div>
{/if}

{#if jackMenu && jackCables.length}
  <div class="cable-editor" role="dialog" aria-label="Cables in this jack" style="left: {jackMenu.x}px; top: {jackMenu.y}px">
    {#each jackCables as c (c.id)}
      <div class="row" onpointerenter={() => (hovered = c.id)} onpointerleave={() => (hovered = null)} role="group">
        <p class="route">{jackName(c.from)} <span class="muted">to</span> {jackName(c.to)}</p>
        <span class="spacer"></span>
        <button class="text-btn" onclick={() => { editing = { id: c.id, x: jackMenu!.x, y: jackMenu!.y }; jackMenu = null; }} title="Amount, smoothing and mode">Edit</button>
        <button class="text-btn" onclick={() => unplug([c])}>Unplug</button>
      </div>
    {/each}
    <div class="row">
      {#if jackCables.length > 1}<button class="text-btn" onclick={() => unplug(jackCables)}>Unplug all</button>{/if}
      <span class="spacer"></span>
      <button class="text-btn" onclick={() => (jackMenu = null)}>Done</button>
    </div>
  </div>
{/if}

{#if $lastUnplugged}
  <div class="undo" role="status">
    Unplugged {$lastUnplugged.cables.length === 1 ? `${jackName($lastUnplugged.cables[0].from)} to ${jackName($lastUnplugged.cables[0].to)}` : `${$lastUnplugged.cables.length} cables`}
    <button class="text-btn" onclick={undoUnplug}>Undo</button>
  </div>
{/if}

<style>
  .hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: none; }
  .cable.hover { stroke-width: 8; }
  .plug.hover { stroke-width: 4; }
  .cable-editor .row { gap: 6px; }
  .undo {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 96;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 12px;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: var(--studio-panel);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
    font-size: var(--ga-text-meta, 11px);
    color: var(--studio-ink);
  }
  .cable-editor {
    position: fixed;
    z-index: 96;
    width: 280px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: var(--studio-panel);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
    font-size: var(--ga-text-meta, 11px);
    color: var(--studio-muted);
  }
  .cable-editor .route { margin: 0; color: var(--studio-ink); font-weight: var(--ga-weight-control, 600); }
  .cable-editor label { display: grid; grid-template-columns: 52px 1fr 52px; align-items: center; gap: 6px; }
  .cable-editor .val { text-align: right; font-variant-numeric: tabular-nums; color: var(--studio-ink); }
  .cable-editor .row { display: flex; align-items: center; }
  .cable-editor .spacer { flex: 1; }
  .cable-editor p { margin: 0; }
  .cables {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 5;
    overflow: visible;
  }
  /* Hidden or faded cables still patch; only the drawing steps back. The cable in the hand always shows. */
  .patched.fade { opacity: 0.22; }
  .patched.hide { display: none; }
</style>
