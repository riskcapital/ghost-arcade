<script lang="ts">
  /**
   * ✦ Auto show: listens to the song on the Song row, says what it heard
   * (tempo, style, sections, the pieces in groups), lets the style and the
   * content be changed (a chip each), and builds the show on Build the show
   * (one undo step). The show then plays from the top; the dialog docks out
   * of the way with Shuffle and Done. "Looks only" is the old ✦ Score.
   */
  import { onMount } from 'svelte';
  import { commitAutoShow, prepareAutoShow, redraftAutoShow, shuffleAutoShow, playFromTop, type AutoShowPrep, type AutoShowSource } from '../../../../timeline/autoshow/autoShowRuntime';
  import { commitScore, prepareScore, shuffleScore, type ScorePrep } from '../../../../timeline/score/scoreRuntime';
  import type { ShowStyle } from '../../../../timeline/autoshow/songStyle';

  interface Props { onclose: () => void }
  let { onclose }: Props = $props();

  type Content = AutoShowSource | 'looks';
  const STYLES: Array<{ id: ShowStyle; label: string; hint: string }> = [
    { id: 'chill', label: 'Chill', hint: 'Slow and soft: calm pictures, long swaps, gentle Screen FX' },
    { id: 'groove', label: 'Groove', hint: 'A steady groove: contents swap every few bars' },
    { id: 'driving', label: 'Driving', hint: 'Four on the floor: sets swap every bar, beat cuts in the drops' },
    { id: 'hard', label: 'Hard', hint: 'Fast and heavy: beat cuts, strobes and hits' },
    { id: 'cinematic', label: 'Cinematic', hint: 'No steady beat: slow reveals and long builds, nothing cut on the beat' },
  ];
  const CONTENTS: Array<{ id: Content; label: string; hint: string }> = [
    { id: 'builtin', label: 'Built-in', hint: 'Curated shaders and Looks made for mapped pieces' },
    { id: 'library', label: 'My library', hint: 'Your own videos (Media Library)' },
    { id: 'both', label: 'Both', hint: 'Built-in content and your videos' },
    { id: 'looks', label: 'Looks only', hint: 'Sections, looks and lines only (no content on the pieces)' },
  ];

  let phase: 'reading' | 'confirm' | 'done' | 'error' = $state('reading');
  let prep = $state<AutoShowPrep | null>(null);
  let scorePrep = $state<ScorePrep | null>(null);
  let content = $state<Content>('builtin');
  let error = $state('');
  let busy = $state(false);
  let builtMs = $state(0);

  onMount(() => {
    void (async () => {
      const r = await prepareAutoShow();
      if (!r.ok) { error = r.reason; phase = 'error'; return; }
      prep = r.prep;
      // Both, when the library has videos.
      if (r.prep.libraryVideos > 0) { content = 'both'; prep = await redraftAutoShow(r.prep, { source: 'both' }); }
      phase = 'confirm';
    })();
  });

  async function setStyle(style: ShowStyle) {
    if (!prep || busy) return;
    busy = true;
    prep = await redraftAutoShow(prep, { style });
    busy = false;
  }

  async function setContent(next: Content) {
    if (!prep || busy) return;
    content = next;
    if (next === 'looks') {
      busy = true;
      const r = await prepareScore();
      busy = false;
      if (r.ok) scorePrep = r.prep;
      else { error = r.reason; phase = 'error'; }
      return;
    }
    busy = true;
    prep = await redraftAutoShow(prep, { source: next });
    busy = false;
  }

  function build() {
    if (!prep || busy) return;
    const t0 = performance.now();
    if (content === 'looks') {
      if (!scorePrep || !commitScore(scorePrep)) { error = 'Nothing to add: the Timeline already has all of it.'; phase = 'error'; return; }
      playFromTop({ structure: scorePrep.structure, track: scorePrep.track });
    } else if (!commitAutoShow(prep)) {
      error = 'Nothing to add: the Timeline already has all of it.';
      phase = 'error';
      return;
    }
    builtMs = prep.timings.analysisMs + prep.timings.draftMs + (performance.now() - t0);
    phase = 'done';
  }

  async function shuffle() {
    busy = true;
    if (content === 'looks') {
      const r = await shuffleScore();
      if (r.ok) { scorePrep = r.prep; playFromTop({ structure: r.prep.structure, track: r.prep.track }); }
      else { error = r.reason; phase = 'error'; }
    } else {
      const r = await shuffleAutoShow();
      if (r.ok) prep = r.prep;
      else { error = r.reason; phase = 'error'; }
    }
    busy = false;
  }

  const draft = $derived(prep?.draft ?? null);
  const adds = $derived(content === 'looks' ? scorePrep?.draft.adds ?? [] : draft?.adds ?? []);
  const skips = $derived(content === 'looks' ? scorePrep?.draft.skips ?? [] : draft?.skips ?? []);
  const sectionNames = $derived(draft ? draft.plan.map((p) => p.name).join(' · ') : '');
  const heardStyle = $derived(prep?.reading.style ?? null);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="auto-backdrop" class:docked={phase === 'done'} onclick={() => { if (phase !== 'done') onclose(); }} data-auto-show-dialog>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="auto-modal" onclick={(e) => e.stopPropagation()} data-auto-phase={phase}>
    {#if phase === 'reading'}
      <h3>✦ Auto show</h3>
      <p>Listening to the song…</p>
    {:else if phase === 'error'}
      <h3>✦ Auto show</h3>
      <p>{error}</p>
      <div class="auto-btns"><button class="auto-ok" onclick={onclose}>OK</button></div>
    {:else if prep && draft}
      <h3>{phase === 'done' ? '✦ Playing the show' : '✦ Auto show'}</h3>
      {#if phase === 'confirm'}
        <p class="auto-song">Song: <span class="file-name">{prep.track.name}</span></p>
      {/if}
      <p class="auto-heard" data-auto-heard>
        <span class="auto-heard-label">Heard:</span>
        {draft.heard.bpm} BPM · {draft.heard.style} · {draft.heard.sections} sections · {draft.heard.pieces} pieces in {draft.heard.groups} groups
      </p>
      {#if phase === 'confirm'}
        <p class="auto-plan" data-auto-plan>{sectionNames}</p>
        <div class="auto-chips" role="group" aria-label="Style">
          <span class="auto-chip-label">Style</span>
          {#each STYLES as s (s.id)}
            <button class="auto-chip" class:on={prep.style === s.id} class:heard={heardStyle === s.id} title={s.hint} disabled={busy || content === 'looks'} onclick={() => setStyle(s.id)} data-auto-style={s.id}>{s.label}</button>
          {/each}
        </div>
        <div class="auto-chips" role="group" aria-label="Content">
          <span class="auto-chip-label">Content</span>
          {#each CONTENTS as c (c.id)}
            <button class="auto-chip" class:on={content === c.id} title={c.hint} disabled={busy || ((c.id === 'library' || c.id === 'both') && prep.libraryVideos === 0)} onclick={() => setContent(c.id)} data-auto-source={c.id}>{c.label}</button>
          {/each}
        </div>
        <p>It adds, only where the Timeline is empty (one undo step):</p>
      {:else}
        <p>Built in {(builtMs / 1000).toFixed(1)} s and playing from the top. Cmd+Z takes it all back; click anything on the Timeline to change it.</p>
      {/if}
      <ul class="auto-adds" data-auto-adds>
        {#each adds as a (a)}<li>{a}</li>{/each}
      </ul>
      {#if skips.length}
        <p class="auto-skip-title">Left alone:</p>
        <ul class="auto-skips" data-auto-skips>{#each skips as s (s)}<li>{s}</li>{/each}</ul>
      {/if}
      <div class="auto-btns">
        {#if phase === 'confirm'}
          <button class="auto-cancel" onclick={onclose}>Cancel</button>
          <button class="auto-ok" onclick={build} disabled={busy || !adds.length} data-auto-build>Build the show</button>
        {:else}
          <button class="auto-cancel" onclick={shuffle} disabled={busy} title="Another show by the same rules (blocks you changed are kept)" data-auto-shuffle>Shuffle</button>
          <button class="auto-ok" onclick={onclose} data-auto-done>Done</button>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .auto-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  .auto-backdrop.docked { inset: auto 16px 16px auto; background: none; display: block; }
  .auto-modal {
    width: 500px; max-width: calc(100vw - 32px); max-height: 80vh; overflow-y: auto; background: var(--ga-card, #16161c);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 8px; padding: 16px 18px; color: var(--ga-ink-1, #ccc); font-size: 13px;
  }
  .docked .auto-modal { width: 360px; max-height: 50vh; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5); }
  h3 { margin: 0 0 8px; color: var(--ga-ink-0, #fff); font-size: 15px; }
  p { margin: 6px 0; }
  .auto-song { color: var(--ga-ink-2, #999); }
  .auto-heard { color: var(--ga-ink-0, #fff); }
  .auto-heard-label { color: #ffd36b; font-weight: 600; margin-right: 4px; }
  .auto-plan { color: #ffd36b; font-size: 12px; }
  .auto-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0; }
  .auto-chip-label { width: 58px; color: var(--ga-ink-2, #999); font-size: 12px; }
  .auto-chip {
    height: 24px; padding: 0 10px; border-radius: 12px; font: inherit; font-size: 12px; cursor: pointer;
    background: transparent; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.2)); color: var(--ga-ink-1, #ccc);
  }
  .auto-chip.heard { border-style: dashed; }
  .auto-chip.on { background: #2f6fed; border-color: #4b84ff; color: #fff; border-style: solid; }
  .auto-chip:disabled { opacity: 0.4; cursor: default; }
  ul { margin: 4px 0 8px; padding-left: 18px; }
  li { margin: 2px 0; }
  .auto-skip-title, .auto-skips { color: var(--ga-ink-2, #999); font-size: 12px; }
  .docked .auto-adds { display: none; }
  .auto-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
  .auto-btns button { height: 28px; padding: 0 14px; border-radius: 4px; font: inherit; cursor: pointer; }
  .auto-cancel { background: transparent; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.2)); color: var(--ga-ink-1, #ccc); }
  .auto-ok { background: #2f6fed; border: 1px solid #4b84ff; color: #fff; font-weight: 600; }
  .auto-ok:disabled { opacity: 0.5; cursor: default; }
</style>
