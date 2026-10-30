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
  <div data-help-page="midi-audio" class="midi-selector">
    <select value={selectedId || ''} onchange={handleDeviceChange} title="MIDI input device">
      <option value="">No MIDI device</option>
      {#each devices as device}
        <option value={device.id}>{device.name}</option>
      {/each}
    </select>
    <button
      class="midi-edit-btn"
      class:active={editMode}
      onclick={() => midiStore.toggleEditMode()}
      title={editMode ? 'Exit MIDI edit mode (Esc)' : 'Enter MIDI edit mode'}
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
    box-sizing: border-box;
    height: var(--ga-control-h);
    max-width: 140px;
    padding: 0 22px 0 8px;
    background-color: var(--ga-slot, #060504);
    color: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    font-size: var(--ga-text-control);
    cursor: pointer;
  }
  .midi-edit-btn {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 4px;
    height: var(--ga-control-h);
    padding: 0 8px;
    background: var(--ga-raise, #26221c);
    color: var(--ga-ink-1, #ada9a2);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }
  .midi-edit-btn:hover {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }
  .midi-edit-btn.active {
    background: var(--ga-selection-bg, #1f3170);
    color: var(--ga-selection-ink, #e0e8ff);
    border-color: var(--ga-selection-line, #5278ff);
  }
  .midi-activity {
    color: var(--ga-green, #46d18a);
    font-size: var(--ga-text-micro);
    animation: midi-blink 0.15s ease-out;
    cursor: default;
  }
  @keyframes midi-blink {
    0% { opacity: 1; transform: scale(1.5); }
    100% { opacity: 0.6; transform: scale(1); }
  }
</style>
