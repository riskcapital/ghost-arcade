/**
 * PJLink projectors: the list the operator adds in Settings, their polled
 * status, and the one entry point cues and the scheduler use to command them.
 *
 * The TCP work lives in the main process (electron/pjlink.cjs, reached over
 * the `pjlink_command` IPC). The transport is injectable so tests can point
 * the same store at the Node client and a fake projector.
 *
 * Saved with the project, like WLED controllers: a projector belongs to the
 * rig the show was programmed for. Its PASSWORD is not: projects are shared
 * between machines and people, so the secret lives in the main process's
 * credential store (electron/pjlink-credentials.cjs, encrypted with
 * safeStorage), keyed by projector id. The project only records
 * `hasPassword`. Commands send the projector id and the main process looks
 * the password up; it never comes back to this side.
 *
 * Projects saved before this carried `password` in the clear. Loading one
 * moves each password into the store and strips it (see `hydrate`).
 */

import { writable, get } from 'svelte/store';
import { generateUUID } from '../utils/uuid';
import type { ProjectorCommand } from './cueList';

export const PJLINK_DEFAULT_PORT = 4352;
export const PROJECTOR_POLL_DEFAULT_SECONDS = 30;

export interface Projector {
  id: string;
  name: string;
  host: string;
  port: number;
  /** A password is stored for this projector (on the machine that set it). */
  hasPassword: boolean;
  enabled: boolean;
}

export type ProjectorPower = 'off' | 'on' | 'cooling' | 'warming' | 'unknown';

export interface ProjectorStatus {
  online: boolean;
  power: ProjectorPower;
  shutter: 'open' | 'closed' | 'unknown';
  input: string | null;
  errors: Record<string, string> | null;
  lampHours: number | null;
  reportedName: string | null;
  lastError: string | null;
  polledAt: number | null;
  /** Result of the last command sent from a cue, the scheduler or a button. */
  lastCommand: { action: string; ok: boolean; error: string | null; at: number } | null;
  /** The password is only held for this session (no secure storage). */
  passwordSessionOnly: boolean;
  /** The project says there is a password but this computer has none. */
  passwordMissing: boolean;
  /** Storing or moving the password failed. */
  credentialError: string | null;
}

export interface ProjectorsState {
  projectors: Projector[];
  status: Record<string, ProjectorStatus>;
  pollSeconds: number;
  polling: boolean;
}

export type PjlinkAction = ProjectorCommand | 'status';

export interface PjlinkRequest {
  /** The main process finds the password by this id. */
  projectorId: string;
  host: string;
  port: number;
  action: PjlinkAction;
  input?: string;
  timeoutMs?: number;
}

export interface PjlinkResult {
  ok: boolean;
  authenticated?: boolean;
  error?: string | null;
  sessionError?: string | null;
  responses?: Array<{ command: string | null; ok: boolean; value: string | null; error: string | null }>;
  status?: {
    power: ProjectorPower;
    shutter: 'open' | 'closed' | 'unknown';
    input: string | null;
    errors: Record<string, string> | null;
    lampHours: number | null;
    name: string | null;
  };
}

export type PjlinkTransport = (request: PjlinkRequest) => Promise<PjlinkResult>;

function defaultTransport(): PjlinkTransport | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { invoke?: (c: string, a: unknown) => Promise<unknown> } }).electronAPI;
  if (!api?.invoke) return null;
  return (request) => api.invoke!('pjlink_command', request) as Promise<PjlinkResult>;
}

let transport: PjlinkTransport | null = null;

export function setPjlinkTransport(next: PjlinkTransport | null): void {
  transport = next;
}

function currentTransport(): PjlinkTransport | null {
  return transport ?? defaultTransport();
}

/** The machine's password store, as the renderer sees it: write and ask,
 *  never read. */
export interface ProjectorCredentialStore {
  set(projectorId: string, password: string): Promise<{ ok: boolean; persisted: boolean; error?: string }>;
  has(projectorId: string): Promise<{ ok: boolean; has: boolean; persisted: boolean }>;
}

