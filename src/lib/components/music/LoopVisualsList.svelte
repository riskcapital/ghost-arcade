<script lang="ts">
  /**
   * Beside the output preview on the Looper page: which visual follows which
   * loop track. The selected track's row is highlighted; Assign gives it the
   * first visual not following a loop yet (pick the look in the rack).
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { loopStationView } from '../../music/loopStation';
  import { LOOP_TRACK_COUNT } from '../../music/loopTrack';
  import { trackSoundLabel } from '../../music/loopSources';
  import { setStudioVoice, studioTarget } from '../../music/studioTarget';
  import { loopTrackOfSource, loopTrackSource } from '../../music/visualVoices';
  import { showToast } from '../../stores/errorToast';

  const voices = $derived($studioTarget?.source.musicVoices ?? []);
  const tracks = $derived($musicStudio.loopStation.tracks);
  const sel = $derived($loopStationView.selected);
  const voiceName = (file: string) => file.replace(/^VX-/, '').replace(/\.fs$/, '').replace(/[-_]/g, ' ');
  const trackName = (i: number) => {
    const t = tracks[i];
    return (t?.name || (t?.kind === 'audio' ? `Audio ${i + 1}` : t?.instrument || t?.source ? trackSoundLabel(t, 'synth') : `Track ${i + 1}`)).split(' · ')[0];
  };
  const rows = $derived(
    Array.from({ length: $musicStudio.loopStation.trackCount }, (_, i) => ({ i, k: voices.findIndex((v) => v.live === loopTrackSource(i)) })).filter((r) => r.k >= 0 || r.i === sel),
  );

  function assign(i: number) {
    const free = voices.findIndex((v) => loopTrackOfSource(v.live) < 0);
    if (free < 0) {
      showToast('Every visual already follows a loop: add one in the visuals rack.', 'info');
      return;
    }
    setStudioVoice(free, { live: loopTrackSource(i) });
  }
</script>

<div class="lv">
  <div class="ga-eyebrow">Loop visuals · follows</div>
  {#each rows as r (r.i)}
    <div class="row" class:hl={r.i === sel}>
      <span class="sw" class:rec={r.i === sel}></span>
      <span class="nm">{#if r.k >= 0}{voiceName(voices[r.k].file)}{:else}{trackName(r.i)}{/if} <span class="ga-eyebrow">· {r.i + 1} {r.k >= 0 ? trackName(r.i) : 'no visual'}</span></span>
      {#if r.k >= 0}
        <button class="tag" onclick={() => setStudioVoice(r.k, { live: undefined })} title="Stop this visual following the loop">Loop {r.i + 1}</button>
      {:else}
        <button class="tag add" onclick={() => assign(r.i)} title="Give this loop track a visual that follows it">+ Assign</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .lv { display: flex; flex-direction: column; gap: 2px; padding: 4px 0; min-width: 0; }
  .row { display: grid; grid-template-columns: 12px 1fr auto; gap: 8px; align-items: center; padding: 7px 8px; border-top: 1px solid var(--studio-edge-soft); }
  .row.hl { background: var(--studio-rec-soft); }
  .sw { width: 10px; height: 10px; border-radius: 3px; background: var(--studio-accent); }
  .sw.rec { background: var(--studio-rec); }
  .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-control, 12px); }
  .tag { height: 20px; padding: 0 7px; border: 1px solid var(--studio-accent); background: transparent; color: var(--studio-accent); border-radius: 4px; font: inherit; font-size: var(--ga-text-meta, 11px); cursor: pointer; }
  .tag.add { border-color: var(--studio-rec); color: var(--studio-rec); }
</style>
