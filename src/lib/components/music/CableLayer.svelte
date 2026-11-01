<script lang="ts">
  /**
   * Draws the patch cables over the Studio view, sagging between their jacks,
   * and finishes a drag: dropped on an input of the same kind it plugs in,
   * dropped anywhere else it is gone.
   */
  import { onDestroy } from 'svelte';
  import { cableDrag } from '../../music/cablePatching';
  import { cableView } from '../../music/cableView';
  import { canConnect } from '../../music/studioSets';
  import { musicStudio } from '../../music/musicStudioStore';
  import { generateUUID } from '../../utils/uuid';

  let { root }: { root: HTMLElement | null } = $props();

  interface Drawn { id: string; d: string; color: string; ends: [number, number, number, number] }

  const COLORS = ['#5278ff', '#a8bcff', '#7ec8e3', '#ff8577', '#e6ebf7'];

  let drawn = $state<Drawn[]>([]);
  let live = $state<{ d: string; color: string } | null>(null);
  let frame: number | null = null;
  let signature = '';

  const cables = $derived($musicStudio.cables[$musicStudio.set]);

  function centre(jack: string, origin: DOMRect): [number, number] | null {
    const el = root?.querySelector<HTMLElement>(`[data-jack="${CSS.escape(jack)}"]:not([data-bay])`);
    if (!el || !el.offsetParent) return null;
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2 - origin.left, r.top + r.height / 2 - origin.top];
  }

  /** A cable hangs: the lower the ends and the longer the run, the deeper the sag. */
  function path(x1: number, y1: number, x2: number, y2: number): string {
    const sag = Math.min(130, 24 + Math.hypot(x2 - x1, y2 - y1) * 0.12);
    const low = Math.max(y1, y2) + sag;
    return `M${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + (x2 - x1) * 0.2).toFixed(1)} ${low.toFixed(1)}, ${(x2 - (x2 - x1) * 0.2).toFixed(1)} ${low.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  }

  function colorFor(id: string, index: number): string {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[(h + index) % COLORS.length];
  }

  function measure() {
    frame = requestAnimationFrame(measure);
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const next: Drawn[] = [];
    cables.forEach((c, i) => {
      const a = centre(c.from, origin);
      const b = centre(c.to, origin);
      if (!a || !b) return;
      next.push({ id: c.id, d: path(a[0], a[1], b[0], b[1]), color: colorFor(c.id, i), ends: [a[0], a[1], b[0], b[1]] });
    });
    const drag = $cableDrag;
    let nextLive: typeof live = null;
    if (drag) {
      const a = centre(drag.from, origin);
      if (a) nextLive = { d: path(a[0], a[1], drag.x - origin.left, drag.y - origin.top), color: '#a8bcff' };
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
    if (!svgEl || !root || $cableView === 'hide') return;
    const origin = root.getBoundingClientRect();
    const pt = new DOMPoint(e.clientX - origin.left, e.clientY - origin.top);
    const hit = [...svgEl.querySelectorAll<SVGPathElement>('path.hit')].reverse().find((p) => p.isPointInStroke(pt));
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    editing = { id: hit.dataset.cable!, x: Math.min(e.clientX, innerWidth - 300), y: Math.min(e.clientY, innerHeight - 240) };
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const jackName = (j: string) => j.replace(/^(cv|dest):/, '').replace(/\.level$/, '').replace(/[.:]/g, ' ');

  frame = requestAnimationFrame(measure);
  onDestroy(() => {
    if (frame !== null) cancelAnimationFrame(frame);
    cableDrag.set(null);
  });

  function onMove(e: PointerEvent) {
    const drag = $cableDrag;
    if (drag) cableDrag.set({ ...drag, x: e.clientX, y: e.clientY });
  }

  function onUp(e: PointerEvent) {
    const drag = $cableDrag;
    if (!drag) return;
    cableDrag.set(null);
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-jack]')?.dataset.jack;
    if (target && canConnect(drag.from, target)) {
      musicStudio.connectCable({ id: generateUUID(), from: drag.from, to: target });
    }
  }
</script>

<svelte:window onpointermove={onMove} onpointerup={onUp} onpointercancel={() => cableDrag.set(null)} oncontextmenucapture={onContext} />

<svg class="cables" aria-hidden="true" bind:this={svgEl}>
  <g class="patched {$cableView}">
  {#each drawn as c (c.id)}
    <path d={c.d} class="hit" data-cable={c.id} />
    <path d={c.d} class="shadow" />
    <path d={c.d} stroke={c.color} class="cable" />
    <circle cx={c.ends[0]} cy={c.ends[1]} r="6" class="plug" stroke={c.color} />
    <circle cx={c.ends[2]} cy={c.ends[3]} r="6" class="plug" stroke={c.color} />
  {/each}
  </g>
  <g>
  {#if live}
    <path d={live.d} class="shadow" />
    <path d={live.d} stroke={live.color} class="cable live" />
  {/if}
  </g>
</svg>

{#if editing && editCable}
  {@const amount = editCable.amount ?? 1}
  {@const control = editCable.from.startsWith('cv:')}
  <div class="cable-editor" role="dialog" aria-label="Cable" style="left: {editing.x}px; top: {editing.y}px">
    <p class="route">{jackName(editCable.from)} <span class="muted">to</span> {jackName(editCable.to)}</p>
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
      <button class="text-btn" onclick={() => { musicStudio.disconnectCable(editCable.id); editing = null; }}>Unplug</button>
      <span class="spacer"></span>
      <button class="text-btn" onclick={() => (editing = null)}>Done</button>
    </div>
  </div>
{/if}

<style>
  .hit { fill: none; stroke: transparent; stroke-width: 14; pointer-events: none; }
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
  .cable { fill: none; stroke-width: 5; stroke-linecap: round; }
  .cable.live { stroke-dasharray: 2 8; }
  .shadow { fill: none; stroke: rgba(0, 0, 0, 0.5); stroke-width: 8; transform: translate(2px, 4px); }
  .plug { fill: #0d1224; stroke-width: 3; }
</style>