function defaultCredentialStore(): ProjectorCredentialStore | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { invoke?: (c: string, a: unknown) => Promise<unknown> } }).electronAPI;
  if (!api?.invoke) return null;
  return {
    set: (projectorId, password) => api.invoke!('pjlink_set_password', { projectorId, password }) as Promise<{ ok: boolean; persisted: boolean; error?: string }>,
    has: (projectorId) => api.invoke!('pjlink_has_password', { projectorId }) as Promise<{ ok: boolean; has: boolean; persisted: boolean }>,
  };
}

let credentialStore: ProjectorCredentialStore | null = null;

export function setProjectorCredentialStore(next: ProjectorCredentialStore | null): void {
  credentialStore = next;
}

function currentCredentialStore(): ProjectorCredentialStore | null {
  return credentialStore ?? defaultCredentialStore();
}

/** Legacy passwords that could not be moved into the store yet, by id. Kept
 *  in memory only, so a retry does not need the old project file. */
const pendingLegacyPasswords = new Map<string, string>();
let settling: Promise<void> = Promise.resolve();

function emptyStatus(): ProjectorStatus {
  return {
    online: false,
    power: 'unknown',
    shutter: 'unknown',
    input: null,
    errors: null,
    lampHours: null,
    reportedName: null,
    lastError: null,
    polledAt: null,
    lastCommand: null,
    passwordSessionOnly: false,
    passwordMissing: false,
    credentialError: null,
  };
}

function initialState(): ProjectorsState {
  return { projectors: [], status: {}, pollSeconds: PROJECTOR_POLL_DEFAULT_SECONDS, polling: false };
}

/**
 * A projector from any source. Accepts the legacy `password` field and hands
 * it back separately so the caller can move it into the store; the returned
 * projector never holds a secret.
 */
export function normalizeProjectorWithLegacy(raw: unknown, index = 0): { projector: Projector; legacyPassword: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const port = Math.round(Number(r.port));
  const legacyPassword = typeof r.password === 'string' ? r.password : '';
  return {
    projector: {
      id: typeof r.id === 'string' && r.id ? r.id : generateUUID(),
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `Projector ${index + 1}`,
      host: typeof r.host === 'string' ? r.host.trim() : '',
      port: Number.isFinite(port) && port > 0 && port < 65536 ? port : PJLINK_DEFAULT_PORT,
      hasPassword: r.hasPassword === true,
      enabled: r.enabled !== false,
    },
    legacyPassword,
  };
}

export function normalizeProjector(raw: unknown, index = 0): Projector | null {
  return normalizeProjectorWithLegacy(raw, index)?.projector ?? null;
}

const store = writable<ProjectorsState>(initialState());
let pollTimer: ReturnType<typeof setInterval> | null = null;

function setHasPassword(id: string, hasPassword: boolean): void {
  store.update((s) => ({
    ...s,
    projectors: s.projectors.map((p) => (p.id === id ? { ...p, hasPassword } : p)),
  }));
}

function setStatus(id: string, patch: Partial<ProjectorStatus>): void {
  store.update((s) => ({
    ...s,
    status: { ...s.status, [id]: { ...(s.status[id] ?? emptyStatus()), ...patch } },
  }));
}

