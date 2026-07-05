import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  deriveNativeRendererRuntimeState,
  nativeRendererRuntime,
  nativeRendererModeLabel,
  resetNativeRendererRuntime,
  updateNativeRendererRuntimeFromStartup,
  updateNativeRendererRuntimeFromStatus,
  type NativeRendererDriverMode,
} from './nativeRenderer';
import type {
  NativeRendererCapabilities,
  RendererReadinessReport,
  RendererStatus,
} from '$lib/api/native-renderer';

function status(overrides: Partial<RendererStatus> = {}): RendererStatus {
  return {
    running: true,
    backend_ready: true,
    backend: 'metal',
    adapter_name: 'Apple M1 Max',
    source_frame_size: 2048,
    source_frame_format: 'rgba16float',
    source_frame_mip_levels: 4,
    native_graph_source_frame_layers: 3,
    compute_graph_runs: 12,
    compute_graph_passes: 48,
    avg_render_gpu_ms: 2.25,
    last_frame_error: null,
    ...overrides,
  } as RendererStatus;
}

function capabilities(features: Record<string, boolean> = {}): NativeRendererCapabilities {
  return {
    schema_version: 1,
    core_version: 'native-test',
    backend: 'metal',
    core_capabilities_confirmed: true,
    implemented_methods: [],
    implemented_command_types: [],
    native_graph_instruments: ['smoke-3d', 'particle-field'],
    features: {
      compute_graph_host: true,
      compute_graph_render: true,
      compute_graph_source_frame_target: true,
      ...features,
    },
    limits: {},
    notes: [],
  };
}

function readiness(modes: RendererReadinessReport['modes']): RendererReadinessReport {
  return {
    timestamp_ms: 100,
    overall_ready: true,
    blockers: [],
    modes,
    capabilities: capabilities(),
    checks: [],
  };
}

describe('native renderer runtime state', () => {
  it.each([
    ['full-v2', { shadow: true, output_driver: true, full_v2: true }],
    ['output-driver', { shadow: true, output_driver: true, full_v2: false }],
    ['shadow', { shadow: true, output_driver: false, full_v2: false }],
    ['degraded', { shadow: false, output_driver: false, full_v2: false }],
  ] as Array<[NativeRendererDriverMode, Record<string, boolean>]>)(
    'derives %s mode from readiness gates',
    (expected, gateState) => {
      const state = deriveNativeRendererRuntimeState(
        status(),
        readiness({
          shadow: { ok: gateState.shadow, detail: 'shadow detail' },
          output_driver: { ok: gateState.output_driver, detail: 'output detail' },
          full_v2: {
            ok: gateState.full_v2,
            detail: 'full detail',
            blockers: gateState.full_v2 ? [] : ['native output driver is not ready'],
          },
        }),
        {
          capabilities: capabilities(),
          graphCatalogComplete: true,
          nativeGraphSourceFrames: true,
          updatedAtMs: 123,
        },
      );

      expect(state.driverMode).toBe(expected);
      expect(state.running).toBe(true);
      expect(state.backendReady).toBe(true);
      expect(state.graphCatalogComplete).toBe(true);
      expect(state.nativeGraphSourceFrames).toBe(true);
      expect(state.nativeGraphSourceFrameLayers).toBe(3);
      expect(state.computeGraphRuns).toBe(12);
      expect(state.computeGraphPasses).toBe(48);
      expect(state.sourceFrameSize).toBe(2048);
      expect(state.sourceFrameFormat).toBe('rgba16float');
      expect(state.sourceFrameMipLevels).toBe(4);
      expect(state.averageGpuMs).toBe(2.25);
    },
  );

  it('stays offline when the core is not running', () => {
    const state = deriveNativeRendererRuntimeState(
      status({ running: false, backend_ready: false, adapter_name: null }),
      null,
      { capabilities: capabilities(), updatedAtMs: 124 },
    );

    expect(state.driverMode).toBe('offline');
    expect(state.readinessDetail).toBe('native renderer is offline');
    expect(state.adapterName).toBeNull();
  });

  it('keeps full-v2 blockers visible before the full native path is ready', () => {
    const state = deriveNativeRendererRuntimeState(
      status(),
      readiness({
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: {
          ok: false,
          detail: '2 tracked gates remain',
          blockers: ['shared-texture media transport is pending', 'native Stage3D renderer is pending'],
        },
      }),
      { capabilities: capabilities(), updatedAtMs: 125 },
    );

    expect(state.driverMode).toBe('output-driver');
    expect(state.blockers).toEqual([
      'shared-texture media transport is pending',
      'native Stage3D renderer is pending',
    ]);
  });

  it('uses compact, user-readable labels for the toolbar', () => {
    expect(nativeRendererModeLabel('offline')).toBe('Offline');
    expect(nativeRendererModeLabel('shadow')).toBe('Shadow');
    expect(nativeRendererModeLabel('output-driver')).toBe('Output Driver');
    expect(nativeRendererModeLabel('full-v2')).toBe('Full V2');
  });

  it('preserves startup readiness mode across status-only polling updates', () => {
    updateNativeRendererRuntimeFromStartup(
      status(),
      readiness({
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: false, detail: 'one gate remains', blockers: ['shared texture pending'] },
      }),
      capabilities(),
      true,
      true,
    );

    updateNativeRendererRuntimeFromStatus(status({ compute_graph_runs: 16, compute_graph_passes: 64 }), {
      graphCatalogComplete: true,
      nativeGraphSourceFrames: true,
    });

    expect(get(nativeRendererRuntime)).toMatchObject({
      driverMode: 'output-driver',
      outputDriverReady: true,
      computeGraphRuns: 16,
      computeGraphPasses: 64,
      readinessDetail: 'output ready',
      blockers: ['shared texture pending'],
    });

    resetNativeRendererRuntime();
  });
});
