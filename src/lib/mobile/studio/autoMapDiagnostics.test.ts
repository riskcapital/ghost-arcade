import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { decodeCaptures } from './structuredLight';
import { autoMapSurfaces } from './autoMapSurfaces';
import { buildDiagnostics, diagnosticsSummary, replayDiagnostics, type AutoMapDiagnostics } from './autoMapDiagnostics';
import { renderDepth, renderScan, twoBoxRoom } from './syntheticRoom';

const inflate = (b: Uint8Array) => new Uint8Array(inflateRawSync(b));

describe('auto-map diagnostics', () => {
  it('keeps a run so the same solver finds the same faces offline', async () => {
    const room = twoBoxRoom();
    const { plan, captures } = renderScan(room);
    const decoded = decodeCaptures(plan, captures);
    const depth = renderDepth(room);
    const projector = { id: 'main', name: 'Main output', width: 1920, height: 1080, corners: [], rmsPx: 0, coverage: decoded.coverage, plan, decoded, white: captures[0], captures, timings: { captureMs: 9000, decodeMs: 400 } };
    const found = autoMapSurfaces([{ id: 'main', width: 1920, height: 1080, plan, decoded, white: captures[0] }], depth);
    const bundle = await buildDiagnostics({ projector, depth, found, turn: 90, gravity: [0, 1, 0], device: 'test', solveMs: 1200 });
    // Through JSON, as it travels and is saved.
    const back = JSON.parse(JSON.stringify(bundle)) as AutoMapDiagnostics;
    expect(back.frames).toHaveLength(plan.frames.length);
    const replay = replayDiagnostics(back, inflate);
    expect(replay.faces.map(f => f.points)).toEqual(bundle.faces.map(f => f.points));
    const line = diagnosticsSummary(back);
    expect(line).toMatch(/Main output 1920x1080, 26 frames 1280x960 turn 90, decoded \d+\.\d% \(\d+ edges\), \d+ faces/);
  }, 120_000);

  // Replays a real run saved by the desktop: AUTOMAP_BUNDLE=<path to bundle.json> npx vitest run autoMapDiagnostics
  const real = process.env.AUTOMAP_BUNDLE;
  it.skipIf(!real || !existsSync(real))('replays a saved real run', () => {
    const bundle = JSON.parse(readFileSync(real!, 'utf8')) as AutoMapDiagnostics;
    for (const depth of [true, false]) {
      const replay = replayDiagnostics(bundle, inflate, { depth });
      console.log(`${depth ? 'with' : 'without'} depth, ${replay.ms} ms, coverage ${(replay.decoded.coverage * 100).toFixed(1)}%:\n` + replay.faces.map(f => `  ${f.rank}${f.minor ? ' minor' : ''}${f.curved ? ' curved' : ''} area ${(f.area * 100).toFixed(2)}% solid ${f.solid.toFixed(2)} edge ${f.edgePx?.toFixed(2) ?? '-'} px`).join('\n'));
    }
  }, 600_000);
});
