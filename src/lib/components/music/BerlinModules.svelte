<script lang="ts">
  /**
   * The Berlin set's own instruments: the drum mixer, the acid line and the
   * visual layers. Rendered in pieces by `part` for the set's layout.
   */
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { ACID_PARAMS, ACID_RANGE } from '../../music/studioSets';
  import { DRUM_LABELS, DRUM_NOTES, DRUM_VOICES, noteName } from '../../music/noteEvents';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';
  import StudioFader from './StudioFader.svelte';

  let { part }: { part: 'drums' | 'acid' | 'layers' } = $props();

  const s = $derived($musicStudio);
  const t = $derived($musicTransport);
  const layers = $derived($vjClipLauncher.layerStates);

  const SHORT: Record<string, string> = { hatClosed: 'Hat', hatOpen: 'O-hat' };

  /** Click height on an acid step sets its pitch; the top of the bar is two octaves up. */
  function setAcidNote(e: PointerEvent, index: number) {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const share = 1 - (e.clientY - r.top) / r.height;
    musicStudio.setAcidStep(index, { note: Math.max(0, Math.min(ACID_RANGE, Math.round(share * ACID_RANGE))) });
  }

  function acidRest(e: MouseEvent, index: number) {
    e.preventDefault();
    const step = s.acidSteps[index];
    musicStudio.setAcidStep(index, { note: step.note === null ? 0 : null });
  }

  const ACID_ROOT = 36;
</script>

