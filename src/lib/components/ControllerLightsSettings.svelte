<script lang="ts">
  import { midiStore } from '../midi/midiStore';
  import { midiManager } from '../midi/midiManager';
  import { controllerLightsStore } from '../midi/controllerLightsStore';
  import { controllerProfiles } from '../midi/controllerProfiles';
</script>
<section data-help-page="midi-audio" class="controller-lights">
  <h3>Controller lights</h3>
  <label><input type="checkbox" checked={$controllerLightsStore.enabled}
    onchange={(e) => midiManager.enableControllerLights(e.currentTarget.checked)} /> Enable controller lights</label>
  <p>Dim pads are loaded, bright pads are playing, and yellow blinking pads are queued. Deck A is green; deck B is blue.</p>
  <label>Output
    <select aria-label="Controller lights output" value={$controllerLightsStore.outputId ?? ''}
      onchange={(e) => controllerLightsStore.configure({ outputId: e.currentTarget.value || null })}>
      <option value="">Match selected MIDI input</option>
      {#each $midiStore.outputDevices.filter(d => d.state === 'connected') as output}
        <option value={output.id}>{output.name}</option>
      {/each}
    </select>
  </label>
  <label>Controller
    <select aria-label="Controller lights profile" value={$controllerLightsStore.profile}
      onchange={(e) => controllerLightsStore.configure({ profile: e.currentTarget.value as any })}>
      <option value="auto">Detect from output name</option>
      {#each Object.values(controllerProfiles) as profile}<option value={profile.id}>{profile.label}</option>{/each}
    </select>
  </label>
  <label>Deck
    <select aria-label="Controller lights deck" value={$controllerLightsStore.deck}
      onchange={(e) => controllerLightsStore.configure({ deck: e.currentTarget.value as 'A' | 'B' | 'selected' })}>
      <option value="selected">Follow selected deck</option><option value="A">Deck A</option><option value="B">Deck B</option>
    </select>
  </label>
  <div class="pages">
    <label>Column page <input aria-label="Controller column page" type="number" min="1" max="128" step="1" value={$controllerLightsStore.columnPage + 1}
      onchange={(e) => controllerLightsStore.configure({ columnPage: Number(e.currentTarget.value) - 1 })} /></label>
    <label>Layer page <input aria-label="Controller layer page" type="number" min="1" max="128" step="1" value={$controllerLightsStore.rowPage + 1}
      onchange={(e) => controllerLightsStore.configure({ rowPage: Number(e.currentTarget.value) - 1 })} /></label>
  </div>
  <label><input type="checkbox" checked={$controllerLightsStore.gridInput}
    onchange={(e) => controllerLightsStore.configure({ gridInput: e.currentTarget.checked })} /> Pads launch the displayed grid</label>
  <p>Existing learned controls take priority. Controller lights use a separate output from MIDI clock. Launchpad profiles enter Programmer mode; disabling lights returns them to Live mode. Enable lights for each app session.</p>
  <p role="status">{$controllerLightsStore.status}</p>
</section>
<style>
  .controller-lights { margin-top: 18px; display: grid; gap: 10px; }
  h3, p { margin: 0; }
  p { font-size: 12px; color: #aaa; line-height: 1.45; }
  label { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  select, input[type=number] { background: #222; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 5px; }
  input[type=number] { width: 55px; }
  .pages { display: flex; gap: 16px; }
</style>
