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
  NativeGraphInstrumentManifestEntry,
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

const graphManifests = [
  { id: 'planet', feature: 'native_planet_graph', shaderIds: ['planet/render'] },
  {
    id: 'smoke-3d',
    feature: 'native_3d_smoke_graph',
    shaderIds: [
      '3d-smoke/splat',
      '3d-smoke/advect-velocity',
      '3d-smoke/divergence',
      '3d-smoke/jacobi',
      '3d-smoke/subtract-gradient',
      '3d-smoke/advect-density',
      '3d-smoke/render',
    ],
  },
  {
    id: 'particle-field',
    feature: 'native_particle_field_graph',
    shaderIds: [
      'particle-field/behavior',
      'particle-field/edges',
      'particle-field/fog',
      'particle-field/render',
      'particle-field/lines',
    ],
  },
  {
    id: 'volumetric-spheres',
    feature: 'native_volumetric_spheres_graph',
    shaderIds: ['volumetric-spheres/sim', 'volumetric-spheres/render'],
  },
  {
    id: 'smoke-riders',
    feature: 'native_smoke_riders_graph',
    shaderIds: [
      '3d-smoke/splat',
      '3d-smoke/advect-velocity',
      '3d-smoke/divergence',
      '3d-smoke/jacobi',
      '3d-smoke/subtract-gradient',
      '3d-smoke/advect-density',
      '3d-smoke/render',
      'volumetric-spheres/sim',
      'volumetric-spheres/render',
    ],
  },
  {
    id: 'ink-cloud',
    feature: 'native_ink_cloud_graph',
    shaderIds: ['ink-cloud/sim', 'ink-cloud/render', 'ink-cloud/background'],
  },
  { id: 'flythrough', feature: 'native_flythrough_graph', shaderIds: ['flythrough/compute', 'flythrough/render'] },
  {
    id: 'pixel-particles',
    feature: 'native_pixel_particles_graph',
    shaderIds: ['pixel-particles/compute', 'pixel-particles/render'],
  },
  {
    id: 'point-cloud-fx',
    feature: 'native_point_cloud_fx_graph',
    shaderIds: [
      'point-cloud-fx/compute',
      'point-cloud-fx/sort-fill',
      'point-cloud-fx/sort-step',
      'point-cloud-fx/render',
    ],
  },
];

function completeGraphCapabilities(
  features: Record<string, boolean> = {},
  manifestOverride?: (
    entry: NativeGraphInstrumentManifestEntry,
  ) => NativeGraphInstrumentManifestEntry,
): NativeRendererCapabilities {
  return {
    ...capabilities({
      ...Object.fromEntries(graphManifests.map((entry) => [entry.feature, true])),
      ...features,
    }),
    native_graph_instruments: graphManifests.map((entry) => entry.id),
    native_graph_instrument_manifest: graphManifests.map((entry) => {
      const manifest = {
        id: entry.id,
        label: entry.id,
        source_uri_prefix: `native-graph://${entry.id}/`,
        shader_ids: entry.shaderIds,
        shader_count: entry.shaderIds.length,
        features: [entry.feature],
        render_target: 'source_frame',
        parity: `${entry.id}-parity`,
      };
      return manifestOverride ? manifestOverride(manifest) : manifest;
    }),
  };
}

const mainDriverFeatureSet = {
  native_output_mirror_texture: true,
  managed_output_attach: true,
  managed_output_window_control: true,
  native_static_image_decode: true,
  native_static_image_prefetch: true,
  compute_graph_texture_sampling: true,
  native_effect_pass_manifest: true,
  shared_texture_upload: true,
  shared_texture_output_export: true,
  native_texture_share_sender: true,
  native_media_decode: true,
  media_prefetch: true,
  native_video_frame_decode: true,
  native_video_frame_prefetch: true,
  native_video_decode_pump: true,
  native_video_decode_pump_window: true,
  native_recording: true,
  native_stage3d: true,
  native_stage3d_output_renderer: true,
  native_stage3d_recording_parity: true,
  native_projection_sim: true,
  native_projection_sim_output_renderer: true,
  native_projection_sim_recording_parity: true,
};

