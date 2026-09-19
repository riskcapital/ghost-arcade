import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import type { VJClip } from './vjClipLauncher';
import { createVJClipTransitions, effectiveClipTransition, normalizedTransitionDuration } from './vjClipTransitions';

const clip = (id: string): VJClip => ({ id, name: id, type: 'video', src: `/show/${id}.mp4`, _nativePlaybackSeekSeq: 7 });

describe('VJ clip transition lifecycle', () => {
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
