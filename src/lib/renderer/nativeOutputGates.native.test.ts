import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { createNativeRendererBroker } from '../../../electron/native-renderer-broker.js';

/**
 * The Output Window opens only when the broker's output-driver gate is ready,
 * and that gate needs every graph instrument route in the core's manifest to
 * be ready. A route that can never become ready (a feature name the core does
 * not advertise, or a check that expects built-in shaders from an instrument
 * that builds its shaders at runtime) kept the Output Window shut on every
 * fresh profile. This starts the real core and checks every route.
 */

const nativeCoreBin = join(process.cwd(), 'native-renderer', 'target', 'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const itIfNativeCore = existsSync(nativeCoreBin) ? it : it.skip;

type ReadinessCheck = { id: string; label?: string; ok?: boolean; detail?: string };

describe('graph route readiness by shader source', () => {
  function reportFor(entry: Record<string, unknown>) {
    const broker = createNativeRendererBroker({
      appRoot: process.cwd(), resourcesPath: process.cwd(), isPackaged: false, platform: 'darwin', env: {},
    }) as any;
    broker.child = { killed: false };
    broker.lastStatus = { ...broker.lastStatus, running: true, backend_ready: true, last_frame_error: '' };
    const features = ['compute_shader_host', 'compute_graph_host', 'compute_graph_render',
      'compute_graph_source_frame_target', 'persistent_compute_buffers', 'native_x_graph'];
    broker.capabilities = {
      core_capabilities_confirmed: true,
      features: Object.fromEntries(features.map((f) => [f, true])),
      native_graph_instruments: ['x'],
      native_graph_instrument_manifest: [{
        id: 'x', label: 'X', source_uri_prefix: 'native-graph://x/', features: ['native_x_graph'],
        render_target: 'source_frame', parity: 'test', ...entry,
      }],
    };
    return new Map<string, ReadinessCheck>(
      broker.readinessReport().checks.map((check: ReadinessCheck) => [check.id, check]),
    ).get('native-x-graph');
  }

  it('accepts a runtime-shader instrument with no built-in shaders', () => {
    expect(reportFor({ shader_source: 'runtime', shader_ids: [], shader_count: 0 })?.ok).toBe(true);
  });

  it('still rejects a built-in instrument that lists no shaders', () => {
    const check = reportFor({ shader_source: 'builtin', shader_ids: [], shader_count: 0 });
    expect(check?.ok).toBe(false);
    expect(check?.detail).toMatch(/shader_ids missing/);
    // An entry from a core that predates shader_source counts as built-in.
    expect(reportFor({ shader_ids: [], shader_count: 0 })?.ok).toBe(false);
    expect(reportFor({ shader_ids: ['x/render'], shader_count: 1 })?.ok).toBe(true);
  });
});

describe('native output gates on a fresh core', () => {
  let broker: any = null;
  afterAll(async () => {
    if (!broker) return;
    await broker.invoke('native_renderer_stop').catch(() => {});
    broker.shutdownSync?.();
  });

  itIfNativeCore('makes every manifest graph route ready, so the output driver can open', async () => {
    broker = createNativeRendererBroker({
      appRoot: process.cwd(),
      resourcesPath: process.cwd(),
      isPackaged: false,
      platform: process.platform,
      env: { ...process.env, GA_NATIVE_VIDEO_PREFETCH: '0' },
    });
    const status = await broker.invoke('native_renderer_start', {
      config: {
        backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
        width: 320,
        height: 180,
        target_fps: 30,
      },
    });
    expect(status?.backend_ready).toBe(true);

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    const manifest: Array<{ id: string }> = capabilities?.native_graph_instrument_manifest ?? [];
    expect(manifest.length).toBeGreaterThan(0);

    const report = broker.readinessReport();
    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );
    const notReady = manifest
      .map((entry) => checks.get(entry.id === 'smoke-3d' ? 'native-3d-smoke-graph' : `native-${entry.id}-graph`))
      .filter((check) => !check?.ok)
      .map((check) => `${check?.id}: ${check?.detail}`);
    expect(notReady).toEqual([]);
    expect(checks.get('compute-instrument-host')?.ok).toBe(true);
    expect(report.modes.output_driver.detail).not.toMatch(/instrument routes are incomplete/);
    expect(report.modes.output_driver.ok).toBe(true);
  }, 60000);
});
