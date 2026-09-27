<script lang="ts">
  // Numbered badges on the canvas while a Screen FX chase order is being
  // clicked in: each picked screen shows its place in the chase. Purely
  // visual (pointer-events: none), so clicks fall through to selection.
  import { project } from '../stores/layers';
  import { chaseOrderRecording } from '../stores/chaseOrderRecorder';
  import { getShapeVertices, type Layer } from '../types';

  let { containerWidth, containerHeight }: { containerWidth: number; containerHeight: number } = $props();

  /** Centroid of the layer's outline in canvas pixels (y down). */
  function centre(layer: Layer): { x: number; y: number } | null {
    const c = layer.corners;
    if (!c) return null;
    const uv = layer.layerShape && layer.layerShape.enabled !== false ? getShapeVertices(layer.layerShape) : [];
    const pts = uv.length >= 3 ? uv : [{ x: 0.5, y: 0.5 }];
    let sx = 0, sy = 0;
    for (const p of pts) {
      const topX = c.topLeft.x + (c.topRight.x - c.topLeft.x) * p.x;
      const topY = c.topLeft.y + (c.topRight.y - c.topLeft.y) * p.x;
      const botX = c.bottomLeft.x + (c.bottomRight.x - c.bottomLeft.x) * p.x;
      const botY = c.bottomLeft.y + (c.bottomRight.y - c.bottomLeft.y) * p.x;
      sx += botX + (topX - botX) * p.y;
      sy += botY + (topY - botY) * p.y;
    }
    return { x: (sx / pts.length) * containerWidth, y: (1 - sy / pts.length) * containerHeight };
  }

  const badges = $derived.by(() => {
    const order = $chaseOrderRecording?.order ?? [];
    return order.flatMap((id, i) => {
      const layer = $project.layers.find((item) => item.id === id);
      const at = layer ? centre(layer) : null;
      return at ? [{ id, n: i + 1, ...at }] : [];
    });
  });
</script>

{#if $chaseOrderRecording}
  <div class="chase-badges" style:width="{containerWidth}px" style:height="{containerHeight}px" aria-hidden="true">
    <div class="chase-banner">Click screens in chase order ({badges.length} picked)</div>
    {#each badges as badge (badge.id)}
      <span class="chase-badge" style:left="{badge.x}px" style:top="{badge.y}px">{badge.n}</span>
    {/each}
  </div>
{/if}

<style>
  .chase-badges { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 30; }
  .chase-banner {
    position: absolute; left: 50%; top: 8px; transform: translateX(-50%);
    background: rgba(255, 79, 216, 0.9); color: #fff; font-size: 12px; font-weight: 600;
    padding: 4px 10px; border-radius: 12px; white-space: nowrap;
  }
  .chase-badge {
    position: absolute; transform: translate(-50%, -50%); min-width: 22px; height: 22px; padding: 0 5px;
    border-radius: 11px; background: #ff4fd8; color: #fff; font: 700 12px/22px system-ui, sans-serif;
    text-align: center; box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6);
  }
</style>
