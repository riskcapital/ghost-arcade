<script lang="ts">
  /**
   * The MIDI inputs plugged in, and what each one is for: a controller (its
   * pads and knobs run the app through MIDI Learn), the band's keys (their
   * notes play into the visuals, and can play the studio), or nothing. Any
   * number can be in use at once. Kept on this computer, by input name.
   */
  import { midiStore } from '../midi/midiStore';
  import { midiInputSetups, midiInputsInUse, setMidiInputSetup, setupFor } from '../midi/midiInputs';
  import type { MidiDevice, MidiInputUse } from '../midi/midiTypes';
  import { BAND_KEYS_DEFAULT_ROLE } from '../music/bandKeys';
  import { INSTRUMENT_LABELS } from '../music/instruments';
  import { PLAYABLE_INSTRUMENTS } from '../music/noteEvents';
  import { VOICE_SOURCES } from '../music/visualVoices';

  const devices = $derived($midiStore.devices.filter((d) => d.state === 'connected'));
  const setups = $derived($midiInputSetups);
  const inUse = $derived($midiInputsInUse);
  const instruments = PLAYABLE_INSTRUMENTS.filter((id) => id !== 'drums');

  function useOf(device: MidiDevice): MidiInputUse {
    const setup = setupFor(setups, device.name);
    if (setup) return setup.use;
    return inUse.keys.includes(device.id) ? 'keys' : inUse.control.includes(device.id) && inUse.standIn !== device.id ? 'control' : 'off';
  }

  function setUse(device: MidiDevice, use: MidiInputUse) {
    setMidiInputSetup(device.name, { use });
  }
</script>

{#if devices.length === 0}
  <p class="none">No MIDI input is plugged in.</p>
{:else}
  <ul class="inputs">
    {#each devices as device (device.id)}
      {@const use = useOf(device)}
      {@const setup = setupFor(setups, device.name)}
      <li class:off={use === 'off'}>
        <div class="row">
          <label class="name" title={device.manufacturer && device.manufacturer !== 'Unknown' ? `${device.name} (${device.manufacturer})` : device.name}>
            <input type="checkbox" checked={use !== 'off'} onchange={(e) => setUse(device, (e.target as HTMLInputElement).checked ? (setup?.use === 'keys' ? 'keys' : 'control') : 'off')} />
            <span translate="no">{device.name}</span>
          </label>
          {#if inUse.standIn === device.id}
            <span class="note" title="No controller is plugged in, so this input is used as one until one is. Tick it to keep it.">Standing in</span>
          {/if}
          <select value={use === 'keys' ? 'keys' : 'control'} disabled={use === 'off'} onchange={(e) => setUse(device, (e.target as HTMLSelectElement).value as MidiInputUse)} aria-label="Use of {device.name}">
            <option value="control">Controller</option>
            <option value="keys">Band keys</option>
          </select>
        </div>
        {#if use === 'keys'}
          <div class="row keys">
            <label title="The sound its notes count as: visual voices following it move with them. Notes on channel 10 count as drums.">
              Counts as
              <select value={setup?.role ?? BAND_KEYS_DEFAULT_ROLE} onchange={(e) => setMidiInputSetup(device.name, { role: (e.target as HTMLSelectElement).value })} aria-label="Sound the notes of {device.name} count as">
                {#each VOICE_SOURCES as source (source.id)}<option value={source.id}>{source.label}</option>{/each}
              </select>
            </label>
            <label class="play" title="Its notes also play a studio instrument while the studio is open">
              <input type="checkbox" checked={setup?.play === true} onchange={(e) => setMidiInputSetup(device.name, { play: (e.target as HTMLInputElement).checked })} />
              Play the studio
            </label>
            <select value={setup?.instrument ?? ''} disabled={setup?.play !== true} onchange={(e) => setMidiInputSetup(device.name, { instrument: (e.target as HTMLSelectElement).value })} aria-label="Studio instrument {device.name} plays">
              <option value="">Instrument picked in the studio</option>
              {#each instruments as id (id)}<option value={id}>{INSTRUMENT_LABELS[id]}</option>{/each}
            </select>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .inputs {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 0;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .row.keys {
    flex-wrap: wrap;
    padding-left: 22px;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #ada9a2);
  }
  label {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .name {
    flex: 1 1 auto;
    font-size: var(--ga-text-control);
    color: var(--ga-ink-0, #f2ede4);
    cursor: pointer;
  }
  .name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li.off .name { color: var(--ga-ink-2, #89857e); }
  .note {
    flex: 0 0 auto;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }
  select {
    box-sizing: border-box;
    height: var(--ga-control-h-sm, 22px);
    max-width: 200px;
    padding: 0 22px 0 6px;
    font-size: var(--ga-text-control);
    cursor: pointer;
  }
  select:disabled { opacity: 0.5; cursor: default; }
  .none {
    margin: 6px 0 0;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }
</style>
