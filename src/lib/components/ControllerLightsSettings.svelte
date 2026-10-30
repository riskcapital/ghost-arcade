<script lang="ts">
  import { midiStore } from '../midi/midiStore';
  import { midiManager } from '../midi/midiManager';
  import { controllerLightsStore } from '../midi/controllerLightsStore';
  import { controllerProfiles } from '../midi/controllerProfiles';
</script>
<section data-help-page="midi-audio" class="controller-lights">
  <h3>Controller lights</h3>
  <label class="row"><span>Enable controller lights</span><span class="toggle"><input type="checkbox" checked={$controllerLightsStore.enabled}
    onchange={(e) => midiManager.enableControllerLights(e.currentTarget.checked)} /><span class="toggle-slider"></span></span></label>
  <p>Dim pads are loaded, bright pads are playing, and yellow blinking pads are queued. Deck A is green; deck B is blue.</p>
  <label class="row">Output
    <select aria-label="Controller lights output" value={$controllerLightsStore.outputId ?? ''}
      onchange={(e) => controllerLightsStore.configure({ outputId: e.currentTarget.value || null })}>
      <option value="">Match selected MIDI input</option>
      {#each $midiStore.outputDevices.filter(d => d.state === 'connected') as output}
        <option value={output.id}>{output.name}</option>
      {/each}
    </select>
  </label>
  <label class="row">Controller
    <select aria-label="Controller lights profile" value={$controllerLightsStore.profile}
      onchange={(e) => controllerLightsStore.configure({ profile: e.currentTarget.value as any })}>
      <option value="auto">Detect from output name</option>
      {#each Object.values(controllerProfiles) as profile}<option value={profile.id}>{profile.label}</option>{/each}
    </select>
  </label>
  <label class="row">Deck
    <select aria-label="Controller lights deck" value={$controllerLightsStore.deck}
      onchange={(e) => controllerLightsStore.configure({ deck: e.currentTarget.value as 'A' | 'B' | 'selected' })}>
      <option value="selected">Follow selected deck</option><option value="A">Deck A</option><option value="B">Deck B</option>
    </select>
  </label>
  <div class="pages row">
    <label>Column page <input aria-label="Controller column page" type="number" min="1" max="128" step="1" value={$controllerLightsStore.columnPage + 1}
      onchange={(e) => controllerLightsStore.configure({ columnPage: Number(e.currentTarget.value) - 1 })} /></label>
    <label>Layer page <input aria-label="Controller layer page" type="number" min="1" max="128" step="1" value={$controllerLightsStore.rowPage + 1}
      onchange={(e) => controllerLightsStore.configure({ rowPage: Number(e.currentTarget.value) - 1 })} /></label>
  </div>
  <label class="row"><span>Pads launch the displayed grid</span><span class="toggle"><input type="checkbox" checked={$controllerLightsStore.gridInput}
    onchange={(e) => controllerLightsStore.configure({ gridInput: e.currentTarget.checked })} /><span class="toggle-slider"></span></span></label>
  <p>Existing learned controls take priority. Controller lights use a separate output from MIDI clock. Launchpad profiles enter Programmer mode; disabling lights returns them to Live mode. Enable lights for each app session.</p>
  <p class="status" role="status">{$controllerLightsStore.status}</p>
</section>
<style>
  /* The same rows as the rest of Settings: label left, control right. */
  .controller-lights { margin-top: 24px; display: grid; }
  h3 {
    margin: 0 0 4px;
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }
  p { margin: 0; padding: 6px 0; font-size: var(--ga-text-meta); color: var(--ga-ink-2, #89857e); line-height: 1.45; }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: var(--ga-control-h);
    padding: 8px 0;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
    color: var(--ga-ink-0, #f2ede4);
  }
  .pages { justify-content: flex-start; gap: 24px; }
  .pages label { display: flex; align-items: center; gap: 8px; }
  select, input[type=number] {
    box-sizing: border-box;
    height: var(--ga-control-h);
    background-color: var(--ga-slot, #060504);
    color: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-body);
  }
  select { min-width: 180px; max-width: 280px; padding: 0 26px 0 8px; }
  input[type=number] { width: 60px; padding: 0 8px; }
  .toggle { position: relative; display: inline-block; flex: 0 0 auto; width: 44px; height: var(--ga-control-h); }
  .toggle input { opacity: 0; width: 0; height: 0; }
  .toggle .toggle-slider {
    position: absolute;
    inset: 0;
    cursor: pointer;
    background-color: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-control-h);
    transition: 0.2s;
  }
  .toggle .toggle-slider::before {
    position: absolute;
    content: "";
    width: 18px;
    height: 18px;
    left: 3px;
    top: 3px;
    border-radius: 50%;
    background-color: var(--ga-ink-2, #89857e);
    transition: 0.2s;
  }
  .toggle input:checked + .toggle-slider { background-color: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .toggle input:checked + .toggle-slider::before { transform: translateX(18px); background-color: var(--ga-selection-ink, #e0e8ff); }
  .toggle input:focus-visible + .toggle-slider { outline: 2px solid var(--ga-focus, #8aa4ff); outline-offset: 1px; }
  .status:empty { display: none; }
</style>
