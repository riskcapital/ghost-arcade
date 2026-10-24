/**
 * Clip files that are no longer where the show expects them. The VJ deck
 * marks those clips and offers to find the files again.
 */
import { writable, get } from 'svelte/store';

/** Absolute paths that were checked and are not on disk. */
export const missingClipFiles = writable<Set<string>>(new Set());

/**
 * Bumped whenever media is pointed at a new file (a relink, or files found
 * in a new place on open). The project counts as changed until saved, so a
 * relink prompts on quit instead of being lost.
 */
export const mediaRelinkVersion = writable(0);
export function noteMediaRelinked(): void {
  mediaRelinkVersion.update((n) => n + 1);
}

type Invoke = (command: string, args?: unknown) => Promise<any>;
const invoker = (): Invoke | null => {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  return typeof api?.invoke === 'function' ? api.invoke.bind(api) : null;
};

let checking = false;
/** Ask the desktop app which of these files exist. Returns the missing ones. */
export async function checkClipFiles(paths: string[]): Promise<Set<string>> {
  const invoke = invoker();
  if (!invoke || checking) return get(missingClipFiles);
  checking = true;
  try {
    const status: Record<string, boolean> = paths.length ? await invoke('media_files_status', { paths }) : {};
    const missing = new Set(paths.filter((p) => status?.[p] === false));
    const before = get(missingClipFiles);
    if (missing.size !== before.size || [...missing].some((p) => !before.has(p))) missingClipFiles.set(missing);
    return missing;
  } catch {
    return get(missingClipFiles);
  } finally {
    checking = false;
  }
}

/** Pick a folder and look inside it for files with these names. */
export async function searchFolderForFiles(names: string[]): Promise<{ canceled: boolean; dir: string | null; found: Record<string, string> }> {
  const invoke = invoker();
  if (!invoke) return { canceled: true, dir: null, found: {} };
  return invoke('media_find_in_folder', { names });
}

/** Files named like these beside `file` (one the user just located). */
export async function findFilesBeside(file: string, names: string[]): Promise<Record<string, string>> {
  const invoke = invoker();
  if (!invoke || !names.length) return {};
  try {
    return (await invoke('media_find_beside', { file, names }))?.found ?? {};
  } catch {
    return {};
  }
}

/** Pick one replacement file. Returns its path, or null when cancelled. */
export async function chooseReplacementFile(name: string): Promise<string | null> {
  const invoke = invoker();
  if (!invoke) return null;
  const picked = await invoke('open_project_dialog', { title: `Locate ${name}`, filters: [{ name: 'Media files', extensions: ['*'] }] });
  return picked?.canceled ? null : picked?.filePath || null;
}
