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
  import TimelineIcon from '../TimelineIcon.svelte';

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
  /** An earlier Auto show is under the song: this one only fills gaps. */
  const earlierShow = $derived(skips.some((line) => /earlier Auto show/.test(line)));
  const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="auto-backdrop" class:docked={phase === 'done'} onclick={() => { if (phase !== 'done') onclose(); }} data-auto-show-dialog>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="auto-modal" onclick={(e) => e.stopPropagation()} data-auto-phase={phase}>
    <div class="auto-head">
      <span class="auto-mark"><TimelineIcon name="sparkle" size={18} /></span>
      <span class="auto-titles">
        <h3>{phase === 'done' ? 'Playing your show' : 'Auto show'}</h3>
        {#if prep}<span class="auto-song"><TimelineIcon name="song" size={12} /><span class="file-name">{prep.track.name}</span></span>{/if}
      </span>
      {#if phase !== 'done'}<button class="auto-x" onclick={onclose} aria-label="Close">×</button>{/if}
    </div>

    {#if phase === 'reading'}
      <div class="auto-listening" role="status">
        <span class="auto-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
        <span>Listening to the song: its tempo, its parts and how hard it hits.</span>
      </div>
    {:else if phase === 'error'}
      <p class="auto-error">{error}</p>
      <div class="auto-btns"><button class="auto-ok" onclick={onclose}>OK</button></div>
    {:else if prep && draft}
      <div class="auto-heard" data-auto-heard>
        <span class="auto-fact" title="The tempo it heard"><TimelineIcon name="tempo" size={13} />{draft.heard.bpm} BPM</span>
        <span class="auto-fact" title="The style it heard"><TimelineIcon name="sparkle" size={13} />{draft.heard.style}</span>
        <span class="auto-fact" title={sectionNames} data-auto-plan><TimelineIcon name="sections" size={13} />{draft.heard.sections} {draft.heard.sections === 1 ? 'section' : 'sections'}{sectionNames ? `: ${sectionNames}` : ''}</span>
        <span class="auto-fact" title="The mapped pieces, in groups that light together"><TimelineIcon name="phrases" size={13} />{draft.heard.pieces} pieces in {draft.heard.groups} groups</span>
      </div>

      {#if phase === 'confirm'}
        {#if earlierShow}
          <p class="auto-note" data-auto-earlier>This Timeline already has an Auto show under the song, so this one only fills what is still empty. For a different show, undo the earlier one first ({MOD} + Z), or keep it and use Shuffle after building.</p>
        {/if}
        <div class="auto-choice" role="group" aria-label="Style">
          <span class="auto-choice-label">Style</span>
          <span class="auto-seg">
            {#each STYLES as s (s.id)}
              <button class:on={prep.style === s.id} class:heard={heardStyle === s.id} title={heardStyle === s.id ? `${s.hint} (what it heard)` : s.hint} disabled={busy || content === 'looks'} onclick={() => setStyle(s.id)} data-auto-style={s.id}>{s.label}</button>
            {/each}
          </span>
        </div>
        <div class="auto-choice" role="group" aria-label="Content">
          <span class="auto-choice-label">Content</span>
          <span class="auto-seg">
            {#each CONTENTS as c (c.id)}
              <button class:on={content === c.id} title={c.hint} disabled={busy || ((c.id === 'library' || c.id === 'both') && prep.libraryVideos === 0)} onclick={() => setContent(c.id)} data-auto-source={c.id}>{c.label}</button>
            {/each}
          </span>
        </div>
        <p class="auto-sub">What it adds, only where the Timeline is empty. One undo takes it all back.</p>
      {:else}
        <p class="auto-sub">Built in {(builtMs / 1000).toFixed(1)} s and playing from the top. {MOD} + Z takes it all back; click anything on the Timeline to change it.</p>
      {/if}
      <ul class="auto-adds" data-auto-adds>
        {#each adds as a, i (i)}<li><span class="auto-tick">✓</span><span>{a}</span></li>{/each}
      </ul>
      {#if skips.length}
        <details class="auto-skipped">
          <summary>Left as it is ({skips.length})</summary>
          <ul class="auto-skips" data-auto-skips>{#each skips as s, i (i)}<li>{s}</li>{/each}</ul>
        </details>
      {/if}
      <div class="auto-btns">
        {#if phase === 'confirm'}
          <button class="auto-cancel" onclick={onclose}>Cancel</button>
          <button class="auto-ok" onclick={build} disabled={busy || !adds.length} data-auto-build><TimelineIcon name="sparkle" size={14} />Build the show</button>
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
    width: 520px; max-width: calc(100vw - 32px); max-height: 80vh; overflow-y: auto;
    background: var(--ga-card, #16161c);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 8px;
    padding: 16px 18px; color: var(--ga-ink-1, #ccc); font-size: 13px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  }
  .docked .auto-modal { width: 360px; max-height: 50vh; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5); }
  .auto-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .auto-mark { display: inline-flex; color: var(--ga-icon, #5278ff); }
  .auto-titles { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
  h3 { margin: 0; color: var(--ga-ink-0, #fff); font-size: 15px; }
  .auto-song { display: inline-flex; align-items: center; gap: 5px; color: var(--ga-ink-2, #999); font-size: 12px; min-width: 0; }
  .auto-song .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .auto-x { width: 26px; height: 26px; background: transparent; border: none; color: var(--ga-ink-2, #888); font-size: 18px; cursor: pointer; align-self: flex-start; }
  .auto-x:hover { color: var(--ga-ink-0, #fff); }
  p { margin: 6px 0; }
  .auto-listening { display: flex; align-items: center; gap: 12px; padding: 12px 0 6px; color: var(--ga-ink-1, #ccc); }
  .auto-bars { display: inline-flex; align-items: flex-end; gap: 3px; height: 18px; }
  .auto-bars i { width: 3px; height: 6px; border-radius: 2px; background: var(--ga-icon, #5278ff); animation: auto-eq 0.9s ease-in-out infinite; }
  .auto-bars i:nth-child(2) { animation-delay: 0.15s; }
  .auto-bars i:nth-child(3) { animation-delay: 0.3s; }
  .auto-bars i:nth-child(4) { animation-delay: 0.45s; }
  .auto-bars i:nth-child(5) { animation-delay: 0.6s; }
  @keyframes auto-eq { 50% { height: 18px; } }
  .auto-error { color: var(--ga-ink-0, #fff); }
  .auto-heard { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 10px 0; border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); }
  .auto-fact { display: inline-flex; align-items: center; gap: 6px; color: var(--ga-ink-0, #f2ede4); font-size: 12px; }
  .auto-fact :global(.tl-icon) { color: var(--ga-ink-2, #999); }
  .auto-note { color: var(--ga-ink-1, #d6d0dc); font-size: 12px; line-height: 1.45; margin: 12px 0 4px; }
  .auto-choice { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
  .auto-choice-label { width: 58px; flex-shrink: 0; color: var(--ga-ink-2, #999); font-size: 12px; }
  .auto-seg { display: inline-flex; flex-wrap: wrap; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14)); border-radius: 5px; overflow: hidden; }
  .auto-seg button {
    height: 26px; padding: 0 11px; font: inherit; font-size: 12px; cursor: pointer;
    background: transparent; border: none; border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.08)); color: var(--ga-ink-1, #ccc);
  }
  .auto-seg button:last-child { border-right: none; }
  .auto-seg button:hover:not(:disabled):not(.on) { color: var(--ga-ink-0, #fff); background: rgba(255, 255, 255, 0.04); }
  .auto-seg button.heard:not(.on) { color: var(--ga-ink-0, #fff); text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 3px; }
  .auto-seg button.on { background: var(--ga-icon, #5278ff); color: #fff; }
  .auto-seg button:disabled { opacity: 0.4; cursor: default; }
  .auto-sub { color: var(--ga-ink-2, #999); font-size: 12px; margin-top: 14px; }
  ul { margin: 4px 0 8px; padding: 0; list-style: none; }
  .auto-adds li { display: flex; gap: 8px; margin: 4px 0; color: var(--ga-ink-0, #f2ede4); }
  .auto-tick { color: var(--ga-icon, #5278ff); font-weight: 700; }
  .auto-skipped { margin-top: 6px; color: var(--ga-ink-2, #999); font-size: 12px; }
  .auto-skipped summary { cursor: pointer; padding: 4px 0; text-transform: none; letter-spacing: normal; font-size: 12px; font-weight: 400; }
  .auto-skipped summary:hover { color: var(--ga-ink-1, #ccc); }
  .auto-skips li { margin: 3px 0 3px 14px; list-style: disc; }
  .docked .auto-adds { display: none; }
  .auto-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .auto-btns button { height: 30px; padding: 0 14px; border-radius: 5px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .auto-cancel { background: transparent; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.2)); color: var(--ga-ink-1, #ccc); }
  .auto-cancel:hover:not(:disabled) { color: var(--ga-ink-0, #fff); }
  .auto-ok { background: var(--ga-icon, #5278ff); border: 1px solid var(--ga-icon, #5278ff); color: #fff; }
  .auto-ok:disabled, .auto-cancel:disabled { opacity: 0.45; cursor: default; }
</style>
