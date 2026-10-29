/**
 * The renderer's side of the p5.js Web Editor import. The main process does
 * the fetching (electron/p5-editor-import.cjs); this asks it by username and
 * sketch id and shapes what comes back.
 */
import { invoke, isDesktopApp } from '../bridge';
import { p5VersionFromUrl } from '../p5sketch/wrapSketch';
import { p5LibraryKind, type P5Sketch, type P5SketchFile, type P5SketchSource } from '../p5sketch/files';

export interface P5SketchSummary {
  id: string;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  /** The `src` of each script tag in its index.html. */
  scripts: string[];
  files: number;
  assets: number;
}

interface ListAnswer {
  ok: boolean;
  reason?: string;
  username?: string;
  sketches?: P5SketchSummary[];
}

interface SketchAnswer {
  ok: boolean;
  reason?: string;
  sketch?: Omit<P5Sketch, 'source'>;
}

const DESKTOP_ONLY = 'Reading sketches from the p5.js Web Editor needs the desktop app. A downloaded zip works here.';

export async function listEditorSketches(username: string): Promise<{ username: string; sketches: P5SketchSummary[] }> {
  if (!isDesktopApp) throw new Error(DESKTOP_ONLY);
  const answer = await invoke<ListAnswer>('p5_editor_list_sketches', { username });
  if (!answer?.ok || !answer.username || !Array.isArray(answer.sketches)) {
    throw new Error(answer?.reason || 'Could not read the sketch list.');
  }
  return { username: answer.username, sketches: answer.sketches };
}

export async function fetchEditorSketch(username: string, id: string, source: P5SketchSource): Promise<P5Sketch> {
  if (!isDesktopApp) throw new Error(DESKTOP_ONLY);
  const answer = await invoke<SketchAnswer>('p5_editor_get_sketch', { username, id });
  if (!answer?.ok || !answer.sketch) throw new Error(answer?.reason || 'Could not read the sketch.');
  const files: P5SketchFile[] = Array.isArray(answer.sketch.files) ? answer.sketch.files : [];
  return { ...answer.sketch, files, source };
}

/** The p5.js version a listed sketch loads, from its script tags. */
export function summaryP5Version(summary: P5SketchSummary): string | null {
  for (const src of summary.scripts) {
    if (p5LibraryKind(src) === 'core') return p5VersionFromUrl(src);
  }
  return null;
}
