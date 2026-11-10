<script lang="ts">
  /**
   * Settings > Show control > Installation. Machine-level, not saved with the
   * project: stored by the main process (electron/show-startup.cjs) and run by
   * electron/install-mode.cjs and lib/install/installRuntime.ts.
   */
  import { onDestroy, onMount } from 'svelte';
  import { refreshShowStartup, showStartupInfo, updateShowStartup, type ShowStartupConfig, type InstallPlaylistItem } from '../../show/showStartup';
  import { installScheduleState, normalizeInstallSchedule, WEEKDAY_NAMES, type InstallSchedule, type InstallDay } from '../../install/installSchedule';
  import { installPaused } from '../../install/installSession';

  type Invoke = (c: string, a?: unknown) => Promise<any>;
  const api = typeof window !== 'undefined' ? (window as unknown as { electronAPI?: { invoke: Invoke } }).electronAPI : undefined;
  const desktop = !!api;

  interface InstallStatus {
    active: boolean;
    paused: boolean;
    configured: boolean;
    uptimeMs: number;
    exitAccelerator: string;
    powerBlocker: boolean;
    guardian: { pid: number; alive: boolean } | null;
    heartbeat: { at: number; state?: string; show?: { playing: boolean; time: number; duration: number } | null; document?: string } | null;
    core: { pid: number; frames: number | null; at: number; ok: boolean } | null;
    restarts: { coreKills: number; reloads: number; relaunches: number; last: number | null };
    logFile: string;
    recent: Array<{ at: number; kind: string; message: string }>;
    wled: Array<{ controllerId: string; name: string; ip: string; port: number; state: string; lastError: string | null }>;
  }

  let error = $state('');
  let busy = $state(false);
  let status = $state<InstallStatus | null>(null);
  let now = $state(Date.now());
  const info = $derived($showStartupInfo);
  const config = $derived(info?.config ?? null);
  const schedule = $derived(normalizeInstallSchedule(config?.schedule));
  const playChoice = $derived(
    !config ? 'none'
      : config.autoStart === 'timeline' ? (config.document === 'timeline' ? 'timeline' : 'show')
      : config.autoStart,
  );
  const nextSwitch = $derived(schedule.enabled ? installScheduleState(schedule, now).next : null);
  const accelerator = $derived((status?.exitAccelerator ?? 'CommandOrControl+Alt+Shift+X')
    .replace('CommandOrControl', typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'Cmd' : 'Ctrl')
    .replace(/\+/g, ' + '));

  let poll: ReturnType<typeof setInterval> | null = null;
  async function refreshStatus() {
    if (!api) return;
    try { status = (await api.invoke('install_status')) as InstallStatus; } catch { status = null; }
    now = Date.now();
  }
  onMount(() => {
    if (!desktop) return;
    refreshShowStartup().catch((e) => (error = String(e?.message ?? e)));
    void refreshStatus();
    poll = setInterval(refreshStatus, 3000);
  });
  onDestroy(() => { if (poll) clearInterval(poll); });

  async function patch(p: Partial<ShowStartupConfig>) {
    busy = true;
    error = '';
    try {
      await updateShowStartup(p);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  function patchSchedule(p: Partial<InstallSchedule>) {
    void patch({ schedule: { ...schedule, ...p } });
  }
  function patchDay(i: number, p: Partial<InstallDay>) {
    const days = schedule.days.map((d, j) => (j === i ? { ...d, ...p } : d));
    patchSchedule({ days });
  }

  function setPlayChoice(value: string) {
    if (value === 'show' || value === 'timeline') void patch({ autoStart: 'timeline', document: value });
    else void patch({ autoStart: value as ShowStartupConfig['autoStart'] });
  }

  async function pickProject(title: string): Promise<string | null> {
    if (!api) return null;
    try {
      const r = (await api.invoke('open_project_dialog', { title })) as { canceled: boolean; filePath: string | null };
      return !r.canceled && r.filePath ? r.filePath : null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return null;
    }
  }
  async function browse() {
    const p = await pickProject('Project to open at start');
    if (p) await patch({ projectPath: p });
  }
  async function addPlaylistItem() {
    const p = await pickProject('Project to add to the playlist');
    if (p && config) await patch({ playlist: [...config.playlist, { path: p, document: config.document ?? 'show' }] });
  }
  function setPlaylist(list: InstallPlaylistItem[]) {
    void patch({ playlist: list });
  }
  function moveItem(i: number, d: number) {
    if (!config) return;
    const list = [...config.playlist];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setPlaylist(list);
  }

  async function leave() {
    if (!api) return;
    await api.invoke('install_leave').catch(() => {});
    installPaused.set(true);
    await refreshStatus();
  }

  function fileName(p: string) {
    return p.split(/[\\/]/).pop() || p;
  }
  function clock(ms: number) {
    const d = new Date(ms);
    return d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function duration(ms: number) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
  }
</script>

<div class="show-settings in-panel" data-install-settings>
  {#if !desktop}
    <p class="sc-hint">Install mode needs the desktop app.</p>
  {:else if !config}
    <p class="sc-hint">Loading…</p>
  {:else}
    {#if status?.active}
      <div class="in-banner on" data-install-banner>
        Install mode is running. To get out: press <kbd>{accelerator}</kbd> (this session), or switch Install mode off below (for good).
        <button onclick={leave} disabled={busy} data-install-leave>Leave for this session</button>
      </div>
    {:else if status?.paused || $installPaused}
      <div class="in-banner">Install mode was left for this session. It starts again at the next launch while the switch below is on.</div>
    {:else if info?.session.skipped}
      <div class="in-banner">This launch skipped install mode (--no-show-mode).</div>
    {/if}

    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Install mode</span>
        <span class="sc-hint">On every launch: open the project, put the outputs on their displays, play, and keep it running. No welcome, update, recovery or save dialogs. Takes effect at the next launch.</span>
      </div>
      <input type="checkbox" checked={config.showMode} disabled={busy} onchange={(e) => patch({ showMode: e.currentTarget.checked })} data-install-mode />
    </div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Start on login</span>
        <span class="sc-hint">
          Starts Ghost Arcade when this computer's user logs in. The computer must log in by itself after a restart: set that in the system settings.
          {#if info?.loginItem.simulated}(Development build: simulated, nothing is registered with the system.){/if}
          {#if info?.loginItem.file}Autostart entry: {info.loginItem.file}{/if}
        </span>
      </div>
      <input type="checkbox" checked={config.launchAtLogin} disabled={busy} onchange={(e) => patch({ launchAtLogin: e.currentTarget.checked })} data-install-login />
    </div>

    <div class="sc-sub">What plays</div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Play</span>
        <span class="sc-hint">The project's Show or Timeline, a playlist of projects, GO on the cue list, or nothing (leave it to the project's own cues).</span>
      </div>
      <select value={playChoice} disabled={busy} onchange={(e) => setPlayChoice(e.currentTarget.value)} data-install-play>
        <option value="show">Show</option>
        <option value="timeline">Timeline</option>
        <option value="playlist">Playlist</option>
        <option value="go">GO on the cue list</option>
        <option value="none">Nothing</option>
      </select>
    </div>
    {#if config.autoStart !== 'playlist'}
      <div class="sc-row">
        <div class="sc-label">
          <span class="sc-title">Project</span>
          <span class="sc-hint in-path" translate="no">{config.projectPath || 'None chosen'}</span>
        </div>
        <div class="in-buttons">
          <button onclick={browse} disabled={busy}>Choose…</button>
          {#if config.projectPath}<button onclick={() => patch({ projectPath: '' })} disabled={busy}>Clear</button>{/if}
        </div>
      </div>
    {:else}
      <div class="in-playlist" data-install-playlist>
        {#each config.playlist as item, i (i)}
          <div class="in-item">
            <span class="in-index">{i + 1}</span>
            <span class="in-path" title={item.path} translate="no">{fileName(item.path)}</span>
            <select value={item.document} disabled={busy} onchange={(e) => setPlaylist(config.playlist.map((x, j) => (j === i ? { ...x, document: e.currentTarget.value as InstallPlaylistItem['document'] } : x)))}>
              <option value="show">Show</option>
              <option value="timeline">Timeline</option>
            </select>
            <button onclick={() => moveItem(i, -1)} disabled={busy || i === 0} aria-label="Move up">↑</button>
            <button onclick={() => moveItem(i, 1)} disabled={busy || i === config.playlist.length - 1} aria-label="Move down">↓</button>
            <button onclick={() => setPlaylist(config.playlist.filter((_, j) => j !== i))} disabled={busy} aria-label="Remove">✕</button>
          </div>
        {:else}
          <p class="sc-hint">No projects yet. Each plays once, then the next; after the last, the first again.</p>
        {/each}
        <div class="in-buttons"><button onclick={addPlaylistItem} disabled={busy}>Add project…</button></div>
      </div>
    {/if}
    {#if playChoice === 'show' || playChoice === 'timeline'}
      <div class="sc-row">
        <div class="sc-label"><span class="sc-title">Loop</span></div>
        <input type="checkbox" checked={config.loopShow} disabled={busy} onchange={(e) => patch({ loopShow: e.currentTarget.checked })} />
      </div>
      <div class="sc-row">
        <div class="sc-label">
          <span class="sc-title">After a restart</span>
          <span class="sc-hint">"By the clock": the loop carries on where it would be had it never stopped. A playlist always restarts the item it was on.</span>
        </div>
        <select value={config.resume} disabled={busy} onchange={(e) => patch({ resume: e.currentTarget.value as ShowStartupConfig['resume'] })}>
          <option value="clock">Resume by the clock</option>
          <option value="start">Start from the beginning</option>
        </select>
      </div>
    {/if}
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Open the outputs</span>
        <span class="sc-hint">Every Screen set to a display opens fullscreen on it (and reopens if its display comes back); with none, the output opens fullscreen.</span>
      </div>
      <input type="checkbox" checked={config.openOutputs} disabled={busy} onchange={(e) => patch({ openOutputs: e.currentTarget.checked })} />
    </div>

    <div class="sc-sub">Daily schedule</div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">On and off times</span>
        <span class="sc-hint">Off: the show stops, the outputs and LEDs go black, and the projectors switch off if set below. Off time before the on time runs past midnight. Without a schedule the installation is always on.</span>
      </div>
      <input type="checkbox" checked={schedule.enabled} disabled={busy} onchange={(e) => patchSchedule({ enabled: e.currentTarget.checked })} data-install-schedule />
    </div>
    {#if schedule.enabled}
      <div class="in-days">
        {#each schedule.days as day, i (i)}
          <label class="in-day">
            <input type="checkbox" checked={day.enabled} disabled={busy} onchange={(e) => patchDay(i, { enabled: e.currentTarget.checked })} />
            <span class="in-dayname">{WEEKDAY_NAMES[i]}</span>
          </label>
          <input type="time" value={day.on} disabled={busy || !day.enabled} onchange={(e) => patchDay(i, { on: e.currentTarget.value })} aria-label="On time" />
          <input type="time" value={day.off} disabled={busy || !day.enabled} onchange={(e) => patchDay(i, { off: e.currentTarget.value })} aria-label="Off time" />
        {/each}
      </div>
      {#if nextSwitch}
        <p class="sc-hint">Next: {nextSwitch.on ? 'on' : 'off'} at {clock(nextSwitch.at)}.</p>
      {/if}
      <div class="sc-row">
        <div class="sc-label">
          <span class="sc-title">Switch the projectors on and off</span>
          <span class="sc-hint">Over PJLink, every projector in Settings > Projectors.</span>
        </div>
        <input type="checkbox" checked={schedule.projectorPower} disabled={busy} onchange={(e) => patchSchedule({ projectorPower: e.currentTarget.checked })} />
      </div>
      {#if schedule.projectorPower}
        <div class="sc-row">
          <div class="sc-label">
            <span class="sc-title">Warm-up</span>
            <span class="sc-hint">Seconds between switching the projectors on and starting the show. Skipped when they already report on.</span>
          </div>
          <input type="number" min="0" max="600" value={schedule.warmupSeconds} disabled={busy} onchange={(e) => patchSchedule({ warmupSeconds: Number(e.currentTarget.value) })} />
        </div>
      {/if}
      <div class="sc-row">
        <div class="sc-label"><span class="sc-title">Shutter</span><span class="sc-hint">Open at the start, close at the end.</span></div>
        <input type="checkbox" checked={schedule.shutter} disabled={busy} onchange={(e) => patchSchedule({ shutter: e.currentTarget.checked })} />
      </div>
    {/if}

    <div class="sc-sub">Keeping it running</div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Watchdog</span>
        <span class="sc-hint">Restarts the render core, the editor or the whole app when one stops or hangs, a few times an hour at most, and resumes the show.</span>
      </div>
      <input type="checkbox" checked={config.watchdog} disabled={busy} onchange={(e) => patch({ watchdog: e.currentTarget.checked })} />
    </div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Start again after a crash</span>
        <span class="sc-hint">A small helper process starts the app again if it disappears without quitting.</span>
      </div>
      <input type="checkbox" checked={config.relaunchOnCrash} disabled={busy} onchange={(e) => patch({ relaunchOnCrash: e.currentTarget.checked })} />
    </div>
    <div class="sc-row">
      <div class="sc-label"><span class="sc-title">Hide the mouse pointer on the outputs</span></div>
      <input type="checkbox" checked={config.hideCursor} disabled={busy} onchange={(e) => patch({ hideCursor: e.currentTarget.checked })} />
    </div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Quitting</span>
        <span class="sc-hint">Shutting down or restarting the computer is never blocked.</span>
      </div>
      <select value={config.quitProtection} disabled={busy} onchange={(e) => patch({ quitProtection: e.currentTarget.value as ShowStartupConfig['quitProtection'] })}>
        <option value="confirm">Ask first</option>
        <option value="combo">Only after the exit key combo</option>
      </select>
    </div>
    <div class="sc-row">
      <div class="sc-label">
        <span class="sc-title">Suppress prompts</span>
        <span class="sc-hint">Alerts become notifications; confirmations answer no.</span>
      </div>
      <input type="checkbox" checked={config.suppressPrompts} disabled={busy} onchange={(e) => patch({ suppressPrompts: e.currentTarget.checked })} />
    </div>

    <div class="sc-sub">Status</div>
    {#if status}
      <div class="in-status" data-install-status>
        <div><span>Install mode</span><b>{status.active ? `running for ${duration(status.uptimeMs)}` : status.paused ? 'left for this session' : 'off this launch'}</b></div>
        <div><span>Sleep prevention</span><b class:bad={!status.powerBlocker}>{status.powerBlocker ? 'active' : 'not active'}</b></div>
        {#if status.active}
          <div><span>Crash helper</span><b class:bad={!!status.guardian && !status.guardian.alive}>{status.guardian ? (status.guardian.alive ? 'watching' : 'gone') : 'off'}</b></div>
          <div><span>Installation</span><b>{status.heartbeat?.state ?? '…'}</b></div>
          {#if status.heartbeat?.show}
            <div><span>{status.heartbeat.document === 'timeline' ? 'Timeline' : 'Show'}</span><b>{status.heartbeat.show.playing ? 'playing' : 'stopped'} {status.heartbeat.show.time.toFixed(0)} / {status.heartbeat.show.duration.toFixed(0)} s</b></div>
          {/if}
          <div><span>Render core</span><b class:bad={!!status.core && !status.core.ok}>{status.core ? `${status.core.ok ? 'answering' : 'not answering'}, frame ${status.core.frames ?? '?'}` : '…'}</b></div>
          <div><span>Restarts (recent)</span><b>core {status.restarts.coreKills}, editor {status.restarts.reloads}, app {status.restarts.relaunches}</b></div>
        {/if}
        {#each status.wled as link (link.controllerId)}
          <div><span translate="no">LED {link.name}</span><b class:bad={link.state === 'down'}>{link.state}{link.state === 'down' && link.lastError ? ` (${link.lastError})` : ''}</b></div>
        {/each}
      </div>
      {#if status.recent.length}
        <div class="in-log" translate="no">
          {#each status.recent.slice().reverse() as entry, i (i)}
            <div><span>{new Date(entry.at).toLocaleTimeString()}</span> <em>{entry.kind}</em> {entry.message}</div>
          {/each}
        </div>
      {/if}
      <div class="in-buttons"><button onclick={() => api?.invoke('install_reveal_log')}>Show the health log</button></div>
      <p class="sc-hint in-path" translate="no">{status.logFile}</p>
    {/if}
  {/if}
  {#if error}<p class="in-error">{error}</p>{/if}
</div>

<style>
  .in-panel { display: flex; flex-direction: column; gap: 4px; }
  .in-panel :global(.sc-row) { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); }
  .in-panel :global(.sc-label) { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .in-panel :global(.sc-title) { font-size: var(--ga-text-body, 13px); font-weight: var(--ga-weight-body, 500); color: var(--ga-ink-0, #eee); }
  .in-panel :global(.sc-hint) { font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--ga-ink-2, #777); }
  .in-panel :global(.sc-sub) { margin: 16px 0 4px; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); color: var(--ga-ink-2, #9a9aa6); }
  select, input[type='time'], input[type='number'] {
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    font-size: var(--ga-text-control, 12px);
    background: rgba(255, 255, 255, 0.04);
    color: var(--ga-ink-0, #ddd);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    padding: 0 6px;
  }
  input[type='number'] { width: 80px; }
  .in-banner {
    padding: 8px 10px;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid rgba(240, 198, 116, 0.4);
    background: rgba(240, 198, 116, 0.08);
    color: #f0c674;
    font-size: var(--ga-text-control, 12px);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .in-banner kbd { font-family: var(--ga-font-mono, ui-monospace, monospace); }
  .in-path { word-break: break-all; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .in-buttons { display: flex; gap: 6px; }
  button {
    height: var(--ga-control-h, 26px);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 4px);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: rgba(255, 255, 255, 0.04);
    color: var(--ga-ink-0, #ddd);
    cursor: pointer;
  }
  button:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  button:disabled { opacity: 0.45; cursor: default; }
  .in-playlist { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; }
  .in-item { display: flex; align-items: center; gap: 6px; }
  .in-item .in-path { flex: 1; min-width: 0; font-size: var(--ga-text-control, 12px); color: var(--ga-ink-0, #ddd); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .in-index { width: 18px; color: var(--ga-ink-2, #777); font-size: var(--ga-text-meta, 11px); }
  .in-days { display: grid; grid-template-columns: 1fr auto auto; gap: 6px 10px; align-items: center; padding: 8px 0; }
  .in-day { display: flex; align-items: center; gap: 8px; font-size: var(--ga-text-control, 12px); color: var(--ga-ink-0, #ddd); }
  .in-status { display: grid; grid-template-columns: 1fr; gap: 4px; font-size: var(--ga-text-control, 12px); }
  .in-status > div { display: flex; justify-content: space-between; gap: 12px; color: var(--ga-ink-2, #888); }
  .in-status b { color: var(--ga-ink-0, #ddd); font-weight: 500; text-align: right; }
  .in-status b.bad { color: #ff8a80; }
  .in-log {
    max-height: 180px;
    overflow: auto;
    margin: 8px 0;
    padding: 6px 8px;
    border-radius: var(--ga-r-hard, 4px);
    background: rgba(0, 0, 0, 0.25);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 11px;
    line-height: 1.5;
    color: var(--ga-ink-1, #bbb);
  }
  .in-log span { color: var(--ga-ink-2, #777); }
  .in-log em { color: #f0c674; font-style: normal; }
  .in-error { color: #ff8a80; font-size: var(--ga-text-control, 12px); }
</style>
