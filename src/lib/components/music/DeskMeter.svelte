<script lang="ts">
  /**
   * A segmented LED meter: green up to -12 dB, amber to -3, red above, a
   * held peak segment and a clip light. One column per channel given (two for
   * a stereo source). Levels are 0-1 on a -60 to 0 dB scale.
   */
  let { levels, peaks, clip = false, onclear }: { levels: number[]; peaks: number[]; clip?: boolean; onclear?: () => void } = $props();

  const SEGMENTS = 24;
  const segs = Array.from({ length: SEGMENTS }, (_, i) => i);
  /** A segment's colour by the dB it stands for. */
  const zone = (i: number) => {
    const db = ((i + 1) / SEGMENTS) * 60 - 60;
    return db > -3 ? 'red' : db > -12 ? 'amber' : 'green';
  };
</script>

<div class="meter" aria-hidden="true">
  <button class="clip" class:on={clip} onclick={() => onclear?.()} tabindex="-1" title="Clip: click to clear"></button>
  <div class="cols">
    {#each levels as level, c (c)}
      {@const lit = Math.round(level * SEGMENTS)}
      {@const peak = Math.min(SEGMENTS - 1, Math.round((peaks[c] ?? 0) * SEGMENTS) - 1)}
      <div class="col">
        {#each segs as i (i)}
          <span class="seg {zone(i)}" class:on={i < lit} class:peak={i === peak && peak >= lit}></span>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .meter { display: flex; flex-direction: column; gap: 3px; align-items: center; padding: 13px 0; }
  .clip { width: 100%; min-width: 8px; height: 5px; padding: 0; border: 0; border-radius: 1px; background: color-mix(in srgb, var(--ga-rec, #ff3b30) 18%, transparent); cursor: pointer; }
  .clip.on { background: var(--ga-rec, #ff3b30); box-shadow: 0 0 5px var(--ga-rec, #ff3b30); }
  .cols { flex: 1; display: flex; gap: 2px; padding: 2px; border-radius: 2px; background: var(--studio-slot, #050608); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.8); }
  .col { width: 5px; display: flex; flex-direction: column-reverse; gap: 1px; }
  .seg { flex: 1; border-radius: 1px; opacity: 0.16; }
  .seg.green { background: var(--ga-green, #46d18a); }
  /* Amber is made from the meter's own green and red. */
  .seg.amber { background: color-mix(in srgb, var(--ga-green, #46d18a) 45%, var(--ga-rec, #ff3b30)); }
  .seg.red { background: var(--ga-rec, #ff3b30); }
  .seg.on, .seg.peak { opacity: 1; }
</style>
