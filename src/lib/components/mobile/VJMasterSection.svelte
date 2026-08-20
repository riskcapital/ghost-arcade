<script lang="ts">
  import VJFader from './VJFader.svelte';
  import { t } from '../../i18n';

  export let masterOpacity: number = 1;
  export let isLive: boolean = false;
  export let onMasterOpacityChange: (val: number) => void = () => {};
  export let onToggleLive: () => void = () => {};
  export let onStopAll: () => void = () => {};
  /** Compact mode: drops the LIVE button entirely, shrinks the master
   *  fader to ~140px, and tightens padding so the section can sit inline
   *  with the macro bank + tempo strip in the new tablet bottom row. */
  export let compact: boolean = false;
  /** Hide the GO-LIVE button regardless of compact mode. The button is
   *  redundant on tablets where the desktop already controls live state
   *  (and the tablet just mirrors it), so by default we hide it on the
   *  iPad surface — operators kept hitting it accidentally and dropping
   *  the show. */
  export let showLiveButton: boolean = false;
</script>

<div class="master-section" class:compact>
  <div class="master-fader-row">
    <span class="master-label">{$t('mobileControls.master.label')}</span>
    <div class="master-fader">
      <VJFader
        value={masterOpacity}
        label=""
        color="var(--accent-primary)"
        orientation="horizontal"
        onChange={onMasterOpacityChange}
        showLeds={true}
        ledCount={compact ? 8 : 12}
      />
    </div>
  </div>
  <div class="master-buttons">
    {#if showLiveButton}
      <button
        class="live-btn"
        class:active={isLive}
        on:click={onToggleLive}
      >
        <span class="live-dot" class:active={isLive}></span>
        {isLive ? $t('mobileControls.master.live') : $t('mobileControls.master.goLive')}
      </button>
    {/if}
    <button
      class="stop-all-btn"
      on:click={onStopAll}
      title={$t('mobileControls.master.stopAllTitle')}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
      {$t('mobileControls.master.stop')}
    </button>
  </div>
</div>

<style>
  .master-section {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: rgba(10, 10, 14, 0.95);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    flex-shrink: 0;
    z-index: 10;
  }

  /* Compact mode (used in the new tablet bottom row): tighter padding,
     smaller fixed-width fader so the macros + tempo + master fit on one
     line. The fader stays touch-friendly (~140px wide is plenty for a
     thumb-drag with LED feedback). */
  .master-section.compact {
    padding: 4px 6px;
    gap: 6px;
    border-top: none;
  }
  .master-section.compact .master-fader-row {
    flex: 0 0 auto;
  }
  .master-section.compact .master-fader {
    /* Wider than the original 140 — operator wanted more thumb room
       for fine master-opacity control during transitions. 180px still
       leaves plenty of horizontal real estate for macros + tempo to
       its left in the bottom row on a 1180px iPad Pro 11" landscape. */
    width: 180px;
  }
  .master-section.compact .master-label {
    font-size: 10px;
    letter-spacing: 1.2px;
  }
  .master-section.compact .stop-all-btn {
    padding: 6px 10px;
    font-size: 11px;
  }

  .master-fader-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .master-label {
    font-size: 11px;
    font-weight: 800;
    color: var(--accent-primary, #ff6b6b);
    letter-spacing: 2px;
    text-shadow: 0 0 10px var(--accent-primary, #ff6b6b);
    white-space: nowrap;
  }

  .master-fader {
    flex: 1;
    min-width: 0;
  }

  .master-buttons {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }

  .live-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 2px;
    text-transform: uppercase;
    background: rgba(60, 60, 60, 0.6);
    border: 2px solid #444;
    color: var(--text-muted, #888);
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }

  .live-btn.active {
    background: rgba(255, 50, 50, 0.12);
    border-color: #ff3333;
    color: #ff3333;
    box-shadow:
      0 0 16px rgba(255, 50, 50, 0.25),
      inset 0 0 16px rgba(255, 50, 50, 0.04);
    animation: live-pulse 1.5s ease-in-out infinite;
  }

  .live-btn:active {
    transform: scale(0.96);
  }

  .live-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #555;
    transition: background 0.2s;
  }

  .live-dot.active {
    background: #ff3333;
    box-shadow: 0 0 8px #ff3333;
    animation: dot-blink 1s infinite;
  }

  @keyframes live-pulse {
    0%, 100% {
      box-shadow:
        0 0 16px rgba(255, 50, 50, 0.25),
        inset 0 0 16px rgba(255, 50, 50, 0.04);
    }
    50% {
      box-shadow:
        0 0 32px rgba(255, 50, 50, 0.4),
        0 0 60px rgba(255, 50, 50, 0.15),
        inset 0 0 20px rgba(255, 50, 50, 0.06);
    }
  }

  @keyframes dot-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .stop-all-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1px;
    background: rgba(255, 68, 68, 0.08);
    border: 1px solid rgba(255, 68, 68, 0.25);
    color: #ff4444;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    -webkit-tap-highlight-color: transparent;
  }

  .stop-all-btn:active {
    transform: scale(0.95);
    background: rgba(255, 68, 68, 0.25);
    box-shadow: 0 0 16px rgba(255, 68, 68, 0.3);
  }
</style>
