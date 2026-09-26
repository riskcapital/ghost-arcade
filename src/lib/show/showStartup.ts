/**
 * Show mode and start-at-boot, renderer side.
 *
 * The config lives in the main process (electron/show-startup.cjs) because
 * it belongs to the machine, not to a project. What THIS launch does is read
 * synchronously from the preload (`window.ghostShowStartup.session`), so the
 * app can skip its first-run prompts before it draws them.
 *
 * In show mode the app, on launch: opens the chosen project, opens the
 * outputs fullscreen, starts the show (GO on the cue list, or plays the show
 * timeline), and never puts a blocking prompt in front of the audience:
 * no welcome, crash-recovery, update or unsaved-changes dialogs, and
 * alert() / confirm() become log lines (confirm answers "no").
 */

import { writable } from 'svelte/store';

export type ShowAutoStart = 'none' | 'go' | 'timeline';

export interface ShowStartupConfig {
  launchAtLogin: boolean;
  showMode: boolean;
  projectPath: string;
  openOutputs: boolean;
  autoStart: ShowAutoStart;
  suppressPrompts: boolean;
}

export interface ShowStartupInfo {
  config: ShowStartupConfig;
  loginItem: { enabled: boolean; simulated: boolean };
  session: { showMode: boolean; skipped: boolean };
}

function readSession(): ShowStartupInfo | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { ghostShowStartup?: { session?: ShowStartupInfo | null } }).ghostShowStartup;
  return bridge?.session ?? null;
}

/** Captured once at module load: the launch-time answer. */
const launchInfo = readSession();

/** True when this launch is running in show mode. */
export function isShowModeLaunch(): boolean {
  return !!launchInfo?.session.showMode;
}

/** True when show mode is on and prompts are suppressed for it. */
export function promptsSuppressed(): boolean {
  return isShowModeLaunch() && launchInfo!.config.suppressPrompts !== false;
}

export function launchConfig(): ShowStartupConfig | null {
  return launchInfo?.config ?? null;
}

export const showStartupInfo = writable<ShowStartupInfo | null>(launchInfo);

type Invoke = (command: string, args?: unknown) => Promise<unknown>;
function invoker(): Invoke | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { invoke?: Invoke } }).electronAPI;
  return api?.invoke ?? null;
}

export async function refreshShowStartup(): Promise<ShowStartupInfo | null> {
  const invoke = invoker();
  if (!invoke) return null;
  const info = (await invoke('show_startup_get')) as ShowStartupInfo;
  showStartupInfo.set(info);
  return info;
}

export async function updateShowStartup(patch: Partial<ShowStartupConfig>): Promise<ShowStartupInfo | null> {
  const invoke = invoker();
  if (!invoke) return null;
  const info = (await invoke('show_startup_set', patch)) as ShowStartupInfo;
  showStartupInfo.set(info);
  return info;
}

/**
 * Replace alert() and confirm() with non-blocking versions for the rest of
 * the session. A modal alert on an unattended machine freezes the show
 * until someone walks up to it.
 */
export function installPromptSuppression(notify?: (message: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;
  window.alert = (message?: unknown) => {
    console.warn('[ShowMode] suppressed alert:', message);
    try { notify?.(String(message ?? '')); } catch { /* ignore */ }
  };
  window.confirm = (message?: string) => {
    console.warn('[ShowMode] suppressed confirm (answered no):', message);
    return false;
  };
  return () => {
    window.alert = originalAlert;
    window.confirm = originalConfirm;
  };
}

export interface ShowModeDeps {
  /** Open a project file by path; resolves true on success. */
  openProject(path: string): Promise<boolean>;
  /** Open the outputs fullscreen if they are not already. */
  openOutputs(): Promise<void>;
  go(): void;
  playTimeline(): void;
  log?(message: string): void;
}

/**
 * The show-mode launch sequence. Each step is independent: a missing
 * project still opens the outputs, and a failed output still starts the
 * show, because a half-working install beats a stuck one.
 */
export async function runShowModeLaunch(config: ShowStartupConfig, deps: ShowModeDeps): Promise<string[]> {
  const steps: string[] = [];
  const log = (m: string) => {
    steps.push(m);
    deps.log?.(m);
  };
  if (config.projectPath) {
    try {
      const ok = await deps.openProject(config.projectPath);
      log(ok ? `opened ${config.projectPath}` : `could not open ${config.projectPath}`);
    } catch (err) {
      log(`could not open ${config.projectPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
    // The project's show-control and timeline sections restore on a
    // microtask after import; let them land before starting anything.
    await new Promise((r) => setTimeout(r, 250));
  }
  if (config.openOutputs) {
    try {
      await deps.openOutputs();
      log('outputs open');
    } catch (err) {
      log(`outputs failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (config.autoStart === 'go') {
    deps.go();
    log('GO');
  } else if (config.autoStart === 'timeline') {
    deps.playTimeline();
    log('timeline playing');
  }
  return steps;
}
