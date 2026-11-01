<script lang="ts">
  /**
   * Every sound as a control signal, for the modules with no room for their
   * own jack: each instrument, each loop track, the band inputs, the master
   * and the drop. Cable one to a macro (or anything with an input) and it
   * follows that sound's level; right-click the cable to make it a trigger.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { INSTRUMENTS } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { INPUT_CHANNELS } from '../../music/mixer';
  import StudioModule from './StudioModule.svelte';
  import StudioJack from './StudioJack.svelte';

  const s = $derived($musicStudio);
  const groups = $derived([
    { title: 'Instruments', jacks: INSTRUMENTS.map((id) => ({ id: `cv:inst.${id}.level`, label: INSTRUMENT_LABELS[id] })) },
    { title: 'Loop tracks', jacks: (['bass', 'chords', 'lead', 'texture'] as const).map((r) => ({ id: `cv:track.${r}.level`, label: r[0].toUpperCase() + r.slice(1) })) },
    {
      title: 'Band, master and drop',
      jacks: [
        ...INPUT_CHANNELS.slice(0, Math.max(1, s.liveInputs.length)).map((ch, i) => ({ id: `cv:chan.${ch}.level`, label: `In ${i + 1}` })),
        { id: 'cv:master.level', label: 'Master' },
        { id: 'cv:build.drop', label: 'Drop hit' },
      ],
    },
  ]);
</script>

<StudioModule title="Sources" subtitle="every sound as a signal">
  <div class="bank">
    {#each groups as g (g.title)}
      <div class="group">
        <span class="ga-eyebrow">{g.title}</span>
        <div class="jacks">
          {#each g.jacks as j (j.id)}
            <StudioJack id={j.id} label={j.label} title="{j.label}: its level as a control signal" />
          {/each}
        </div>
      </div>
    {/each}
  </div>
</StudioModule>

<style>
  .bank { display: flex; flex-direction: column; gap: 8px; }
  .group { display: flex; flex-direction: column; gap: 4px; }
  .jacks { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 6px 4px; }
  .jacks :global(.jack-label) { font-size: var(--ga-text-micro, 9px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 48px; }
</style>
