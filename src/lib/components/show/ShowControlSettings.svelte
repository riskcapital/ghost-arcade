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
    border-bottom: 1px solid #161618;
  }
  .show-settings :global(.sc-label) {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }
  .show-settings :global(.sc-title) { font-size: 14px; color: var(--text-primary, #eee); }
  .show-settings :global(.sc-hint) { font-size: 12px; color: #777; }
  .show-settings :global(.sc-sub) {
    margin: 14px 0 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #9a9aa6;
  }
  .show-settings :global(select),
  .show-settings :global(input[type='text']),
  .show-settings :global(input[type='number']),
  .show-settings :global(input[type='time']),
  .show-settings :global(input[type='date']) {
    background: #09090c;
    border: 1px solid #33333a;
    border-radius: 4px;
    color: #e7e7eb;
    padding: 5px 7px;
    font: inherit;
    font-size: 12px;
  }
  .show-settings :global(input[type='checkbox']) { width: 16px; height: 16px; cursor: pointer; }
</style>
