/**
 * PJLink projectors: the list the operator adds in Settings, their polled
 * status, and the one entry point cues and the scheduler use to command them.
 *
 * The TCP work lives in the main process (electron/pjlink.cjs, reached over
 * the `pjlink_command` IPC). The transport is injectable so tests can point
 * the same store at the Node client and a fake projector.
 *
 * Saved with the project, like WLED controllers: a projector belongs to the
 * rig the show was programmed for. The password is stored in the project
 * file in the clear, which is all PJLink's own MD5 scheme protects anyway.
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
  password: string;
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
}

export interface ProjectorsState {
  projectors: Projector[];
  status: Record<string, ProjectorStatus>;
  pollSeconds: number;
  polling: boolean;
}

export type PjlinkAction = ProjectorCommand | 'status';

export interface PjlinkRequest {
  host: string;
  port: number;
  password: string;
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
  };
}

function initialState(): ProjectorsState {
  return { projectors: [], status: {}, pollSeconds: PROJECTOR_POLL_DEFAULT_SECONDS, polling: false };
}

export function normalizeProjector(raw: unknown, index = 0): Projector | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const port = Math.round(Number(r.port));
  return {
    id: typeof r.id === 'string' && r.id ? r.id : generateUUID(),
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : `Projector ${index + 1}`,
    host: typeof r.host === 'string' ? r.host.trim() : '',
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : PJLINK_DEFAULT_PORT,
    password: typeof r.password === 'string' ? r.password : '',
    enabled: r.enabled !== false,
  };
}

const store = writable<ProjectorsState>(initialState());
let pollTimer: ReturnType<typeof setInterval> | null = null;

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
    return await t({ host: projector.host, port: projector.port, password: projector.password, action, input });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const projectors = {
  subscribe: store.subscribe,

  add(init: Partial<Projector> = {}): string {
    const s = get(store);
    const p = normalizeProjector({ ...init, id: undefined }, s.projectors.length)!;
    store.update((x) => ({ ...x, projectors: [...x.projectors, p] }));
    return p.id;
  },

  update(id: string, patch: Partial<Omit<Projector, 'id'>>): void {
    store.update((s) => ({
      ...s,
      projectors: s.projectors.map((p, i) => (p.id === id ? normalizeProjector({ ...p, ...patch, id }, i) ?? p : p)),
    }));
  },

  remove(id: string): void {
    store.update((s) => {
      const status = { ...s.status };
      delete status[id];
      return { ...s, projectors: s.projectors.filter((p) => p.id !== id), status };
    });
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

  serialize(): { version: number; projectors: Projector[]; pollSeconds: number } {
    const s = get(store);
    return { version: 1, projectors: s.projectors.map((p) => ({ ...p })), pollSeconds: s.pollSeconds };
  },

  hydrate(payload: unknown): void {
    const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const list = (Array.isArray(p.projectors) ? p.projectors : [])
      .map((raw, i) => normalizeProjector(raw, i))
      .filter((x): x is Projector => x !== null);
    const poll = Number(p.pollSeconds);
    const wasPolling = get(store).polling;
    store.set({
      projectors: list,
      status: {},
      pollSeconds: Number.isFinite(poll) ? Math.max(5, Math.min(3600, Math.round(poll))) : PROJECTOR_POLL_DEFAULT_SECONDS,
      polling: false,
    });
    if (wasPolling) this.startPolling();
  },

  _resetForTest(): void {
    this.stopPolling();
    transport = null;
    store.set(initialState());
  },
};
