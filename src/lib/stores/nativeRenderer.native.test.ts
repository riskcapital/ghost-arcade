import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
  deriveNativeRendererRuntimeState,
  inferNativeGraphRuntimeFlags,
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

function readiness(
  modes: RendererReadinessReport['modes'],
  overrides: Partial<RendererReadinessReport> = {},
): RendererReadinessReport {
  return {
    timestamp_ms: 100,
    overall_ready: true,
    blockers: [],
    modes,
    capabilities: capabilities(),
    checks: [],
    ...overrides,
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

  it('surfaces native output texture-share readiness for the toolbar', () => {
    const state = deriveNativeRendererRuntimeState(
      status(),
      readiness(
        {
          shadow: { ok: true, detail: 'shadow ready' },
          output_driver: { ok: true, detail: 'output ready' },
          full_v2: { ok: false, detail: 'sender pending', blockers: ['Syphon native texture-share sender is not active-ready'] },
        },
        {
          texture_share: {
            platform: 'syphon',
            label: 'Syphon',
            available: true,
            nativeOutputCapable: true,
            nativeOutputActive: false,
            nativeOutputWaitingForFrame: true,
            nativeOutputLastPublishedFrame: 42,
            nativeOutputPendingPromotion: true,
            nativeOutputPromotionAttempts: 3,
            nativeOutputPromotionReason: 'waiting-for-native-output',
          },
          checks: [
            {
              id: 'shared-texture-source-frame-upload',
              label: 'Shared texture source-frame transport',
              ok: true,
              detail: 'source-frame IOSurface upload is available',
            },
            {
              id: 'shared-texture-upload',
              label: 'Shared texture media transport',
              ok: false,
              detail: 'full media transport is pending',
            },
            {
              id: 'shared-texture-output-export',
              label: 'Native output shared-texture export',
              ok: true,
              detail: 'native output mirror is exported as an IOSurface handle',
            },
            {
              id: 'native-effect-pass-manifest',
              label: 'Native source-frame effect-pass route',
              ok: true,
              detail: '46 source-frame layer effects can route through the native effect-pass graph',
            },
            {
              id: 'native-texture-share-sender',
              label: 'Native Syphon sender',
              ok: false,
              detail: 'native output IOSurface pump is waiting for the first rendered frame',
            },
          ],
        },
      ),
      {
        capabilities: capabilities({ shared_texture_output_export: true }),
        graphCatalogComplete: true,
        nativeGraphSourceFrames: true,
        updatedAtMs: 127,
      },
    );

    expect(state.textureShareLabel).toBe('Syphon');
    expect(state.textureSharePlatform).toBe('syphon');
    expect(state.textureShareAvailable).toBe(true);
    expect(state.sharedTextureSourceFrameUploadReady).toBe(true);
    expect(state.sharedTextureMediaTransportReady).toBe(false);
    expect(state.sharedTextureOutputExportReady).toBe(true);
    expect(state.nativeEffectPassReady).toBe(true);
    expect(state.nativeEffectPassDetail).toContain('source-frame layer effects');
    expect(state.nativeTextureShareSenderReady).toBe(false);
    expect(state.nativeTextureShareSenderDetail).toContain('waiting for the first rendered frame');
    expect(state.nativeOutputShareCapable).toBe(true);
    expect(state.nativeOutputShareActive).toBe(false);
    expect(state.nativeOutputShareWaitingForFrame).toBe(true);
    expect(state.nativeOutputShareLastPublishedFrame).toBe(42);
    expect(state.nativeOutputSharePendingPromotion).toBe(true);
    expect(state.nativeOutputSharePromotionAttempts).toBe(3);
    expect(state.nativeOutputSharePromotionReason).toBe('waiting-for-native-output');
  });

  it('does not promote to the main driver when local graph routes are incomplete', () => {
    const state = deriveNativeRendererRuntimeState(
      status(),
      readiness({
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      }),
      {
        capabilities: capabilities(),
        graphCatalogComplete: false,
        nativeGraphSourceFrames: true,
        updatedAtMs: 126,
      },
    );

    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
    expect(state.blockers).toContain('native graph instrument catalog is incomplete');
    expect(state.readinessDetail).toContain('main driver waiting on native graph instrument catalog');
  });

  it('uses broker graph checks to keep incomplete native catalogs out of main-driver mode', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: capabilities({
          native_3d_smoke_graph: true,
          native_particle_field_graph: false,
        }),
        checks: [
          {
            id: 'native-3d-smoke-graph',
            label: '3D Smoke',
            ok: true,
            detail: 'ready',
          },
          {
            id: 'native-particle-field-graph',
            label: 'Particle Field',
            ok: false,
            detail: 'missing shader',
          },
        ],
      },
    );
    const flags = inferNativeGraphRuntimeFlags(report.capabilities, report);
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 128,
    });

    expect(flags).toEqual({
      graphCatalogComplete: false,
      nativeGraphSourceFrames: true,
    });
    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
    expect(state.blockers).toContain('native graph instrument catalog is incomplete');
  });

  it('uses compact, user-readable labels for the toolbar', () => {
    expect(nativeRendererModeLabel('offline')).toBe('WebGL Fallback');
    expect(nativeRendererModeLabel('shadow')).toBe('Native Scene Sync');
    expect(nativeRendererModeLabel('output-driver')).toBe('Native Output Driver');
    expect(nativeRendererModeLabel('full-v2')).toBe('Native Main Driver');
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
