// A lost GPU device (driver reset, hung or unplugged GPU, out of memory)
// stops the core with a GPU fault. The broker then replaces the core process
// and the editor sends its scene again. This forces a device loss in the real
// core (GA_CORE_TEST_DEVICE_LOSS destroys the device after N frames), runs
// the broker and an editor stand-in that follows the editor's own restart
// rules, and checks the picture comes back on a new core. It prints how long
// the picture was gone and where that time went.
import { describe, expect, it } from 'vitest';
// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { createNativeRendererBroker } from '../../../electron/native-renderer-broker.js';
import {
  NATIVE_CORE_LIVENESS_POLL_MS,
  NATIVE_CORE_REPLACED_REASON,
  nativeCoreLossReason,
  nativeCoreRestartDelay,
} from '$lib/sync/nativeCoreSupervisor';
import { gpuTestPlatform as platform, rpcDeadlineScale } from './nativeHardwareTestPlatform';

type Command = Record<string, unknown>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const W = 640;
const H = 360;
const full = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } };
const LOSS_AFTER_FRAMES = 60;
// GA_CORE_LOSS_BASELINE=1 times the editor's old rules (liveness on the 3 s
// status log, 1 s restart delay) for comparison.
const baseline = process.env.GA_CORE_LOSS_BASELINE === '1';
const livenessPollMs = baseline ? 3000 : NATIVE_CORE_LIVENESS_POLL_MS;

const config = { backend: platform.rendererBackend, width: W, height: H, target_fps: 60, source_frame_size: 128 };

// What the editor sends a fresh core: here, one full-frame red layer.
const scene: Command[] = [
  { type: 'upsert_layer', layer_id: 'loss-red', z_index: 1, opacity: 1, blend_mode: 'normal', corners: full },
  { type: 'set_layer_visibility', layer_id: 'loss-red', visible: true },
  { type: 'set_layer_color', layer_id: 'loss-red', rgba: [1, 0, 0, 1] },
  { type: 'present' },
];

const isRed = (snapshot: any) => {
  const [r, g, b] = (snapshot?.mean_rgba ?? [0, 0, 0]) as number[];
  return r > 0.95 && g < 0.05 && b < 0.05;
};

const suite = platform.runnable ? describe : describe.skip;
suite('Native GPU device loss', () => {
  it('brings the picture back on a new core after the device is lost', async () => {
    const coreLines: Array<{ at: number; line: string }> = [];
    const log = console.log;
    const warn = console.warn;
    const capture = (fallback: (...args: unknown[]) => void) => (...args: unknown[]) => {
      const line = args.map(String).join(' ');
      if (line.startsWith('[NativeRenderer]')) coreLines.push({ at: performance.now(), line });
      else fallback(...args);
    };
    console.log = capture(log);
    console.warn = capture(warn);
    const broker = createNativeRendererBroker({
      appRoot: process.cwd(),
      resourcesPath: process.cwd(),
      isPackaged: false,
      platform: process.platform,
      env: { ...process.env, GA_NATIVE_VIDEO_PREFETCH: '0', GA_CORE_TEST_DEVICE_LOSS: String(LOSS_AFTER_FRAMES) },
    }) as any;
    let stopEditor = false;
    try {
      const started = await broker.invoke('native_renderer_start', { config });
      expect(started?.backend_ready).toBe(true);
      // Only the first core loses its device; the replacement must not.
      delete broker.env.GA_CORE_TEST_DEVICE_LOSS;
      await broker.invoke('native_renderer_submit_commands', { commands: scene });
      let startedInstance = Number(broker.coreInstance);

      // The editor: sends commands every frame, checks the core's liveness on
      // its poll, and after a loss waits its restart delay, starts a new
      // sync (start + full scene).
      const marks: Record<string, number> = {};
      let lossAt = 0;
      let restartAttempt = 0;
      const editor = (async () => {
        let nextPoll = performance.now() + livenessPollMs;
        while (!stopEditor) {
          await sleep(16);
          if (!lossAt) {
            await broker.invoke('native_renderer_submit_commands', { commands: [{ type: 'present' }] }).catch(() => null);
          }
          if (performance.now() < nextPoll) continue;
          nextPoll = performance.now() + livenessPollMs;
          const status = await broker.invoke('native_renderer_get_status').catch(() => null);
          if (lossAt) continue;
          const reason = nativeCoreLossReason(status, startedInstance);
          if (!reason) continue;
          lossAt = performance.now();
          marks.editorSawLoss = lossAt;
          const delay = nativeCoreRestartDelay(restartAttempt++, {
            replaced: !baseline && reason === NATIVE_CORE_REPLACED_REASON,
          }) ?? 0;
          await sleep(delay);
          marks.syncStart = performance.now();
          await broker.invoke('native_renderer_start', { config });
          marks.coreStarted = performance.now();
          startedInstance = Number(broker.coreInstance);
          await broker.invoke('native_renderer_submit_commands', { commands: scene });
          marks.sceneSent = performance.now();
          return;
        }
      })();

      // Wait for the loss, then for red on the new core.
      const deadline = performance.now() + 30000 * rpcDeadlineScale;
      let pictureAt = 0;
      let snapshot: any = null;
      while (performance.now() < deadline) {
        await sleep(20);
        if (!marks.sceneSent) continue;
        snapshot = await broker.invoke('native_renderer_get_frame_snapshot').catch(() => null);
        if (isRed(snapshot)) { pictureAt = performance.now(); break; }
      }
      stopEditor = true;
      await editor;
      const destroyed = coreLines.find(entry => /TEST: destroying the GPU device/.test(entry.line))?.at ?? 0;
      const faultSeen = coreLines.find(entry => /GPU fault detected/.test(entry.line))?.at ?? 0;
      const brokerRestarted = coreLines.find(entry => /render core restarted after GPU fault/.test(entry.line))?.at ?? 0;
      const ms = (from: number, to: number) => (from && to ? `${Math.round(to - from)} ms` : 'n/a');
      process.stdout.write(`${[
        `GPU device loss: time to picture (${baseline ? 'old editor rules' : 'current'})`,
        `  device destroyed -> broker sees fault:    ${ms(destroyed, faultSeen)}`,
        `  broker: new core started:                ${ms(faultSeen, brokerRestarted)}`,
        `  device destroyed -> editor sees loss:     ${ms(destroyed, marks.editorSawLoss)}`,
        `  editor restart delay:                    ${ms(marks.editorSawLoss, marks.syncStart)}`,
        `  start on the new core:                   ${ms(marks.syncStart, marks.coreStarted)}`,
        `  scene sent:                              ${ms(marks.coreStarted, marks.sceneSent)}`,
        `  scene sent -> picture:                   ${ms(marks.sceneSent, pictureAt)}`,
        `  total, device destroyed -> picture:      ${ms(destroyed, pictureAt)}`,
      ].join('\n')}\n`);
      expect(destroyed).toBeGreaterThan(0);
      expect(faultSeen).toBeGreaterThan(0);
      expect(Number(broker.coreInstance)).toBeGreaterThan(1);
      expect(pictureAt).toBeGreaterThan(0);
      expect(isRed(snapshot)).toBe(true);
    } finally {
      stopEditor = true;
      console.log = log;
      console.warn = warn;
      await broker.invoke('native_renderer_stop').catch(() => {});
      broker.shutdownSync?.();
    }
  }, 60000);
});
