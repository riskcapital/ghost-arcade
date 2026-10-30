<script lang="ts">
  /**
   * Settings > Show Control. One entry point for the four sections, which
   * also carries the row styles they share (Settings' own row styles are
   * scoped to SettingsPanel.svelte and do not reach child components).
   */
  import TimecodeSettings from './TimecodeSettings.svelte';
  import ScheduleSettings from './ScheduleSettings.svelte';
  import StartupSettings from './StartupSettings.svelte';
  import ProjectorSettings from './ProjectorSettings.svelte';

  export let section: 'timecode' | 'schedule' | 'startup' | 'projectors';
</script>

<div class="show-settings">
  {#if section === 'timecode'}
    <TimecodeSettings />
  {:else if section === 'schedule'}
    <ScheduleSettings />
  {:else if section === 'startup'}
    <StartupSettings />
  {:else}
    <ProjectorSettings />
  {/if}
</div>

<style>
  .show-settings :global(.sc-row) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .show-settings :global(.sc-label) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .show-settings :global(.sc-title) { font-size: var(--ga-text-body, 13px); font-weight: var(--ga-weight-body, 500); color: var(--ga-ink-0, #eee); }
  .show-settings :global(.sc-hint) { font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--ga-ink-2, #777); }
  /* Sub-headings: eyebrow. */
  .show-settings :global(.sc-sub) {
    margin: 16px 0 4px;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #9a9aa6);
  }
  .show-settings :global(select),
  .show-settings :global(input[type='text']),
  .show-settings :global(input[type='number']),
  .show-settings :global(input[type='time']),
  .show-settings :global(input[type='date']) {
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: var(--ga-slot, #09090c);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-0, #e7e7eb);
    padding: 0 8px;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
  }
  .show-settings :global(input[type='checkbox']) { width: 16px; height: 16px; cursor: pointer; }
</style>