function completeMainDriverCapabilities(features: Record<string, boolean> = {}): NativeRendererCapabilities {
  return {
    ...completeGraphCapabilities({
      ...mainDriverFeatureSet,
      ...features,
    }),
    implemented_methods: ['export_frame_snapshot'],
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
          capabilities: gateState.full_v2 ? completeMainDriverCapabilities() : capabilities(),
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
      { capabilities: completeGraphCapabilities(), updatedAtMs: 125 },
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

  it('does not infer a complete graph catalog from a partial capabilities fallback', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: capabilities({
          native_3d_smoke_graph: true,
          native_particle_field_graph: true,
        }),
        checks: [],
      },
    );
    const flags = inferNativeGraphRuntimeFlags(report.capabilities, report);
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 129,
    });

    expect(flags).toEqual({
      graphCatalogComplete: false,
      nativeGraphSourceFrames: true,
    });
    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
  });

  it('does not infer a complete graph catalog when a graph feature flag is missing', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: completeGraphCapabilities({
          native_pixel_particles_graph: false,
        }),
        checks: [],
      },
    );
    const flags = inferNativeGraphRuntimeFlags(report.capabilities, report);
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 131,
    });

    expect(flags).toEqual({
      graphCatalogComplete: false,
      nativeGraphSourceFrames: true,
    });
    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
  });

  it('does not infer a complete graph catalog when manifest metadata is stale', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: completeGraphCapabilities({}, (entry) =>
          entry.id === 'smoke-3d'
            ? {
              ...entry,
              render_target: 'snapshot',
              parity: '',
            }
            : entry,
        ),
        checks: [],
      },
    );
    const flags = inferNativeGraphRuntimeFlags(report.capabilities, report);
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 132,
    });

    expect(flags).toEqual({
      graphCatalogComplete: false,
      nativeGraphSourceFrames: true,
    });
    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
  });

  it('does not infer a complete graph catalog when manifest shaders are missing', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: completeGraphCapabilities({}, (entry) =>
          entry.id === 'point-cloud-fx'
            ? {
              ...entry,
              shader_ids: ['point-cloud-fx/compute'],
            }
            : entry,
        ),
        checks: [],
      },
    );
    const flags = inferNativeGraphRuntimeFlags(report.capabilities, report);
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 133,
    });

    expect(flags).toEqual({
      graphCatalogComplete: false,
      nativeGraphSourceFrames: true,
    });
    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
  });

  it('allows a complete capabilities fallback when graph checks are unavailable', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: completeGraphCapabilities({
          native_3d_smoke_graph: true,
          native_particle_field_graph: true,
          ...mainDriverFeatureSet,
        }),
        checks: [],
      },
    );
    const flags = inferNativeGraphRuntimeFlags(report.capabilities, report);
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 130,
    });

    expect(flags).toEqual({
      graphCatalogComplete: true,
      nativeGraphSourceFrames: true,
    });
    expect(state.driverMode).toBe('full-v2');
    expect(state.fullV2Ready).toBe(true);
  });

  it('does not promote to the main driver when a local runtime gate is missing', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: completeMainDriverCapabilities({
          native_recording: false,
        }),
        checks: [],
      },
    );
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 134,
    });

    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
    expect(state.blockers).toContain('native recording/MP4 frame path is not fully ready');
  });

  it('uses broker readiness checks to down-promote stale full-v2 reports', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: completeMainDriverCapabilities(),
        checks: [
          {
            id: 'native-effect-pass-manifest',
            label: 'Native source-frame effect-pass route',
            ok: false,
            detail: 'native effect-pass graph manifest is incomplete',
          },
        ],
      },
    );
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 135,
    });

    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
    expect(state.blockers).toContain('native source-frame effect-pass route is incomplete');
    expect(state.nativeEffectPassReady).toBe(false);
  });

  it('uses texture-share sender readiness checks over stale feature flags', () => {
    const report = readiness(
      {
        shadow: { ok: true, detail: 'shadow ready' },
        output_driver: { ok: true, detail: 'output ready' },
        full_v2: { ok: true, detail: 'full ready', blockers: [] },
      },
      {
        capabilities: completeMainDriverCapabilities(),
        texture_share: {
          platform: 'syphon',
          label: 'Syphon',
          available: true,
          nativeOutputCapable: true,
          nativeOutputActive: true,
          nativeOutputWaitingForFrame: true,
          nativeOutputLastPublishedFrame: 0,
        },
        checks: [
          {
            id: 'native-texture-share-sender',
            label: 'Native Syphon sender',
            ok: false,
            detail: 'native output IOSurface pump is waiting for the first rendered frame',
          },
        ],
      },
    );
    const state = deriveNativeRendererRuntimeState(status(), report, {
      capabilities: report.capabilities,
      updatedAtMs: 136,
    });

    expect(state.driverMode).toBe('output-driver');
    expect(state.fullV2Ready).toBe(false);
    expect(state.blockers).toContain('native texture-share sender is not active-ready');
    expect(state.nativeTextureShareSenderReady).toBe(false);
    expect(state.nativeTextureShareSenderDetail).toContain('waiting for the first rendered frame');
    expect(state.nativeOutputShareWaitingForFrame).toBe(true);
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
