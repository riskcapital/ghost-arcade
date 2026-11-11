/**
 * Install mode, editor side: runs an unattended installation.
 *
 * Started once by App.svelte when this launch is in show mode. It:
 *   - opens the chosen project (or the playlist's current item)
 *   - runs the daily schedule (installRunner.ts): outputs, projectors over
 *     PJLink, blackout, LEDs, show start and stop
 *   - starts the show where it should be (installResume.ts) and restarts it
 *     if it stopped by itself; advances a playlist at each item's end
 *   - opens every Screen set to a display on that display, and reopens one
 *     that closed (a projector that dropped its signal while off)
 *   - sends a heartbeat to the main process's watchdog every two seconds,
 *     carrying the show's anchor so a restart resumes at the right point
 *   - writes schedule events to the health log
 *
 * The show is played through installTransport.ts, never through a
 * document's internal tracks.
 */

import { get } from 'svelte/store';
import { invoke, isDesktopApp } from '../bridge';
import { InstallRunner } from './installRunner';
import { installScheduleState, normalizeInstallSchedule, type InstallSchedule } from './installSchedule';
import { chooseAnchor, nextPlaylistIndex, periodKeyFor, resumePlaylistIndex, resumePosition, type InstallAnchor } from './installResume';
import { installTransport, type InstallDocument } from './installTransport';
import { installPaused } from './installSession';
import { showStartupInfo, type ShowStartupConfig } from '../show/showStartup';
import { cueList } from '../show/cueList';
import { projectors } from '../show/projectors';
import { setBlackout } from '../show/showControlRuntime';
import { setWLEDForceBlack } from '../wled/sender';
import { screens } from '../stores/screens';
import { resolveStoredDisplay, type DisplayInfo } from '../output/displayAssignment';

export interface InstallAppDeps {
  openProject(path: string): Promise<boolean>;
  /** Open the output window fullscreen (used when no Screen is set to a display). */
  openMainOutput(): Promise<void>;
  notify?(message: string): void;
}

function sendLog(kind: string, message: string): void {
  console.log(`[Install] ${kind}: ${message}`);
  if (isDesktopApp) invoke('install_log', { kind, message }).catch(() => {});
}

/** Open every enabled Screen that targets a connected display and is not open yet. */
let screensInFlight: Promise<{ opened: string[]; expected: number }> | null = null;

/** One at a time: two checks at once both saw a Screen closed and opened it twice (a flash). */
export function openInstallScreens(): Promise<{ opened: string[]; expected: number }> {
  if (!screensInFlight) screensInFlight = openScreensNow().finally(() => { screensInFlight = null; });
  return screensInFlight;
}

async function openScreensNow(): Promise<{ opened: string[]; expected: number }> {
  const wanted = get(screens).filter((s) => s.enabled && (s.targetType ?? 'sender') === 'display' && s.displayId != null);
  if (!wanted.length) return { opened: [], expected: 0 };
  const displays = ((await invoke('get_displays').catch(() => [])) as DisplayInfo[]) || [];
  const open = new Set(((await invoke('output_list_slice_windows').catch(() => [])) as string[]) || []);
  const opened: string[] = [];
  for (const s of wanted) {
    if (open.has(s.id)) continue;
    const target = resolveStoredDisplay(displays, s.displayId, s.displayFingerprint ?? null);
    // Its display is not connected (yet): try again at the next check.
    if (!target) continue;
    const r = (await invoke('output_open_slice_window', { sliceId: s.id, displayId: target.id }).catch((e) => ({ ok: false, error: String(e) }))) as { ok: boolean; error?: string };
    if (r?.ok) opened.push(s.name || s.id);
    else sendLog('outputs', `Screen ${s.name || s.id} did not open: ${r?.error ?? 'unknown error'}`);
  }
  if (opened.length && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('ghost:slice-windows-changed'));
  return { opened, expected: wanted.length };
}

function projectorsAreOn(): boolean {
  const s = get(projectors);
  const live = s.projectors.filter((p) => p.enabled && p.host);
  return live.length > 0 && live.every((p) => s.status[p.id]?.power === 'on');
}

function describeSchedule(s: InstallSchedule): string {
  if (!s.enabled) return 'no schedule (always on)';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return s.days.map((d, i) => `${names[i]} ${d.enabled ? `${d.on}-${d.off}` : 'off'}`).join(', ')
    + (s.projectorPower ? `; projectors on/off, warm-up ${s.warmupSeconds} s` : '')
    + (s.shutter ? '; shutter' : '');
}

