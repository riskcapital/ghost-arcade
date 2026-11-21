<script lang="ts">
  /**
   * The Looper page's left rail: the tempo and where the bar is, Tap, nudge
   * and Resync; and the song's sections, each with the tracks it plays.
   * A section launches on the next bar (the one waiting shows NEXT and the
   * bar it lands on); Next section steps through them (MIDI-learnable).
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { launchLoopSection, loopSectionState, loopStationView, nextLoopSection } from '../../music/loopStation';
  import { beatNow } from '../../music/loopUi';
  import { LOOP_TRACK_COUNT } from '../../music/loopTrack';
  import { launchClockTempo, resyncLaunchClock } from '../../stores/launchClock';
  import { audioStore } from '../../stores/audio';
  import { showToast } from '../../stores/errorToast';
  import { generateUUID } from '../../utils/uuid';
  import { loopKey } from '../../music/loopControls';

  /** The looper's keys while the Looper page shows (not while typing, and not the keys the letter keyboard plays). */
  function key(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (e.defaultPrevented || target?.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    if (loopKey(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const station = $derived($musicStudio.loopStation);
  const sec = $derived($loopSectionState);
  const beat = $derived(Math.max(0, $beatNow));
  // The tempo is read with the beat, so it follows taps and nudges.
  const bpm = $derived((void $beatNow, launchClockTempo()));
  const bar = $derived(Math.floor(beat / 4) + 1);
  const inBar = $derived(Math.floor(beat) % 4);
  const playing = $derived($loopStationView.tracks.map((t, i) => (t.phase === 'play' || t.phase === 'overdub' ? i : -1)).filter((i) => i >= 0));
  const toNext = $derived(sec.at !== null ? Math.max(0, Math.ceil((sec.at - beat) / 4)) : 0);

  function nudge(d: number) {
    audioStore.setManualBPM(Math.round((launchClockTempo() + d) * 10) / 10);
  }

  function snapshot() {
    if (!playing.length) {
      showToast('Start some loops first: a section keeps which tracks play.', 'info');
      return;
    }
    musicStudio.updateLoopStation((d) => ({ ...d, sections: [...d.sections, { id: generateUUID(), name: `Section ${d.sections.length + 1}`, tracks: [...playing] }].slice(-16) }));
  }

  function rename(id: string, name: string) {
    if (!name.trim()) return;
    musicStudio.updateLoopStation((d) => ({ ...d, sections: d.sections.map((x) => (x.id === id ? { ...x, name: name.trim().slice(0, 40) } : x)) }));
  }

  function remove(id: string) {
    musicStudio.updateLoopStation((d) => ({ ...d, sections: d.sections.filter((x) => x.id !== id) }));
  }
</script>

<svelte:window onkeydown={key} />

<div class="rail">
  <div class="clock">
    <div class="bpm">{bpm.toFixed(1)}<small>BPM</small></div>
    <div class="pos"><span class="big">{bar}.{inBar + 1}.{Math.floor((beat % 1) * 4) + 1}</span><span class="ga-eyebrow">bar · beat</span></div>
    <div class="beats" aria-hidden="true">{#each [0, 1, 2, 3] as b}<i class:on={b <= inBar} class:one={b === 0}></i>{/each}</div>
    <div class="tap">
      <button onclick={() => audioStore.tapTempo()} title="Tap the tempo">Tap</button>
      <button onclick={() => nudge(-1)} title="One BPM slower" aria-label="Slower">−</button>
      <button onclick={() => nudge(1)} title="One BPM faster" aria-label="Faster">+</button>
      <button onclick={() => resyncLaunchClock()} title="Make now the downbeat">Resync</button>
    </div>
  </div>
  <div class="rh">
    <span class="ga-eyebrow">Song · sections</span>
    {#if sec.next}<span class="ga-eyebrow soon">{toNext} to bar {Math.floor((sec.at ?? 0) / 4) + 1}</span>{/if}
  </div>
  <div class="list">
    {#each station.sections as x (x.id)}
      {@const now = sec.now === x.id && !sec.next}
      {@const next = sec.next === x.id}
      <div class="sec" class:now class:next role="button" tabindex="0" onclick={() => launchLoopSection(x.id)} onkeydown={(e) => e.key === 'Enter' && launchLoopSection(x.id)} title="Play these tracks from the next bar; the others stop">
        <div class="sn">
          <input value={x.name} aria-label="Section name" onclick={(e) => e.stopPropagation()} onchange={(e) => rename(x.id, (e.target as HTMLInputElement).value)} />
          {#if now}<span class="tag now">Playing</span>{:else if next}<span class="tag next">Next · bar {Math.floor((sec.at ?? 0) / 4) + 1}</span>{/if}
          <button class="x" onclick={(e) => { e.stopPropagation(); remove(x.id); }} aria-label="Remove section {x.name}">×</button>
        </div>
        <div class="dots">{#each { length: $musicStudio.loopStation.trackCount } as _, k}<i class:on={x.tracks.includes(k)}></i>{/each}</div>
      </div>
    {:else}
      <p class="empty">Play some loops, then Snapshot: a section keeps which tracks play, to bring back on the bar.</p>
    {/each}
  </div>
  <div class="foot">
    <button onclick={snapshot} title="Keep which tracks play now as a section">+ Snapshot playing tracks</button>
    <button onclick={() => nextLoopSection()} disabled={!station.sections.length} title="Launch the next section on the bar (MIDI-learnable: Next loop section)" data-midi-path="studio:loop.section.next" data-midi-label="Next loop section" data-midi-mode="toggle">Next section ▸</button>
    <span class="ga-eyebrow hint">Launches on the bar</span>
  </div>
</div>

<style>
  .rail { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--studio-panel); border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); overflow: hidden; }
  .clock { padding: 14px 16px; border-bottom: 1px solid var(--studio-edge-soft); }
  .bpm { font-size: 38px; font-weight: 300; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
  .bpm small { font-size: 12px; color: var(--studio-muted); margin-left: 4px; }
  .pos { display: flex; align-items: baseline; gap: 10px; margin-top: 4px; }
  .big { font-size: 21px; font-variant-numeric: tabular-nums; }
  .beats { display: flex; gap: 5px; margin: 10px 0 12px; }
  .beats i { flex: 1; height: 6px; border-radius: 2px; background: var(--studio-edge-soft); }
  .beats i.on { background: var(--studio-accent); }
  .beats i.on.one { background: var(--studio-ink); }
  .tap { display: flex; gap: 6px; }
  .tap button, .foot button { flex: 1; height: 28px; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; cursor: pointer; }
  .rh { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px 6px; }
  .soon { color: var(--studio-rec); }
  .list { flex: 1; min-height: 0; overflow: auto; }
  .sec { padding: 9px 16px; border-top: 1px solid var(--studio-edge-soft); cursor: pointer; outline: none; }
  .sec:hover { background: rgba(255, 255, 255, 0.02); }
  .sec.now { background: var(--studio-accent-soft); box-shadow: inset 3px 0 0 var(--studio-accent); }
  .sec.next { box-shadow: inset 3px 0 0 var(--studio-rec); }
  .sn { display: flex; align-items: center; gap: 6px; }
  .sn input { flex: 1; min-width: 0; border: 0; background: transparent; color: var(--studio-ink); font: inherit; font-weight: 600; padding: 0; }
  .tag { font-size: 9px; letter-spacing: 0.08em; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 3px; white-space: nowrap; }
  .tag.now { background: var(--studio-accent); color: var(--studio-on-accent); }
  .tag.next { color: var(--studio-rec); border: 1px solid var(--studio-rec); }
  .x { border: 0; background: transparent; color: var(--studio-muted); cursor: pointer; padding: 0 2px; }
  .dots { display: flex; gap: 6px; margin-top: 6px; }
  .dots i { width: 9px; height: 9px; border-radius: 50%; border: 1px solid var(--studio-edge); }
  .dots i.on { background: var(--studio-ink); border-color: var(--studio-ink); opacity: 0.75; }
  .sec.now .dots i.on { background: var(--studio-accent); border-color: var(--studio-accent); opacity: 1; }
  .empty { margin: 10px 16px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .foot { display: flex; flex-direction: column; gap: 6px; padding: 12px 16px; border-top: 1px solid var(--studio-edge); }
  .foot button:disabled { opacity: 0.4; cursor: default; }
  .hint { text-align: center; }
</style>
