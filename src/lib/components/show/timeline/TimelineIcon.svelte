<script lang="ts" module>
  /**
   * The Timeline's icons: one stroke family (24 grid, round caps), drawn in
   * currentColor so a button's own colour states carry over.
   */
  export type TimelineIconName =
    | 'song'
    | 'marker'
    | 'cues'
    | 'sections'
    | 'phrases'
    | 'snap'
    | 'zoom-in'
    | 'zoom-out'
    | 'tempo'
    | 'help'
    | 'trash'
    | 'record'
    | 'sliders'
    | 'sparkle'
    | 'eye'
    | 'eye-off'
    | 'solo'
    | 'lock'
    | 'unlock'
    | 'layer-add'
    | 'line-add'
    | 'play'
    | 'media'
    | 'chevron'
    | 'live';
</script>

<script lang="ts">
  interface Props {
    name: TimelineIconName;
    size?: number;
  }
  let { name, size = 15 }: Props = $props();
</script>

<svg class="tl-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'song'}
    <path d="M9 18V5l11-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="17" cy="16" r="3" />
  {:else if name === 'marker'}
    <path d="M6 3h12v12l-6 6-6-6z" /><path d="M12 7v4M10 9h4" />
  {:else if name === 'cues'}
    <path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3" />
  {:else if name === 'sections'}
    <path d="M3 5h5v14H3zM10 5h4v14h-4zM16 5h5v14h-5z" />
  {:else if name === 'phrases'}
    <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
  {:else if name === 'snap'}
    <path d="M6 3v8a6 6 0 0 0 12 0V3" /><path d="M6 7h4M14 7h4" />
  {:else if name === 'zoom-in'}
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" />
  {:else if name === 'zoom-out'}
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M8 11h6" />
  {:else if name === 'tempo'}
    <path d="M9 3h6l3 18H6z" /><path d="M12 15l5-8" />
  {:else if name === 'help'}
    <circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" /><path d="M12 17h.01" stroke-width="2.6" />
  {:else if name === 'trash'}
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  {:else if name === 'record'}
    <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
  {:else if name === 'sliders'}
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
  {:else if name === 'sparkle'}
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z" />
  {:else if name === 'eye'}
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" />
  {:else if name === 'eye-off'}
    <path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.8 0 3.3-.5 4.6-1.2" />
  {:else if name === 'solo'}
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" />
  {:else if name === 'lock'}
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
  {:else if name === 'unlock'}
    <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" />
  {:else if name === 'layer-add'}
    <path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 4-2.2" /><path d="M19 15v6M16 18h6" />
  {:else if name === 'line-add'}
    <path d="M3 17l5-6 4 3 5-7" /><path d="M19 3v6M16 6h6" />
  {:else if name === 'play'}
    <path d="M7 4l13 8-13 8z" fill="currentColor" />
  {:else if name === 'media'}
    <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" fill="currentColor" />
  {:else if name === 'live'}
    <circle cx="12" cy="12" r="2" fill="currentColor" /><path d="M8.5 15.5a5 5 0 0 1 0-7M15.5 8.5a5 5 0 0 1 0 7M5.6 18.4a9 9 0 0 1 0-12.8M18.4 5.6a9 9 0 0 1 0 12.8" />
  {:else if name === 'chevron'}
    <path d="M6 9l6 6 6-6" />
  {/if}
</svg>

<style>
  .tl-icon { flex-shrink: 0; display: block; }
</style>
