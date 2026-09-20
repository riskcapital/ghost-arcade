import { get, writable } from 'svelte/store';
import type { CrossfaderTransition, VJClip, VJDeck, VJLayerState } from './vjClipLauncher';

export const VJ_CLIP_TRANSITION_STYLES: readonly CrossfaderTransition[] = [
  'dissolve', 'wipe', 'rgb-split', 'cube', 'shatter', 'halftone', 'glitch', 'liquid', 'strobe', 'slide',
];

export function normalizedTransitionDuration(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(10, value)) : fallback;
}

export function normalizedTransitionStyle(value: unknown, fallback: CrossfaderTransition = 'dissolve'): CrossfaderTransition {
  return VJ_CLIP_TRANSITION_STYLES.includes(value as CrossfaderTransition)
    ? value as CrossfaderTransition : fallback;
}

export function effectiveClipTransition(layer: Pick<VJLayerState, 'transitionDuration' | 'transitionStyle'>, clip: VJClip) {
  return {
    duration: normalizedTransitionDuration(clip.transitionDuration, normalizedTransitionDuration(layer.transitionDuration)),
    style: normalizedTransitionStyle(clip.transitionStyle, normalizedTransitionStyle(layer.transitionStyle)),
  };
}

export const vjClipTransitionKey = (deck: VJDeck, layerIndex: number) => `${deck}:${layerIndex}`;

/** Live-only state. Never attach this to the launcher: project saves and
 * output-window broadcasts must not contain retained DOM/GPU resources. */
export interface VJClipTransition {
  token: number;
  deck: VJDeck;
  layerIndex: number;
  outgoingClip: VJClip;
  incomingClipId: string;
  incomingSeekGeneration: number;
  duration: number;
  style: CrossfaderTransition;
  startedAtMs: number | null;
  requiresSnapshot: boolean;
  frozenSourceId?: string;
  queuedTriggerId?: string;
  preparedIncoming?: VJClip;
}

export function createVJClipTransitions() {
  const state = writable<ReadonlyMap<string, VJClipTransition>>(new Map());
  let nextToken = 0;
  let release: ((sourceId: string) => void) | null = null;

  const releaseIfUnused = (sourceId: string | undefined) => {
    if (sourceId && !Array.from(get(state).values()).some(entry => entry.frozenSourceId === sourceId)) release?.(sourceId);
  };
  const cancel = (deck: VJDeck, layerIndex: number, token?: number) => {
    const key = vjClipTransitionKey(deck, layerIndex);
    const current = get(state).get(key);
    if (token !== undefined && current?.token !== token) return false;
    if (!current) return false;
    state.update(entries => { const next = new Map(entries); next.delete(key); return next; });
    releaseIfUnused(current.frozenSourceId);
    return true;
  };

  return {
    subscribe: state.subscribe,
    setReleaseHandler(handler: (sourceId: string) => void) {
      release = handler;
      return () => { if (release === handler) release = null; };
    },
    setFrozenSource(deck: VJDeck, layerIndex: number, token: number, sourceId: string) {
      const key = vjClipTransitionKey(deck, layerIndex);
      const active = get(state).get(key);
      if (!active || active.token !== token || !active.requiresSnapshot) return false;
      state.update(entries => new Map(entries).set(key, { ...active, requiresSnapshot: false, frozenSourceId: sourceId }));
      releaseIfUnused(active.frozenSourceId);
      return true;
    },
    begin(deck: VJDeck, layerIndex: number, outgoing: VJClip | null, incoming: VJClip, duration: number, style: CrossfaderTransition, frozenSourceId?: string, queuedTriggerId?: string) {
      const key = vjClipTransitionKey(deck, layerIndex);
      const old = get(state).get(key);
      const returnsToWaitingOutgoing = old?.startedAtMs === null && !old.requiresSnapshot
        && !old.frozenSourceId && old.outgoingClip.id === incoming.id;
      if (!outgoing || outgoing.id === incoming.id || returnsToWaitingOutgoing || outgoing.type === 'preset' || incoming.type === 'preset' || normalizedTransitionDuration(duration) <= 0) {
        cancel(deck, layerIndex);
        releaseIfUnused(frozenSourceId);
        return null;
      }
      const entry: VJClipTransition = {
        token: ++nextToken, deck, layerIndex,
        // An unstarted fade has never shown its incoming clip: retain the
        // original picture when another trigger arrives before readiness.
        outgoingClip: { ...(old && old.startedAtMs === null && !old.requiresSnapshot ? old.outgoingClip : outgoing) },
        incomingClipId: incoming.id,
        incomingSeekGeneration: Math.max(0, Math.round(incoming._nativePlaybackSeekSeq ?? 0)),
        duration: normalizedTransitionDuration(duration), style: normalizedTransitionStyle(style),
        startedAtMs: null,
        ...(queuedTriggerId ? {queuedTriggerId,preparedIncoming:{...incoming}} : {}),
        requiresSnapshot: !!old && (old.startedAtMs !== null || old.requiresSnapshot || !!old.queuedTriggerId) && !frozenSourceId,
        ...(frozenSourceId ? { frozenSourceId } : old?.startedAtMs === null && old.frozenSourceId ? { frozenSourceId: old.frozenSourceId } : {}),
      };
      state.update(entries => new Map(entries).set(key, entry));
      releaseIfUnused(old?.frozenSourceId);
      return entry;
    },
    confirmScheduled(deck: VJDeck, layerIndex: number, token: number, nowMs: number) {
      const key=vjClipTransitionKey(deck,layerIndex), active=get(state).get(key);
      if (!active || active.token!==token || !active.queuedTriggerId || !Number.isFinite(nowMs)) return false;
      state.update(entries=>new Map(entries).set(key,{...active,queuedTriggerId:undefined,preparedIncoming:undefined,startedAtMs:nowMs}));
      return true;
    },
    markReady(deck: VJDeck, layerIndex: number, token: number, nowMs: number) {
      const key = vjClipTransitionKey(deck, layerIndex);
      const active = get(state).get(key);
      if (!active || active.token !== token || active.queuedTriggerId || active.requiresSnapshot || active.startedAtMs !== null || !Number.isFinite(nowMs)) return false;
      state.update(entries => new Map(entries).set(key, { ...active, startedAtMs: nowMs }));
      return true;
    },
    complete: cancel,
    cancel,
    clear() {
      const snapshots = new Set(Array.from(get(state).values()).flatMap(entry => entry.frozenSourceId ? [entry.frozenSourceId] : []));
      state.set(new Map());
      for (const sourceId of snapshots) releaseIfUnused(sourceId);
    },
    referencesClip(clipId: string) {
      return Array.from(get(state).values()).some(entry => !entry.frozenSourceId && entry.outgoingClip.id === clipId);
    },
  };
}

export const vjClipTransitions = createVJClipTransitions();
