/**
 * "My loops": loops saved from the live looper, global across projects.
 *
 * On the desktop they live in the app's userData folder, behind the
 * user_loops_* commands (electron/user-loops-store.cjs): the page sends a
 * loop's data and gets back an id, and names a loop by that id only. In the
 * browser preview MIDI loops are kept in localStorage and audio in memory.
 */

import { get, writable } from 'svelte/store';
import { invoke, isElectron } from '../bridge';
import type { RecordedNote } from './loopRecorder';
import type { MusicKey } from './studioSets';
import type { XyPoint } from './loopSources';
import { uniqueName } from './loopTrack';

export interface UserLoopMeta {
  kind: 'midi' | 'audio';
  name: string;
  bars: number;
  beats: number;
  bpm: number;
  key: MusicKey | null;
  instrument: string | null;
  tone?: string;
  /** A tab instrument's loop: "xy", "dub" or "pads" (loopSources.ts); absent for the keys. */
  source?: string;
  /** An XY loop: the puck's movement, every layer's points together. */
  xy?: XyPoint[];
  createdAt: number;
}

export interface UserLoopEntry extends UserLoopMeta {
  id: string;
  hasAudio: boolean;
  noteCount: number;
}

export interface UserLoop extends UserLoopMeta {
  id: string;
  notes: RecordedNote[];
  /** Audio loops: the WAV file's bytes. */
  wav: Uint8Array | null;
}

/** Where the loops are kept. Swapped out in tests. */
export interface UserLoopsBackend {
  list(): Promise<UserLoopEntry[]>;
  save(meta: UserLoopMeta & { notes: RecordedNote[] }, wav: Uint8Array | null): Promise<string>;
  read(id: string): Promise<UserLoop | null>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

type Reply<T> = { success: boolean; error?: string } & T;

function check<T>(reply: Reply<T>): T {
  if (!reply || !reply.success) throw new Error(reply?.error || 'My loops is not available.');
  return reply;
}

const desktopBackend: UserLoopsBackend = {
  async list() {
    return check(await invoke<Reply<{ loops: UserLoopEntry[] }>>('user_loops_list', {})).loops;
  },
  async save(meta, wav) {
    return check(await invoke<Reply<{ id: string }>>('user_loops_save', { meta, wav })).id;
  },
  async read(id) {
    const reply = check(await invoke<Reply<{ loop: UserLoopEntry & { notes: RecordedNote[] }; wav: Uint8Array | ArrayBuffer | null }>>('user_loops_read', { id }));
    const wav = reply.wav ? (reply.wav instanceof Uint8Array ? reply.wav : new Uint8Array(reply.wav)) : null;
    return { ...reply.loop, wav };
  },
  async rename(id, name) {
    check(await invoke<Reply<object>>('user_loops_rename', { id, name }));
  },
  async remove(id) {
    check(await invoke<Reply<object>>('user_loops_delete', { id }));
  },
};

const STORAGE_KEY = 'ga-my-loops';

/** The browser preview's loops (and the tests'). */
export function memoryBackend(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): UserLoopsBackend {
  const audio = new Map<string, Uint8Array>();
  let mem: Array<UserLoopMeta & { id: string; notes: RecordedNote[] }> = [];
  const load = () => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw) mem = JSON.parse(raw);
    } catch { /* unreadable: start empty */ }
    return mem;
  };
  const store = () => {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(mem.filter((l) => l.kind === 'midi'))); } catch { /* full or blocked */ }
  };
  let serial = 0;
  return {
    async list() {
      return load().map(({ notes, ...l }) => ({ ...l, hasAudio: audio.has(l.id), noteCount: notes.length })).sort((a, b) => b.createdAt - a.createdAt);
    },
    async save(meta, wav) {
      load();
      const id = `00000000-0000-4000-8000-${String(Date.now() % 1e12).padStart(12, '0').slice(-10)}${String(++serial % 100).padStart(2, '0')}`;
      mem.push({ ...meta, id });
      if (wav) audio.set(id, wav);
      store();
      return id;
    },
    async read(id) {
      const l = load().find((x) => x.id === id);
      return l ? { ...l, wav: audio.get(id) ?? null } : null;
    },
    async rename(id, name) {
      load();
      mem = mem.map((l) => (l.id === id ? { ...l, name } : l));
      store();
    },
    async remove(id) {
      load();
      mem = mem.filter((l) => l.id !== id);
      audio.delete(id);
      store();
    },
  };
}

let backend: UserLoopsBackend = isElectron ? desktopBackend : memoryBackend();

export function setUserLoopsBackend(next: UserLoopsBackend): void {
  backend = next;
  userLoops.set([]);
  loaded = false;
}

/** The loops, newest first (empty until `refreshUserLoops`). */
export const userLoops = writable<UserLoopEntry[]>([]);
let loaded = false;

export async function refreshUserLoops(): Promise<UserLoopEntry[]> {
  const list = await backend.list();
  userLoops.set(list);
  loaded = true;
  return list;
}

export async function ensureUserLoops(): Promise<void> {
  if (!loaded) await refreshUserLoops().catch(() => undefined);
}

/** Save a loop under a name not taken yet ("Riff" → "Riff 2"); returns its id. */
export async function saveUserLoop(meta: UserLoopMeta & { notes: RecordedNote[] }, wav: Uint8Array | null = null): Promise<string> {
  await ensureUserLoops();
  const name = uniqueName(meta.name, get(userLoops).map((l) => l.name));
  const id = await backend.save({ ...meta, name }, wav);
  await refreshUserLoops();
  return id;
}

export async function readUserLoop(id: string): Promise<UserLoop | null> {
  return backend.read(id);
}

export async function renameUserLoop(id: string, name: string): Promise<void> {
  const others = get(userLoops).filter((l) => l.id !== id).map((l) => l.name);
  await backend.rename(id, uniqueName(name, others));
  await refreshUserLoops();
}

export async function deleteUserLoop(id: string): Promise<void> {
  await backend.remove(id);
  await refreshUserLoops();
}
