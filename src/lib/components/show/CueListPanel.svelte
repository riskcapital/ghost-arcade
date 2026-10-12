<script lang="ts">
  /**
   * Cue list panel, beside the show timeline.
   *
   * Top: what is live, what is next, the countdown to an auto-follow, and
   * GO / Back / Stop / Reset. Each of those carries a data-midi-path, so
   * MIDI learn and OSC learn can bind a controller to them.
   *
   * Keyboard, only while focus is inside this panel (and never while typing
   * in one of its fields): Space is GO, Shift+Space is Back. The panel
   * swallows those keys so the app-wide Space (play the timeline, or pan the
   * canvas) does not also fire.
   *
   * Left: the list. Click a cue to edit it, double-click to stand by on it.
   * Right: the selected cue's number, name, follow and actions.
   */
  import { onDestroy } from 'svelte';
  import {
    cueList,
    cueLabel,
    resolveFollowTarget,
    type Cue,
    type CueActionKind,
  } from '../../show/cueList';
  import { timecodeChase } from '../../show/timecode/timecodeChase';
  import { formatSecondsAsTimecode, parseTimecodeToSeconds, type TimecodeRate } from '../../show/timecode/timecode';
  import CueActionEditor from './CueActionEditor.svelte';

  $: s = $cueList;
  $: cues = s.cues;
  $: current = cues.find((c) => c.id === s.currentCueId) ?? null;
  $: standby = cues.find((c) => c.id === s.standbyCueId) ?? (!s.currentCueId ? cues[0] ?? null : null);
  $: selected = cues.find((c) => c.id === s.selectedCueId) ?? null;
  $: pending = s.pendingFollow;
  $: pendingTarget = pending ? cues.find((c) => c.id === pending.targetCueId) ?? null : null;

  // Countdown ticks locally; the engine only stores the deadline.
  let remainingMs: number | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  $: if (pending && !tickTimer) {
    tickTimer = setInterval(() => (remainingMs = cueList.remainingMs()), 50);
    remainingMs = cueList.remainingMs();
  } else if (!pending && tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    remainingMs = null;
  }
  onDestroy(() => {
    if (tickTimer) clearInterval(tickTimer);
  });

  function formatCountdown(ms: number | null): string {
    if (ms === null) return '';
    const total = Math.max(0, ms) / 1000;
    const m = Math.floor(total / 60);
    const sec = total - m * 60;
    return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
  }
  $: countdownPct = pending && remainingMs !== null ? Math.max(0, Math.min(100, 100 - (remainingMs / pending.totalMs) * 100)) : 0;

  function followSummary(cue: Cue): string {
    const f = cue.follow;
    const target = f.target === 'end'
      ? 'end'
      : f.target === 'loop'
        ? 'loop'
        : f.target === 'jump'
          ? `to ${cues.find((c) => c.id === f.jumpTo)?.number ?? '?'}`
          : '';
    if (f.mode === 'go') return target && target !== 'end' ? `GO, ${target}` : target === 'end' ? 'GO, end' : 'GO';
    const wait = f.unit === 'beats' ? `${f.wait} beats` : `${f.wait}s`;
    return `Auto ${wait}${target ? `, ${target}` : ''}`;
  }

  // ── Keyboard ───────────────────────────────────────────────────────────
  function isTyping(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    const tag = el?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
  }
  function onKeydown(e: KeyboardEvent) {
    if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    // Ours: keep it from the app-wide Space and from a focused button's
    // own activation (which would fire a second GO on key-up).
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.shiftKey) cueList.back();
    else cueList.go();
  }
  function onKeyup(e: KeyboardEvent) {
    if (e.code !== 'Space' || isTyping(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  // ── Editing ────────────────────────────────────────────────────────────
  let addKind: CueActionKind = 'preset';
  const ACTION_KINDS: Array<{ value: CueActionKind; label: string }> = [
    { value: 'preset', label: 'Mapping preset' },
    { value: 'snapshot', label: 'Snapshot' },
    { value: 'vjClip', label: 'VJ clip' },
    { value: 'vjColumn', label: 'VJ column' },
    { value: 'vjStopAll', label: 'Stop all VJ clips' },
    { value: 'blackout', label: 'Blackout' },
    { value: 'macro', label: 'Macro value' },
    { value: 'layerOpacity', label: 'Layer opacity' },
    { value: 'param', label: 'Control path value' },
    { value: 'timeline', label: 'Show timeline' },
    { value: 'projector', label: 'Projector' },
  ];

  function addCue() {
    cueList.addCue({}, s.selectedCueId);
  }
  function deleteSelected() {
    if (selected) cueList.removeCue(selected.id);
  }

  const chaseSettings = timecodeChase.settings;
  $: tcSettings = $chaseSettings;
  $: tcRate = (tcSettings.rate === 'auto' ? 25 : tcSettings.rate) as TimecodeRate;
  function cueTimecodeText(cue: Cue): string {
    return cue.timecode === null ? '' : formatSecondsAsTimecode(cue.timecode + tcSettings.offset, tcRate);
  }
  let tcError = '';
  function setCueTimecode(cue: Cue, text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      tcError = '';
      cueList.updateCue(cue.id, { timecode: null });
      return;
    }
    const secs = parseTimecodeToSeconds(trimmed, tcRate);
    if (secs === null) {
      tcError = 'Use HH:MM:SS:FF';
      return;
    }
    tcError = '';
    cueList.updateCue(cue.id, { timecode: Math.max(0, secs - tcSettings.offset) });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex a11y_no_noninteractive_element_interactions -->
<section
  class="cue-panel"
  tabindex="0"
  aria-label="Cue list. Space is GO, Shift+Space is Back."
  onkeydown={onKeydown}
  onkeyup={onKeyup}
  data-cue-panel
>
  <div class="cue-status">
    <div class="cue-lines">
      <div class="cue-line">
        <span class="cue-tag">Now</span>
        <span class="cue-live" data-cue-current>{current ? cueLabel(current) : 'Nothing fired'}</span>
      </div>
      <div class="cue-line">
        <span class="cue-tag">Next</span>
        <span class="cue-next" data-cue-next>{(pendingTarget ?? standby) ? cueLabel(pendingTarget ?? standby) : 'End of list'}</span>
      </div>
      <div class="cue-line cue-count" data-cue-countdown>
        {#if pending}
          <span class="cue-tag">Auto</span>
          <span class="cue-clock">{formatCountdown(remainingMs)}</span>
          <span class="cue-bar"><span style="width: {countdownPct}%"></span></span>
        {:else if s.active}
          <span class="cue-tag">Wait</span><span class="cue-muted">for GO</span>
        {:else}
          <span class="cue-tag">Idle</span><span class="cue-muted">{current ? 'Stopped' : 'Ready'}</span>
        {/if}
      </div>
    </div>
    <div class="cue-transport">
      <button
        class="cue-go"
        onclick={() => cueList.go()}
        disabled={cues.length === 0}
        data-midi-path="show:go"
        data-midi-label="Cue list GO"
        data-midi-mode="toggle"
        title="GO: fire the next cue (Space while the cue list has focus)"
      >GO</button>
      <div class="cue-small-btns">
        <button onclick={() => cueList.back()} disabled={!current} data-midi-path="show:back" data-midi-label="Cue list Back" data-midi-mode="toggle" title="Back: fire the cue above the current one (Shift+Space)">Back</button>
        <button onclick={() => cueList.stop()} data-midi-path="show:stop" data-midi-label="Cue list Stop" data-midi-mode="toggle" title="Stop: cancel the pending follow, freeze fades, pause the timeline">Stop</button>
        <button onclick={() => cueList.reset()} data-midi-path="show:reset" data-midi-label="Cue list Reset" data-midi-mode="toggle" title="Reset: stop and stand by on the first cue">Reset</button>
      </div>
    </div>
  </div>

  <div class="cue-body">
    <div class="cue-list-col">
      <div class="cue-list" role="list">
        {#each cues as cue (cue.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
          <div
            class="cue-row"
            role="listitem"
            class:current={cue.id === s.currentCueId}
            class:standby={cue.id === (pendingTarget ?? standby)?.id}
            class:selected={cue.id === s.selectedCueId}
            data-cue-id={cue.id}
            onclick={() => cueList.select(cue.id)}
            ondblclick={() => cueList.setStandby(cue.id)}
            title="Click to edit, double-click to stand by"
          >
            <span class="cue-state" aria-hidden="true"></span>
            <span class="cue-num">{cue.number}</span>
            <span class="cue-name">{cue.name || 'Untitled'}</span>
            <span class="cue-follow">{followSummary(cue)}</span>
          </div>
        {/each}
        {#if cues.length === 0}
          <div class="cue-empty">No cues yet. Add one, then give it actions.</div>
        {/if}
      </div>
      <div class="cue-list-btns">
        <button onclick={addCue} title="Add a cue below the selected one">+ Cue</button>
        <button onclick={() => selected && cueList.setStandby(selected.id)} disabled={!selected} title="Stand by on the selected cue: GO fires it next">Stand by</button>
        <button onclick={deleteSelected} disabled={!selected} title="Delete the selected cue">Delete</button>
      </div>
    </div>

    {#if selected}
      {@const target = resolveFollowTarget(cues, selected)}
      <div class="cue-editor" data-cue-editor>
        <div class="ce-row">
          <label class="ce-field ce-num">No.
            <input type="text" value={selected.number} onchange={(e) => cueList.updateCue(selected.id, { number: e.currentTarget.value.trim() || selected.number })} />
          </label>
          <label class="ce-field ce-grow">Name
            <input type="text" value={selected.name} placeholder="Untitled" onchange={(e) => cueList.updateCue(selected.id, { name: e.currentTarget.value })} data-cue-name />
          </label>
        </div>
        <div class="ce-row">
          <label class="ce-field">Then
            <select value={selected.follow.mode} onchange={(e) => cueList.updateFollow(selected.id, { mode: e.currentTarget.value as 'go' | 'auto' })} data-cue-follow-mode>
              <option value="go">Wait for GO</option>
              <option value="auto">Auto-follow after</option>
            </select>
          </label>
          {#if selected.follow.mode === 'auto'}
            <input class="ce-wait" type="number" min="0" step="0.1" value={selected.follow.wait} onchange={(e) => cueList.updateFollow(selected.id, { wait: parseFloat(e.currentTarget.value) || 0 })} aria-label="Wait" data-cue-wait />
            <select value={selected.follow.unit} onchange={(e) => cueList.updateFollow(selected.id, { unit: e.currentTarget.value as 'seconds' | 'beats' })} aria-label="Wait unit">
              <option value="seconds">seconds</option>
              <option value="beats">beats</option>
            </select>
          {/if}
        </div>
        <div class="ce-row">
          <label class="ce-field">Go to
            <select value={selected.follow.target} onchange={(e) => cueList.updateFollow(selected.id, { target: e.currentTarget.value as 'next' | 'jump' | 'loop' | 'end' })} data-cue-follow-target>
              <option value="next">Next cue</option>
              <option value="jump">Jump to cue</option>
              <option value="loop">Loop to the first cue</option>
              <option value="end">End of list</option>
            </select>
          </label>
          {#if selected.follow.target === 'jump'}
            <select value={selected.follow.jumpTo ?? ''} onchange={(e) => cueList.updateFollow(selected.id, { jumpTo: e.currentTarget.value || null })} aria-label="Jump target">
              <option value="">Choose cue</option>
              {#each cues as c (c.id)}
                <option value={c.id}>{cueLabel(c)}</option>
              {/each}
            </select>
          {/if}
          <span class="ce-hint">{target ? `then ${cueLabel(target)}` : 'then nothing'}</span>
        </div>
        <div class="ce-row">
          <label class="ce-field" title="Fires this cue when a chased timecode passes this time (house timecode, the show offset is applied)">Timecode
            <input class="ce-tc" type="text" placeholder="none" value={cueTimecodeText(selected)} onchange={(e) => setCueTimecode(selected, e.currentTarget.value)} />
          </label>
          {#if tcError}<span class="ce-error">{tcError}</span>{/if}
        </div>

        <div class="ce-actions">
          {#each selected.actions as action (action.id)}
            <CueActionEditor cueId={selected.id} {action} />
          {/each}
          {#if selected.actions.length === 0}
            <div class="cue-empty">No actions: this cue only moves the list along.</div>
          {/if}
        </div>
        <div class="ce-row">
          <select bind:value={addKind} aria-label="Action to add">
            {#each ACTION_KINDS as k}
              <option value={k.value}>{k.label}</option>
            {/each}
          </select>
          <button class="ce-add" onclick={() => cueList.addAction(selected.id, addKind)} data-cue-add-action>+ Action</button>
          <button class="ce-fire" onclick={() => cueList.fire(selected.id, 'manual')} title="Fire this cue now">Fire now</button>
        </div>
      </div>
    {/if}
  </div>
</section>

<style>
  .cue-panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    width: 560px;
    max-width: 48vw;
    flex-shrink: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
    background: #0c0c11;
    outline: none;
    font-size: 11px;
    color: var(--text-primary, #ddd);
  }
  .cue-panel:focus-within,
  .cue-panel:focus {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ga-coral, #ff6f5e) 45%, transparent);
  }
  .cue-status {
    display: flex;
    gap: 8px;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
  }
  .cue-lines { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cue-line { display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap; }
  .cue-tag {
    width: 34px;
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--text-muted, #888);
  }
  .cue-live { font-size: 13px; font-weight: 700; color: #fff; overflow: hidden; text-overflow: ellipsis; }
  .cue-next { font-size: 12px; color: #f0c674; overflow: hidden; text-overflow: ellipsis; }
  .cue-muted { color: var(--text-muted, #888); }
  .cue-clock { font-family: var(--font-jetbrains), monospace; font-size: 12px; color: #9fe0a0; min-width: 48px; }
  .cue-bar { flex: 1; height: 4px; background: rgba(255, 255, 255, 0.08); border-radius: 2px; overflow: hidden; }
  .cue-bar span { display: block; height: 100%; background: #9fe0a0; }
  .cue-transport { display: flex; gap: 6px; align-items: stretch; }
  .cue-go {
    width: 74px;
    font-size: 20px;
    font-weight: 800;
    letter-spacing: 1px;
    color: #06140a;
    background: linear-gradient(180deg, #5fdc76, #2fa84a);
    border: 1px solid rgba(255, 255, 255, 0.25);
    border-radius: 6px;
    cursor: pointer;
    font-family: inherit;
  }
  .cue-go:hover:not(:disabled) { filter: brightness(1.1); }
  .cue-go:disabled { opacity: 0.4; cursor: default; }
  .cue-small-btns { display: flex; flex-direction: column; gap: 3px; }
  .cue-small-btns button, .cue-list-btns button, .ce-add, .ce-fire {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-secondary, #aaa);
    font-size: 10px;
    font-weight: 600;
    border-radius: 4px;
    padding: 3px 8px;
    cursor: pointer;
    font-family: inherit;
  }
  .cue-small-btns button:hover:not(:disabled), .cue-list-btns button:hover:not(:disabled), .ce-add:hover, .ce-fire:hover { color: #fff; border-color: rgba(255, 255, 255, 0.25); }
  button:disabled { opacity: 0.4; cursor: default; }

  .cue-body { display: flex; flex: 1; min-height: 0; }
  .cue-list-col { width: 230px; flex-shrink: 0; display: flex; flex-direction: column; border-right: 1px solid rgba(255, 255, 255, 0.06); min-height: 0; }
  .cue-list { flex: 1; overflow-y: auto; min-height: 0; }
  .cue-row {
    display: grid;
    grid-template-columns: 10px 30px 1fr auto;
    align-items: center;
    gap: 5px;
    padding: 3px 6px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    user-select: none;
  }
  .cue-row:hover { background: rgba(255, 255, 255, 0.04); }
  .cue-row.selected { background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 14%, transparent); }
  .cue-state { width: 7px; height: 7px; border-radius: 50%; }
  .cue-row.standby .cue-state { background: #f0c674; }
  .cue-row.current .cue-state { background: #5fdc76; box-shadow: 0 0 6px #5fdc76; }
  .cue-row.current .cue-name { color: #fff; font-weight: 700; }
  .cue-num { font-family: var(--font-jetbrains), monospace; color: var(--text-secondary, #aaa); }
  .cue-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cue-follow { color: var(--text-muted, #888); font-size: 10px; white-space: nowrap; }
  .cue-empty { padding: 8px; color: var(--text-muted, #888); font-style: italic; }
  .cue-list-btns { display: flex; gap: 4px; padding: 4px 6px; border-top: 1px solid rgba(255, 255, 255, 0.06); }

  .cue-editor { flex: 1; min-width: 0; overflow-y: auto; padding: 6px 8px; display: flex; flex-direction: column; gap: 5px; }
  .ce-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; }
  .ce-field { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted, #888); }
  .ce-grow { flex: 1; min-width: 0; }
  .ce-grow input { flex: 1; min-width: 0; }
  .ce-num input { width: 42px; }
  .ce-wait { width: 56px; }
  .ce-tc { width: 96px; font-family: var(--font-jetbrains), monospace; }
  .ce-hint { color: var(--text-muted, #888); font-style: italic; }
  .ce-error { color: #ff8a80; }
  .ce-actions { display: flex; flex-direction: column; gap: 4px; }
  .cue-editor input, .cue-editor select {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #ddd);
    font-size: 11px;
    border-radius: 3px;
    padding: 2px 4px;
    font-family: inherit;
  }
  .ce-fire { margin-left: auto; }
</style>