async function send(projector: Projector, action: PjlinkAction, input = ''): Promise<PjlinkResult> {
  const t = currentTransport();
  if (!t) return { ok: false, error: 'projector control needs the desktop app' };
  if (!projector.host) return { ok: false, error: 'no address' };
  try {
    return await t({ projectorId: projector.id, host: projector.host, port: projector.port, action, input });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const projectors = {
  subscribe: store.subscribe,

  add(init: Partial<Omit<Projector, 'hasPassword'>> = {}): string {
    const s = get(store);
    const p = normalizeProjector({ ...init, id: undefined, hasPassword: false }, s.projectors.length)!;
    store.update((x) => ({ ...x, projectors: [...x.projectors, p] }));
    return p.id;
  },

  /** Edit the projector's saved fields. `hasPassword` only changes through
   *  setPassword, which is what actually stores one. */
  update(id: string, patch: Partial<Omit<Projector, 'id' | 'hasPassword'>>): void {
    store.update((s) => ({
      ...s,
      projectors: s.projectors.map((p, i) => {
        if (p.id !== id) return p;
        const { hasPassword: _ignored, ...rest } = patch as Partial<Projector>;
        return normalizeProjector({ ...p, ...rest, id, hasPassword: p.hasPassword }, i) ?? p;
      }),
    }));
  },

  /**
   * Store this projector's password on this computer (an empty string
   * deletes it). Resolves with whether it will survive a restart.
   */
  async setPassword(id: string, password: string): Promise<{ ok: boolean; persisted: boolean; error?: string }> {
    const creds = currentCredentialStore();
    if (!creds) {
      const error = 'passwords need the desktop app';
      setStatus(id, { credentialError: error });
      return { ok: false, persisted: false, error };
    }
    let result: { ok: boolean; persisted: boolean; error?: string };
    try {
      result = await creds.set(id, password);
    } catch (err) {
      result = { ok: false, persisted: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) {
      pendingLegacyPasswords.delete(id);
      setHasPassword(id, !!password);
      setStatus(id, {
        credentialError: null,
        passwordMissing: false,
        passwordSessionOnly: !!password && !result.persisted,
      });
    } else {
      setStatus(id, { credentialError: `Could not store the password: ${result.error ?? 'unknown error'}` });
    }
    return result;
  },

  /** Try again to move a legacy project password into the store. */
  async retryPasswordMigration(id: string): Promise<boolean> {
    const pw = pendingLegacyPasswords.get(id);
    if (pw === undefined) return false;
    return (await this.setPassword(id, pw)).ok;
  },

  remove(id: string): void {
    const had = get(store).projectors.find((p) => p.id === id)?.hasPassword;
    pendingLegacyPasswords.delete(id);
    store.update((s) => {
      const status = { ...s.status };
      delete status[id];
      return { ...s, projectors: s.projectors.filter((p) => p.id !== id), status };
    });
    // Best effort: do not leave a secret behind for a projector that is gone.
    if (had) void currentCredentialStore()?.set(id, '').catch(() => {});
  },

  get(id: string): Projector | undefined {
    return get(store).projectors.find((p) => p.id === id);
  },

  /** Projectors a target names: one id, or '*' for every enabled one. */
  resolve(target: string): Projector[] {
    const list = get(store).projectors;
    if (target === '*' || !target) return list.filter((p) => p.enabled);
    return list.filter((p) => p.id === target);
  },

  /**
   * Send an action to one projector or all of them ('*'). Resolves once
   * every projector has answered (or failed); never throws.
   */
  async command(target: string, action: ProjectorCommand, input = ''): Promise<PjlinkResult[]> {
    const list = this.resolve(target);
    return Promise.all(list.map(async (p) => {
      const result = await send(p, action, input);
      setStatus(p.id, {
        lastCommand: { action, ok: !!result.ok, error: result.error ?? null, at: Date.now() },
        ...(result.sessionError || (!result.ok && !result.responses?.length)
          ? { online: false, lastError: result.error ?? 'no reply' }
          : { online: true }),
        ...(result.ok && action === 'power-on' ? { power: 'warming' as const } : {}),
        ...(result.ok && action === 'power-off' ? { power: 'cooling' as const } : {}),
        ...(result.ok && action === 'shutter-close' ? { shutter: 'closed' as const } : {}),
        ...(result.ok && action === 'shutter-open' ? { shutter: 'open' as const } : {}),
      });
      return result;
    }));
  },

  async poll(id?: string): Promise<void> {
    const list = get(store).projectors.filter((p) => p.enabled && p.host && (!id || p.id === id));
    await Promise.all(list.map(async (p) => {
      const result = await send(p, 'status');
      if (!result.ok || !result.status) {
        setStatus(p.id, { online: false, lastError: result.error ?? 'no reply', polledAt: Date.now() });
        return;
      }
      setStatus(p.id, {
        online: true,
        power: result.status.power,
        shutter: result.status.shutter,
        input: result.status.input,
        errors: result.status.errors,
        lampHours: result.status.lampHours,
        reportedName: result.status.name,
        lastError: null,
        polledAt: Date.now(),
      });
    }));
  },

  setPollSeconds(seconds: number): void {
    const v = Math.max(5, Math.min(3600, Math.round(Number(seconds) || PROJECTOR_POLL_DEFAULT_SECONDS)));
    store.update((s) => ({ ...s, pollSeconds: v }));
    if (get(store).polling) this.startPolling();
  },

  startPolling(): void {
    if (pollTimer) clearInterval(pollTimer);
    store.update((s) => ({ ...s, polling: true }));
    void this.poll();
    pollTimer = setInterval(() => void this.poll(), get(store).pollSeconds * 1000);
  },

  stopPolling(): void {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    store.update((s) => ({ ...s, polling: false }));
  },

  /** Project payload. Never carries a password, only `hasPassword`. */
  serialize(): { version: number; projectors: Projector[]; pollSeconds: number } {
    const s = get(store);
    return {
      version: 2,
      projectors: s.projectors.map((p) => ({
        id: p.id,
        name: p.name,
        host: p.host,
        port: p.port,
        hasPassword: p.hasPassword,
        enabled: p.enabled,
      })),
      pollSeconds: s.pollSeconds,
    };
  },

  /**
   * Project open. Legacy `password` fields are moved into this computer's
   * store and dropped; `hasPassword` turns true only once the store has
   * taken the password, so a failed move never claims a password exists.
   * Projectors that say they have a password are checked against the store
   * and flagged when this computer does not have it (a project from
   * another machine). Idempotent: loading the same file twice stores the
   * same password under the same id.
   */
  hydrate(payload: unknown): void {
    const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const legacy: Array<[string, string]> = [];
    const list: Projector[] = [];
    (Array.isArray(p.projectors) ? p.projectors : []).forEach((raw, i) => {
      const n = normalizeProjectorWithLegacy(raw, i);
      if (!n) return;
      if (n.legacyPassword) {
        legacy.push([n.projector.id, n.legacyPassword]);
        n.projector.hasPassword = false;
      }
      list.push(n.projector);
    });
    const poll = Number(p.pollSeconds);
    const wasPolling = get(store).polling;
    pendingLegacyPasswords.clear();
    store.set({
      projectors: list,
      status: {},
      pollSeconds: Number.isFinite(poll) ? Math.max(5, Math.min(3600, Math.round(poll))) : PROJECTOR_POLL_DEFAULT_SECONDS,
      polling: false,
    });
    for (const [id, pw] of legacy) pendingLegacyPasswords.set(id, pw);
    const legacyIds = new Set(legacy.map(([id]) => id));
    settling = Promise.all([
      ...legacy.map(([id, pw]) => this.setPassword(id, pw).then(() => undefined)),
      ...list
        .filter((x) => x.hasPassword && !legacyIds.has(x.id))
        .map(async (x) => {
          const creds = currentCredentialStore();
          if (!creds) return;
          try {
            const r = await creds.has(x.id);
            setStatus(x.id, { passwordMissing: !r.has, passwordSessionOnly: r.has && !r.persisted });
          } catch {
            /* unknown: say nothing rather than something wrong */
          }
        }),
    ]).then(() => undefined);
    if (wasPolling) this.startPolling();
  },

  /** Resolves when the last hydrate's password moves and checks are done. */
  whenCredentialsSettled(): Promise<void> {
    return settling;
  },

  _resetForTest(): void {
    this.stopPolling();
    transport = null;
    credentialStore = null;
    pendingLegacyPasswords.clear();
    settling = Promise.resolve();
    store.set(initialState());
  },
};
