<script lang="ts">
  /**
   * PluginIcon — single source of truth for plugin glyph SVGs.
   * Shared between the MediaTray plugin cards (32×32) and the
   * LayerPanel thumbnail (24×24 by default — sized by the consumer).
   *
   * Add a new plugin's icon by adding a {:else if pluginId === 'xxx'}
   * branch below. The {:else} fallback renders the manifest's unicode
   * glyph (manifest.icon) so a missing branch still draws something.
   */
  import { getPluginByEffectType } from '../plugins/registry';
  import type { IntegratedEffectType } from '../types';

  /** Plugin id (preferred) OR an effectType that resolves to one. */
  export let pluginId: string | null = null;
  export let effectType: IntegratedEffectType | null = null;
  /** SVG box size in CSS pixels. */
  export let size: number = 32;

  // Resolve pluginId from effectType if needed
  $: resolvedId = pluginId ?? (effectType ? (getPluginByEffectType(effectType)?.id ?? null) : null);
  // Fallback unicode glyph if we have no custom SVG for this id
  $: fallbackGlyph = effectType
    ? (getPluginByEffectType(effectType)?.icon ?? '?')
    : '?';
</script>

{#if resolvedId === 'fluidgen'}
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 2C6.5 8 4 12 4 15a8 8 0 1 0 16 0c0-3-2.5-7-8-13Z" stroke="currentColor" stroke-width="1.4"/>
    <path d="M9 14c0 2 1.3 3 3 3s3-1 3-3" stroke="currentColor" stroke-width="1" opacity="0.55"/>
  </svg>

{:else if resolvedId === 'particles3d'}
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="2.5" stroke="currentColor" stroke-width="1.4"/>
    <circle cx="6" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="18" cy="6" r="1.2" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="6" cy="18" r="1.2" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="18" cy="18" r="1.5" stroke="currentColor" stroke-width="1.2"/>
    <line x1="8.5" y1="9.5" x2="6.5" y2="7.5" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
    <line x1="15.5" y1="9.5" x2="17.5" y2="7.5" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
    <line x1="8.5" y1="14.5" x2="6.5" y2="16.5" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
    <line x1="15.5" y1="14.5" x2="17.5" y2="16.5" stroke="currentColor" stroke-width="0.8" opacity="0.5"/>
  </svg>

{:else if resolvedId === 'milkdrop'}
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="1.4" stroke="currentColor" stroke-width="1.3"/>
    <path d="M12 12c0-2 2-3 3-2s1 4-1 5-5-1-5-4 3-6 7-6 7 4 7 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
  </svg>

{:else if resolvedId === 'audiomotion'}
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <rect x="3"  y="14" width="2" height="6"  fill="currentColor" rx="0.5"/>
    <rect x="6"  y="10" width="2" height="10" fill="currentColor" rx="0.5"/>
    <rect x="9"  y="7"  width="2" height="13" fill="currentColor" rx="0.5"/>
    <rect x="12" y="5"  width="2" height="15" fill="currentColor" rx="0.5"/>
    <rect x="15" y="9"  width="2" height="11" fill="currentColor" rx="0.5"/>
    <rect x="18" y="13" width="2" height="7"  fill="currentColor" rx="0.5"/>
  </svg>

{:else if resolvedId === 'wavejs'}
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.2"/>
    <circle cx="12" cy="12" r="7"   stroke="currentColor" stroke-width="1" opacity="0.6"/>
    <circle cx="12" cy="12" r="10"  stroke="currentColor" stroke-width="0.8" opacity="0.35"/>
    <path d="M2 12 Q 6 7, 12 12 T 22 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
  </svg>

{:else if resolvedId === 'hydra'}
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="2"   stroke="currentColor" stroke-width="1.3"/>
    <path d="M12 4 L12 8 M12 16 L12 20 M4 12 L8 12 M16 12 L20 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M6.3 6.3 L9.2 9.2 M14.8 14.8 L17.7 17.7 M17.7 6.3 L14.8 9.2 M9.2 14.8 L6.3 17.7" stroke="currentColor" stroke-width="1" opacity="0.6" stroke-linecap="round"/>
  </svg>

{:else if resolvedId === 'ghostfx'}
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 3 L20 12 L12 21 L4 12 Z"  stroke="currentColor" stroke-width="1.3"/>
    <path d="M12 7 L17 12 L12 17 L7 12 Z"  stroke="currentColor" stroke-width="1" opacity="0.65"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
  </svg>

{:else if resolvedId === 'handfx'}
  <!-- HandFX: stylised hand silhouette (5 fingers, minimal palm) -->
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <!-- Palm + thumb base -->
    <path d="M8 21 C 6 19, 5 17, 5 14 L 5 9 a 1.2 1.2 0 0 1 2.4 0 L 7.4 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <!-- 4 fingers extending up -->
    <path d="M9 14 L 9 5 a 1.1 1.1 0 0 1 2.2 0 L 11.2 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M12 13 L 12 4 a 1.1 1.1 0 0 1 2.2 0 L 14.2 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M15 13 L 15 5 a 1.1 1.1 0 0 1 2.2 0 L 17.2 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    <!-- Right-side palm closing back to thumb -->
    <path d="M17.2 13 L 17.2 16 C 17.2 19, 14 21, 12 21 L 8 21" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- Sensor pulse at fingertips -->
    <circle cx="6.2" cy="9"  r="0.9" fill="currentColor" opacity="0.55"/>
    <circle cx="10.1" cy="5"  r="0.9" fill="currentColor" opacity="0.55"/>
    <circle cx="13.1" cy="4"  r="0.9" fill="currentColor" opacity="0.55"/>
    <circle cx="16.1" cy="5"  r="0.9" fill="currentColor" opacity="0.55"/>
  </svg>

{:else if resolvedId === 'analyzerlab'}
  <!-- Analyzer Lab: 3 stacked analysis panels (waterfall lines, chroma bars, waveform) -->
  <svg class="plugin-icon-svg" width={size} height={size} viewBox="0 0 24 24" fill="none">
    <!-- Spectrogram top: horizontal scan lines -->
    <line x1="3" y1="5" x2="21" y2="5" stroke="currentColor" stroke-width="0.9" opacity="0.85"/>
    <line x1="3" y1="7" x2="21" y2="7" stroke="currentColor" stroke-width="0.9" opacity="0.55"/>
    <line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="0.9" opacity="0.30"/>
    <!-- Chromagram middle: 6 thin bars -->
    <rect x="4"  y="12" width="1.8" height="3" fill="currentColor" rx="0.3"/>
    <rect x="7"  y="11" width="1.8" height="4" fill="currentColor" rx="0.3"/>
    <rect x="10" y="13" width="1.8" height="2" fill="currentColor" rx="0.3"/>
    <rect x="13" y="11" width="1.8" height="4" fill="currentColor" rx="0.3"/>
    <rect x="16" y="12" width="1.8" height="3" fill="currentColor" rx="0.3"/>
    <rect x="19" y="13" width="1.5" height="2" fill="currentColor" rx="0.3"/>
    <!-- Waveform bottom: oscilloscope curve -->
    <path d="M3 19 Q 6 17, 9 19 T 15 19 T 21 19" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  </svg>

{:else}
  <!-- Fallback: manifest's unicode icon char -->
  <span class="plugin-icon-emoji" style="font-size:{Math.round(size * 0.66) + 2}px">{fallbackGlyph}</span>
{/if}

<style>
  .plugin-icon-svg {
    color: var(--coral, #FF6B6B);
    display: block;
  }
  .plugin-icon-emoji {
    display: inline-block;
    line-height: 1;
    color: var(--coral, #FF6B6B);
  }
</style>