{#if part === 'drums'}
  <StudioModule title="DRUMS" subtitle="Each voice has its own jack: patch it to a layer or a macro">
    {#snippet head()}
      <StudioJack id="audio:drums" label="Out" title="Drum sound" />
    {/snippet}
    <div class="mixer">
      {#each DRUM_VOICES as voice (voice)}
        {@const muted = s.drumMutes.includes(voice)}
        <div class="channel" class:lit={t.held.has(`drums:${DRUM_NOTES[voice]}`)}>
          <span class="ch-name">{SHORT[voice] ?? DRUM_LABELS[voice]}</span>
          <StudioKnob label="{DRUM_LABELS[voice]} tune" hideLabel value={s.params[`mix.${voice}.tune`]} defaultValue={0.5} size={26} onchange={(v) => musicStudio.setParam(`mix.${voice}.tune`, v)} format={(v) => `${Math.round((v - 0.5) * 12)} st`} />
          <StudioFader label="{DRUM_LABELS[voice]} level" value={s.params[`mix.${voice}.level`]} onchange={(v) => musicStudio.setParam(`mix.${voice}.level`, v)} />
          <button class="mute" class:on={muted} onclick={() => musicStudio.toggleDrumMute(voice)} aria-pressed={muted} aria-label="Mute {DRUM_LABELS[voice]}">M</button>
          <StudioJack id="cv:drum.{voice}" title="{DRUM_LABELS[voice]} hits, as a control signal" />
        </div>
      {/each}
    </div>
  </StudioModule>
{:else if part === 'acid'}
  <StudioModule title="ACID" subtitle="Bass line · click a step for its pitch, right-click to rest">
    {#snippet head()}
      <StudioJack id="cv:acid.cutoff" label="Cutoff" title="Acid filter, as a control signal" />
      <StudioJack id="audio:acid" label="Out" title="Acid sound" />
    {/snippet}
    <div class="knob-row">
      {#each ACID_PARAMS as p (p.key)}
        <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={38} onchange={(v) => musicStudio.setParam(p.key, v)} />
      {/each}
    </div>
    <div class="acid-steps">
      {#each s.acidSteps as step, i (i)}
        <div class="acid-step" class:bar={i % 4 === 0} class:playhead={t.step >= 0 && i === t.step % 16}>
          <button
            class="pitch"
            onpointerdown={(e) => setAcidNote(e, i)}
            oncontextmenu={(e) => acidRest(e, i)}
            aria-label="Step {i + 1}: {step.note === null ? 'rest' : noteName(ACID_ROOT + step.note)}"
          >
            {#if step.note !== null}
              <span class="dot" class:glide={step.glide} style="bottom: calc({(step.note / ACID_RANGE) * 100}% - 3px)"></span>
            {/if}
          </button>
          <span class="step-note">{step.note === null ? '·' : noteName(ACID_ROOT + step.note)}</span>
          <button class="flag" class:on={step.accent} onclick={() => musicStudio.setAcidStep(i, { accent: !step.accent })} aria-label="Accent step {i + 1}" title="Accent"></button>
          <button class="flag glide" class:on={step.glide} onclick={() => musicStudio.setAcidStep(i, { glide: !step.glide })} aria-label="Glide into step {i + 1}" title="Glide"></button>
        </div>
      {/each}
    </div>
    <p class="note">Plays with the beat. Top square: accent. Bottom: glide in from the step before.</p>
  </StudioModule>
{:else}
  <StudioModule title="VISUAL LAYERS" subtitle="Deck A · patch any hit into a layer" grow>
    <div class="layers">
      {#each layers as layer, i (i)}
        <div class="layer" class:muted={layer.mute}>
          <button class="toggle" class:on={!layer.mute} onclick={() => vjClipLauncher.toggleLayerMute(i, 'A')} aria-pressed={!layer.mute} aria-label="Layer {i + 1} on"></button>
          <div class="layer-name">
            <span class="ln">L{i + 1}</span>
            <span class="clip">{layer.activeClip?.name ?? 'Empty'}</span>
          </div>
          <input
            class="opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={layer.opacity}
            oninput={(e) => vjClipLauncher.setLayerOpacity(i, +(e.target as HTMLInputElement).value, 'A')}
            aria-label="Layer {i + 1} opacity"
          />
          <StudioJack id="dest:layer:{i}" title="Pulse layer {i + 1} with a control signal" />
        </div>
      {/each}
    </div>
  </StudioModule>
{/if}

<style>
  .mixer { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 4px; flex: 1; min-height: 0; }
  .channel { display: flex; flex-direction: column; align-items: center; gap: 8px; min-height: 0; }
  .ch-name { font-size: 10px; font-weight: 800; letter-spacing: 0.06em; color: var(--studio-ink); }
  .channel.lit .ch-name { color: var(--studio-accent); }
  .mute {
    width: 28px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 9px;
    font-weight: 800;
    cursor: pointer;
  }
  .mute.on { background: var(--studio-ink); color: var(--studio-slot); border-color: var(--studio-ink); }
  .knob-row { display: flex; justify-content: space-between; }
  .acid-steps { display: grid; grid-template-columns: repeat(16, minmax(0, 1fr)); gap: 3px; }
  .acid-step { display: flex; flex-direction: column; align-items: stretch; gap: 3px; }
  .pitch {
    position: relative;
    height: 64px;
    padding: 0;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-slot);
    border-radius: var(--studio-radius);
    cursor: ns-resize;
  }
  .acid-step.bar .pitch { border-color: var(--studio-edge); }
  .acid-step.playhead .pitch { box-shadow: inset 0 0 0 1px var(--studio-accent); }
  .dot { position: absolute; left: 2px; right: 2px; height: 6px; background: var(--studio-ink); pointer-events: none; }
  .dot.glide { background: var(--studio-muted); }
  .step-note { font-family: var(--ga-font-mono, ui-monospace); font-size: 8px; text-align: center; color: var(--studio-muted); }
  .flag {
    height: 8px;
    padding: 0;
    border: 1px solid var(--studio-edge);
    background: transparent;
    cursor: pointer;
  }
  .flag.on { background: var(--studio-ink); border-color: var(--studio-ink); }
  .flag.glide.on { background: var(--studio-muted); border-color: var(--studio-muted); }
  .note { margin: 0; color: var(--studio-muted); font-size: 11px; }
  .layers { display: flex; flex-direction: column; }
  .layer {
    min-height: 46px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--studio-edge-soft);
  }
  .toggle {
    width: 20px;
    height: 20px;
    padding: 0;
    border: 1px solid var(--studio-edge);
    background: transparent;
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .toggle.on { background: var(--studio-ink); border-color: var(--studio-ink); }
  .layer-name { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .ln { font-size: 10px; font-weight: 800; letter-spacing: 0.1em; color: var(--studio-muted); }
  .clip { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layer.muted .clip { color: var(--studio-muted); }
  .opacity { flex: 0 0 110px; width: 110px; }
</style>
