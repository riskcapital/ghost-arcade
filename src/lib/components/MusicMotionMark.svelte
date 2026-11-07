<!--
  The quiet mark for a shader made for Music motion: a tiny waveform, icon
  only, in the app's icon blue. `live` marks a shader with Music motion
  switched on: its bars move.
-->
<script lang="ts">
  interface Props {
    size?: number;
    title?: string;
    live?: boolean;
  }

  let { size = 11, title = 'Made for Music motion', live = false }: Props = $props();
</script>

<svg
  class="mm-mark"
  class:live
  width={size}
  height={size}
  viewBox="0 0 12 12"
  fill="none"
  stroke="currentColor"
  stroke-width="1.4"
  stroke-linecap="round"
  role={title ? 'img' : undefined}
  aria-label={title || undefined}
  aria-hidden={title ? undefined : 'true'}
>{#if title}<title>{title}</title>{/if}<path d="M1 6h1.5M10.5 6H11" /><path class="bar b1" d="M4 3.5v5" /><path class="bar b2" d="M6.5 1.5v9" /><path class="bar b3" d="M9 4v4" /></svg>

<style>
  .mm-mark {
    display: inline-block;
    flex: none;
    vertical-align: -1px;
    color: var(--ga-icon, #5278ff);
  }
  .bar {
    transform-box: fill-box;
    transform-origin: center;
  }
  .live .bar {
    animation: mm-bar 0.9s ease-in-out infinite alternate;
  }
  .live .b2 { animation-delay: -0.3s; }
  .live .b3 { animation-delay: -0.6s; }
  @keyframes mm-bar {
    from { transform: scaleY(0.35); }
    to { transform: scaleY(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .live .bar { animation: none; }
  }
</style>
