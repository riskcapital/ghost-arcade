<script lang="ts">
  /**
   * On the editor's stage preview: the pieces (and LED fixtures) a where
   * line lights, outlined by how lit they are. Shown while hovering a block's
   * where band, and while a block with a where line is selected in the
   * Timeline (at the playhead). Visual only (pointer-events: none).
   */
  import { project } from '../../../stores/layers';
  import { showSlice } from './timelineSlices';
  import { getShapeVertices, type Layer, type WLEDController } from '../../../types';
  import { resolveWLEDMapping } from '../../../wled/mapping';
  import { parseLedSpotId } from '../../../timeline/where/spatialOrder';
  import { whereHighlight, litSpotsAt, lookPieces, type WhereBlockInfo } from './whereUi';

  let { containerWidth, containerHeight }: { containerWidth: number; containerHeight: number } = $props();

  // Slices, not $showTimeline: the store publishes every playhead frame.
  const doc = showSlice('doc');
  const isOpen = showSlice('isOpen');
  const selection = showSlice('selection');
  const lookClips = showSlice('lookClips');
  const ledClips = showSlice('ledClips');
  const layerTracks = showSlice('layerTracks');
  const isPlaying = showSlice('isPlaying');
  const currentTime = showSlice('currentTime');

  /** The selected block's where line, when the Timeline is open on it. */
  const selectedInfo = $derived.by((): WhereBlockInfo | null => {
    if ($doc !== 'timeline' || !$isOpen || !$selection) return null;
    const sel = $selection;
    const s = { lookClips: $lookClips, ledClips: $ledClips, layerTracks: $layerTracks };
    if (sel.kind === 'lookClip') {
      const c = s.lookClips.find((x) => x.id === sel.id);
      return c?.where ? { target: { scope: 'look', id: c.id }, where: c.where, start: c.startTime, duration: c.duration, pieces: lookPieces(($project.layers ?? []) as Layer[], c.scope, c.layerIds) } : null;
    }
    if (sel.kind === 'ledClip') {
      const c = s.ledClips.find((x) => x.id === sel.id);
      return c?.where ? { target: { scope: 'block', id: c.id }, where: c.where, start: c.startTime, duration: c.duration } : null;
    }
    if (sel.kind === 'layerClip') {
      for (const t of s.layerTracks) {
        const c = t.clips.find((x) => x.id === sel.id);
        if (c?.where) return { target: { scope: 'block', id: c.id }, where: c.where, start: c.startTime, duration: c.duration };
      }
    }
    return null;
  });

  const lit = $derived.by(() => {
    if ($whereHighlight) return $whereHighlight;
    const info = selectedInfo;
    if (!info || $isPlaying) return null;
    return litSpotsAt(info, $currentTime).lit;
  });

  function outline(layer: Layer): string {
    const c = layer.corners;
    const uv = layer.layerShape && layer.layerShape.enabled !== false ? getShapeVertices(layer.layerShape) : [];
    const pts = uv.length >= 3 ? uv : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    return pts.map((p) => {
      const topX = c.topLeft.x + (c.topRight.x - c.topLeft.x) * p.x;
      const topY = c.topLeft.y + (c.topRight.y - c.topLeft.y) * p.x;
      const botX = c.bottomLeft.x + (c.bottomRight.x - c.bottomLeft.x) * p.x;
      const botY = c.bottomLeft.y + (c.bottomRight.y - c.bottomLeft.y) * p.x;
      return `${(botX + (topX - botX) * p.y) * containerWidth},${(1 - (botY + (topY - botY) * p.y)) * containerHeight}`;
    }).join(' ');
  }

  const shapes = $derived.by(() => {
    const map = lit;
    if (!map?.size) return { pieces: [], leds: [] };
    const layers = ($project.layers ?? []) as Layer[];
    const pieces = layers.filter((l) => l.corners && (map.get(l.id) ?? 0) > 0).map((l) => ({ id: l.id, points: outline(l), w: map.get(l.id)! }));
    const leds: Array<{ id: string; x: number; y: number; w: number }> = [];
    for (const [id, w] of map) {
      const spot = parseLedSpotId(id);
      if (!spot) continue;
      const c = (($project as { wledControllers?: WLEDController[] }).wledControllers ?? []).find((x) => x.id === spot.controllerId);
      if (!c) continue;
      const range = spot.rangeId ? c.ranges?.find((r) => r.id === spot.rangeId) : null;
      const pts = resolveWLEDMapping(c.ledCount, c.mapping, containerWidth / Math.max(1, containerHeight)).points;
      const from = range ? range.start : 0;
      const to = range ? range.start + range.count : pts.length;
      for (let i = from; i < Math.min(to, pts.length); i += Math.max(1, Math.floor((to - from) / 60))) {
        leds.push({ id: `${id}:${i}`, x: pts[i].x * containerWidth, y: pts[i].y * containerHeight, w });
      }
    }
    return { pieces, leds };
  });
</script>

{#if shapes.pieces.length || shapes.leds.length}
  <svg class="where-hl" width={containerWidth} height={containerHeight} data-where-highlight>
    {#each shapes.pieces as p (p.id)}
      <polygon points={p.points} style:fill-opacity={0.18 * p.w} style:stroke-opacity={0.35 + 0.65 * p.w} />
    {/each}
    {#each shapes.leds as d (d.id)}
      <circle cx={d.x} cy={d.y} r="4" style:fill-opacity={0.3 + 0.7 * d.w} />
    {/each}
  </svg>
{/if}

<style>
  .where-hl { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 29; overflow: visible; }
  polygon { fill: #5ce1e6; stroke: #5ce1e6; stroke-width: 2; vector-effect: non-scaling-stroke; }
  circle { fill: #ff9f43; stroke: rgba(0, 0, 0, 0.6); stroke-width: 1; }
</style>
