import { describe, expect, it, vi } from 'vitest';
const saved: any[] = [];
vi.mock('../bridge', () => ({ invoke: async (cmd: string, args: any) => { saved.push({ cmd, args }); return { success: true }; } }));
import { receiveDiagnosticsChunk, runSummary } from './autoMapDiagnostics';

describe('auto-map diagnostics from the phone', () => {
  const bundle = { target: { name: 'Main output', width: 1920, height: 1080 }, frames: new Array(26).fill('x'), photo: { width: 1280, height: 960 }, turn: 0, decode: { coverage: 0.4123, edges: 51234 },
    faces: [{ rank: 1, rmsPx: 12, edgePx: 0.6, minor: false, curved: false }, { rank: 2, rmsPx: 13, edgePx: 2.4, minor: true, curved: false }], timings: { captureMs: 11200, decodeMs: 400, solveMs: 1300 } };
  it('logs one line a run: target, frames, coverage, faces with their fit, timings', () => {
    expect(runSummary(bundle)).toBe('auto map on Main output 1920x1080, 26 frames 1280x960 turn 0, decoded 41.2% (51234 edges), 1 faces + 1 minor [1:0.6px 2m:2.4px], capture 11200 ms decode 400 ms solve 1300 ms');
  });
  it('puts the chunks back together and saves the run with its pictures', async () => {
    const text = JSON.stringify({ bundle, files: { 'overlay.jpg': 'data:image/jpeg;base64,AAAA', 'photo.jpg': 'data:image/jpeg;base64,BBBB' } });
    const half = Math.ceil(text.length / 2);
    expect(await receiveDiagnosticsChunk({ requestId: 'r1', index: 1, count: 2, data: text.slice(half) })).toBeNull();
    const run = await receiveDiagnosticsChunk({ requestId: 'r1', index: 0, count: 2, data: text.slice(0, half) });
    expect(run?.bundle.decode.edges).toBe(51234);
    const call = saved.find(s => s.cmd === 'save_automap_diagnostics');
    expect(Object.keys(call.args.files).sort()).toEqual(['bundle.json', 'overlay.jpg', 'photo.jpg']);
    expect(call.args.summary).toContain('1 faces + 1 minor');
  });
});