export function startInstallRuntime(initial: ShowStartupConfig, deps: InstallAppDeps): () => void {
  let config = initial;
  let stopped = false;
  let projectPath = initial.projectPath;
  let playlistIndex = 0;
  let document: InstallDocument = initial.document ?? 'show';
  let anchorMs: number | null = null;
  let periodKey = 'always';
  let playlistBusy = false;
  let notPlayingSince = 0;
  /** The current playlist item has played: stopping now means it ended. */
  let itemPlayed = false;
  let lastScheduleText = describeSchedule(normalizeInstallSchedule(initial.schedule));
  const timers: Array<ReturnType<typeof setInterval>> = [];
  /** Bumped by every stop: a start still waiting on a load is then dropped. */
  let generation = 0;
  /** The document the show was started on (stopped at the off time whatever Play says now). */
  let startedDocument: InstallDocument | null = null;
  /** "follows timecode" was logged (not again every few seconds). */
  let followLogged = false;
  const cleanups: Array<() => void> = [];

  const schedule = () => normalizeInstallSchedule(config.schedule);
  const playsDocument = () => config.autoStart === 'timeline' || config.autoStart === 'playlist';

  // Settings edits while running: the runner reads the live config.
  cleanups.push(showStartupInfo.subscribe((info) => {
    if (!info?.config) return;
    config = info.config;
    const text = describeSchedule(normalizeInstallSchedule(config.schedule));
    if (text !== lastScheduleText) {
      lastScheduleText = text;
      sendLog('schedule', `schedule changed: ${text}`);
    }
  }));

  async function openOutputs(): Promise<void> {
    if (!config.openOutputs) return;
    const { opened, expected } = await openInstallScreens();
    if (expected === 0) await deps.openMainOutput();
    else if (opened.length) sendLog('outputs', `opened ${opened.join(', ')}`);
  }

  async function loadPlaylistItem(index: number): Promise<boolean> {
    const item = config.playlist[index];
    if (!item) return false;
    playlistIndex = index;
    itemPlayed = false;
    document = item.document;
    projectPath = item.path;
    const ok = await deps.openProject(item.path).catch(() => false);
    sendLog('playlist', `${ok ? 'playing' : 'could not open'} item ${index + 1} of ${config.playlist.length}: ${item.path} (${item.document})`);
    await new Promise((r) => setTimeout(r, 250));
    return ok;
  }

  async function startShow(periodStart: number): Promise<void> {
    // A switch-off or leaving install mode while this waits calls it off.
    const gen = generation;
    const current = () => !stopped && gen === generation;
    const s = schedule();
    periodKey = periodKeyFor(s.enabled, periodStart);
    if (config.autoStart === 'go') {
      cueList.go();
      return;
    }
    if (!playsDocument()) return;
    const t = await installTransport();
    if (!current()) return;
    if (t.controllable && !t.controllable(document)) {
      if (!followLogged) sendLog('show', 'the show follows timecode; not starting it here');
      followLogged = true;
      return;
    }
    followLogged = false;
    const stored = (await invoke('install_anchor').catch(() => null)) as InstallAnchor | null;
    if (!current()) return;
    startedDocument = document;
    if (config.autoStart === 'playlist') {
      t.setActiveDocument(document);
      t.setLoop(document, false);
      t.seek(document, 0);
      t.play(document);
      anchorMs = Date.now();
      return;
    }
    t.setActiveDocument(document);
    t.setLoop(document, config.loopShow);
    const st = t.state(document);
    const anchor = chooseAnchor({
      stored,
      projectPath,
      periodKey,
      periodStart,
      scheduleEnabled: s.enabled,
      warmupMs: s.projectorPower ? s.warmupSeconds * 1000 : 0,
    });
    const pos = resumePosition({ mode: config.resume, anchorMs: anchor, now: Date.now(), duration: st.duration, loop: config.loopShow });
    t.seek(document, pos);
    t.play(document);
    anchorMs = Date.now() - pos * 1000;
    sendLog('show', `${document} playing from ${pos.toFixed(1)} s of ${st.duration.toFixed(1)} s${pos > 0 ? ' (resumed by the clock)' : ''}`);
  }

  async function stopShow(): Promise<void> {
    generation++;
    cueList.stop();
    // The document this started, even if Play was set to Nothing or GO since.
    const doc = startedDocument ?? (playsDocument() ? document : null);
    startedDocument = null;
    if (doc) {
      const t = await installTransport();
      t.stop(doc);
    }
    anchorMs = null;
  }

  async function keepShowRunning(periodStart: number): Promise<void> {
    if (!playsDocument() || playlistBusy) return;
    const t = await installTransport();
    const st = t.state(document);
    if (st.playing) {
      notPlayingSince = 0;
      itemPlayed = true;
      // Keep the anchor true to the playhead (seeks, audio-clock drift),
      // choosing the one nearest the last so a loop wrap does not move it.
      if (st.duration > 0) {
        const raw = Date.now() - st.time * 1000;
        const period = st.duration * 1000;
        const k = anchorMs === null || !st.loop ? 0 : Math.round((anchorMs - raw) / period);
        const next = raw + k * period;
        if (anchorMs === null || Math.abs(next - anchorMs) > 1500) anchorMs = next;
      }
      return;
    }
    // An item that does not loop ends by stopping (at its end, or rewound).
    // Following timecode: the clock starts and stops it, not this.
    if (t.controllable && !t.controllable(document)) {
      notPlayingSince = 0;
      return;
    }
    if (config.autoStart === 'playlist' && (itemPlayed || (st.duration > 0 && st.time >= st.duration - 0.05))) {
      playlistBusy = true;
      const gen = generation;
      try {
        const next = nextPlaylistIndex(playlistIndex, config.playlist.length);
        if (await loadPlaylistItem(next) && !stopped && gen === generation) await startShow(periodStart);
      } finally {
        playlistBusy = false;
      }
      return;
    }
    if (!notPlayingSince) notPlayingSince = Date.now();
    // A playlist item with nothing to play (missing file, empty document) is skipped.
    if (config.autoStart === 'playlist' && config.playlist.length > 1 && Date.now() - notPlayingSince > 10_000) {
      notPlayingSince = 0;
      itemPlayed = true;
      return;
    }
    if (Date.now() - notPlayingSince > 5000 && st.duration > 0) {
      notPlayingSince = 0;
      sendLog('show', `${document} had stopped; starting it again`);
      await startShow(periodStart);
    }
  }

  const runner = new InstallRunner(schedule, {
    openOutputs,
    projector: (command) => projectors.command('*', command),
    projectorsAreOn,
    setBlackout,
    setLedsBlack: (on) => setWLEDForceBlack(on),
    startShow,
    stopShow: () => { void stopShow(); },
    keepShowRunning: (p) => { void keepShowRunning(p); },
    log: (m) => sendLog('schedule', m),
  });

  async function boot(): Promise<void> {
    // Left install mode (the key combo) before this page was listening: stay out.
    const st0 = (await invoke('install_status').catch(() => null)) as { active?: boolean; paused?: boolean } | null;
    if (st0 && st0.paused) {
      stop();
      installPaused.set(true);
      return;
    }
    if (stopped) return;
    const stored = (await invoke('install_anchor').catch(() => null)) as InstallAnchor | null;
    const s = schedule();
    sendLog('start', `editor ready; ${describeSchedule(s)}; then: ${config.autoStart}${playsDocument() ? ` (${config.autoStart === 'playlist' ? `${config.playlist.length} items` : document})` : ''}`);
    if (config.autoStart === 'playlist' && config.playlist.length) {
      const st = installScheduleState(s, Date.now());
      const key = periodKeyFor(s.enabled, st.window?.start ?? 0);
      await loadPlaylistItem(resumePlaylistIndex(stored, config.playlist.length, key));
    } else if (config.projectPath) {
      const ok = await deps.openProject(config.projectPath).catch(() => false);
      sendLog('start', ok ? `opened ${config.projectPath}` : `could not open ${config.projectPath}`);
      // The project's show sections restore on a microtask after import.
      await new Promise((r) => setTimeout(r, 250));
    }
    if (stopped) return;
    runner.tick();
    timers.push(setInterval(() => { if (!stopped) runner.tick(); }, 1000));
    // A Screen whose display went away (a projector powered off) comes back.
    timers.push(setInterval(() => {
      if (!stopped && runner.current === 'on' && config.openOutputs) void openInstallScreens().then(({ opened }) => {
        if (opened.length) sendLog('outputs', `reopened ${opened.join(', ')}`);
      });
    }, 15_000));
  }

  async function heartbeat(): Promise<void> {
    if (stopped) return;
    let show: { playing: boolean; time: number; duration: number } | null = null;
    if (playsDocument()) {
      try { show = (await installTransport()).state(document); } catch { show = null; }
    }
    const anchor: InstallAnchor | null = anchorMs === null ? null : {
      anchorMs,
      periodKey,
      projectPath,
      ...(config.autoStart === 'playlist' ? { playlistIndex } : {}),
    };
    invoke('install_heartbeat', { state: runner.current, document, show, anchor, playlistIndex }).catch(() => {});
  }

  if (isDesktopApp) {
    heartbeat();
    timers.push(setInterval(() => { void heartbeat(); }, 2000));
    const api = (window as unknown as { electronAPI?: { on?: (ch: string, cb: (...a: unknown[]) => void) => (() => void) | void } }).electronAPI;
    const offPause = api?.on?.('install-mode-paused', () => {
      stop();
      installPaused.set(true);
      setWLEDForceBlack(false);
      deps.notify?.('Install mode is off for this session. Settings > Show control > Installation turns it off for good.');
    });
    if (typeof offPause === 'function') cleanups.push(offPause);
    const offRefused = api?.on?.('install-mode-quit-refused', () => {
      deps.notify?.('Install mode: press Cmd/Ctrl + Alt + Shift + X to leave install mode before quitting.');
    });
    if (typeof offRefused === 'function') cleanups.push(offRefused);
  }
  void boot();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    generation++;
    for (const t of timers) clearInterval(t);
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* ignore */ }
    }
  }
  return stop;
}
