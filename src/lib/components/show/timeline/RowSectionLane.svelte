<script lang="ts">
  /** A section header's strip in the lanes (and, folded, where its summary goes). */
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    height?: number;
    children?: Snippet;
  }
  let { id, height = 24, children }: Props = $props();
</script>

<div class="rsl" style:height="{height}px" data-row-section-lane={id}>{#if children}{@render children()}{/if}</div>

<style>
  .rsl {
    position: relative;
    box-sizing: border-box;
    background: #12110e;
    border-top: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-bottom: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07));
  }
</style>
