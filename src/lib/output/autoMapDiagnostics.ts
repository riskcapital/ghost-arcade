import { writable } from 'svelte/store';
import { invoke } from '../bridge';

/**
 * Auto-map runs the phone sends (photos, decode, faces, timings, its overlay
 * picture), saved to userData/diagnostics/automap/<stamp>/ with a one-line
 * summary in the debug log. The phone side builds them
 * (src/lib/mobile/studio/autoMapDiagnostics.ts); its tests replay a saved
 * bundle.json through the same solver.
 */
type Face = { rank: number; rmsPx: number; edgePx?: number; minor: boolean; curved: boolean; outline?: { x: number; y: number }[] };
export type ReceivedRun = { stamp: string; bundle: Record<string, any>; overlay?: string; photo?: string };

/** The latest run: the verification shot is saved beside it. */
export const lastAutoMapRun = writable<ReceivedRun | null>(null);

export function runSummary(b: Record<string, any>): string {
  const faces: Face[] = Array.isArray(b?.faces) ? b.faces : [];
  const main = faces.filter(f => !f.minor);
  const t = b?.timings ?? {};
  const list = faces.map(f => `${f.rank}${f.minor ? 'm' : ''}${f.curved ? 'c' : ''}:${Number(f.edgePx ?? f.rmsPx).toFixed(1)}px`).join(' ');
  return `auto map on ${b?.target?.name} ${b?.target?.width}x${b?.target?.height}, ${b?.frames?.length ?? 0} frames ${b?.photo?.width}x${b?.photo?.height} turn ${b?.turn}, decoded ${(Number(b?.decode?.coverage) * 100).toFixed(1)}% (${b?.decode?.edges} edges), ${main.length} faces + ${faces.length - main.length} minor [${list}], capture ${t.captureMs ?? '?'} ms decode ${t.decodeMs ?? '?'} ms solve ${t.solveMs ?? '?'} ms${b?.depth ? ', depth' : ''}`;
}

const parts = new Map<string, { count: number; got: string[]; at: number }>();

/** Collects one chunk; when the run is complete, saves it and returns it. */
export async function receiveDiagnosticsChunk(msg: { requestId: string; index: number; count: number; data: string }): Promise<ReceivedRun | null> {
  for (const [id, entry] of parts) if (Date.now() - entry.at > 120_000) parts.delete(id);
  const entry = parts.get(msg.requestId) ?? { count: msg.count, got: [], at: Date.now() };
  parts.set(msg.requestId, entry);
  entry.got[msg.index] = msg.data;
  if (entry.got.filter(x => typeof x === 'string').length < entry.count) return null;
  parts.delete(msg.requestId);
  const { bundle, files } = JSON.parse(entry.got.join('')) as { bundle: Record<string, any>; files?: Record<string, string> };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const images: Record<string, string> = {};
  for (const name of ['overlay.jpg', 'photo.jpg']) if (typeof files?.[name] === 'string') images[name] = files[name];
  const summary = runSummary(bundle);
  await invoke('save_automap_diagnostics', { stamp, files: { 'bundle.json': JSON.stringify(bundle), ...images }, summary }).catch(() => {});
  const run = { stamp, bundle, overlay: images['overlay.jpg'], photo: images['photo.jpg'] };
  lastAutoMapRun.set(run);
  return run;
}
