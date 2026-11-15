import { describe, expect, it } from 'vitest';
import { PAIRED_DRAFT_KEY, readPairedDraft, usesWorld, writePairedDraft } from './pairedDraft';
import { defaultInteractive } from './interactive';
import { makeEffect } from './interactiveEffects';
import { defaultReliefWorld } from '../../scene3d/worldModel';
import { readInteractiveDraft } from './interactiveLibrary';

const memory = () => {
  const m = new Map<string, string>();
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('the paired editor’s draft', () => {
  it('keeps the last scene on the phone and opens it again, apart from the phone’s own draft', () => {
    const store = memory();
    const scene = { ...defaultInteractive(), name: 'Gig wall' };
    writePairedDraft(store, scene);
    expect([...store.m.keys()]).toEqual([PAIRED_DRAFT_KEY]);
    expect(readInteractiveDraft(store)).toBeNull();
    expect(readPairedDraft(store, false)?.name).toBe('Gig wall');
    expect(readPairedDraft(store, true)?.name).toBe('Gig wall');
  });

  it('opens a 3D world draft only with a desktop that has the world, and never hands an older one a world', () => {
    const store = memory();
    const world = { ...defaultInteractive(), world: { ...defaultReliefWorld(), enabled: true } };
    expect(usesWorld(world)).toBe(true);
    writePairedDraft(store, world);
    expect(readPairedDraft(store, false)).toBeNull();
    expect(readPairedDraft(store, true)?.world?.enabled).toBe(true);
    const balls = { ...defaultInteractive(), effects: [makeEffect('balls3d')] };
    expect(usesWorld(balls)).toBe(true);
    // A world switched off, no world effects: fine for an older desktop, without the world.
    writePairedDraft(store, { ...defaultInteractive(), world: { ...defaultReliefWorld(), enabled: false } });
    const old = readPairedDraft(store, false)!;
    expect(old).not.toBeNull();
    expect('world' in old).toBe(false);
  });

  it('starts fresh from anything unreadable', () => {
    const store = memory();
    store.setItem(PAIRED_DRAFT_KEY, '{nope');
    expect(readPairedDraft(store, true)).toBeNull();
    store.setItem(PAIRED_DRAFT_KEY, JSON.stringify({ version: 9, scene: defaultInteractive() }));
    expect(readPairedDraft(store, true)).toBeNull();
  });
});
