<svelte:options namespace="svg" />

<script lang="ts">
  /**
   * Patch cables as they are drawn on every patchable instrument (Audio Lab,
   * Analog Synth): a coloured strand over a soft shadow with a plug at each
   * end, the one under the pointer thicker. Goes inside the instrument's own
   * <svg>, which measures the jacks and owns the clicks. `normal` cables are
   * the connections an input has with nothing plugged in: a faint dashed line,
   * no plugs. Each cable also gets an invisible wide `path.hit` (data-cable),
   * for hit-testing under the pointer; the cable in the hand (`live`) is
   * dotted and has neither.
   */
  import type { DrawnCable } from '../../music/cableLook';
  import './cableStyles.css';

  let {
    cables,
    hovered = null,
  }: {
    cables: DrawnCable[];
    hovered?: string | null;
  } = $props();
</script>

{#each cables as c (c.id)}
  {#if c.normal}
    <path d={c.d} stroke={c.color} class="studio-cable normal" />
  {:else}
    {#if !c.live}<path d={c.d} class="hit studio-cable-hit" data-cable={c.id} />{/if}
    <path d={c.d} class="shadow studio-cable-shadow" />
    <path d={c.d} stroke={c.color} class="cable studio-cable" class:hover={hovered === c.id} class:live={!!c.live} />
    {#if !c.live}
      <circle cx={c.ends[0]} cy={c.ends[1]} r={hovered === c.id ? 9 : 6} class="plug studio-cable-plug" class:hover={hovered === c.id} stroke={c.color} />
      <circle cx={c.ends[2]} cy={c.ends[3]} r={hovered === c.id ? 9 : 6} class="plug studio-cable-plug" class:hover={hovered === c.id} stroke={c.color} />
    {/if}
  {/if}
{/each}
