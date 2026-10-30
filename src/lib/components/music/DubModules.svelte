<script lang="ts">
  /**
   * The dub set's own instruments: the dub bass (played on the keys), the
   * siren and the shots. Patch them into the tape echo and throw them.
   */
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { DUBBASS_PARAMS, SHOT_PARAMS, SIREN_PARAMS } from '../../music/studioSets';
  import { SHOT_NAMES } from '../../music/dubSounds';
  import { setSiren, triggerShot } from '../../music/musicRuntime';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  let { part }: { part: 'bass' | 'siren' | 'shots' } = $props();

  const s = $derived($musicStudio);
  const t = $derived($musicTransport);
  const bassSounding = $derived([...t.held].some((k) => k.startsWith('dubbass:')));
  const sirenSounding = $derived([...t.held].some((k) => k.startsWith('siren:')));

  let latched = $state(false);
  let holding = false;

  function holdDown(e: PointerEvent) {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    holding = true;
    if (!latched) setSiren(true);
  }

  function holdUp() {
    if (!holding) return;
    holding = false;
    if (!latched) setSiren(false);
  }

  function toggleLatch() {
    latched = !latched;
    setSiren(latched);
  }

  // A latched siren stops when the panel goes away.
  $effect(() => () => {
    if (latched) setSiren(false);
  });

  function shotDown(e: PointerEvent, index: number) {
    e.preventDefault();
    triggerShot(index, Math.min(1, 0.6 + s.velocity * 0.4));
  }
</script>

{#if part === 'bass'}
  <StudioModule title="Dub bass" subtitle="Play it on the keys" led={bassSounding}>
    {#snippet head()}
      <StudioJack id="cv:dubbass.level" label="Level" title="Dub bass level, as a control signal" />
      <StudioJack id="audio:dubbass" label="Out" title="Dub bass sound" />
    {/snippet}
    <div class="knob-row">
      {#each DUBBASS_PARAMS as p (p.key)}
        <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={34} onchange={(v) => musicStudio.setParam(p.key, v)} />
      {/each}
    </div>
  </StudioModule>
{:else if part === 'siren'}
  <StudioModule title="Siren" subtitle="Hold to wail" led={sirenSounding}>
    {#snippet head()}
      <StudioJack id="cv:siren.level" label="Level" title="Siren level, as a control signal" />
      <StudioJack id="audio:siren" label="Out" title="Siren sound" />
    {/snippet}
    <div class="siren">
      <div class="siren-keys">
        <button
          class="hold"
          class:on={sirenSounding}
          onpointerdown={holdDown}
          onpointerup={holdUp}
          onpointercancel={holdUp}
          aria-label="Hold the siren"
        >Hold</button>
        <button class="latch" class:on={latched} aria-pressed={latched} onclick={toggleLatch}>Latch</button>
      </div>
      <div class="knob-row grow">
        {#each SIREN_PARAMS as p (p.key)}
          <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={34} onchange={(v) => musicStudio.setParam(p.key, v)} />
        {/each}
      </div>
    </div>
  </StudioModule>
{:else}
  <StudioModule title="Shots" subtitle="Fire them into the echo" grow>
    {#snippet head()}
      <StudioJack id="cv:shots.level" label="Level" title="Shots, as a control signal" />
      <StudioJack id="audio:shots" label="Out" title="Shot sounds" />
    {/snippet}
    <div class="shots">
      <div class="pads">
        {#each SHOT_NAMES as name, i (name)}
          <button class="pad" class:lit={t.held.has(`shots:${60 + i}`)} onpointerdown={(e) => shotDown(e, i)} aria-label="Fire {name}">{name}</button>
        {/each}
      </div>
      <div class="shot-knobs">
        {#each SHOT_PARAMS as p (p.key)}
          <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={30} onchange={(v) => musicStudio.setParam(p.key, v)} />
        {/each}
      </div>
    </div>
  </StudioModule>
{/if}

<style>
  .knob-row { display: flex; justify-content: space-between; }
  .knob-row.grow { flex: 1; justify-content: space-around; }
  .siren { display: flex; align-items: center; gap: 12px; }
  .siren-keys { display: flex; flex-direction: column; gap: 6px; }
  .hold, .latch {
    width: 64px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    touch-action: none;
  }
  .hold { height: 40px; }
  .latch { height: var(--ga-control-h-sm, 22px); color: var(--studio-muted); }
  .hold.on { border-color: var(--studio-accent); background: var(--studio-accent); color: var(--studio-on-accent); box-shadow: 0 0 14px var(--studio-accent-soft); }
  .latch.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .shots { flex: 1; min-height: 0; display: flex; gap: 10px; }
  .pads { flex: 1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: minmax(34px, 1fr); gap: 6px; }
  .pad {
    min-width: 0;
    padding: 0 4px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
    touch-action: none;
    transition: background 0.25s ease-out, box-shadow 0.25s ease-out;
  }
  .pad:hover { border-color: var(--studio-muted); }
  .pad.lit { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); box-shadow: 0 0 16px var(--studio-accent-soft); transition: none; }
  .shot-knobs { display: flex; flex-direction: column; justify-content: space-around; }
</style>
