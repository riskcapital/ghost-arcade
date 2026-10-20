/**
 * Ableton bridge — mirrors the Live set and fires linked visuals.
 *
 *  - Ghost Arcade's Live control surface (ableton/GhostArcade) reports the
 *    set and every launch over loopback UDP; Electron main forwards each
 *    batch through `window.ghostAbleton.onMessage`.
 *  - The set is mirrored here: scenes, tracks, clip names and colours, and
 *    which slots are playing or queued.
 *  - Links (src/lib/ableton/abletonLinks.ts) pair a scene or clip with a VJ
 *    column, clip or snapshot. They fire the moment Live launches, not on
 *    Ghost Arcade's own launch quantize, because Live has already waited
 *    for the bar.
 *
 * Links are saved with the project (exportProject / importProject in
 * src/lib/stores/layers.ts).
 */

import { get, writable } from 'svelte/store';
import { generateUUID } from '../utils/uuid';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { snapshots } from '../stores/snapshots';
import {
  linksForClip,
  linksForScene,
  positionFallback,
  relink,
  samePlace,
  sanitizeLinks,
  type AbletonLink,
  type AbletonSource,
  type LiveScene,
  type LiveTrack,
  type VisualAction,
} from './abletonLinks';

/** No heartbeat for this long means Live (or the script) went away. */
const CONNECTION_TIMEOUT_MS = 3500;
/** Track messages for one set arrive as a burst; relink once it settles. */
const RELINK_DELAY_MS = 150;

export interface ScriptStatus {
  installed: boolean;
  current: boolean;
  path: string;
  libraryFound: boolean;
  available: boolean;
}

export interface AbletonBridgeState {
  /** Start the listener with the project (saved). */
  enabled: boolean;
  links: AbletonLink[];
  // Runtime only.
  listening: boolean;
  error: string | null;
  connected: boolean;
  tempo: number;
  numerator: number;
  denominator: number;
  playing: boolean;
  quantize: number;
  scenes: LiveScene[];
  tracks: LiveTrack[];
  /** Links that match nothing in the current set. */
  missing: string[];
  /** Last time each link fired (performance.now()), for the UI flash. */
  fired: Record<string, number>;
  /** Live's song position (beats) at `clockAt` (performance.now()). */
  clockBeat: number;
  clockAt: number;
  /** Recent launches, newest first, for the activity strip. */
  activity: { text: string; at: number }[];
  script: ScriptStatus | null;
}

/** Live's song position now, run forward from the last report. */
export function songBeat(state: AbletonBridgeState, now = performance.now()): number {
  if (!state.playing) return state.clockBeat;
  return state.clockBeat + ((now - state.clockAt) / 1000) * (state.tempo / 60);
}

const INITIAL: AbletonBridgeState = {
  enabled: false,
  links: [],
  listening: false,
  error: null,
  connected: false,
  tempo: 120,
  numerator: 4,
  denominator: 4,
  playing: false,
  quantize: 4,
  scenes: [],
  tracks: [],
  missing: [],
  fired: {},
  clockBeat: 0,
  clockAt: 0,
  activity: [],
  script: null,
};

const ACTIVITY_LENGTH = 8;

type LiveMessage = Record<string, any> & { t: string };

const api = () => (typeof window !== 'undefined' ? (window as any).ghostAbleton : undefined);

