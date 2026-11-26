/**
 * Signed app-code updates, as the main process reports them
 * (electron/updates/code-update.cjs). Only the desktop app has them; in a
 * browser every call is a no-op and the store stays null.
 */
import { writable, get } from 'svelte/store';
import { getElectronApi } from '../bridge';

export interface CodeUpdateStatus {
  enabled: boolean;
  shellId: string | null;
  builtinVersion: string;
  codeVersion: string;
  source: 'builtin' | 'update';
  pending: string | null;
  previous: string | null;
  bad: string[];
  latest: {
    version: string;
    /** The release's notes (markdown), for the update modal. */
    notes: string;
    installable: boolean;
    /** Why it cannot install: 'needs-full-download', 'no-code-update', 'failed-before', … */
    reason: string | null;
    size: number | null;
    installed: boolean;
  } | null;
  progress: { version: string; received: number; total: number } | null;
  installing: boolean;
  lastError: string | null;
  /** This run gave an update up because it did not start (to: null = the built-in code). */
  rolledBack: { from: string; to: string | null } | null;
  bootEvents: string[];
}

export const codeUpdate = writable<CodeUpdateStatus | null>(null);

const api = getElectronApi;

async function call(command: string): Promise<CodeUpdateStatus | null> {
  const a = api();
  if (!a) return null;
  try {
    const status = (await a.invoke(command)) as CodeUpdateStatus | null;
    if (status && typeof status === 'object') codeUpdate.set(status);
    return status ?? null;
  } catch (err) {
    console.warn(`[CodeUpdate] ${command} failed:`, err);
    return null;
  }
}

export const refreshCodeUpdate = () => call('code_update_status');
export const checkCodeUpdate = () => call('code_update_check');
export const revertCodeUpdate = () => call('code_update_revert');
export const cancelCodeUpdate = () => call('code_update_cancel');

/** The editor is up: an installed update counts as started (see the rollback in main). */
export function signalCodeReady(): void {
  void call('code_update_ready');
}

/** Download, check and unpack the update; resolves when it is ready to load (or failed). */
export async function installCodeUpdate(): Promise<CodeUpdateStatus | null> {
  const a = api();
  if (!a) return null;
  const off = a.on?.('code-update-progress', (progress: CodeUpdateStatus['progress']) => {
    const current = get(codeUpdate);
    if (current) codeUpdate.set({ ...current, installing: true, progress });
  });
  const current = get(codeUpdate);
  if (current) codeUpdate.set({ ...current, installing: true, lastError: null });
  try {
    return await call('code_update_install');
  } finally {
    off?.();
  }
}

/** Quit (unsaved work still asks) and start again on the installed update. */
export async function restartForCodeUpdate(): Promise<void> {
  const a = api();
  if (!a) return;
  try { await a.invoke('code_update_restart'); } catch (err) { console.warn('[CodeUpdate] restart failed:', err); }
}

/** "84 MB" for a byte count. */
export function formatMegabytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '';
  return `${Math.max(1, Math.round(bytes / 1048576))} MB`;
}
