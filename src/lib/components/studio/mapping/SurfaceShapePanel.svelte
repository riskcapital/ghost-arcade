<script lang="ts">
  /** Kind of the selected surface (corners, mesh, free shape) and its geometry tools. */
  import './mappingPanel.css';
  import type { Surface } from '../../../mobile/studio/model';
  import { gridOf, MAX_MESH_SIDE, MIN_MESH_SIDE } from '../../../mobile/studio/mapping/meshGrid';
  import { convertSurface, setDensity, surfaceKind, type SurfaceKind } from '../../../mobile/studio/mapping/surfaceKinds';
  import { isSmooth, removePoint, setPointSmooth, insertPoint, MIN_PATH_POINTS, MAX_PATH_POINTS } from '../../../mobile/studio/mapping/pathGeometry';
  import { withShape } from '../../../mobile/studio/mapping/surfaceShape';
  import { isWelded, pointAt, unweldAt } from '../../../mobile/studio/mapping/edit';
  import MapIcon from './MapIcon.svelte';

  type Props = {
    surfaces: Surface[];
    index: number;
    point: number;
    /** Apply a change that is one undo step. */
    onapply: (surfaces: Surface[], point?: number) => void;
    onnotice?: (message: string) => void;
  };
  let { surfaces, index, point, onapply, onnotice }: Props = $props();
  const s = $derived(surfaces[index]);
  const kind = $derived(s ? surfaceKind(s) : 'quad');
  const grid = $derived(s ? gridOf(s) : { cols: 3, rows: 3 });
  const path = $derived(s?.shape?.points ?? []);
  const selectedPathPoint = $derived(kind === 'shape' ? path[point] : undefined);
  const at = $derived(pointAt(s, point));
  const welded = $derived(!!s && !!at && isWelded(s, at));

  function patch(next: Surface, p?: number) {
    onapply(surfaces.map((x, i) => (i === index ? next : x)), p);
  }
  function setKind(next: SurfaceKind) {
    if (!s || s.locked || next === kind) return;
    if (kind === 'shape' && next !== 'shape') onnotice?.('The outline is gone; Undo brings it back.');
    patch(convertSurface(s, next), 0);
  }
  function density(axis: 'cols' | 'rows', by: number) {
    if (!s || s.locked) return;
    patch(setDensity(s, { [axis]: grid[axis] + by }), 0);
  }
  const kinds: { id: SurfaceKind; label: string; icon: string }[] = [
    { id: 'quad', label: 'Corners', icon: 'quad' },
    { id: 'mesh', label: 'Mesh', icon: 'mesh' },
    { id: 'shape', label: 'Shape', icon: 'shape' },
  ];
</script>

{#if s}
  <section class="mp" aria-label="Surface shape">
    <div class="mp-head"><strong>SHAPE</strong>{#if welded}<span class="mp-label weld">Point welded</span>{/if}</div>
    <div class="mp-seg" role="group" aria-label="Surface kind">
      {#each kinds as k}<button class:active={kind === k.id} aria-pressed={kind === k.id} disabled={s.locked} onclick={() => setKind(k.id)}><MapIcon name={k.icon} size={16} />{k.label}</button>{/each}
    </div>
    {#if kind === 'mesh'}
      <div class="mp-row">
        <span class="mp-label grow">Columns</span>
        <span class="mp-step"><button aria-label="Fewer columns" disabled={s.locked || grid.cols <= MIN_MESH_SIDE} onclick={() => density('cols', -1)}><MapIcon name="remove" size={16} /></button><output>{grid.cols}</output><button aria-label="More columns" disabled={s.locked || grid.cols >= MAX_MESH_SIDE} onclick={() => density('cols', 1)}><MapIcon name="add" size={16} /></button></span>
      </div>
      <div class="mp-row">
        <span class="mp-label grow">Rows</span>
        <span class="mp-step"><button aria-label="Fewer rows" disabled={s.locked || grid.rows <= MIN_MESH_SIDE} onclick={() => density('rows', -1)}><MapIcon name="remove" size={16} /></button><output>{grid.rows}</output><button aria-label="More rows" disabled={s.locked || grid.rows >= MAX_MESH_SIDE} onclick={() => density('rows', 1)}><MapIcon name="add" size={16} /></button></span>
      </div>
      <div class="mp-row">
        <button class="grow" aria-pressed={!!s.bezier} disabled={s.locked} onclick={() => patch({ ...s, bezier: !s.bezier })}><MapIcon name="curve" size={16} />Curved edges</button>
      </div>
      <p class="mp-hint">{s.bezier ? 'Select a point, then drag its yellow handles or the squares on its edges to bend them.' : 'More points follow a curved wall; the picture keeps its place when you change them.'}</p>
    {:else if kind === 'shape'}
      <div class="mp-row">
        <button class="grow" disabled={s.locked || path.length >= MAX_PATH_POINTS} onclick={() => patch(withShape(s, insertPoint(path, point, 0.5)), point + 1)}><MapIcon name="add" size={16} />Add point</button>
        <button class="grow" disabled={s.locked || path.length <= MIN_PATH_POINTS} onclick={() => patch(withShape(s, removePoint(path, point)), Math.max(0, point - 1))}><MapIcon name="remove" size={16} />Delete point</button>
      </div>
      {#if selectedPathPoint}
        <div class="mp-seg" role="group" aria-label="Point type" style="margin-top:8px">
          <button class:active={!isSmooth(selectedPathPoint)} aria-pressed={!isSmooth(selectedPathPoint)} disabled={s.locked} onclick={() => patch(withShape(s, setPointSmooth(path, point, false)), point)}><MapIcon name="corner" size={16} />Sharp</button>
          <button class:active={isSmooth(selectedPathPoint)} aria-pressed={isSmooth(selectedPathPoint)} disabled={s.locked} onclick={() => patch(withShape(s, setPointSmooth(path, point, true)), point)}><MapIcon name="smooth" size={16} />Curved</button>
        </div>
      {/if}
      <p class="mp-hint">Tap a + on an edge to add a point there; drag the + to bend that edge.</p>
    {:else}
      <p class="mp-hint">Drag the four corners onto your surface. Choose Mesh for a curved wall or Shape for any outline.</p>
    {/if}
    {#if welded && at}
      <div class="mp-row"><button class="grow" disabled={s.locked} onclick={() => { onapply(unweldAt(surfaces, index, at), point); onnotice?.('Point unwelded: it now moves on its own.'); }}><MapIcon name="unweld" size={16} />Unweld point</button></div>
    {/if}
  </section>
{/if}

<style>
  .weld {
    color: #ffd36b;
  }
</style>
