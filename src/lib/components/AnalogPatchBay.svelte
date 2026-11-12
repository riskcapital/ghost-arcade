<script lang="ts">
  /**
   * Analog Synth's patch, condensed for the deck tray: each input by module,
   * with what feeds it and how much. The full view patches the same
   * connections with cables. An input's normal (its connection with nothing
   * plugged in) is marked in its menu.
   */
  import StudioKnob from './music/StudioKnob.svelte';
  import { CABLE_COLORS } from '../music/cableLook';
  import { INPUT_JACKS, SOURCES, paramValue, type InputJack } from '../videosynth/patch';
  import { formatParam, paramSpec } from '../videosynth/labels';

  let {
    effectSource,
    midiPrefix = 'map:plugin',
    onpatch,
  }: {
    effectSource: Record<string, unknown>;
    midiPrefix?: string;
    onpatch: (patch: Record<string, unknown>, gesture?: string) => void;
  } = $props();

  const sourceOf = (j: InputJack) => paramValue(effectSource, paramSpec(j.srcKey));
  const amountOf = (j: InputJack) => paramValue(effectSource, paramSpec(j.amtKey));
  const cableColor = (source: number) => CABLE_COLORS[(source - 1 + CABLE_COLORS.length) % CABLE_COLORS.length];

  const MODULES = ['Osc A', 'Osc B', 'Osc C', 'Picture', 'Feedback', 'Tube'];
  const byModule = MODULES.map((m) => ({ module: m, jacks: INPUT_JACKS.filter((j) => j.module === m) }));

  function set(j: InputJack, source: number) {
    if (source !== sourceOf(j)) onpatch({ [j.srcKey]: source });
  }
</script>

<div class="patch">
  {#each byModule as group (group.module)}
    <div class="group" role="group" aria-label={`${group.module} inputs`}>
      <span class="module">{group.module}</span>
      {#each group.jacks as j (j.id)}
        {@const from = sourceOf(j)}
        {@const a = paramSpec(j.amtKey)}
        <div class="row">
          <span class="plug" class:empty={!from} class:normal={!!from && from === j.normal} style:--cable={from ? cableColor(from) : 'transparent'} aria-hidden="true"></span>
          <label class="name" for={`vs-patch-${j.id}`}>{j.label}</label>
          <select
            id={`vs-patch-${j.id}`}
            value={String(from)}
            onchange={(e) => set(j, Number(e.currentTarget.value))}
            data-midi-path={`${midiPrefix}:${j.srcKey}`}
            data-midi-label={`${j.module} · ${j.label} from`}
            data-midi-min={0}
            data-midi-max={SOURCES.length - 1}
          >
            {#each SOURCES as label, i}
              <option value={String(i)}>{label}{i === j.normal && i ? ' (normal)' : ''}</option>
            {/each}
          </select>
          <StudioKnob
            label={`${j.label} amount`}
            hideLabel
            title={`${j.module} · ${j.label} amount`}
            value={amountOf(j)}
            min={a.min}
            max={a.max}
            defaultValue={a.default}
            size={24}
            format={formatParam(a)}
            midiPath={`${midiPrefix}:${j.amtKey}`}
            onchange={(v) => onpatch({ [j.amtKey]: v }, `analog-synth:${j.amtKey}`)}
          />
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .patch {
    display: grid;
    gap: 10px;
    padding: 4px 0 8px;
  }
  .group {
    display: grid;
    gap: 4px;
  }
  .module {
    font-size: var(--ga-text-micro, 9px);
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--studio-muted);
  }
  .row {
    display: grid;
    grid-template-columns: 10px 58px minmax(0, 1fr) auto;
    gap: 8px;
    align-items: center;
  }
  /* The cable's color, as in the full view; a ring when nothing is plugged in. */
  .plug {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--cable);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4);
  }
  .plug.empty {
    box-shadow: inset 0 0 0 1px var(--studio-edge);
  }
  .plug.normal {
    opacity: 0.45;
  }
  .name {
    font-size: var(--ga-text-meta, 11px);
    color: var(--studio-ink-1);
    white-space: nowrap;
  }
  select {
    height: var(--ga-control-h-sm, 24px);
    min-width: 0;
    background: var(--studio-slot);
    color: var(--studio-ink);
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
  }
  select:focus-visible {
    outline: 2px solid var(--ga-focus, var(--studio-accent));
    outline-offset: 2px;
  }
</style>
