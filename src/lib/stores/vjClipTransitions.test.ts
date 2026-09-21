import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { VJClip } from './vjClipLauncher';
import { createVJClipTransitions, effectiveClipTransition, normalizedTransitionDuration } from './vjClipTransitions';

const clip = (id: string): VJClip => ({ id, name: id, type: 'video', src: `/show/${id}.mp4`, _nativePlaybackSeekSeq: 7 });

describe('VJ clip transition lifecycle', () => {
  it('publishes a three-row column together when readiness replies arrive out of order', () => {
    const store = createVJClipTransitions();
    const entries = [0, 1, 2].map(row => store.begin('A', row, clip(`old-${row}`), clip(`new-${row}`),
      1, 'dissolve', undefined, undefined, 42)!);
    const seen: Array<Array<number | null>> = [];
    const unsubscribe = store.subscribe(state => seen.push([...state.values()].map(entry => entry.startedAtMs)));
    expect(store.markReady('A', 2, entries[2].token, 100)).toBe(false);
    expect(store.markReady('A', 0, entries[0].token, 110)).toBe(false);
    expect(seen).toEqual([[null, null, null]]);
    expect(store.markReady('A', 1, entries[1].token, 120)).toBe(true);
    expect(seen).toEqual([[null, null, null], [120, 120, 120]]);
    unsubscribe();
  });

  it('does not let an old column readiness reply start a replacement or block surviving rows', () => {
    const store = createVJClipTransitions();
    const a = store.begin('A', 0, clip('a'), clip('b'), 1, 'wipe', undefined, undefined, 1)!;
    const b = store.begin('A', 1, clip('c'), clip('d'), 1, 'wipe', undefined, undefined, 1)!;
    store.markReady('A', 0, a.token, 10);
    const replacement = store.begin('A', 1, clip('d'), clip('e'), 1, 'wipe')!;
    expect(store.markReady('A', 1, b.token, 20)).toBe(false);
    expect(store.markReady('A', 0, a.token, 20)).toBe(true);
    expect(get(store).get('A:1')?.startedAtMs).toBeNull();
    expect(store.markReady('A', 1, replacement.token, 30)).toBe(true);
  });

  it('holds a queued fade until its native receipt and protects a replacement', () => {
    const store=createVJClipTransitions();
    const entry=store.begin('A',0,clip('a'),{...clip('b'),isPlaying:false},1,'dissolve',undefined,'queued-1')!;
    expect(entry.preparedIncoming?.isPlaying).toBe(false);
    expect(store.markReady('A',0,entry.token,100)).toBe(false);
    expect(store.confirmScheduled('A',0,entry.token,80)).toBe(true);
    expect(get(store).get('A:0')).toMatchObject({startedAtMs:80,queuedTriggerId:undefined,preparedIncoming:undefined});
    const next=store.begin('A',0,clip('b'),clip('c'),1,'wipe')!;
    expect(store.confirmScheduled('A',0,entry.token,100)).toBe(false);
    expect(store.cancel('A',0,entry.token)).toBe(false);
    expect(get(store).get('A:0')?.token).toBe(next.token);
  });
  it('captures the displayed picture when interrupting a queued fade with an uncertain start', () => {
    const store=createVJClipTransitions();
    store.begin('B',0,clip('a'),clip('b'),1,'dissolve',undefined,'queued');
    expect(store.begin('B',0,clip('a'),clip('c'),1,'wipe')?.requiresSnapshot).toBe(true);
  });

  it('inherits duration and style separately, preserving an explicit immediate cut', () => {
    const layer = { transitionDuration: 2, transitionStyle: 'wipe' as const };
    expect(effectiveClipTransition(layer, clip('b'))).toEqual({ duration: 2, style: 'wipe' });
    expect(effectiveClipTransition(layer, { ...clip('b'), transitionDuration: 0 })).toEqual({ duration: 0, style: 'wipe' });
    expect(effectiveClipTransition(layer, { ...clip('b'), transitionStyle: 'slide' })).toEqual({ duration: 2, style: 'slide' });
    expect([-5, 20, NaN, Infinity].map(value => normalizedTransitionDuration(value))).toEqual([0, 10, 0, 0]);
  });

  it('keeps the outgoing picture and waits for readiness before starting the clock', () => {
    const store = createVJClipTransitions();
    const outgoing = clip('a');
    const entry = store.begin('A', 0, outgoing, clip('b'), 2, 'dissolve')!;
    outgoing._nativePlaybackSeekSeq = 99;
    expect(get(store).get('A:0')).toMatchObject({ startedAtMs: null, incomingSeekGeneration: 7, outgoingClip: { _nativePlaybackSeekSeq: 7 } });
    expect(store.markReady('A', 0, entry.token, 123)).toBe(true);
    expect(store.markReady('A', 0, entry.token, 456)).toBe(false);
    expect(get(store).get('A:0')?.startedAtMs).toBe(123);
  });

  it('replaces an incoming clip that never became ready while retaining the original outgoing clip', () => {
    const store = createVJClipTransitions();
    const first = store.begin('A', 0, clip('a'), clip('b'), 1, 'wipe')!;
    const latest = store.begin('A', 0, clip('b'), clip('c'), 1, 'slide')!;
    expect(latest.outgoingClip.id).toBe('a');
    expect(latest.requiresSnapshot).toBe(false);
    expect(store.markReady('A', 0, first.token, 100)).toBe(false);
    expect(store.complete('A', 0, first.token)).toBe(false);
    expect(get(store).get('A:0')?.incomingClipId).toBe('c');
  });

  it('requires a frozen current picture on interruption and keeps resources bounded across rapid triggers', () => {
    const store = createVJClipTransitions();
    const release = vi.fn();
    store.setReleaseHandler(release);
    const first = store.begin('A', 0, clip('a'), clip('b'), 1, 'wipe')!;
    store.markReady('A', 0, first.token, 0);
    const second = store.begin('A', 0, clip('b'), clip('c'), 1, 'slide')!;
    const latest = store.begin('A', 0, clip('c'), clip('d'), 1, 'slide')!;
    expect(get(store).size).toBe(1);
    expect(latest.requiresSnapshot).toBe(true);
    expect(store.markReady('A', 0, latest.token, 50)).toBe(false);
    expect(store.setFrozenSource('A', 0, second.token, 'snapshot-a')).toBe(false);
    expect(store.setFrozenSource('A', 0, latest.token, 'snapshot-a')).toBe(true);
    expect(store.referencesClip('c')).toBe(false);
    expect(store.markReady('A', 0, latest.token, 50)).toBe(true);
    expect(store.complete('A', 0, latest.token)).toBe(true);
    expect(release).toHaveBeenCalledExactlyOnceWith('snapshot-a');
  });

  it('cuts immediately for zero duration and same-clip retriggers without retaining old state', () => {
    const store = createVJClipTransitions();
    store.begin('A', 0, clip('a'), clip('b'), 1, 'wipe');
    expect(store.begin('A', 0, clip('b'), clip('b'), 1, 'wipe')).toBeNull();
    expect(get(store).size).toBe(0);
    store.begin('A', 0, clip('a'), clip('b'), 1, 'wipe');
    expect(store.begin('A', 0, clip('b'), clip('c'), 0, 'wipe')).toBeNull();
    expect(get(store).size).toBe(0);
  });

  it('restarts the still-visible original clip when the pending incoming clip never appeared', () => {
    const store = createVJClipTransitions();
    store.begin('A', 0, clip('a'), clip('b'), 1, 'wipe');
    expect(store.begin('A', 0, clip('b'), clip('a'), 1, 'wipe')).toBeNull();
    expect(get(store).size).toBe(0);
  });

  it('keeps decks independent and clears all retained pictures on stop/reset', () => {
    const store = createVJClipTransitions();
    const a = store.begin('A', 1, clip('a'), clip('b'), 2, 'wipe')!;
    const b = store.begin('B', 1, clip('c'), clip('d'), 3, 'slide')!;
    expect(get(store).size).toBe(2);
    expect(store.complete('A', 1, b.token)).toBe(false);
    expect(store.complete('A', 1, a.token)).toBe(true);
    expect(get(store).get('B:1')).toEqual(b);
    store.clear();
    expect(get(store).size).toBe(0);
    expect(store.markReady('B', 1, b.token, 100)).toBe(false);
  });
});
