<script lang="ts">
  /**
   * While a cable is in the hand, every input it can plug into, labelled and
   * in one place over the output, so a drop target is always in reach even
   * when its jack on the panel is small, scrolled away or not on this set.
   * Dropping on one of these is the same as dropping on the jack itself.
   */
  import { cableDrag } from '../../music/cablePatching';
  import { canConnect, jackKind } from '../../music/studioSets';
  import { musicStudio } from '../../music/musicStudioStore';
  import { macros } from '../../stores/macros';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';

  interface Target { id: string; label: string; hint: string }
  interface Group { title: string; targets: Target[] }

  const drag = $derived($cableDrag);
  const set = $derived($musicStudio.set);
  const cables = $derived($musicStudio.cables[set]);

  const groups = $derived.by((): Group[] => {
    if (!drag) return [];
    const all: Group[] = [
      { title: 'Effects', targets: [{ id: 'fx:in', label: set === 'dub' ? 'Echo chamber' : 'FX rack', hint: 'Sends this sound through the effects' }] },
      {
        title: 'Analog synth',
        targets: set === 'analog'
          ? [
              { id: 'dest:analog.cutoff', label: 'Cutoff', hint: 'Opens and closes the filter' },
              { id: 'dest:analog.pitch', label: 'Pitch', hint: 'Bends the pitch' },
              { id: 'dest:analog.amp', label: 'Amp', hint: 'Turns the volume' },
            ]
          : [],
      },
      { title: 'Macros', targets: $macros.macros.map((m) => ({ id: `dest:macro:${m.id}`, label: m.name, hint: `Turns ${m.name} and everything it controls` })) },
      { title: 'Deck layers', targets: $vjClipLauncher.layerStates.map((_, i) => ({ id: `dest:layer:${i}`, label: `Layer ${i + 1}`, hint: `Pulses layer ${i + 1}'s opacity` })) },
    ];
    return all
      .map((g) => ({ ...g, targets: g.targets.filter((t) => canConnect(drag.from, t.id)) }))
      .filter((g) => g.targets.length);
  });

  const kind = $derived(drag ? jackKind(drag.from) : null);
  const taken = (id: string) => cables.some((c) => c.to === id && c.from !== drag?.from);
</script>

{#if drag}
  <div class="bay" role="group" aria-label="Where this cable can go">
    <p class="head">
      {kind === 'audio' ? 'Drop on an input to route this sound' : 'Drop on an input to control it with this signal'}<span class="muted"> · let go anywhere else to cancel</span>
    </p>
    {#if groups.length}
      {#each groups as g (g.title)}
        <div class="group">
          <span class="ga-eyebrow">{g.title}</span>
          <div class="targets">
            {#each g.targets as t (t.id)}
              <span class="target" data-jack={t.id} data-bay="" title="{t.hint}{taken(t.id) ? ' (replaces the cable there)' : ''}">
                <span class="hole {kind}"></span>{t.label}
              </span>
            {/each}
          </div>
        </div>
      {/each}
    {:else}
      <p class="none">Nothing in this set takes {kind === 'audio' ? 'a sound' : 'a control signal'} yet.{kind === 'control' ? ' Add a macro or a deck layer to give it somewhere to go.' : ''}</p>
    {/if}
  </div>
{/if}

<style>
  .bay {
    position: absolute;
    top: 34px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    width: min(560px, calc(100% - 24px));
    box-sizing: border-box;
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    font-size: var(--ga-text-meta, 11px);
    color: var(--studio-ink);
  }
  .head, .none { margin: 0; }
  .muted, .none { color: var(--studio-muted); }
  .group { display: flex; flex-direction: column; gap: 4px; }
  .targets { display: flex; flex-wrap: wrap; gap: 4px; }
  .target {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 9px 0 5px;
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
    background: var(--studio-cell);
    cursor: copy;
    white-space: nowrap;
  }
  .target:hover { border-color: var(--studio-accent); color: var(--studio-accent); }
  .hole {
    width: 12px;
    height: 12px;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--studio-jack-ring, #c9d3ee);
    background: #03050b;
  }
  .hole.control { border-color: var(--studio-jack-cv, #7ec8e3); }
  .target:hover .hole { border-color: var(--studio-accent); }
</style>
