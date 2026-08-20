<script lang="ts">
  import { midiStore } from '../midi/midiStore';
  import { midiManager } from '../midi/midiManager';
  import { t } from '../i18n';
  // Tier-related imports removed — MIDI editing always available.

  $: devices = $midiStore.devices.filter((d) => d.state === 'connected');
  $: selectedId = $midiStore.selectedDeviceId;
  $: available = $midiStore.available;
  $: editMode = $midiStore.editMode;
  $: lastMsg = $midiStore.lastMessage;

  function handleDeviceChange(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    if (id) midiManager.selectDevice(id);
  }
</script>

{#if available}
  <div class="midi-selector">
    <select value={selectedId || ''} onchange={handleDeviceChange} title={$t('inputControls.midi.inputDeviceTitle')}>
      <option value="">{$t('inputControls.midi.noDevice')}</option>
      {#each devices as device}
        <option value={device.id}>{device.name}</option>
      {/each}
    </select>
    <button
      class="midi-edit-btn"
      class:active={editMode}
      onclick={() => midiStore.toggleEditMode()}
      title={editMode ? $t('inputControls.midi.exitEditModeTitle') : $t('inputControls.midi.enterEditModeTitle')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="2"/>
        <path d="M2 12 L6 12"/>
        <path d="M18 12 L22 12"/>
        <path d="M12 2 L12 6"/>
        <path d="M12 18 L12 22"/>
      </svg>
      {$t('inputControls.midi.label')}
    </button>
    {#if lastMsg && selectedId}
      <span class="midi-activity" title={$t('inputControls.midi.activityTitle', {
          values: {
            channel: lastMsg.channel + 1,
            type: lastMsg.type.toUpperCase(),
            number: lastMsg.number,
            value: lastMsg.value,
          },
        })}
      >
        &#9679;
      </span>
    {/if}
  </div>
{/if}

<style>
  .midi-selector {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .midi-selector select {
    background: var(--bg-secondary, #1a1a2e);
    color: var(--text-primary, #e0e0e0);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    padding: 2px 4px;
    font-size: 12px;
    max-width: 140px;
    cursor: pointer;
  }
  .midi-edit-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    background: var(--bg-secondary, #1a1a2e);
    color: var(--text-secondary, #999);
    border: 1px solid var(--border-color, #333);
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .midi-edit-btn:hover {
    color: var(--text-primary, #e0e0e0);
    border-color: #bb86fc;
  }
  .midi-edit-btn.active {
    background: #bb86fc;
    color: #000;
    border-color: #bb86fc;
  }
  .midi-activity {
    color: #00ff88;
    font-size: 9px;
    animation: midi-blink 0.15s ease-out;
    cursor: default;
  }
  @keyframes midi-blink {
    0% { opacity: 1; transform: scale(1.5); }
    100% { opacity: 0.6; transform: scale(1); }
  }
</style>
