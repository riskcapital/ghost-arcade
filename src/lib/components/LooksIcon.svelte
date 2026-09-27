<script lang="ts">
  // The Looks mark: a keystoned (projection-mapped) surface with an Edge
  // Effect tracing part of its edge, which is what a Look does to every
  // shape. A plain line icon in currentColor like the rest of the app; the
  // traced edge reads by weight, the untraced edge is dimmed.
  let { size = 16 }: { size?: number } = $props();
</script>

<svg class="looks-icon" width={size} height={size} viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M5.4 5.2 L18.2 4.4 L20.6 19.4 L3.4 19.8 Z" stroke-width="1.5" stroke-opacity="0.45" />
  <path d="M4.5 11.8 L5.4 5.2 L18.2 4.4 L19.1 10" stroke-width="2.2" />
  <circle cx="19.1" cy="10" r="1.9" fill="currentColor" stroke="none" />
</svg>

<style>
  .looks-icon { flex: none; display: block; }
</style>
