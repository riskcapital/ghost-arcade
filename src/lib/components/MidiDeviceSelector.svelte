<script lang="ts">
  import { midiStore } from '../midi/midiStore';
  import { midiManager } from '../midi/midiManager';
  // Tier-related imports removed — MIDI editing always available.

  $: devices = $midiStore.devices.filter(d => d.state === 'connected');
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
    <select value={selectedId || ''} onchange={handleDeviceChange} title="MIDI Input Device">
      <option value="">No MIDI Device</option>
      {#each devices as device}
        <option value={device.id}>{device.name}</option>
      {/each}
    </select>
    <button
      class="midi-edit-btn"
      class:active={editMode}
      onclick={() => midiStore.toggleEditMode()}
      title={editMode ? 'Exit MIDI Edit Mode (ESC)' : 'Enter MIDI Edit Mode'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="2"/>
        <path d="M2 12 L6 12"/>
        <path d="M18 12 L22 12"/>
        <path d="M12 2 L12 6"/>
        <path d="M12 18 L12 22"/>
      </svg>
      MIDI
    </button>
    {#if lastMsg && selectedId}
      <span class="midi-activity" title="Ch{lastMsg.channel + 1} {lastMsg.type.toUpperCase()} #{lastMsg.number} Val:{lastMsg.value}">
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
    font-size: 13px;
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
    font-size: 12px;
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
    font-size: 10px;
    animation: midi-blink 0.15s ease-out;
    cursor: default;
  }
  @keyframes midi-blink {
    0% { opacity: 1; transform: scale(1.5); }
    100% { opacity: 0.6; transform: scale(1); }
  }
</style>
