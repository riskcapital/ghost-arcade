<script lang="ts">
  /** Choose what kind of surface to add, or draw its outline on the canvas. */
  import './mappingPanel.css';
  import type { NewSurfaceKind } from '../../../mobile/studio/mapping/surfaceKinds';
  import MapIcon from './MapIcon.svelte';

  let { full = false, onadd, ondraw, onclose }: { full?: boolean; onadd: (kind: NewSurfaceKind) => void; ondraw: () => void; onclose: () => void } = $props();
  const kinds: { id: NewSurfaceKind; label: string; icon: string }[] = [
    { id: 'quad', label: 'Corners', icon: 'quad' },
    { id: 'mesh', label: 'Mesh', icon: 'mesh' },
    { id: 'circle', label: 'Circle', icon: 'circle' },
    { id: 'triangle', label: 'Triangle', icon: 'shape' },
    { id: 'hexagon', label: 'Hexagon', icon: 'polygon' },
  ];
</script>

<section class="mp add-sheet" aria-label="Add a surface">
  <div class="mp-head"><strong>ADD SURFACE</strong><button aria-label="Close" onclick={onclose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg></button></div>
  {#if full}<p class="mp-hint">A set holds up to 16 surfaces. Remove one to add another.</p>{/if}
  <div class="mp-grid">
    {#each kinds as k}<button disabled={full} onclick={() => onadd(k.id)}><MapIcon name={k.icon} size={22} />{k.label}</button>{/each}
    <button disabled={full} onclick={ondraw}><MapIcon name="draw" size={22} />Draw outline</button>
  </div>
</section>
