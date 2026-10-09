import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, gpuTestPlatform as platform } from './nativeHardwareTestPlatform';

/**
 * An empty layer shows the alignment card on true black, not a grey fill.
 * A colour layer still draws its colour, and a composition with no layers
 * is 0,0,0.
 */
type Command = Record<string, unknown>;
function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(String(message.error)));
  });
  const send = (method: string, params: Command = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() { try { await send('shutdown'); } catch { /* gone */ } await closeNativeTestCore(child); },
  };
}

const W = 640, H = 360;
const full = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } };

const suite = platform.runnable ? describe : describe.skip;
suite('Empty layer alignment card', () => {
  it('draws lines on true black instead of a grey fill', async () => {
    const rpc = core();
    try {
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: W, height: H, source_frame_size: 128, target_fps: 30 } });
      await rpc.commands([{ type: 'present' }]);
      const blank = await rpc.send('frame_snapshot');
      expect(blank.mean_rgba.slice(0, 3)).toEqual([0, 0, 0]);

      await rpc.commands([{ type: 'upsert_layer', layer_id: 'empty', z_index: 1, opacity: 1, blend_mode: 'normal', corners: full }, { type: 'present' }]);
      await new Promise(r => setTimeout(r, 200));
      const snap = await rpc.send('frame_snapshot', { include_pixels: true });
      const px = Buffer.from(snap.rgba_b64, 'base64');
      if (process.env.GA_CARD_DUMP) writeFileSync(process.env.GA_CARD_DUMP, JSON.stringify({ w: snap.width, h: snap.height, b64: snap.rgba_b64 }));
      const at = (x: number, y: number) => [...px.subarray((y * snap.width + x) * 4, (y * snap.width + x) * 4 + 3)];
      let black = 0, lit = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) black++;
        else if (Math.max(px[i], px[i + 1], px[i + 2]) > 200) lit++;
      }
      const total = snap.width * snap.height;
      // Mostly true black, with real lines and patches on it.
      expect(black / total).toBeGreaterThan(0.6);
      expect(lit / total).toBeGreaterThan(0.01);
      // The frame runs along the layer's edge at full white (the outermost
      // row carries the shape's own anti-aliasing).
      expect(Math.min(...at(Math.floor(snap.width / 3) + 7, 1))).toBeGreaterThan(240);
      // A cell interior away from every line is 0,0,0.
      expect(at(Math.round(snap.width / 2 + 5.5 * H / 12 * snap.width / W), Math.round(snap.height / 2 + 0.5 * snap.height / 12))).toEqual([0, 0, 0]);

      // A colour layer is still its colour at full strength.
      await rpc.commands([{ type: 'set_layer_color', layer_id: 'empty', rgba: [1, 1, 1, 1] }, { type: 'present' }]);
      await new Promise(r => setTimeout(r, 200));
      const white = await rpc.send('frame_snapshot');
      expect(Math.min(...white.mean_rgba.slice(0, 3))).toBeGreaterThan(0.99);
    } finally { await rpc.close(); }
  }, 30000);
});
