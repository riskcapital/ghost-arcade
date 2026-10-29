<script lang="ts">
  /**
   * Draws the patch cables over the Studio view, sagging between their jacks,
   * and finishes a drag: dropped on an input of the same kind it plugs in,
   * dropped anywhere else it is gone.
   */
  import { onDestroy } from 'svelte';
  import { cableDrag } from '../../music/cablePatching';
  import { canConnect } from '../../music/studioSets';
  import { musicStudio } from '../../music/musicStudioStore';
  import { generateUUID } from '../../utils/uuid';

  let { root }: { root: HTMLElement | null } = $props();

  interface Drawn { id: string; d: string; color: string; ends: [number, number, number, number] }

  const COLORS = ['#f0a43a', '#d9d2bf', '#7f9db3', '#c9503c', '#9fb07a'];

  let drawn = $state<Drawn[]>([]);
  let live = $state<{ d: string; color: string } | null>(null);
  /** The output frame, which cables pass behind so they never cover the picture. */
  let hole = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let frame: number | null = null;
  let signature = '';

  const cables = $derived($musicStudio.cables[$musicStudio.set]);

  function centre(jack: string, origin: DOMRect): [number, number] | null {
    const el = root?.querySelector<HTMLElement>(`[data-jack="${CSS.escape(jack)}"]`);
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
      if (a) nextLive = { d: path(a[0], a[1], drag.x - origin.left, drag.y - origin.top), color: '#f0a43a' };
    }
    const frameEl = root.querySelector<HTMLElement>('.frame');
    const fr = frameEl?.getBoundingClientRect();
    const nextHole = fr ? { x: fr.left - origin.left, y: fr.top - origin.top, w: fr.width, h: fr.height } : null;
    const sig = next.map((n) => n.d).join('|') + (nextLive?.d ?? '') + (nextHole ? `${nextHole.x},${nextHole.y},${nextHole.w},${nextHole.h}` : '');
    if (sig === signature) return;
    signature = sig;
    hole = nextHole;
    drawn = next;
    live = nextLive;
  }

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

<svelte:window onpointermove={onMove} onpointerup={onUp} onpointercancel={() => cableDrag.set(null)} />

<svg class="cables" aria-hidden="true">
  <defs>
    <mask id="studio-cable-mask" maskUnits="userSpaceOnUse" x="-10000" y="-10000" width="30000" height="30000">
      <rect x="-10000" y="-10000" width="30000" height="30000" fill="white" />
      {#if hole}<rect x={hole.x} y={hole.y} width={hole.w} height={hole.h} rx="4" fill="black" />{/if}
    </mask>
  </defs>
  <g mask="url(#studio-cable-mask)">
  {#each drawn as c (c.id)}
    <path d={c.d} class="shadow" />
    <path d={c.d} stroke={c.color} class="cable" />
    <circle cx={c.ends[0]} cy={c.ends[1]} r="6" class="plug" stroke={c.color} />
    <circle cx={c.ends[2]} cy={c.ends[3]} r="6" class="plug" stroke={c.color} />
  {/each}
  {#if live}
    <path d={live.d} class="shadow" />
    <path d={live.d} stroke={live.color} class="cable live" />
  {/if}
  </g>
</svg>

<style>
  .cables {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 5;
    overflow: visible;
  }
  .cable { fill: none; stroke-width: 5; stroke-linecap: round; }
  .cable.live { stroke-dasharray: 2 8; }
  .shadow { fill: none; stroke: rgba(0, 0, 0, 0.5); stroke-width: 8; transform: translate(2px, 4px); }
  .plug { fill: #2a2723; stroke-width: 3; }
</style>
