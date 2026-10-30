<script lang="ts">
  /**
   * Playing with a band: the band's sound (the live input) thrown into an
   * echo and washed into a reverb that come back on their own, a moment of
   * it frozen into a texture, and its key heard so the studio plays in it.
   */
  import { onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { bandState, listenForKey, prepareBand, setBandThrow, setBandWash, startLiveInput, stopLiveInput, toggleFreeze, useHeardKey } from '../../music/musicRuntime';
  import { ECHO_TIMES, type EchoTimeId } from '../../music/soundSlots';
  import { ROOT_NAMES } from '../../music/studioSets';
  import StudioKnob from './StudioKnob.svelte';

  const s = $derived($musicStudio);
  const b = $derived($bandState);
  const fx = $derived(s.bandFx);
  let throwing = $state(false);
  let washing = $state(false);

  onMount(() => {
    // Start keeping the last moment now, so the first freeze has one.
    prepareBand();
    return () => {
      if (throwing) setBandThrow(false);
      if (washing) setBandWash(false);
    };
  });

  function hold(e: PointerEvent, set: (on: boolean) => void, mark: (on: boolean) => void) {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    mark(true);
    set(true);
  }

  function letGo(on: boolean, set: (on: boolean) => void, mark: (on: boolean) => void) {
    if (!on) return;
    mark(false);
    set(false);
  }

  const percent = (v: number) => `${Math.round(v * 100)}%`;
  const heardName = $derived(b.heard ? `${ROOT_NAMES[b.heard.root]} ${b.heard.mode}` : '');
  const sure = $derived(!b.heard ? '' : b.heard.confidence > 0.5 ? 'sure' : b.heard.confidence > 0.2 ? 'likely' : 'a guess so far');
</script>

<div class="band" role="group" aria-label="Live band">
  <section class="input">
    <span class="ga-eyebrow">Band input</span>
    <button class="power" class:on={s.inputOn} aria-pressed={s.inputOn} onclick={() => (s.inputOn ? stopLiveInput() : void startLiveInput())} title={s.inputOn ? 'Stop listening to the band' : 'Listen to the band (choose the input in Mixer)'}>
      <span class="led" class:on={s.inputOn}></span>{s.inputOn ? 'Listening' : 'Off'}
    </button>
    {#if s.inputError}<span class="error" role="alert">{s.inputError}</span>{:else}<span class="hint">Feed it the desk's aux send. Only the effects come back here.</span>{/if}
  </section>

  <section>
    <span class="ga-eyebrow">Echo</span>
    <div class="row">
      <button
        class="hold"
        class:on={throwing}
        onpointerdown={(e) => hold(e, setBandThrow, (on) => (throwing = on))}
        onpointerup={() => letGo(throwing, setBandThrow, (on) => (throwing = on))}
        onpointercancel={() => letGo(throwing, setBandThrow, (on) => (throwing = on))}
        title="Hold to throw the band into the echo; the repeats run on after"
      >Throw</button>
      <StudioKnob label="Send" value={fx.echoSend} defaultValue={0} size={28} format={percent} title="How much of the band always goes into the echo" onchange={(v) => musicStudio.setBandFx({ echoSend: v })} />
      <StudioKnob label="Repeats" value={fx.feedback / 0.92} defaultValue={0.55 / 0.92} size={28} format={(v) => percent(v)} title="How long the echo keeps repeating" onchange={(v) => musicStudio.setBandFx({ feedback: v * 0.92 })} />
      <StudioKnob label="Tone" value={fx.echoTone} defaultValue={0.45} size={28} format={percent} title="Dark to bright repeats" onchange={(v) => musicStudio.setBandFx({ echoTone: v })} />
    </div>
    <select value={fx.echoTime} onchange={(e) => musicStudio.setBandFx({ echoTime: (e.target as HTMLSelectElement).value as EchoTimeId })} aria-label="Echo time" title="How far behind the band the echo is, in time with the tempo">
      {#each ECHO_TIMES as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
    </select>
  </section>

  <section>
    <span class="ga-eyebrow">Reverb</span>
    <div class="row">
      <button
        class="hold"
        class:on={washing}
        onpointerdown={(e) => hold(e, setBandWash, (on) => (washing = on))}
        onpointerup={() => letGo(washing, setBandWash, (on) => (washing = on))}
        onpointercancel={() => letGo(washing, setBandWash, (on) => (washing = on))}
        title="Hold to wash the band into a long reverb"
      >Wash</button>
      <StudioKnob label="Send" value={fx.verbSend} defaultValue={0} size={28} format={percent} title="How much of the band always goes into the reverb" onchange={(v) => musicStudio.setBandFx({ verbSend: v })} />
    </div>
  </section>

  <section>
    <span class="ga-eyebrow">Freeze</span>
    <div class="row">
      <button class="hold" class:on={b.frozen} aria-pressed={b.frozen} onclick={() => void toggleFreeze()} title={b.frozen ? 'Let the frozen moment go' : 'Hold the last moment of sound as a texture'}>{b.frozen ? 'Frozen' : 'Freeze'}</button>
      <StudioKnob label="Level" value={fx.freezeLevel} defaultValue={0.7} size={28} format={percent} onchange={(v) => musicStudio.setBandFx({ freezeLevel: v })} />
    </div>
    <div class="ga-segmented small" role="group" aria-label="Freeze pitch">
      {#each [[-12, 'Oct −'], [0, 'As played'], [12, 'Oct +']] as [pitch, label] (pitch)}
        <button class:active={fx.freezePitch === pitch} aria-pressed={fx.freezePitch === pitch} onclick={() => musicStudio.setBandFx({ freezePitch: pitch as -12 | 0 | 12 })}>{label}</button>
      {/each}
    </div>
    {#if b.freezeError}<span class="error" role="alert">{b.freezeError}</span>{/if}
  </section>

  <section>
    <span class="ga-eyebrow">Band's key</span>
    <div class="row">
      <button class="hold" class:on={b.listening} aria-pressed={b.listening} onclick={() => listenForKey(!b.listening)} title={b.listening ? 'Stop listening' : "Listen to the band's notes for its key"}>{b.listening ? 'Listening' : 'Listen'}</button>
      <button class="studio-btn" disabled={!b.heard} onclick={useHeardKey} title="Play the studio in the key heard">Use key</button>
    </div>
    <span class="heard">{#if b.heard}{heardName} <span class="hint">({sure})</span>{:else if b.listening}Play a few bars…{:else}Not listening{/if}</span>
  </section>

  <section class="return">
    <span class="ga-eyebrow">Return</span>
    <StudioKnob label="Level" value={fx.returnLevel} defaultValue={0.8} size={32} format={percent} title="How loud the band's effects come back" onchange={(v) => musicStudio.setBandFx({ returnLevel: v })} />
  </section>
</div>

<style>
  .band { flex: 1; min-height: 0; overflow: auto; display: flex; gap: 14px; align-items: flex-start; padding: 2px 2px 4px; }
  section { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  section.input { max-width: 190px; }
  .row { display: flex; align-items: flex-end; gap: 8px; }
  .hold {
    min-width: 64px;
    height: 44px;
    padding: 0 10px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    touch-action: none;
    user-select: none;
  }
  .hold.on { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); }
  .power { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--studio-edge); background: var(--studio-cell); color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; font-size: var(--ga-text-control, 12px); cursor: pointer; align-self: flex-start; }
  .led { width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 6px var(--studio-accent); }
  .hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); line-height: 1.35; }
  .error { font-size: var(--ga-text-meta, 11px); color: var(--ga-danger, #ff6b6b); max-width: 220px; }
  .heard { font-size: var(--ga-text-control, 12px); color: var(--studio-ink); }
  select { max-width: 120px; }
</style>
