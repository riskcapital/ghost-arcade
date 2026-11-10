<script lang="ts">
  /**
   * "Score this song": reads the song on the Song row, says what the draft
   * will add (and what it leaves alone), lays it down on confirm (one undo
   * step), then offers Shuffle for another draft by the same rules.
   */
  import { onMount } from 'svelte';
  import { commitScore, prepareScore, shuffleScore, type ScorePrep } from '../../../../timeline/score/scoreRuntime';

  interface Props { onclose: () => void }
  let { onclose }: Props = $props();

  let phase: 'reading' | 'confirm' | 'done' | 'error' = $state('reading');
  let prep = $state<ScorePrep | null>(null);
  let error = $state('');
  let busy = $state(false);

  onMount(() => {
    void (async () => {
      const r = await prepareScore();
      if (r.ok) { prep = r.prep; phase = 'confirm'; }
      else { error = r.reason; phase = 'error'; }
    })();
  });

  function confirm() {
    if (!prep) return;
    if (!commitScore(prep)) { error = 'Nothing to add: the Timeline already has all of it.'; phase = 'error'; return; }
    phase = 'done';
  }
  async function shuffle() {
    busy = true;
    const r = await shuffleScore();
    busy = false;
    if (r.ok) prep = r.prep;
    else { error = r.reason; phase = 'error'; }
  }
  const kinds = $derived(prep ? prep.draft.plan.map((p) => p.name).join(' · ') : '');
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="score-backdrop" onclick={onclose} data-score-dialog>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="score-modal" onclick={(e) => e.stopPropagation()}>
    {#if phase === 'reading'}
      <h3>Score this song</h3>
      <p>Listening to the song…</p>
    {:else if phase === 'error'}
      <h3>Score this song</h3>
      <p>{error}</p>
      <div class="score-btns"><button class="score-ok" onclick={onclose}>OK</button></div>
    {:else if prep}
      <h3>{phase === 'done' ? 'Scored' : 'Score this song?'}</h3>
      <p class="score-song">Song: <span class="file-name">{prep.track.name}</span></p>
      <p class="score-plan" data-score-plan>{kinds}</p>
      {#if phase === 'confirm'}
        <p>It adds, only where the Timeline is empty (one undo step):</p>
      {:else}
        <p>Added (Cmd+Z takes it all back). Shuffle tries other looks and colours by the same rules.</p>
      {/if}
      <ul class="score-adds" data-score-adds>
        {#each prep.draft.adds as a (a)}<li>{a}</li>{/each}
      </ul>
      {#if prep.draft.skips.length}
        <p class="score-skip-title">Left alone:</p>
        <ul class="score-skips">{#each prep.draft.skips as s (s)}<li>{s}</li>{/each}</ul>
      {/if}
      <div class="score-btns">
        {#if phase === 'confirm'}
          <button class="score-cancel" onclick={onclose}>Cancel</button>
          <button class="score-ok" onclick={confirm} disabled={!prep.draft.adds.length} data-score-confirm>Score this song</button>
        {:else}
          <button class="score-cancel" onclick={shuffle} disabled={busy} data-score-shuffle>Shuffle</button>
          <button class="score-ok" onclick={onclose} data-score-done>Done</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .score-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  .score-modal {
    width: 480px; max-width: calc(100vw - 32px); max-height: 80vh; overflow-y: auto; background: var(--ga-card, #16161c);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 8px; padding: 16px 18px; color: var(--ga-ink-1, #ccc); font-size: 13px;
  }
  h3 { margin: 0 0 8px; color: var(--ga-ink-0, #fff); font-size: 15px; }
  p { margin: 6px 0; }
  .score-song { color: var(--ga-ink-2, #999); }
  .score-plan { color: #ffd36b; font-size: 12px; }
  ul { margin: 4px 0 8px; padding-left: 18px; }
  li { margin: 2px 0; }
  .score-skip-title { color: var(--ga-ink-2, #999); font-size: 12px; }
  .score-skips { color: var(--ga-ink-2, #999); font-size: 12px; }
  .score-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  button { height: 28px; padding: 0 14px; border-radius: 4px; font: inherit; cursor: pointer; }
  .score-cancel { background: transparent; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.2)); color: var(--ga-ink-1, #ccc); }
  .score-ok { background: #2f6fed; border: 1px solid #4b84ff; color: #fff; font-weight: 600; }
  .score-ok:disabled { opacity: 0.5; cursor: default; }
</style>
