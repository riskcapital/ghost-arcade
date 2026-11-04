<script lang="ts">
  /**
   * The band's inputs at a glance: listening on or off, and for each input
   * its name, what the visuals see it as, whether it is coming in and how
   * much of it goes to the band effects. Then how the studio plays with the
   * band: dipping under its kick and following its bass.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { addBandInput, bandInputStatus, startLiveInput, stopLiveInput } from '../../music/musicRuntime';
  import { INPUT_CHANNELS, MAX_LIVE_INPUTS, liveInputLabel } from '../../music/mixer';
  import { channelChoices, channelLabel } from '../../music/bandInputs';
  import StudioJack from './StudioJack.svelte';
  import { PART_SOURCES, type VoiceSourceId } from '../../music/visualVoices';
  import { DUCK_RELEASE_MAX, DUCK_RELEASE_MIN } from '../../music/soundSlots';
  import StudioKnob from './StudioKnob.svelte';
  import InputSourceSelect from './InputSourceSelect.svelte';

  const s = $derived($musicStudio);
  const status = $derived($bandInputStatus);
  const fx = $derived(s.bandFx);
  const hasKick = $derived(s.liveInputs.some((input) => input.role === 'kick'));
  const hasBass = $derived(s.liveInputs.some((input) => input.role === 'bass'));

  const percent = (v: number) => `${Math.round(v * 100)}%`;
  const seconds = (v: number) => (v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`);

  const withBandHint = $derived(
    fx.duckDepth > 0 && !hasKick ? 'Set an input to Kick for the studio to dip under it.'
    : fx.followBass && !hasBass ? 'Set an input to Bass for the drone to follow it.'
    : fx.followBass ? 'Hold a chord on the drone: it moves to the bass note.'
    : 'Duck hears inputs set to Kick; Follow bass hears inputs set to Bass.',
  );

  function lightTitle(i: number): string {
    const st = status[i];
    if (st?.error) return st.error;
    if (!st?.on) return 'Not listening';
    return st.level > 0 ? 'Hearing it' : 'Listening, nothing heard yet';
  }
</script>

<section class="inputs">
  <div class="head">
    <span class="ga-eyebrow">Band inputs</span>
    <span class="spacer"></span>
    {#if s.liveInputs.length < MAX_LIVE_INPUTS}
      <button class="studio-btn dashed add" onclick={addBandInput} title="Add a band input: another instrument, or another channel of the same interface">Add</button>
    {/if}
    <button class="power" class:on={s.inputOn} aria-pressed={s.inputOn} onclick={() => (s.inputOn ? stopLiveInput() : void startLiveInput())} title={s.inputOn ? 'Stop listening to the band' : 'Listen to every band input'} data-midi-path="studio:band.inputs" data-midi-label="Listen to the band inputs" data-midi-mode="toggle">
      <span class="led" class:on={s.inputOn}></span>{s.inputOn ? 'Listening' : 'Listen'}
    </button>
  </div>
  <ul class="rows">
    {#each s.liveInputs as input, i (i)}
      {@const st = status[i]}
      {@const label = liveInputLabel(input, i)}
      <li class="input">
        <div class="line">
          <span class="led" class:ready={!!st?.on} class:on={!!st?.on && st.level > 0} class:error={!!st?.error} title={lightTitle(i)}></span>
          <input class="name" type="text" value={input.name} placeholder="Input {i + 1}" maxlength="24" spellcheck="false" aria-label="Name of input {i + 1}" title="What the band calls this input" onchange={(e) => musicStudio.setLiveInput(i, { name: e.currentTarget.value })} />
          <select class="role" value={input.role} aria-label="What the visuals see {label} as" title="What the visuals see {label} as" onchange={(e) => musicStudio.setLiveInput(i, { role: e.currentTarget.value as VoiceSourceId })}>
            {#each PART_SOURCES as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
          </select>
          {#if s.liveInputs.length > 1}
            <button class="remove" onclick={() => musicStudio.removeLiveInput(i)} title="Remove {label}; the inputs after it move up" aria-label="Remove {label}">×</button>
          {/if}
        </div>
        <div class="line">
          <InputSourceSelect index={i} compact class="src" />
          <select class="chan" value={input.channel} aria-label="Channel {label} hears" title="Which channel of the device {label} hears. A stereo interface sends its two inputs as 1 and 2; Mix hears them together." onchange={(e) => musicStudio.setLiveInput(i, { channel: Number(e.currentTarget.value) })}>
            {#each channelChoices(st?.channels ?? null, input.channel) as c (c)}<option value={c}>{c < 0 ? 'Mix' : `Ch ${channelLabel(c)}`}</option>{/each}
          </select>
          <span class="level" aria-hidden="true"><span class="fill" style="transform: scaleX({st?.on ? st.level : 0})"></span></span>
          <StudioJack id="cv:chan.{INPUT_CHANNELS[i]}.level" title="{label} out: its level, as a control signal" />
          <StudioKnob label="FX" value={input.fxSend} defaultValue={1} size={20} format={percent} title="How much of {label} goes into the echo, reverb and freeze" midiPath="studio:input.{i + 1}.fx-send" onchange={(v) => musicStudio.setLiveInput(i, { fxSend: v })} />
        </div>
        {#if st?.error}<span class="error" role="alert">{st.error}</span>{/if}
      </li>
    {/each}
  </ul>
  {#if s.inputError && !status.some((x) => x.error)}
    <span class="error" role="alert">{s.inputError}</span>
  {:else}
    <span class="hint">Pick what each input hears: this computer's sound, a mic, a phone or an interface. Level, EQ and pan are in the Mixer.</span>
  {/if}
</section>

<section class="with-band">
  <span class="ga-eyebrow">With the band</span>
  <div class="knobs">
    <StudioKnob label="Duck" value={fx.duckDepth} defaultValue={0} size={28} format={percent} title="How far the drone, bowls, FX pads and synth dip on each kick from the band" midiPath="studio:band.duck" onchange={(v) => musicStudio.setBandFx({ duckDepth: v })} />
    <StudioKnob label="Release" value={fx.duckRelease} min={DUCK_RELEASE_MIN} max={DUCK_RELEASE_MAX} defaultValue={0.25} size={28} format={seconds} title="How quickly they come back up after the kick" midiPath="studio:band.duck-release" onchange={(v) => musicStudio.setBandFx({ duckRelease: v })} />
  </div>
  <button class="studio-btn follow" class:on={fx.followBass} aria-pressed={fx.followBass} onclick={() => musicStudio.setBandFx({ followBass: !fx.followBass })} title="The drone's chords move to the note the bass player is on" data-midi-path="studio:band.follow-bass" data-midi-label="Drone follows the band's bass" data-midi-mode="toggle">Follow bass</button>
  <span class="hint">{withBandHint}</span>
</section>

<style>
  section { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .inputs { width: 330px; }
  .with-band { max-width: 150px; }
  .head { display: flex; align-items: center; gap: 6px; }
  .spacer { flex: 1; }
  .add { height: 26px; }
  .power { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--studio-edge); background: var(--studio-cell); color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; font-size: var(--ga-text-control, 12px); cursor: pointer; }
  .power.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .input { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; background: var(--studio-cell); border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius); }
  .line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .name {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 4px;
    border: 1px dashed transparent;
    background: transparent;
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
  }
  .name::placeholder { color: var(--studio-ink); opacity: 1; }
  .name:hover { border-color: var(--studio-edge); }
  .name:focus { outline: none; border-style: solid; border-color: var(--studio-accent); }
  .role { flex: 0 0 104px; min-width: 0; }
  .line :global(.src) { flex: 1; min-width: 0; }
  .chan { flex: 0 0 58px; min-width: 0; }
  .remove { flex: 0 0 auto; width: 22px; height: 22px; padding: 0; border: 1px solid transparent; background: transparent; color: var(--studio-muted); border-radius: var(--studio-radius); font: inherit; font-size: 15px; line-height: 1; cursor: pointer; }
  .remove:hover { border-color: var(--studio-edge); color: var(--studio-ink); }
  .level { flex: 0 0 34px; height: 5px; background: var(--studio-slot); border: 1px solid var(--studio-edge-soft); border-radius: 2px; overflow: hidden; }
  /* Scaled, not resized: a moving meter only recomposites. */
  .fill { display: block; height: 100%; background: var(--studio-accent); transform-origin: left center; transition: transform 80ms linear; will-change: transform; }
  .led { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); }
  .led.ready { background: var(--studio-slot); box-shadow: inset 0 0 0 1px var(--studio-accent); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 6px var(--studio-accent); }
  .led.error { background: var(--ga-danger, #ff6b6b); box-shadow: none; }
  .knobs { display: flex; align-items: flex-end; gap: 8px; }
  .follow { align-self: flex-start; }
  .hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); line-height: 1.35; }
  .error { font-size: var(--ga-text-meta, 11px); color: var(--ga-danger, #ff6b6b); line-height: 1.35; }
</style>
