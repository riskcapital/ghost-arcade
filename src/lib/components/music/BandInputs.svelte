<script lang="ts">
  /**
   * The band's inputs at a glance: listening on or off, and for each input
   * its name, what the visuals see it as, whether it is coming in and how
   * much of it goes to the band effects. Then how the studio plays with the
   * band: dipping under its kick and following its bass.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { bandInputStatus, startLiveInput, stopLiveInput } from '../../music/musicRuntime';
  import { liveInputLabel } from '../../music/mixer';
  import { VOICE_SOURCES, type VoiceSourceId } from '../../music/visualVoices';
  import { DUCK_RELEASE_MAX, DUCK_RELEASE_MIN } from '../../music/soundSlots';
  import StudioKnob from './StudioKnob.svelte';

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
    <button class="power" class:on={s.inputOn} aria-pressed={s.inputOn} onclick={() => (s.inputOn ? stopLiveInput() : void startLiveInput())} title={s.inputOn ? 'Stop listening to the band' : 'Listen to every band input'} data-midi-path="studio:band.inputs" data-midi-label="Listen to the band inputs" data-midi-mode="toggle">
      <span class="led" class:on={s.inputOn}></span>{s.inputOn ? 'Listening' : 'Off'}
    </button>
  </div>
  <ul class="rows">
    {#each s.liveInputs as input, i (i)}
      {@const st = status[i]}
      {@const label = liveInputLabel(input, i)}
      <li class="input-row">
        <span class="led" class:ready={!!st?.on} class:on={!!st?.on && st.level > 0} class:error={!!st?.error} title={lightTitle(i)}></span>
        <span class="input-name" title={label}>{label}</span>
        <select class="role" value={input.role} aria-label="What the visuals see {label} as" title="What the visuals see {label} as" onchange={(e) => musicStudio.setLiveInput(i, { role: e.currentTarget.value as VoiceSourceId })}>
          {#each VOICE_SOURCES as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
        </select>
        <span class="level" aria-hidden="true"><span class="fill" style="width: {(st?.on ? st.level : 0) * 100}%"></span></span>
        <StudioKnob label="FX" value={input.fxSend} defaultValue={1} size={22} format={percent} title="How much of {label} goes into the echo, reverb and freeze" midiPath="studio:input.{i + 1}.fx-send" onchange={(v) => musicStudio.setLiveInput(i, { fxSend: v })} />
      </li>
    {/each}
  </ul>
  {#if s.inputError}
    <span class="error" role="alert">{s.inputError}</span>
  {:else}
    <span class="hint">Name, add and route inputs in Mixer. A stereo interface sends its two inputs as channels 1 and 2. Feed it the desk's aux send; only the effects come back here.</span>
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
  .inputs { width: 270px; }
  .with-band { max-width: 150px; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .power { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--studio-edge); background: var(--studio-cell); color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; font-size: var(--ga-text-control, 12px); cursor: pointer; }
  .power.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .input-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .input-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-control, 12px); color: var(--studio-ink); }
  .role { flex: 0 0 96px; min-width: 0; }
  .level { flex: 0 0 34px; height: 5px; background: var(--studio-slot); border: 1px solid var(--studio-edge-soft); border-radius: 2px; overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--studio-accent); transition: width 80ms linear; }
  .led { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); }
  .led.ready { background: var(--studio-slot); box-shadow: inset 0 0 0 1px var(--studio-accent); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 6px var(--studio-accent); }
  .led.error { background: var(--ga-danger, #ff6b6b); box-shadow: none; }
  .knobs { display: flex; align-items: flex-end; gap: 8px; }
  .follow { align-self: flex-start; }
  .hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); line-height: 1.35; }
  .error { font-size: var(--ga-text-meta, 11px); color: var(--ga-danger, #ff6b6b); line-height: 1.35; }
</style>
