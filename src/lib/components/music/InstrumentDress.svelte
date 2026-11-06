<script lang="ts">
  /**
   * Sound, FX and Visual for one instrument, in its module's header: a tone
   * to play it with (and, for a pad, what Y does), its channel's insert
   * effects, and a visual voice that follows it. Shared by every module that
   * wants it; everything saves with the set, scenes and songs.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { insertEditorChannel } from '../../music/studioUi';
  import { TONES } from '../../music/tone/tones';
  import { Y_AXES, type YAxis } from '../../music/instrumentDress';
  import { syncDressVisual } from '../../music/instrumentDressVisual';
  import type { ClipVisual } from '../../music/session';
  import type { InstrumentId } from '../../music/noteEvents';
  import VisualPickButton from './VisualPickButton.svelte';
  import { voiceSourcesFor } from '../../music/visualVoices';
  import { BLEND_MODE_ORDER, blendModeLabel } from '../../types';

  let { instrument, builtIn = 'Built-in', axes = false }: { instrument: InstrumentId; builtIn?: string; axes?: boolean } = $props();

  const s = $derived($musicStudio);
  const dress = $derived(s.dress[instrument] ?? {});
  const fxCount = $derived(s.inserts[instrument]?.length ?? 0);
  let open = $state<'sound' | 'visual' | null>(null);

  const families = ['pad', 'lead', 'arp', 'bass'] as const;
  const FAMILY_LABEL: Record<string, string> = { pad: 'Pads', lead: 'Leads and keys', arp: 'Arps (hold a chord)', bass: 'Basses' };

  function setVisual(patch: Partial<ClipVisual>) {
    const base: ClipVisual = dress.visual ?? { file: patch.file ?? '', source: instrument, blend: 'screen', level: 0.9 };
    const visual = patch.file === '' ? undefined : { ...base, ...patch };
    musicStudio.setDress(instrument, { visual });
    syncDressVisual(instrument, visual);
  }
</script>

<div class="dress" role="group" aria-label="Sound, effects and visual">
  <button class="studio-btn" class:on={!!dress.tone || open === 'sound'} onclick={() => (open = open === 'sound' ? null : 'sound')} title="What it plays{axes ? ' and what Y does' : ''}">Sound</button>
  <button class="studio-btn" class:on={fxCount > 0} onclick={() => insertEditorChannel.set($insertEditorChannel === instrument ? null : instrument)} title="Effects on this instrument's channel">FX{fxCount ? ` ${fxCount}` : ''}</button>
  <button class="studio-btn" class:on={!!dress.visual || open === 'visual'} onclick={() => (open = open === 'visual' ? null : 'visual')} title="A visual that follows it">Visual</button>

  {#if open === 'sound'}
    <div class="pop" role="dialog" aria-label="Sound">
      <label>Sound
        <select value={dress.tone ?? ''} onchange={(e) => musicStudio.setDress(instrument, { tone: (e.target as HTMLSelectElement).value || undefined })}>
          <option value="">{builtIn}</option>
          {#each families as fam (fam)}
            <optgroup label={FAMILY_LABEL[fam]}>
              {#each TONES.filter((t) => t.family === fam) as t (t.id)}<option value={t.id} title={t.blurb}>{t.name}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </label>
      {#if axes}
        <label>X <span class="fixed">Pitch, in key</span></label>
        <label>Y
          <select value={dress.yAxis ?? 'space'} onchange={(e) => musicStudio.setDress(instrument, { yAxis: (e.target as HTMLSelectElement).value as YAxis })}>
            {#each Y_AXES as a (a.id)}<option value={a.id}>{a.label}</option>{/each}
          </select>
        </label>
      {/if}
      <button class="studio-btn done" onclick={() => (open = null)}>Done</button>
    </div>
  {:else if open === 'visual'}
    <div class="pop" role="dialog" aria-label="Visual">
      <label>Visual
        <VisualPickButton file={dress.visual?.file ?? null} none placeholder="None" onpick={(f) => setVisual({ file: f ?? '' })} />
      </label>
      {#if dress.visual}
        <label>Follows
          <select value={dress.visual.source} onchange={(e) => setVisual({ source: (e.target as HTMLSelectElement).value })}>
            {#each voiceSourcesFor(s.set, dress.visual.source) as src (src.id)}<option value={src.id}>{src.label}</option>{/each}
          </select>
        </label>
        <label>Blend
          <select value={dress.visual.blend} onchange={(e) => setVisual({ blend: (e.target as HTMLSelectElement).value })}>
            {#each BLEND_MODE_ORDER as m (m)}<option value={m}>{blendModeLabel(m)}</option>{/each}
          </select>
        </label>
        <label>Opacity
          <input type="range" min="0" max="1" step="0.01" value={dress.visual.level} onchange={(e) => setVisual({ level: +(e.target as HTMLInputElement).value })} />
        </label>
      {/if}
      <button class="studio-btn done" onclick={() => (open = null)}>Done</button>
    </div>
  {/if}
</div>

<style>
  .dress { position: relative; display: inline-flex; align-items: center; gap: 4px; }
  .pop {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    width: 240px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: var(--studio-panel);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  }
  .pop label { display: grid; grid-template-columns: 56px 1fr; align-items: center; gap: 6px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .pop select { width: 100%; min-width: 0; }
  .fixed { color: var(--studio-ink); }
  .done { align-self: flex-end; }
</style>
