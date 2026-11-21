import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createRequire } from 'node:module';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteUserLoop, memoryBackend, readUserLoop, renameUserLoop, saveUserLoop, setUserLoopsBackend, userLoops } from './userLoops';
import { encodeWav } from './wav';

const require = createRequire(import.meta.url);
const { createUserLoopsStore } = require('../../../electron/user-loops-store.cjs');

const meta = (name: string) => ({
  kind: 'midi' as const,
  name,
  bars: 4,
  beats: 16,
  bpm: 120,
  key: { root: 9, scale: 'minor' as const },
  instrument: 'keys',
  notes: [{ beat: 0, dur: 1, note: 60, velocity: 0.8 }],
  createdAt: 1,
});

describe('My loops (renderer)', () => {
  beforeEach(() => setUserLoopsBackend(memoryBackend(null)));

  it('saves, lists, renames and deletes, keeping names unique', async () => {
    const a = await saveUserLoop(meta('Keys 3 · 4 bars'));
    await saveUserLoop(meta('Keys 3 · 4 bars'));
    expect(get(userLoops).map((l) => l.name).sort()).toEqual(['Keys 3 · 4 bars', 'Keys 3 · 4 bars 2']);
    const loop = await readUserLoop(a);
    expect(loop?.notes).toEqual(meta('x').notes);
    await renameUserLoop(a, 'Keys 3 · 4 bars 2');
    expect(get(userLoops).find((l) => l.id === a)?.name).toBe('Keys 3 · 4 bars 2 2');
    await deleteUserLoop(a);
    expect(get(userLoops)).toHaveLength(1);
  });
});

describe('My loops store (desktop)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ga-my-loops-'));
  const store = createUserLoopsStore(dir);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips a MIDI loop and an audio loop by id', () => {
    const { id } = store.save({ meta: meta('Riff') });
    const read = store.read({ id });
    expect(read.loop.name).toBe('Riff');
    expect(read.loop.notes).toEqual(meta('x').notes);
    expect(read.wav).toBeNull();
    const wav = encodeWav(new Float32Array(480), new Float32Array(480), 48000);
    const audio = store.save({ meta: { ...meta('Gtr'), kind: 'audio', notes: [] }, wav });
    expect(store.read({ id: audio.id }).wav.length).toBe(wav.byteLength);
    store.rename({ id, name: '  New\nname ' });
    expect(store.list().find((l: { id: string }) => l.id === id).name).toBe('New name');
    store.remove({ id: audio.id });
    expect(readdirSync(dir).filter((f) => f.endsWith('.wav'))).toHaveLength(0);
  });

  it('refuses ids that are not its own, and audio that is not a WAV', () => {
    expect(() => store.read({ id: '../../etc/passwd' })).toThrow();
    expect(() => store.remove({ id: '..' })).toThrow();
    expect(() => store.save({ meta: { ...meta('x'), kind: 'audio' }, wav: new Uint8Array(100) })).toThrow();
  });
});
