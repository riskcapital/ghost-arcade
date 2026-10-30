<script lang="ts">
  /** Recorded takes: rename, play once, loop, load the beat back, delete. */
  import { takeNoteCount } from '../../music/recording';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { playTake, stopTake } from '../../music/musicRuntime';
  import { downloadMidi, takeSong } from '../../music/midiExport';

  const s = $derived($musicStudio);

  function toggle(id: string, loop: boolean) {
    if (s.playingTakeId === id && s.loopTake === loop) stopTake();
    else playTake(id, loop);
  }

  function seconds(sec: number): string {
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }
</script>

<div class="takes">
  {#each s.takes as take (take.id)}
    {@const playing = s.playingTakeId === take.id}
    <div class="take" class:playing>
      <input class="name" value={take.name} onchange={(e) => musicStudio.renameTake(take.id, (e.target as HTMLInputElement).value)} aria-label="Take name" />
      <span class="meta">{seconds(take.length)} · {takeNoteCount(take)} notes</span>
      {#if playing}
        <span class="progress"><span style="width: {$musicTransport.takeProgress * 100}%"></span></span>
      {/if}
      <button class="icon" class:on={playing && !s.loopTake} onclick={() => toggle(take.id, false)} title={playing && !s.loopTake ? 'Stop' : 'Play'}>
        {#if playing && !s.loopTake}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"/></svg>
        {/if}
      </button>
      <button class="icon" class:on={playing && s.loopTake} onclick={() => toggle(take.id, true)} title={playing && s.loopTake ? 'Stop looping' : 'Loop'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>
      </button>
      {#if take.pattern}
        <button class="icon" onclick={() => take.pattern && musicStudio.setPattern(take.pattern)} title="Load this take's beat into the pattern">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>
        </button>
      {/if}
      <button class="icon" onclick={() => downloadMidi(takeSong(take), take.name)} title="Save as a MIDI file">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>
      </button>
      <button class="icon" onclick={() => musicStudio.removeTake(take.id)} title="Delete take">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M8 10v8M16 10v8"/></svg>
      </button>
    </div>
  {:else}
    <p class="empty">Press Rec, play, then Rec again. Takes save with the project.</p>
  {/each}
</div>

<style>
  .takes { display: flex; flex-direction: column; }
  .take {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    border-bottom: 1px solid var(--mk-line-soft, var(--ga-line, rgba(255,255,255,.07)));
  }
  .name {
    width: 96px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--mk-ink, var(--ga-ink-0, #eef0f4));
    border-radius: var(--mk-radius, var(--ga-r-hard, 2px));
    font: inherit;
    font-size: 12px;
  }
  .name:hover, .name:focus { border-color: var(--mk-line, var(--ga-line-2, rgba(255,255,255,.12))); }
  .playing .name { color: var(--mk-accent, var(--ga-coral, #ff6f5e)); }
  .meta {
    margin-right: auto;
    color: var(--mk-muted, var(--ga-ink-2, #5e6571));
    font-family: var(--mk-mono, var(--ga-font-mono, ui-monospace));
    font-size: 11px;
  }
  .progress { width: 48px; height: 2px; background: var(--mk-line, var(--ga-line-2, rgba(255,255,255,.12))); }
  .progress span { display: block; height: 100%; background: var(--mk-accent, var(--ga-coral, #ff6f5e)); }
  .icon {
    width: 24px;
    height: 24px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--mk-line, var(--ga-line-2, rgba(255,255,255,.12)));
    background: transparent;
    color: var(--mk-muted, var(--ga-ink-1, #9aa0ac));
    border-radius: var(--mk-radius, var(--ga-r-hard, 2px));
    cursor: pointer;
  }
  .icon svg { width: 13px; height: 13px; fill: currentColor; }
  .icon svg[fill="none"] { fill: none; }
  .icon:hover { color: var(--mk-ink, var(--ga-ink-0, #eef0f4)); }
  .icon.on { color: var(--mk-accent, var(--ga-coral, #ff6f5e)); border-color: var(--mk-accent, var(--ga-coral, #ff6f5e)); }
  .empty { margin: 6px 0; color: var(--mk-muted, var(--ga-ink-2, #5e6571)); font-size: 12px; }
</style>
