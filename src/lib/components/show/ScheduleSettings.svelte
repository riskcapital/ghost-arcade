<script lang="ts">
  /**
   * Settings > Show Control > Schedule. Saved with the project.
   */
  import { onDestroy } from 'svelte';
  import {
    activeWindow,
    newScheduleEntry,
    newScheduleException,
    nextWindow,
    showSchedule,
    type ScheduleEntry,
    type ScheduleException,
    type ShowSchedule,
  } from '../../show/scheduler';
  import { cueList, cueLabel } from '../../show/cueList';
  import { getScheduleRunner } from '../../show/showControlRuntime';

  $: sch = $showSchedule;
  $: cues = $cueList.cues;

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function patch(p: Partial<ShowSchedule>) {
    showSchedule.update((s) => ({ ...s, ...p }));
  }
  function patchEntry(id: string, p: Partial<ScheduleEntry>) {
    patch({ entries: sch.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  }
  function toggleDay(entry: ScheduleEntry, day: number) {
    const days = entry.days.includes(day) ? entry.days.filter((d) => d !== day) : [...entry.days, day].sort();
    patchEntry(entry.id, { days });
  }
  function patchException(id: string, p: Partial<ScheduleException>) {
    patch({ exceptions: sch.exceptions.map((e) => (e.id === id ? { ...e, ...p } : e)) });
  }

  // "Now" readout refreshes every few seconds.
  let now = Date.now();
  const timer = setInterval(() => (now = Date.now()), 5000);
  onDestroy(() => clearInterval(timer));
  $: live = sch.enabled ? activeWindow(sch, now) : null;
  $: upcoming = sch.enabled ? nextWindow(sch, now) : null;
  // Re-read on the clock tick: the runner's log is not a store.
  function runnerAt(_tick: number) {
    return getScheduleRunner();
  }
  $: runner = runnerAt(now);
  $: recent = runner ? runner.log.slice(-6).reverse() : [];

  function when(ms: number): string {
    return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function clock(ms: number): string {
    return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="sch-panel" data-schedule-settings>
  <div class="sc-row">
    <div class="sc-label">
      <span class="sc-title">Run the show on a schedule</span>
      <span class="sc-hint">Starts and stops the show at the times below. A machine that wakes up mid-show starts it straight away.</span>
    </div>
    <input type="checkbox" checked={sch.enabled} onchange={(e) => patch({ enabled: e.currentTarget.checked })} data-schedule-enabled />
  </div>

  <div class="sch-now" data-schedule-now>
    {#if !sch.enabled}
      Scheduler off.
    {:else if live}
      Show time now, until {clock(live.end)}.{runner?.running ? '' : ' Starting on the next tick.'}
    {:else if upcoming}
      Next show {when(upcoming.start)} to {clock(upcoming.end)}.
    {:else}
      No show in the next two weeks.
    {/if}
  </div>

  <h4 class="sc-sub">Show times</h4>
  {#each sch.entries as entry (entry.id)}
    <div class="sch-entry" data-schedule-entry>
      <input type="checkbox" checked={entry.enabled} onchange={(e) => patchEntry(entry.id, { enabled: e.currentTarget.checked })} title="Use this show time" aria-label="Enabled" />
      <div class="sch-days">
        {#each DAYS as d, i}
          <button class="sch-day" class:on={entry.days.includes(i)} onclick={() => toggleDay(entry, i)} aria-pressed={entry.days.includes(i)}>{d}</button>
        {/each}
        <button class="sch-day sch-all" onclick={() => patchEntry(entry.id, { days: [0, 1, 2, 3, 4, 5, 6] })} title="Every day">Daily</button>
      </div>
      <label class="sch-time">Start <input type="time" value={entry.start} onchange={(e) => patchEntry(entry.id, { start: e.currentTarget.value || entry.start })} data-schedule-start /></label>
      <label class="sch-time">Stop <input type="time" value={entry.stop} onchange={(e) => patchEntry(entry.id, { stop: e.currentTarget.value || entry.stop })} data-schedule-stop /></label>
      <button class="sch-remove" onclick={() => patch({ entries: sch.entries.filter((e) => e.id !== entry.id) })} aria-label="Remove show time">×</button>
    </div>
  {/each}
  <button class="sch-add" onclick={() => patch({ entries: [...sch.entries, newScheduleEntry()] })} data-schedule-add>+ Show time</button>
  <p class="sc-hint">A stop time earlier than the start runs past midnight.</p>

  <h4 class="sc-sub">Date exceptions</h4>
  {#each sch.exceptions as ex (ex.id)}
    <div class="sch-entry">
      <input type="date" value={ex.date} onchange={(e) => patchException(ex.id, { date: e.currentTarget.value || ex.date })} aria-label="Date" />
      <select value={ex.kind} onchange={(e) => patchException(ex.id, { kind: e.currentTarget.value as 'closed' | 'hours' })} aria-label="Exception">
        <option value="closed">Closed</option>
        <option value="hours">Special hours</option>
      </select>
      {#if ex.kind === 'hours'}
        <label class="sch-time">Start <input type="time" value={ex.start} onchange={(e) => patchException(ex.id, { start: e.currentTarget.value || ex.start })} /></label>
        <label class="sch-time">Stop <input type="time" value={ex.stop} onchange={(e) => patchException(ex.id, { stop: e.currentTarget.value || ex.stop })} /></label>
      {/if}
      <input class="sch-note" type="text" placeholder="Note" value={ex.note} onchange={(e) => patchException(ex.id, { note: e.currentTarget.value })} />
      <button class="sch-remove" onclick={() => patch({ exceptions: sch.exceptions.filter((e) => e.id !== ex.id) })} aria-label="Remove exception">×</button>
    </div>
  {/each}
  <button class="sch-add" onclick={() => patch({ exceptions: [...sch.exceptions, newScheduleException()] })}>+ Exception</button>

  <h4 class="sc-sub">At the start</h4>
  <div class="sc-row">
    <div class="sc-label"><span class="sc-title">Fire cue</span><span class="sc-hint">The cue list runs on from here with its follow actions.</span></div>
    <select value={sch.startCueId ?? ''} onchange={(e) => patch({ startCueId: e.currentTarget.value || null })} data-schedule-start-cue>
      <option value="">First cue</option>
      {#each cues as c (c.id)}<option value={c.id}>{cueLabel(c)}</option>{/each}
    </select>
  </div>
  <div class="sc-row">
    <div class="sc-label"><span class="sc-title">Open the outputs fullscreen</span></div>
    <input type="checkbox" checked={sch.openOutputs} onchange={(e) => patch({ openOutputs: e.currentTarget.checked })} />
  </div>
  <div class="sc-row">
    <div class="sc-label"><span class="sc-title">Power projectors on</span><span class="sc-hint">Minutes ahead of the start, for lamp warm-up. 0 powers on at the start.</span></div>
    <div class="sch-inline">
      <input type="checkbox" checked={sch.projectorsOn} onchange={(e) => patch({ projectorsOn: e.currentTarget.checked })} data-schedule-projectors-on />
      <input type="number" min="0" max="120" step="1" value={sch.projectorLeadMinutes} disabled={!sch.projectorsOn} onchange={(e) => patch({ projectorLeadMinutes: Math.max(0, Math.min(120, parseFloat(e.currentTarget.value) || 0)) })} aria-label="Minutes before the start" />
      <span>min</span>
    </div>
  </div>
  <div class="sc-row">
    <div class="sc-label"><span class="sc-title">Open the projector shutters at the start, close them at the stop</span></div>
    <input type="checkbox" checked={sch.shutter} onchange={(e) => patch({ shutter: e.currentTarget.checked })} data-schedule-shutter />
  </div>

  <h4 class="sc-sub">At the stop</h4>
  <div class="sc-row">
    <div class="sc-label"><span class="sc-title">Fire cue</span><span class="sc-hint">Fired after the cue list stops, for a closing look.</span></div>
    <select value={sch.stopCueId ?? ''} onchange={(e) => patch({ stopCueId: e.currentTarget.value || null })}>
      <option value="">None</option>
      {#each cues as c (c.id)}<option value={c.id}>{cueLabel(c)}</option>{/each}
    </select>
  </div>
  <div class="sc-row">
    <div class="sc-label"><span class="sc-title">Blackout the output</span></div>
    <input type="checkbox" checked={sch.blackoutOnStop} onchange={(e) => patch({ blackoutOnStop: e.currentTarget.checked })} />
  </div>
  <div class="sc-row">
    <div class="sc-label"><span class="sc-title">Power projectors off</span></div>
    <input type="checkbox" checked={sch.projectorsOff} onchange={(e) => patch({ projectorsOff: e.currentTarget.checked })} data-schedule-projectors-off />
  </div>

  {#if recent.length > 0}
    <h4 class="sc-sub">Recent</h4>
    <ul class="sch-log">
      {#each recent as ev}
        <li>{when(ev.at)}: {ev.type === 'projectors-on' ? 'projectors on' : ev.type}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .sch-panel { display: flex; flex-direction: column; gap: 4px; }
  .sch-now {
    padding: 8px 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.3);
    font-size: 12px;
    color: var(--text-secondary, #aaa);
    margin: 4px 0 8px;
  }
  .sch-entry {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid #161618;
  }
  .sch-days { display: flex; gap: 2px; }
  .sch-day {
    font-size: 11px;
    padding: 4px 6px;
    border-radius: 4px;
    border: 1px solid #33333a;
    background: #09090c;
    color: #777;
    cursor: pointer;
  }
  .sch-day.on { color: #fff; border-color: #BB86FC; background: rgba(187, 134, 252, 0.18); }
  .sch-all { margin-left: 4px; color: #aaa; }
  .sch-time { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: #888; }
  .sch-note { flex: 1; min-width: 80px; }
  .sch-remove { background: none; border: none; color: #888; font-size: 16px; cursor: pointer; margin-left: auto; }
  .sch-remove:hover { color: #fff; }
  .sch-add {
    align-self: flex-start;
    margin: 6px 0;
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 4px;
    border: 1px solid #33333a;
    background: #15151b;
    color: #ddd;
    cursor: pointer;
  }
  .sch-inline { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #888; }
  .sch-inline input[type='number'] { width: 56px; }
  .sch-log { margin: 0; padding-left: 18px; font-size: 12px; color: #888; }
</style>