function createAbletonBridge() {
  const store = writable<AbletonBridgeState>({ ...INITIAL });
  const { subscribe, update } = store;
  const read = () => get(store);

  let unsubscribeMessages: (() => void) | null = null;
  let unsubscribeStatus: (() => void) | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  let relinkTimer: ReturnType<typeof setTimeout> | null = null;
  let lastHello = 0;
  /** Scene and track counts the links were last resolved against. */
  let linkedCounts: { scenes: number; tracks: number } | null = null;
  /** Scenes whose trigger cleared in the batch being handled. */
  let launchedScenes: number[] = [];
  let sceneQueuedInBatch = false;

  function send(message: LiveMessage) {
    void api()?.send(message);
  }

  function runAction(action: VisualAction) {
    if (action.kind === 'column') vjClipLauncher.triggerColumnNow(action.column, action.deck);
    else if (action.kind === 'clip') vjClipLauncher.triggerClipNow(action.layer, action.column, action.deck);
    else snapshots.recall(action.slot);
  }

  function fire(links: AbletonLink[], label: string) {
    const { missing } = read();
    const live = links.filter(link => !missing.includes(link.id));
    if (!live.length) return;
    for (const link of live) runAction(link.action);
    const now = performance.now();
    update(s => ({
      ...s,
      fired: { ...s.fired, ...Object.fromEntries(live.map(l => [l.id, now])) },
      activity: [{ text: label, at: now }, ...s.activity].slice(0, ACTIVITY_LENGTH),
    }));
  }

  function sceneLabel(index: number) {
    return read().scenes[index]?.name || `Scene ${index + 1}`;
  }

  function scheduleRelink() {
    if (relinkTimer) clearTimeout(relinkTimer);
    relinkTimer = setTimeout(() => {
      relinkTimer = null;
      update(s => {
        const counts = { scenes: s.scenes.length, tracks: s.tracks.length };
        const { links, missing } = relink(s.links, s.scenes, s.tracks, positionFallback(linkedCounts, counts));
        linkedCounts = counts;
        return { ...s, links, missing };
      });
    }, RELINK_DELAY_MS);
  }

  function setTrack(index: number, patch: Partial<LiveTrack>) {
    update(s => {
      if (!s.tracks[index]) return s;
      const tracks = s.tracks.slice();
      tracks[index] = { ...tracks[index], ...patch };
      return { ...s, tracks };
    });
  }

  function handle(message: LiveMessage) {
    if (typeof message.beat === 'number' && Number.isFinite(message.beat)) {
      const beat = message.beat;
      update(s => ({ ...s, clockBeat: beat, clockAt: performance.now() }));
    }
    switch (message.t) {
      case 'hello': {
        const wasConnected = read().connected;
        lastHello = performance.now();
        update(s => ({
          ...s,
          connected: true,
          tempo: Number(message.tempo) || s.tempo,
          numerator: Number(message.num) || s.numerator,
          denominator: Number(message.den) || s.denominator,
          playing: !!message.playing,
          quantize: Number.isInteger(message.quantize) ? message.quantize : s.quantize,
        }));
        if (!wasConnected) send({ t: 'sync' });
        break;
      }
      case 'bye':
        lastHello = 0;
        update(s => ({ ...s, connected: false }));
        break;
      case 'set': {
        const scenes: LiveScene[] = (Array.isArray(message.scenes) ? message.scenes : []).map((scene: any, index: number) => ({
          name: String(scene?.n ?? ''),
          color: Number(scene?.c) || 0,
          queued: read().scenes[index]?.queued ?? false,
        }));
        const count = Math.max(0, Number(message.tracks) || 0);
        update(s => ({
          ...s,
          scenes,
          tracks: Array.from({ length: count }, (_, i) => s.tracks[i]
            ?? { name: '', color: 0, slots: [], playing: -1, fired: -1, startedBeat: 0, firedBeat: 0 }),
        }));
        scheduleRelink();
        break;
      }
      case 'track': {
        const index = Number(message.i);
        if (!Number.isInteger(index)) break;
        setTrack(index, {
          name: String(message.n ?? ''),
          color: Number(message.c) || 0,
          slots: (Array.isArray(message.slots) ? message.slots : []).map((slot: any) =>
            Array.isArray(slot) ? { name: String(slot[0] ?? ''), color: Number(slot[1]) || 0, length: Number(slot[2]) || 4 } : null),
          playing: Number(message.play) >= 0 ? Number(message.play) : -1,
          fired: Number(message.fired) >= 0 ? Number(message.fired) : -1,
        });
        scheduleRelink();
        break;
      }
      case 'play': {
        const track = Number(message.i);
        const slot = Number(message.s) >= 0 ? Number(message.s) : -1;
        setTrack(track, { playing: slot, fired: -1, startedBeat: read().clockBeat });
        if (slot >= 0) {
          const t = read().tracks[track];
          fire(linksForClip(read().links, track, slot), `${t?.name || `Track ${track + 1}`} · ${t?.slots[slot]?.name || 'Clip'}`);
        }
        break;
      }
      case 'fired': {
        setTrack(Number(message.i), { fired: Number(message.s) >= 0 ? Number(message.s) : -1, firedBeat: read().clockBeat });
        break;
      }
      case 'scene': {
        const index = Number(message.s);
        if (!read().scenes[index]) break;
        const queued = !!message.trig;
        update(s => {
          const scenes = s.scenes.slice();
          scenes[index] = { ...scenes[index], queued };
          return { ...s, scenes };
        });
        // Live clears the trigger the moment the scene launches. With the
        // transport stopped it launches at once and only the clear arrives.
        if (queued) sceneQueuedInBatch = true;
        else launchedScenes.push(index);
        break;
      }
    }
  }

  async function startListener() {
    const bridge = api();
    if (!bridge) return;
    const result = await bridge.start();
    update(s => ({ ...s, listening: !!result?.ok, error: result?.ok ? null : result?.error ?? null }));
    if (result?.ok) send({ t: 'sync' });
  }

  async function stopListener() {
    await api()?.stop();
    lastHello = 0;
    update(s => ({ ...s, listening: false, connected: false }));
  }

  return {
    subscribe,

    initialize() {
      const bridge = api();
      if (!bridge || unsubscribeMessages) return;
      unsubscribeMessages = bridge.onMessage((messages: LiveMessage[]) => {
        launchedScenes = [];
        sceneQueuedInBatch = false;
        for (const message of messages) {
          if (message && typeof message.t === 'string') handle(message);
        }
        // A trigger that clears while another scene queues was replaced,
        // not launched.
        if (!sceneQueuedInBatch) {
          for (const scene of launchedScenes) fire(linksForScene(read().links, scene), sceneLabel(scene));
        }
      });
      unsubscribeStatus = bridge.onStatus((status: { listening: boolean; error: string | null }) => {
        update(s => ({ ...s, listening: status.listening, error: status.error, connected: status.listening && s.connected }));
      });
      watchdog = setInterval(() => {
        if (read().connected && performance.now() - lastHello > CONNECTION_TIMEOUT_MS) {
          update(s => ({ ...s, connected: false }));
        }
      }, 1000);
    },

    destroy() {
      unsubscribeMessages?.();
      unsubscribeStatus?.();
      unsubscribeMessages = unsubscribeStatus = null;
      if (watchdog) clearInterval(watchdog);
      if (relinkTimer) clearTimeout(relinkTimer);
      watchdog = relinkTimer = null;
    },

    /** Turn the bridge on for this project and start listening. */
    async enable() {
      update(s => ({ ...s, enabled: true }));
      if (!read().listening) await startListener();
    },

    async disable() {
      update(s => ({ ...s, enabled: false }));
      await stopListener();
    },

    resync() {
      send({ t: 'sync' });
    },

    async refreshScript() {
      const script = await api()?.scriptStatus();
      if (script) update(s => ({ ...s, script }));
      return script as ScriptStatus | undefined;
    },

    async installScript(chooseFolder = false) {
      const result = await api()?.installScript({ chooseFolder });
      await this.refreshScript();
      return result as { ok: boolean; path?: string; error?: string; canceled?: boolean } | undefined;
    },

    revealScript() {
      void api()?.revealScript();
    },

    /** Launch in Live. */
    launchScene(scene: number) {
      send({ t: 'fire_scene', s: scene });
    },
    launchClip(track: number, slot: number) {
      send({ t: 'fire_clip', i: track, s: slot });
    },
    /** Live's transport. */
    play() {
      send({ t: read().clockBeat > 0 ? 'continue' : 'play' });
    },
    stop() {
      send({ t: 'stop' });
    },
    stopAllClips() {
      send({ t: 'stop_all' });
    },
    stopTrack(track: number) {
      send({ t: 'stop_track', i: track });
    },

    /** Run a link's visual now, as if Live had launched it. */
    preview(link: AbletonLink) {
      runAction(link.action);
      update(s => ({ ...s, fired: { ...s.fired, [link.id]: performance.now() } }));
    },

    addLink(source: AbletonSource, action: VisualAction) {
      const link: AbletonLink = { id: generateUUID(), source, action };
      update(s => ({ ...s, links: [...s.links, link], missing: s.missing.filter(id => id !== link.id) }));
      return link;
    },

    removeLink(id: string) {
      update(s => ({ ...s, links: s.links.filter(l => l.id !== id), missing: s.missing.filter(m => m !== id) }));
    },

    /** Remove every link on one scene or clip. */
    clearSource(source: AbletonSource) {
      update(s => ({ ...s, links: s.links.filter(l => !samePlace(l.source, source)) }));
    },

    /** Scene N launches VJ column N on `deck`, for every scene that fits in
     *  the clip grid. Replaces those scenes' existing links. */
    linkScenesToColumns(deck: 'A' | 'B' = 'A') {
      const columns = get(vjClipLauncher).numColumns;
      update(s => {
        const count = Math.min(s.scenes.length, columns);
        const kept = s.links.filter(l => l.source.kind !== 'scene' || l.source.scene >= count);
        const added: AbletonLink[] = Array.from({ length: count }, (_, scene) => ({
          id: generateUUID(),
          source: { kind: 'scene', scene, name: s.scenes[scene].name },
          action: { kind: 'column', deck, column: scene },
        }));
        return { ...s, links: [...kept, ...added] };
      });
    },

    /** Mirror the Live grid onto deck `deck`: track N clip M launches VJ
     *  layer N column M, wherever both exist. Replaces those clips' links. */
    linkTracksToLayers(deck: 'A' | 'B' = 'A') {
      const launcher = get(vjClipLauncher);
      const grid = deck === 'B' ? launcher.bankBClipGrid : launcher.clipGrid;
      update(s => {
        const added: AbletonLink[] = [];
        s.tracks.forEach((track, t) => track.slots.forEach((clip, slot) => {
          if (!clip || !grid[t]?.[slot]) return;
          added.push({
            id: generateUUID(),
            source: { kind: 'clip', track: t, slot, trackName: track.name, name: clip.name },
            action: { kind: 'clip', deck, layer: t, column: slot },
          });
        }));
        const kept = s.links.filter(l => !added.some(a => samePlace(a.source, l.source)));
        return { ...s, links: [...kept, ...added] };
      });
    },

    hydrate(raw: unknown) {
      const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<AbletonBridgeState>;
      linkedCounts = null;
      update(s => ({ ...s, enabled: !!saved.enabled, links: sanitizeLinks(saved.links), missing: [], fired: {} }));
      if (read().scenes.length || read().tracks.length) scheduleRelink();
      if (saved.enabled && !read().listening) void startListener();
    },

    serialize() {
      const { enabled, links } = read();
      return { enabled, links };
    },

    reset() {
      linkedCounts = null;
      update(s => ({ ...s, enabled: false, links: [], missing: [], fired: {} }));
    },
  };
}

export const abletonBridge = createAbletonBridge();
