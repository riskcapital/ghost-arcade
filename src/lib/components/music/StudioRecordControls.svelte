<script lang="ts">
  /**
   * Record A/V: the program output with the studio's sound, or the sound
   * alone as WAV, with stems if wanted and a count-in to the next bar. Its
   * menu holds the options and the recent recordings. Kept apart from Rec
   * take (which records the notes played) so the two are never confused.
   */
  import { onDestroy } from 'svelte';
  import { forgetRecording, recentRecordings, revealRecording, startStudioRecording, stopStudioRecording, studioRec, type StudioRecMode } from '../../music/studioRecorder';
  import RecordingSourcePicker from '../RecordingSourcePicker.svelte';

  const KEY = 'ga.studio.recOptions';
  let mode = $state<StudioRecMode>('video');
  let stems = $state(false);
  let countIn = $state(true);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (saved.mode === 'audio' || saved.mode === 'video') mode = saved.mode;
    stems = saved.stems === true;
    countIn = saved.countIn !== false;
  } catch {
    // First use.
  }
  $effect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ mode, stems, countIn })); } catch { /* private window */ }
  });

  let open = $state(false);
  let elapsed = $state(0);
  const timer = setInterval(() => {
    const st = $studioRec;
    elapsed = st.phase === 'recording' ? (performance.now() - st.startedAt) / 1000 : 0;
  }, 250);
  onDestroy(() => clearInterval(timer));

  const phase = $derived($studioRec.phase);
  const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

  function toggle() {
    if (phase === 'idle') startStudioRecording({ mode, stems, countIn });
    else void stopStudioRecording();
  }
</script>

<div class="rec" role="group" aria-label="Record A/V">
  <button
    class="go"
    class:on={phase === 'recording'}
    class:wait={phase === 'waiting' || phase === 'saving'}
    onclick={toggle}
    disabled={phase === 'saving'}
    title={phase === 'idle' ? (mode === 'video' ? 'Record the output with the studio sound into one file' : 'Record the studio sound as WAV') : phase === 'waiting' ? 'Starting on the next bar: press to cancel' : 'Stop and keep the recording'}
  >
    <span class="dot" aria-hidden="true"></span>
    {#if phase === 'recording'}{clock(elapsed)}{:else if phase === 'waiting'}Next bar…{:else if phase === 'saving'}Saving…{:else}Record A/V{/if}
  </button>
  <button class="more" class:open aria-expanded={open} onclick={() => (open = !open)} aria-label="Recording options and recent recordings" title="Options and recent recordings">▾</button>
  {#if open}
    <div class="menu" role="dialog" aria-label="Record A/V options">
      <div class="row">
        <span class="label">Record</span>
        <div class="ga-segmented small" role="group" aria-label="What to record">
          <button class:active={mode === 'video'} aria-pressed={mode === 'video'} onclick={() => (mode = 'video')}>Video and audio</button>
          <button class:active={mode === 'audio'} aria-pressed={mode === 'audio'} onclick={() => (mode = 'audio')}>Audio only (WAV)</button>
        </div>
      </div>
      {#if mode === 'video'}
        <div class="row"><span class="label">Source</span><RecordingSourcePicker disabled={phase !== 'idle'} compact /></div>
      {/if}
      <label class="row check"><input type="checkbox" bind:checked={stems} /> Stems: a WAV per mixer channel, recorded together</label>
      <label class="row check"><input type="checkbox" bind:checked={countIn} /> Start on the next bar</label>
      <div class="recent">
        <span class="label">Recent</span>
        {#each $recentRecordings.slice(0, 8) as r (r.id)}
          <div class="item">
            <span class="name" title={r.path ?? r.name}>{r.kind === 'video' ? 'Video' : r.kind === 'stem' ? 'Stem' : 'WAV'} · {r.name}</span>
            {#if r.path}<button class="link" onclick={() => revealRecording(r)} title="Show it in its folder">Reveal</button>{/if}
            <button class="link" onclick={() => forgetRecording(r.id)} title="Take it off this list (the file stays)">Remove</button>
          </div>
        {:else}
          <p class="empty">Nothing recorded yet.</p>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .rec { position: relative; display: flex; align-items: center; gap: 2px; }
  .go, .more {
    height: var(--ga-control-h, 26px);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .more { padding: 0 6px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ga-rec, #ff3b30); opacity: 0.6; }
  .go.on { border-color: var(--ga-rec, #ff3b30); color: var(--ga-rec, #ff3b30); }
  .go.on .dot { opacity: 1; box-shadow: 0 0 6px var(--ga-rec, #ff3b30); }
  .go.wait .dot { animation: blink 0.6s steps(2) infinite; }
  @keyframes blink { to { opacity: 0.15; } }
  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 12;
    width: 360px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
    font-size: var(--ga-text-meta, 11px);
  }
  .row { display: flex; align-items: center; gap: 8px; }
  .check { color: var(--studio-ink); }
  .label { min-width: 46px; color: var(--studio-muted); font-weight: 700; }
  .recent { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--studio-edge-soft); padding-top: 8px; }
  .item { display: flex; align-items: center; gap: 6px; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .link { padding: 0; border: 0; background: transparent; color: var(--studio-muted); font: inherit; cursor: pointer; }
  .link:hover { color: var(--studio-ink); }
  .empty { margin: 0; color: var(--studio-muted); }
</style>
