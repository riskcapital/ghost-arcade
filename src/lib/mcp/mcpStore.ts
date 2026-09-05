import { writable, get } from 'svelte/store';
import { executeMcpTool } from './mcpTools';

/**
 * Enable/disable for the MCP server, and the bridge that answers tool calls.
 *
 * Off by default and never auto-enabled. An open port that can black out the
 * output mid-show is not something to switch on for someone because it might
 * be convenient; it should be a decision they made.
 */

const STORAGE_KEY = 'ghost-arcade_mcp';
const DEFAULT_PORT = 7420;

export interface McpState {
  enabled: boolean;
  running: boolean;
  port: number;
  /** Bearer token clients must send. Regenerated every time the server starts. */
  token: string | null;
  lastError: string | null;
  /** Rolling record of what has been called, so the user can see what an agent
   *  actually did rather than inferring it from the output changing. */
  recentCalls: Array<{ name: string; at: number; ok: boolean }>;
}

const INITIAL: McpState = {
  enabled: false,
  running: false,
  port: DEFAULT_PORT,
  token: null,
  lastError: null,
  recentCalls: [],
};

/** Enough to see a pattern, not enough to grow without bound. */
const MAX_RECENT_CALLS = 25;

function createMcpStore() {
  const { subscribe, update } = writable<McpState>({ ...INITIAL });
  let unsubscribeBridge: (() => void) | null = null;
  let initialized = false;

  function persist() {
    if (typeof localStorage === 'undefined') return;
    try {
      const s = get({ subscribe });
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: s.enabled, port: s.port }));
    } catch {
      // Not worth failing over; worst case it starts disabled next time.
    }
  }

  function attachBridge(api: any) {
    if (unsubscribeBridge) return;
    unsubscribeBridge = api.onToolCall(async ({ callId, name, args }: any) => {
      let ok = true;
      try {
        const result = await executeMcpTool(name, args || {});
        ok = !result.isError;
        api.respond({ callId, result });
      } catch (err) {
        ok = false;
        api.respond({ callId, error: (err as Error)?.message || String(err) });
      }
      update(s => ({
        ...s,
        recentCalls: [{ name, at: Date.now(), ok }, ...s.recentCalls].slice(0, MAX_RECENT_CALLS),
      }));
    });
  }

  return {
    subscribe,

    async initialize() {
      if (initialized) return;
      initialized = true;
      const api = (window as any).ghostMCP;
      if (!api) return;
      attachBridge(api);

      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
        if (saved && typeof saved === 'object') {
          update(s => ({
            ...s,
            enabled: typeof saved.enabled === 'boolean' ? saved.enabled : s.enabled,
            port: Number.isInteger(saved.port) ? saved.port : s.port,
          }));
        }
      } catch { /* ignore malformed state */ }

      if (get({ subscribe }).enabled) await this.start();
    },

    async start() {
      const api = (window as any).ghostMCP;
      if (!api) return;
      const s = get({ subscribe });
      const res = await api.start({ port: s.port });
      update(prev => ({
        ...prev,
        running: !!res?.ok,
        token: res?.token ?? null,
        port: res?.port ?? prev.port,
        lastError: res?.ok ? null : (res?.error ?? 'failed to start'),
      }));
    },

    async stop() {
      const api = (window as any).ghostMCP;
      if (!api) return;
      await api.stop();
      update(s => ({ ...s, running: false, token: null }));
    },

    async setEnabled(enabled: boolean) {
      update(s => ({ ...s, enabled }));
      persist();
      if (enabled) await this.start(); else await this.stop();
    },

    async setPort(port: number) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) return;
      update(s => ({ ...s, port }));
      persist();
      // Rebind so the change takes effect now rather than at next launch.
      if (get({ subscribe }).enabled) {
        await this.stop();
        await this.start();
      }
    },
  };
}

export const mcpStore = createMcpStore();
