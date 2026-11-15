<script lang="ts">
  /**
   * Audio Lab's icon: a flask with sound rising from it. The one drawing
   * every Audio Lab icon uses (plugin cards, layer thumbnails, the plugin
   * panel and the VJ dock button), so changing it is one edit here.
   */
  /** Box size in CSS pixels. */
  export let size = 24;
  /** For small buttons (the VJ dock): a heavier line, without the liquid. */
  export let compact = false;
  let className = '';
  export { className as class };
</script>

<svg class={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={compact ? 1.8 : 1.4} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M9.6 9h4.8M10.4 9v4l-4 6.2A1.2 1.2 0 0 0 7.4 21h9.2a1.2 1.2 0 0 0 1-1.8l-4-6.2V9"/>
  {#if !compact}<path d="M8.3 18h7.4" stroke-width="1.1" opacity=".6"/>{/if}
  <path d="M9.8 6.3a3.2 3.2 0 0 1 4.4 0M8 4.3a5.8 5.8 0 0 1 8 0" stroke-width={compact ? 1.5 : 1.2} opacity=".7"/>
</svg>

<style>
  svg { display: block; flex: none; }
</style>
