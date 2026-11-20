<script lang="ts">
  /**
   * ✦ Auto show: listens to the song on the Song row, says what it heard
   * (tempo, style, sections, the pieces in groups), lets the style and the
   * content be changed (a chip each), and builds the show on Build the show
   * (one undo step). The show then plays from the top; the dialog docks out
   * of the way with Shuffle and Done. "Looks only" is the old ✦ Score.
   */
  import { onMount } from 'svelte';
  import { commitAutoShow, prepareAutoShow, redraftAutoShow, releaseLastAutoShow, shuffleAutoShow, playFromTop } from '../../../../timeline/autoshow/autoShowRuntime';
  import { commitScore, prepareScore, shuffleScore } from '../../../../timeline/score/scoreRuntime';
  import { onShowDocChange, onShowTimelineReset } from '../../../../stores/showTimeline';
  import type { ShowStyle } from '../../../../timeline/autoshow/songStyle';
  import { createAutoShowFlow, type AutoShowContent } from './autoShowFlow';
  import TimelineIcon from '../TimelineIcon.svelte';
  import { autoShowDockInset } from './autoShowUi';

  interface Props { onclose: () => void }
  let { onclose }: Props = $props();

  const STYLES: Array<{ id: ShowStyle; label: string; hint: string }> = [
    { id: 'chill', label: 'Chill', hint: 'Slow and soft: calm pictures, long swaps, gentle Screen FX' },
    { id: 'groove', label: 'Groove', hint: 'A steady groove: contents swap every few bars' },
    { id: 'driving', label: 'Driving', hint: 'Four on the floor: sets swap every bar, beat cuts in the drops' },
    { id: 'hard', label: 'Hard', hint: 'Fast and heavy: beat cuts, strobes and hits' },
    { id: 'cinematic', label: 'Cinematic', hint: 'No steady beat: slow reveals and long builds, nothing cut on the beat' },
  ];
  const CONTENTS: Array<{ id: AutoShowContent; label: string; hint: string }> = [
    { id: 'builtin', label: 'Built-in', hint: 'Curated shaders and Looks made for mapped pieces' },
    { id: 'library', label: 'My library', hint: 'Your own videos (Media Library)' },
    { id: 'both', label: 'Both', hint: 'Built-in content and your videos' },
    { id: 'looks', label: 'Looks only', hint: 'Sections, looks and lines only (no content on the pieces)' },
  ];

  // One state for the whole dialog (autoShowFlow.ts): no flag can stick.
  const flow = createAutoShowFlow({
    prepare: (signal) => prepareAutoShow({ signal }),
    redraft: (prep, change, signal) => redraftAutoShow(prep, change, { signal }),
    commit: (prep) => commitAutoShow(prep),
    shuffle: (signal) => shuffleAutoShow({}, { signal }),
    prepareScore: (signal) => prepareScore({ signal }),
    commitScore: (prep) => commitScore(prep),
    shuffleScore: (signal) => shuffleScore({ signal }),
    playFromTop,
    release: releaseLastAutoShow,
    onReset: (listener) => {
      const offReset = onShowTimelineReset(listener);
      const offDoc = onShowDocChange(listener);
      return () => { offReset(); offDoc(); };
    },
    now: () => performance.now(),
  });
  const flowState = flow.state;

  onMount(() => {
    void flow.start();
    return () => flow.dispose();
  });

  // A built show's dialog closes when another project or document opens.
  $effect(() => {
    if ($flowState.kind === 'closed') onclose();
  });

  const st = $derived($flowState);
  /** Shown for the dialog's phases: reading, confirm (ready or working), done, error. */
  const phase = $derived(
    st.kind === 'idle' || st.kind === 'reading' ? 'reading'
      : st.kind === 'ready' || st.kind === 'redrafting' || st.kind === 'building' ? 'confirm'
        : st.kind === 'done' || st.kind === 'shuffling' ? 'done'
          : 'error',
  );
  const shownState = $derived('content' in st ? st : null);
  const prep = $derived(shownState?.prep ?? (st.kind === 'error' ? st.prep : null));
  const content = $derived<AutoShowContent>(shownState?.content ?? 'builtin');
  const scorePrep = $derived(shownState?.scorePrep ?? null);
  /** A step is running: the choices and buttons wait. */
  const busy = $derived(st.kind !== 'ready' && st.kind !== 'done');
  const draft = $derived(shownState?.prep.draft ?? null);
  const adds = $derived(content === 'looks' ? scorePrep?.draft.adds ?? [] : draft?.adds ?? []);
  const skips = $derived(content === 'looks' ? scorePrep?.draft.skips ?? [] : draft?.skips ?? []);
  const sectionNames = $derived(draft ? draft.plan.map((p) => p.name).join(' · ') : '');
  const heardStyle = $derived(prep?.reading.style ?? null);
  /** An earlier Auto show is under the song: this one only fills gaps. */
  const earlierShow = $derived(skips.some((line) => /earlier Auto show/.test(line)));
  // Docked once built: over the grid, clear of the side column and the
  // status bar (it covered the Inspector and the frame rate). Measured when
  // it docks and when the window changes size, not every frame.
  let dock = $state({ right: 16, bottom: 16 });
  $effect(() => {
    if (phase !== 'done' || typeof window === 'undefined') return;
    const rect = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
    const measure = () => { dock = autoShowDockInset({ width: window.innerWidth, height: window.innerHeight }, rect('[data-timeline-side]'), rect('.statusbar')); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
  const MOD = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="auto-backdrop" class:docked={phase === 'done'} style:right={phase === 'done' ? `${dock.right}px` : null} style:bottom={phase === 'done' ? `${dock.bottom}px` : null} onclick={() => { if (phase !== 'done') onclose(); }} data-auto-show-dialog>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="auto-modal" onclick={(e) => e.stopPropagation()} data-auto-phase={phase} data-auto-state={st.kind}>
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
    {:else if st.kind === 'error'}
      <p class="auto-error" data-auto-error>{st.message}</p>
      <div class="auto-btns">
        {#if st.canRetry}
          <button class="auto-cancel" onclick={onclose}>Close</button>
          <button class="auto-ok" onclick={() => flow.retry()} data-auto-retry>Try again</button>
        {:else}
          <button class="auto-ok" onclick={onclose}>OK</button>
        {/if}
      </div>
    {:else if shownState && draft}
      <div class="auto-heard" data-auto-heard>
        <span class="auto-fact" title="The tempo it heard"><TimelineIcon name="tempo" size={13} />{draft.heard.bpm} BPM</span>
        <span class="auto-fact" title="The style it heard"><TimelineIcon name="sparkle" size={13} />{draft.heard.style}</span>
        <span class="auto-fact" title={sectionNames} data-auto-plan><TimelineIcon name="sections" size={13} />{draft.heard.sections} {draft.heard.sections === 1 ? 'section' : 'sections'}{sectionNames ? `: ${sectionNames}` : ''}</span>
        <span class="auto-fact" title="The mapped pieces, in groups that light together"><TimelineIcon name="phrases" size={13} />{draft.heard.pieces} pieces in {draft.heard.groups} groups</span>
      </div>

      {#if phase === 'confirm'}
        {#if shownState.note}
          <p class="auto-note" data-auto-note>{shownState.note}</p>
        {/if}
        {#if earlierShow}
          <p class="auto-note" data-auto-earlier>This Timeline already has an Auto show under the song, so this one only fills what is still empty. For a different show, undo the earlier one first ({MOD} + Z), or keep it and use Shuffle after building.</p>
        {/if}
        <div class="auto-choice" role="group" aria-label="Style">
          <span class="auto-choice-label">Style</span>
          <span class="auto-seg">
            {#each STYLES as s (s.id)}
              <button class:on={shownState.prep.style === s.id} class:heard={heardStyle === s.id} title={heardStyle === s.id ? `${s.hint} (what it heard)` : s.hint} disabled={busy || content === 'looks'} onclick={() => flow.setStyle(s.id)} data-auto-style={s.id}>{s.label}</button>
            {/each}
          </span>
        </div>
        <div class="auto-choice" role="group" aria-label="Content">
          <span class="auto-choice-label">Content</span>
          <span class="auto-seg">
            {#each CONTENTS as c (c.id)}
              <button class:on={content === c.id} title={c.hint} disabled={busy || ((c.id === 'library' || c.id === 'both') && shownState.prep.libraryVideos === 0)} onclick={() => flow.setContent(c.id)} data-auto-source={c.id}>{c.label}</button>
            {/each}
          </span>
        </div>
        <p class="auto-sub">What it adds, only where the Timeline is empty. One undo takes it all back.</p>
      {:else}
        <p class="auto-sub">Built in {((st.kind === 'done' || st.kind === 'shuffling' ? st.builtMs : 0) / 1000).toFixed(1)} s and playing from the top. {MOD} + Z takes it all back; click anything on the Timeline to change it.</p>
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
          <button class="auto-ok" onclick={() => flow.build()} disabled={busy || !adds.length} data-auto-build><TimelineIcon name="sparkle" size={14} />Build the show</button>
        {:else}
          <button class="auto-cancel" onclick={() => flow.shuffle()} disabled={busy} title="Another show by the same rules (blocks you changed are kept)" data-auto-shuffle>Shuffle</button>
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
