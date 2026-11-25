/**
 * One auto-map run, kept so a real scan can be looked at and replayed
 * offline: every stripe photo (compressed losslessly), the depth with its
 * lens and pose, which way the phone was held, what was found, timings.
 * The phone builds it after each run; the desktop saves it under
 * userData/diagnostics/automap/<stamp>/; `replayDiagnostics` runs the
 * same solver on it in a test.
 */
import { decodeCaptures, planPatterns, type Capture } from './structuredLight';
import type { DepthScan } from './meshMap';
import type { AutoMapProjector } from './autoMap';
import { autoMapSurfaces, type AutoMapped } from './autoMapSurfaces';

export type DiagnosticFace = { rank: number; outline: { x: number; y: number }[]; points: { x: number; y: number }[]; rmsPx: number; edgePx?: number; area: number; solid: number; minor: boolean; curved: boolean };

export type AutoMapDiagnostics = {
  schema: 'ghost-automap-diagnostics';
  version: 1;
  createdAt: string;
  device: string;
  /** Clockwise turn the photos were given to be upright, and gravity in the scan's frame when known. */
  turn: number;
  gravity: number[] | null;
  target: { id: string; name: string; width: number; height: number; region?: { x: number; y: number; width: number; height: number } };
  cell: number;
  photo: { width: number; height: number };
  /** 'deflate-raw' or 'raw': how each frame's 8-bit luma is packed before base64. */
  encoding: 'deflate-raw' | 'raw';
  frames: string[];
  depth?: { width: number; height: number; intrinsics: DepthScan['intrinsics']; pose?: number[]; turn?: number; meters: string };
  decode: { coverage: number; edges: number };
  faces: DiagnosticFace[];
  timings: { captureMs?: number; decodeMs?: number; solveMs?: number };
};

const toBase64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

async function pack(bytes: Uint8Array, encoding: AutoMapDiagnostics['encoding']): Promise<string> {
  if (encoding === 'raw') return toBase64(bytes);
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return toBase64(new Uint8Array(await new Response(stream).arrayBuffer()));
}

const lumaBytes = (c: Capture) => {
  if (c.luma instanceof Uint8Array || c.luma instanceof Uint8ClampedArray) return new Uint8Array(c.luma.buffer, c.luma.byteOffset, c.width * c.height);
  const out = new Uint8Array(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(c.luma[i])));
  return out;
};

export const diagnosticFaces = (found: AutoMapped[]): DiagnosticFace[] => found.map((m, rank) => ({
  rank: rank + 1, outline: m.outline, points: m.points, rmsPx: m.rmsPx, ...(m.edgePx !== undefined ? { edgePx: m.edgePx } : {}),
  area: m.area, solid: m.solid, minor: m.minor, curved: !!m.curved,
}));

export async function buildDiagnostics(run: { projector: AutoMapProjector; depth?: DepthScan; found: AutoMapped[]; turn: number; gravity: number[] | null; device: string; solveMs?: number }): Promise<AutoMapDiagnostics> {
  const { projector } = run;
  const captures = projector.captures ?? [projector.white];
  const encoding: AutoMapDiagnostics['encoding'] = typeof CompressionStream === 'function' ? 'deflate-raw' : 'raw';
  const frames: string[] = [];
  for (const c of captures) frames.push(await pack(lumaBytes(c), encoding));
  const depth = run.depth;
  return {
    schema: 'ghost-automap-diagnostics', version: 1, createdAt: new Date().toISOString(), device: run.device, turn: run.turn, gravity: run.gravity,
    target: { id: projector.id, name: projector.name, width: projector.width, height: projector.height, ...(projector.region ? { region: projector.region } : {}) },
    cell: projector.plan.cell, photo: { width: projector.white.width, height: projector.white.height }, encoding, frames,
    ...(depth ? { depth: { width: depth.width, height: depth.height, intrinsics: depth.intrinsics, ...(depth.pose ? { pose: Array.from(depth.pose) } : {}), ...(depth.turn !== undefined ? { turn: depth.turn } : {}), meters: toBase64(new Uint8Array(depth.meters.buffer, depth.meters.byteOffset, depth.meters.byteLength)) } } : {}),
    decode: { coverage: projector.decoded.coverage, edges: projector.decoded.edges?.count ?? 0 },
    faces: diagnosticFaces(run.found),
    timings: { ...(projector.timings ?? {}), ...(run.solveMs !== undefined ? { solveMs: run.solveMs } : {}) },
  };
}

/** One line for the desktop log: what was mapped, how well, how long. */
export function diagnosticsSummary(d: AutoMapDiagnostics): string {
  const main = d.faces.filter(f => !f.minor);
  const faces = d.faces.map(f => `${f.rank}${f.minor ? 'm' : ''}${f.curved ? 'c' : ''}:${(f.edgePx ?? f.rmsPx).toFixed(1)}px`).join(' ');
  const t = d.timings;
  return `auto map on ${d.target.name} ${d.target.width}x${d.target.height}, ${d.frames.length} frames ${d.photo.width}x${d.photo.height} turn ${d.turn}, decoded ${(d.decode.coverage * 100).toFixed(1)}% (${d.decode.edges} edges), ${main.length} faces + ${d.faces.length - main.length} minor [${faces}], capture ${t.captureMs ?? '?'} ms decode ${t.decodeMs ?? '?'} ms solve ${t.solveMs ?? '?'} ms${d.depth ? ', depth' : ''}`;
}

/** The scan back from a bundle: photos and depth exactly as the phone had them. `inflate` undoes deflate-raw (node: zlib.inflateRawSync). */
export function unpackDiagnostics(d: AutoMapDiagnostics, inflate: (bytes: Uint8Array) => Uint8Array): { captures: Capture[]; depth?: DepthScan } {
  const captures = d.frames.map(f => {
    const bytes = fromBase64(f);
    const luma = d.encoding === 'deflate-raw' ? inflate(bytes) : bytes;
    return { width: d.photo.width, height: d.photo.height, luma: new Uint8Array(luma) };
  });
  const depth = d.depth ? { width: d.depth.width, height: d.depth.height, intrinsics: d.depth.intrinsics, meters: new Float32Array(fromBase64(d.depth.meters).buffer), ...(d.depth.pose ? { pose: d.depth.pose } : {}), ...(d.depth.turn !== undefined ? { turn: d.depth.turn as 0 } : {}) } : undefined;
  return { captures, ...(depth ? { depth } : {}) };
}

/** Runs today's solver on a saved run: what the phone would find now. */
export function replayDiagnostics(d: AutoMapDiagnostics, inflate: (bytes: Uint8Array) => Uint8Array, options: { depth?: boolean } = {}) {
  const { captures, depth } = unpackDiagnostics(d, inflate);
  const plan = planPatterns(d.target.width, d.target.height, d.cell);
  const started = Date.now();
  const decoded = decodeCaptures(plan, captures);
  const found = autoMapSurfaces([{ id: d.target.id, width: d.target.width, height: d.target.height, plan, decoded, white: captures[0] }], options.depth === false ? undefined : depth);
  return { decoded, found, faces: diagnosticFaces(found), ms: Date.now() - started };
}
