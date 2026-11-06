<!--
  The quiet mark for a shader made for Music motion: a tiny waveform, icon
  only, in the app's icon blue.
-->
<script lang="ts">
  interface Props {
    size?: number;
    title?: string;
  }

  let { size = 11, title = 'Made for Music motion' }: Props = $props();
</script>

<svg
  class="mm-mark"
  width={size}
  height={size}
  viewBox="0 0 12 12"
  fill="none"
  stroke="currentColor"
  stroke-width="1.4"
  stroke-linecap="round"
  role="img"
  aria-label={title}
><title>{title}</title><path d="M1 6h1.5M4 3.5v5M6.5 1.5v9M9 4v4M10.5 6H11" /></svg>

<style>
  .mm-mark {
    display: inline-block;
    flex: none;
    vertical-align: -1px;
    color: var(--ga-icon, #5278ff);
  }
</style>
