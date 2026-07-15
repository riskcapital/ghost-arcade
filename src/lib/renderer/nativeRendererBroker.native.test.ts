import { describe, expect, it } from 'vitest';
// @ts-expect-error The Electron broker is authored as ESM JavaScript; this test exercises it directly.
import { createNativeRendererBroker } from '../../../electron/native-renderer-broker.js';

type ReadinessCheck = {
  id: string;
  ok?: boolean;
  detail?: string;
};

type TextureShareStatus = {
  available: boolean;
  platform: string;
  label: string;
  senderMode?: string;
  nativeOutputCapable?: boolean;
  nativeOutputTransport?: string;
  nativeOutputRequiresNamedTexture?: boolean;
  nativeOutputActive?: boolean;
  nativeOutputWaitingForFrame?: boolean;
  nativeOutputLastPublishedFrame?: number;
};

type NativeEditorPreviewStatus = {
  available: boolean;
  attached: boolean;
  pumpActive: boolean;
  mode: string;
  presentation: string;
  transport?: string;
  lastPresentedFrame: number;
  framesPresented: number;
};

const nativeGraphManifests = [
  {
    id: 'planet',
    feature: 'native_planet_graph',
    shader_ids: ['planet/render'],
  },
  {
    id: 'smoke-3d',
    feature: 'native_3d_smoke_graph',
    shader_ids: [
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
    shader_ids: [
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
    shader_ids: ['volumetric-spheres/sim', 'volumetric-spheres/render'],
  },
  {
    id: 'smoke-riders',
    feature: 'native_smoke_riders_graph',
    shader_ids: [
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
    shader_ids: ['ink-cloud/sim', 'ink-cloud/render', 'ink-cloud/background'],
  },
  {
    id: 'flythrough',
    feature: 'native_flythrough_graph',
    shader_ids: ['flythrough/compute', 'flythrough/render'],
  },
  {
    id: 'pixel-particles',
    feature: 'native_pixel_particles_graph',
    shader_ids: ['pixel-particles/compute', 'pixel-particles/render'],
  },
];

function coreCapabilities(features: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const sharedSourceFrameReady = features.shared_texture_source_frame_upload === true;
  const backend = String(overrides.backend ?? 'metal');
	  const outputSharedTextureExport = (overrides.output_shared_texture_export as { available?: boolean } | undefined) ??
	    (features.shared_texture_output_export === true
	      ? outputSharedTextureExportContractForBackend(backend, true)
	      : outputSharedTextureExportContractForBackend(backend, false));
	  const nativeEditorPreview = overrides.native_editor_preview
	    ?? nativeEditorPreviewContract(
	      outputSharedTextureExport?.available === true
	        && features.native_editor_preview_frame_source === true,
	      backend,
	    );
	  return {
    schema_version: 1,
    core_version: 'test-core',
    backend,
    implemented_methods: [
      'get_capabilities',
      'export_frame_snapshot',
      'frame_snapshot',
    ],
    implemented_command_types: [],
    native_graph_instruments: [],
    native_graph_instrument_manifest: [],
    native_compositor_blend_modes: [],
    native_compositor_effect_descriptors: [],
    native_effect_pass_descriptors: [],
    features: {
      native_frame_export: true,
      native_frame_sequence_export: true,
      frame_snapshot_export: true,
      native_recording: false,
      ...features,
    },
    limits: {},
    source_frame_shared_texture_import: sharedSourceFrameReady
      ? {
          available: true,
          backend: 'metal',
          platform: 'iosurface',
          importer: 'metal-iosurface',
          handle_scope: 'global-id',
          accepted_handle_encodings: ['integer', 'base64', 'hex', 'opaque'],
          accepted_formats: ['bgra8unorm', 'rgba8unorm', '80', '87', '28', '70'],
          reason: null,
        }
      : {
          available: false,
          backend: 'metal',
          platform: 'iosurface',
          importer: 'none',
          handle_scope: '',
          accepted_handle_encodings: [],
          accepted_formats: [],
          reason: 'native renderer is not running',
        },
	    output_shared_texture_export: outputSharedTextureExport,
	    native_editor_preview: nativeEditorPreview,
	    notes: [],
	    ...overrides,
	  };
	}

function createBroker({
  encoderAvailable = true,
  textureShareStatus = null,
  nativeEditorPreviewStatus = {
    available: true,
    attached: true,
    pumpActive: true,
    mode: 'shared-texture-import-blit',
    presentation: 'underlay-zero-copy',
    transport: '',
    lastPresentedFrame: 8,
    framesPresented: 8,
  },
  platform = 'darwin',
}: {
  encoderAvailable?: boolean;
  textureShareStatus?: TextureShareStatus | null;
  nativeEditorPreviewStatus?: NativeEditorPreviewStatus | null;
  platform?: NodeJS.Platform;
} = {}) {
  const broker = createNativeRendererBroker({
    appRoot: process.cwd(),
    resourcesPath: process.cwd(),
    isPackaged: false,
    platform,
    env: {
      ...process.env,
      GA_NATIVE_VIDEO_PREFETCH: '0',
    },
    nativeFrameEncoderStatusProvider: () => ({
      available: encoderAvailable,
      activeSessions: 0,
      mp4ActiveSessions: 0,
      jpegActiveSessions: 0,
      encoder: 'ffmpeg',
      reason: encoderAvailable ? null : 'ffmpeg unavailable in test',
    }),
    textureShareStatusProvider: textureShareStatus ? () => textureShareStatus : null,
    nativeEditorPreviewStatusProvider: nativeEditorPreviewStatus ? () => ({
      ...nativeEditorPreviewStatus,
      transport: nativeEditorPreviewStatus.transport ||
        (platform === 'win32' ? 'dxgi' : platform === 'darwin' ? 'iosurface' : 'none'),
    }) : null,
  }) as any;
  broker.child = { killed: false };
  broker.lastStatus = {
    ...broker.lastStatus,
    running: true,
    backend_ready: true,
    adapter_name: 'Test GPU',
    last_frame_error: '',
  };
  return broker;
}

function completeNativeV2Features() {
  const graphFeatures = Object.fromEntries(nativeGraphManifests.map((entry) => [entry.feature, true]));
  return {
    compute_shader_host: true,
    compute_graph_host: true,
    compute_graph_render: true,
    compute_graph_texture_sampling: true,
    compute_graph_source_frame_target: true,
    persistent_compute_buffers: true,
    native_output_mirror_texture: true,
    native_editor_preview_frame_source: true,
    isf_glsl_parse_probe: true,
    isf_glsl_host: true,
    shared_texture_source_frame_upload: true,
    shared_texture_upload: true,
    shared_texture_output_export: true,
    managed_output_attach: true,
    managed_output_window_control: true,
    native_static_image_decode: true,
    native_static_image_prefetch: true,
    native_media_decode: true,
    media_prefetch: true,
    native_video_frame_decode: true,
    native_video_frame_prefetch: true,
    native_video_decode_pump: true,
    native_video_decode_pump_window: true,
    native_stage3d: true,
    native_stage3d_output_renderer: true,
    native_stage3d_recording_parity: true,
    native_projection_sim: true,
    native_projection_sim_output_renderer: true,
    native_projection_sim_recording_parity: true,
    ...graphFeatures,
  };
}

function completeGraphManifestOverrides(overrides: Record<string, unknown> = {}) {
  const backend = String(overrides.backend ?? 'metal');
  return {
    native_graph_instruments: nativeGraphManifests.map((entry) => entry.id),
    native_graph_instrument_manifest: nativeGraphManifests.map((entry) => ({
      id: entry.id,
      label: entry.id,
      source_uri_prefix: `native-graph://${entry.id}/`,
      shader_ids: entry.shader_ids,
      shader_count: entry.shader_ids.length,
      features: [entry.feature],
      render_target: 'source_frame',
      parity: `${entry.id}-parity`,
    })),
    native_editor_preview: nativeEditorPreviewContract(true, backend, true),
    ...overrides,
  };
}

function windowsSharedTextureImportContract() {
  return {
    available: true,
    backend: 'd3d12',
    platform: 'dxgi',
    importer: 'd3d12-open-shared-handle',
    handle_scope: 'process-handle',
    accepted_handle_encodings: ['integer', 'base64', 'hex', 'opaque'],
    accepted_formats: ['bgra8unorm', 'rgba8unorm', '80', '87', '28', '70'],
    reason: null,
  };
}

function outputSharedTextureExportContractForBackend(backend: string, available = true) {
  const colorContract = {
    color_space: 'srgb',
    storage_format: 'bgra8unorm',
    storage_encoding: 'srgb-encoded-bgra8unorm',
    alpha_mode: 'opaque',
    premultiplied_alpha: false,
    single_render_source: 'core-output-composite',
    zero_conversions: true,
  };
  if (backend === 'd3d12') {
    return {
      available,
      backend: 'd3d12',
      platform: 'dxgi',
      exporter: available ? 'd3d12-shared-resource-name' : 'none',
      handle_scope: available ? 'process-local' : '',
      preferred_transport: available ? 'shared_name' : '',
      handle_encoding: available ? 'integer' : '',
      handle_byte_length: available ? 8 : 0,
      name_scope: available ? 'local-session' : '',
      exported_formats: available ? ['bgra8unorm'] : [],
      ...colorContract,
      publisher: available ? 'SpoutOutput.sendTextureByName' : 'none',
      reason: available ? null : 'native output shared texture export is unavailable',
    };
  }
  return {
    available,
    backend: 'metal',
    platform: 'iosurface',
    exporter: available ? 'metal-iosurface' : 'none',
    handle_scope: available ? 'global-id' : '',
    preferred_transport: available ? 'handle' : '',
    handle_encoding: available ? 'integer' : '',
    handle_byte_length: available ? 4 : 0,
    exported_formats: available ? ['bgra8unorm'] : [],
    ...colorContract,
    publisher: available ? 'SyphonOutput.publishIOSurface' : 'none',
    reason: available ? null : 'native output shared texture export is unavailable',
  };
}

function nativeEditorPreviewContract(available = true, backend = 'metal', productionReady = false) {
  return {
    available,
    mode: available ? (productionReady ? 'shared-texture-import-blit' : 'embedded-presenter-pending') : 'unavailable',
    presentation: available ? (productionReady ? 'underlay-zero-copy' : 'unavailable') : 'unavailable',
    needs_underlay_lock_in: available && !productionReady,
    production_ready: productionReady,
    parented: productionReady,
    source: available ? 'core-output-composite' : 'native-unavailable',
    single_render: available,
    transport: backend === 'd3d12' ? 'dxgi' : backend === 'metal' ? 'iosurface' : 'none',
    color_space: 'srgb',
    storage_format: 'bgra8unorm',
    storage_encoding: 'srgb-encoded-bgra8unorm',
    alpha_mode: 'opaque',
    premultiplied_alpha: false,
    zero_conversions: true,
    reason: available
      ? (productionReady ? null : 'native core-output composite is available; editor embedded shared-texture presenter is pending')
      : 'native renderer is not running',
  };
}

describe('native renderer broker capability overlay', () => {
  it('promotes raw frame export plus desktop MP4 encoder into native recording readiness', async () => {
    const broker = createBroker({ encoderAvailable: true });
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      return coreCapabilities();
    };

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    expect(capabilities.core_capabilities_confirmed).toBe(true);
    expect(capabilities.features.native_frame_export).toBe(true);
    expect(capabilities.features.frame_snapshot_export).toBe(true);
    expect(capabilities.features.native_mp4_frame_encoder).toBe(true);
    expect(capabilities.features.native_recording).toBe(true);

    const checks = new Map<string, ReadinessCheck>(
      broker.readinessReport().checks.map((check: ReadinessCheck) => [check.id, check]),
    );
    expect(checks.get('native-frame-export')?.ok).toBe(true);
    expect(checks.get('native-recording')?.ok).toBe(true);
    expect(String(checks.get('native-recording')?.detail ?? '')).toContain('MP4/JPEG encoders');
  });

  it('keeps native recording unavailable when the desktop encoder bridge is missing', async () => {
    const broker = createBroker({ encoderAvailable: false });
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      return coreCapabilities();
    };

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    expect(capabilities.features.native_frame_export).toBe(true);
    expect(capabilities.features.native_mp4_frame_encoder).toBe(false);
    expect(capabilities.features.native_recording).toBe(false);

    const checks = new Map<string, ReadinessCheck>(
      broker.readinessReport().checks.map((check: ReadinessCheck) => [check.id, check]),
    );
    expect(checks.get('native-frame-export')?.ok).toBe(true);
    expect(checks.get('native-recording')?.ok).toBe(false);
    expect(String(checks.get('native-recording')?.detail ?? '')).toContain('ffmpeg unavailable');
  });

  it('does not promote the Electron FFmpeg video bridge into native-only readiness', async () => {
    const broker = createBroker({
      encoderAvailable: true,
      textureShareStatus: {
        available: true,
        platform: 'syphon',
        label: 'Syphon',
        senderMode: 'native-iosurface',
        nativeOutputCapable: true,
        nativeOutputActive: true,
        nativeOutputWaitingForFrame: false,
        nativeOutputLastPublishedFrame: 8,
      },
    });
    broker.lastStatus = {
      ...broker.lastStatus,
      output_window_attached: true,
      output_swapchain_ready: true,
      output_present_healthy: true,
      swapchain_presented: 5,
      frames_presented: 5,
      scene_layers_active: 1,
      output_last_presented_layer_count: 1,
      swapchain_last_present_result: 'ok',
    };
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      return coreCapabilities(
        {
          ...completeNativeV2Features(),
          native_video_frame_decode: false,
          native_video_frame_prefetch: false,
          native_video_decode_pump: false,
          native_video_decode_pump_window: false,
        },
        completeGraphManifestOverrides(),
      );
    };

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    expect(capabilities.features.native_video_frame_prefetch).toBe(false);
    expect(capabilities.features.video_frame_prefetch).toBe(false);

    const decodeCapabilities = await broker.invoke('native_renderer_get_decode_capabilities');
    expect(decodeCapabilities.video_decode).toBe(false);
    expect(decodeCapabilities.native_video_frame_prefetch).toBe(false);
    expect(decodeCapabilities.video_frame_prefetch).toBe(false);
    expect(decodeCapabilities.supported_source_types).toEqual(['image']);

    await expect(
      broker.invoke('native_renderer_prefetch_media', {
        source_id: 'native-only-video',
        uri: '/tmp/native-only-video.mp4',
        source_type: 'video',
      }),
    ).rejects.toThrow(/render-core video decode pump/);

    const report = broker.readinessReport();
    expect(report.modes.output_driver.ok).toBe(true);
    expect(report.modes.full_v2.ok).toBe(false);
    expect(report.modes.full_v2.blockers).toEqual([
      'native render-clock video decode pump is not fully ready',
    ]);
  });

  it('promotes full-v2 when native output, graph routes, media, recording, and texture share are ready', async () => {
    const broker = createBroker({
      encoderAvailable: true,
      textureShareStatus: {
        available: true,
        platform: 'syphon',
        label: 'Syphon',
        senderMode: 'native-iosurface',
        nativeOutputCapable: true,
        nativeOutputActive: true,
        nativeOutputWaitingForFrame: false,
        nativeOutputLastPublishedFrame: 8,
      },
    });
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      const graphFeatures = Object.fromEntries(nativeGraphManifests.map((entry) => [entry.feature, true]));
      return coreCapabilities(
        {
          compute_shader_host: true,
          compute_graph_host: true,
          compute_graph_render: true,
          compute_graph_texture_sampling: true,
          compute_graph_source_frame_target: true,
          persistent_compute_buffers: true,
          native_output_mirror_texture: true,
          native_editor_preview_frame_source: true,
          isf_glsl_parse_probe: true,
          isf_glsl_host: true,
          shared_texture_source_frame_upload: true,
          shared_texture_upload: true,
          shared_texture_output_export: true,
          managed_output_attach: true,
          managed_output_window_control: true,
          native_static_image_decode: true,
          native_static_image_prefetch: true,
          native_media_decode: true,
          media_prefetch: true,
          native_video_frame_decode: true,
          native_video_frame_prefetch: true,
          native_video_decode_pump: true,
          native_video_decode_pump_window: true,
          native_stage3d: true,
          native_stage3d_output_renderer: true,
          native_stage3d_recording_parity: true,
          native_projection_sim: true,
          native_projection_sim_output_renderer: true,
          native_projection_sim_recording_parity: true,
          ...graphFeatures,
        },
        {
          native_editor_preview: nativeEditorPreviewContract(true, 'metal', true),
          native_graph_instruments: nativeGraphManifests.map((entry) => entry.id),
          native_graph_instrument_manifest: nativeGraphManifests.map((entry) => ({
            id: entry.id,
            label: entry.id,
            source_uri_prefix: `native-graph://${entry.id}/`,
            shader_ids: entry.shader_ids,
            shader_count: entry.shader_ids.length,
            features: [entry.feature],
            render_target: 'source_frame',
            parity: `${entry.id}-parity`,
          })),
        },
      );
    };

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    expect(capabilities.features.native_recording).toBe(true);
    expect(capabilities.features.native_effect_pass_manifest).toBe(true);
    expect(capabilities.features.native_texture_share_sender).toBe(true);

    const report = broker.readinessReport();
    expect(report.modes.output_driver.ok).toBe(true);
    expect(report.modes.full_v2.ok).toBe(true);
    expect(report.modes.full_v2.blockers).toEqual([]);

    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );
    expect(checks.get('native-texture-share-sender')?.ok).toBe(true);
    expect(checks.get('native-media-decode')?.ok).toBe(true);
    expect(checks.get('native-recording')?.ok).toBe(true);
    expect(checks.get('native-stage3d-output-renderer')?.ok).toBe(true);
    expect(checks.get('native-stage3d-recording-parity')?.ok).toBe(true);
    expect(checks.get('native-projection-sim-output-renderer')?.ok).toBe(true);
    expect(checks.get('native-projection-sim-recording-parity')?.ok).toBe(true);
  });

  it('promotes full-v2 on Windows only when the Spout bridge can publish named DXGI output', async () => {
    const broker = createBroker({
      platform: 'win32',
      encoderAvailable: true,
      textureShareStatus: {
        available: true,
        platform: 'spout',
        label: 'Spout',
        senderMode: 'native-dxgi-capable',
        nativeOutputCapable: true,
        nativeOutputTransport: 'dxgi-shared-name',
        nativeOutputRequiresNamedTexture: true,
        nativeOutputActive: false,
        nativeOutputWaitingForFrame: false,
        nativeOutputLastPublishedFrame: 0,
      },
    });
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      return coreCapabilities(
        completeNativeV2Features(),
        completeGraphManifestOverrides({
          backend: 'd3d12',
          source_frame_shared_texture_import: windowsSharedTextureImportContract(),
        }),
      );
    };

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    expect(capabilities.features.native_texture_share_sender).toBe(true);

    const report = broker.readinessReport();
    expect(report.modes.output_driver.ok).toBe(true);
    expect(report.modes.full_v2.ok).toBe(true);
    expect(report.modes.full_v2.blockers).toEqual([]);
    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );
    expect(checks.get('native-texture-share-sender')?.ok).toBe(true);
    expect(checks.get('native-texture-share-sender')?.detail).toContain('Spout');
  });

  it('keeps Windows full-v2 blocked when the DXGI output contract is not shared-name publishable', async () => {
    const broker = createBroker({
      platform: 'win32',
      encoderAvailable: true,
      textureShareStatus: {
        available: true,
        platform: 'spout',
        label: 'Spout',
        senderMode: 'native-dxgi-capable',
        nativeOutputCapable: true,
        nativeOutputTransport: 'dxgi-shared-name',
        nativeOutputRequiresNamedTexture: true,
        nativeOutputActive: false,
        nativeOutputWaitingForFrame: false,
        nativeOutputLastPublishedFrame: 0,
      },
    });
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      return coreCapabilities(
        completeNativeV2Features(),
        completeGraphManifestOverrides({
          backend: 'd3d12',
          source_frame_shared_texture_import: windowsSharedTextureImportContract(),
          output_shared_texture_export: {
            available: true,
            backend: 'd3d12',
            platform: 'dxgi',
            exporter: 'd3d12-open-shared-handle',
            handle_scope: 'process-local',
	            preferred_transport: 'handle',
	            handle_encoding: 'integer',
	            handle_byte_length: 8,
	            exported_formats: ['bgra8unorm'],
	            color_space: 'srgb',
	            storage_format: 'bgra8unorm',
	            storage_encoding: 'srgb-encoded-bgra8unorm',
	            alpha_mode: 'opaque',
	            premultiplied_alpha: false,
	            single_render_source: 'core-output-composite',
	            zero_conversions: true,
	            publisher: 'SpoutOutput.sendTexture',
	            reason: null,
          },
        }),
      );
    };

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    expect(capabilities.features.shared_texture_output_export).toBe(true);
    expect(capabilities.features.native_texture_share_sender).toBe(false);

    const report = broker.readinessReport();
    expect(report.modes.full_v2.ok).toBe(false);
    expect(report.modes.full_v2.blockers).toContain(
      'native output shared-texture export contract is not ready',
    );
    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );
    expect(checks.get('shared-texture-output-export')?.ok).toBe(false);
    expect(checks.get('shared-texture-output-export')?.detail).toContain('preferred_transport');
    expect(checks.get('native-texture-share-sender')?.ok).toBe(false);
  });

  it('keeps Windows full-v2 blocked when Spout cannot publish named DXGI output', async () => {
    const broker = createBroker({
      platform: 'win32',
      encoderAvailable: true,
      textureShareStatus: {
        available: true,
        platform: 'spout',
        label: 'Spout',
        senderMode: 'native-texture-share-pending',
        nativeOutputCapable: false,
        nativeOutputTransport: 'dxgi-shared-name',
        nativeOutputRequiresNamedTexture: true,
        nativeOutputActive: false,
        nativeOutputWaitingForFrame: false,
        nativeOutputLastPublishedFrame: 0,
      },
    });
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      return coreCapabilities(
        completeNativeV2Features(),
        completeGraphManifestOverrides({
          backend: 'd3d12',
          source_frame_shared_texture_import: windowsSharedTextureImportContract(),
        }),
      );
    };

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    expect(capabilities.features.native_texture_share_sender).toBe(false);

    const report = broker.readinessReport();
    expect(report.modes.output_driver.ok).toBe(true);
    expect(report.modes.full_v2.ok).toBe(false);
    expect(report.modes.full_v2.blockers).toEqual([
      'Spout native texture-share sender is not active-ready',
    ]);
    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );
    expect(checks.get('native-texture-share-sender')?.ok).toBe(false);
    expect(checks.get('native-texture-share-sender')?.detail).toContain(
      'does not expose native output shared-texture publish',
    );
  });

  it('keeps texture-share sender unavailable while native output waits for its first frame', async () => {
    const broker = createBroker({
      encoderAvailable: true,
      textureShareStatus: {
        available: true,
        platform: 'syphon',
        label: 'Syphon',
        senderMode: 'native-iosurface',
        nativeOutputCapable: true,
        nativeOutputActive: true,
        nativeOutputWaitingForFrame: true,
        nativeOutputLastPublishedFrame: 0,
      },
    });
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      const graphFeatures = Object.fromEntries(nativeGraphManifests.map((entry) => [entry.feature, true]));
      return coreCapabilities(
        {
          compute_shader_host: true,
          compute_graph_host: true,
          compute_graph_render: true,
          compute_graph_texture_sampling: true,
          compute_graph_source_frame_target: true,
          persistent_compute_buffers: true,
          native_output_mirror_texture: true,
          native_editor_preview_frame_source: true,
          isf_glsl_parse_probe: true,
          isf_glsl_host: true,
          shared_texture_source_frame_upload: true,
          shared_texture_upload: true,
          shared_texture_output_export: true,
          managed_output_attach: true,
          managed_output_window_control: true,
          native_static_image_decode: true,
          native_static_image_prefetch: true,
          native_media_decode: true,
          media_prefetch: true,
          native_video_frame_decode: true,
          native_video_frame_prefetch: true,
          native_video_decode_pump: true,
          native_video_decode_pump_window: true,
          native_stage3d: true,
          native_stage3d_output_renderer: true,
          native_stage3d_recording_parity: true,
          native_projection_sim: true,
          native_projection_sim_output_renderer: true,
          native_projection_sim_recording_parity: true,
          ...graphFeatures,
        },
        {
          native_editor_preview: nativeEditorPreviewContract(true, 'metal', true),
          native_graph_instruments: nativeGraphManifests.map((entry) => entry.id),
          native_graph_instrument_manifest: nativeGraphManifests.map((entry) => ({
            id: entry.id,
            label: entry.id,
            source_uri_prefix: `native-graph://${entry.id}/`,
            shader_ids: entry.shader_ids,
            shader_count: entry.shader_ids.length,
            features: [entry.feature],
            render_target: 'source_frame',
            parity: `${entry.id}-parity`,
          })),
        },
      );
    };

    const capabilities = await broker.refreshCapabilities({ requireCore: true });
    expect(capabilities.features.native_texture_share_sender).toBe(false);

    const report = broker.readinessReport();
    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );

    expect(report.modes.output_driver.ok).toBe(true);
    expect(report.modes.full_v2.ok).toBe(false);
    expect(report.modes.full_v2.blockers).toEqual([
      'Syphon native texture-share sender is not active-ready',
    ]);
    expect(checks.get('native-texture-share-sender')?.ok).toBe(false);
    expect(String(checks.get('native-texture-share-sender')?.detail ?? '')).toContain(
      'waiting for the first rendered frame',
    );
  });

  it('keeps full-v2 blocked when scene bridge output parity is only partially advertised', async () => {
    const broker = createBroker({
      encoderAvailable: true,
      textureShareStatus: {
        available: true,
        platform: 'syphon',
        label: 'Syphon',
        senderMode: 'native-iosurface',
        nativeOutputCapable: true,
        nativeOutputActive: true,
        nativeOutputWaitingForFrame: false,
        nativeOutputLastPublishedFrame: 8,
      },
    });
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      const graphFeatures = Object.fromEntries(nativeGraphManifests.map((entry) => [entry.feature, true]));
      return coreCapabilities(
        {
          compute_shader_host: true,
          compute_graph_host: true,
          compute_graph_render: true,
          compute_graph_texture_sampling: true,
          compute_graph_source_frame_target: true,
          persistent_compute_buffers: true,
          native_output_mirror_texture: true,
          native_editor_preview_frame_source: true,
          isf_glsl_parse_probe: true,
          isf_glsl_host: true,
          shared_texture_source_frame_upload: true,
          shared_texture_upload: true,
          shared_texture_output_export: true,
          managed_output_attach: true,
          managed_output_window_control: true,
          native_static_image_decode: true,
          native_static_image_prefetch: true,
          native_media_decode: true,
          media_prefetch: true,
          native_video_frame_decode: true,
          native_video_frame_prefetch: true,
          native_video_decode_pump: true,
          native_video_decode_pump_window: true,
          native_stage3d: true,
          native_stage3d_output_renderer: false,
          native_stage3d_recording_parity: false,
          native_projection_sim: true,
          native_projection_sim_output_renderer: false,
          native_projection_sim_recording_parity: false,
          ...graphFeatures,
        },
        {
          native_editor_preview: nativeEditorPreviewContract(true, 'metal', true),
          native_graph_instruments: nativeGraphManifests.map((entry) => entry.id),
          native_graph_instrument_manifest: nativeGraphManifests.map((entry) => ({
            id: entry.id,
            label: entry.id,
            source_uri_prefix: `native-graph://${entry.id}/`,
            shader_ids: entry.shader_ids,
            shader_count: entry.shader_ids.length,
            features: [entry.feature],
            render_target: 'source_frame',
            parity: `${entry.id}-parity`,
          })),
        },
      );
    };

    await broker.refreshCapabilities({ requireCore: true });
    const report = broker.readinessReport();
    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );

    expect(report.modes.output_driver.ok).toBe(true);
    expect(report.modes.full_v2.ok).toBe(false);
    expect(report.modes.full_v2.blockers).toEqual([
      'native Stage3D output renderer/recording parity is pending',
      'native projection simulator output renderer/recording parity is pending',
    ]);
    expect(checks.get('native-stage3d-output-renderer')?.ok).toBe(false);
    expect(checks.get('native-stage3d-recording-parity')?.ok).toBe(false);
    expect(checks.get('native-projection-sim-output-renderer')?.ok).toBe(false);
    expect(checks.get('native-projection-sim-recording-parity')?.ok).toBe(false);
  });

  it('uses swapchain presented frames for managed native output activity', async () => {
    const broker = createBroker({ encoderAvailable: true });
    broker.lastStatus = {
      ...broker.lastStatus,
      output_window_attached: true,
      output_swapchain_ready: true,
      output_present_healthy: true,
      swapchain_presented: 5,
      frames_presented: 0,
      scene_layers_active: 1,
      output_last_presented_layer_count: 1,
      swapchain_last_present_result: 'ok',
    };
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      return coreCapabilities({
        managed_output_attach: true,
      });
    };

    await broker.refreshCapabilities({ requireCore: true });
    const report = broker.readinessReport();
    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );

    expect(report.modes.output_active.ok).toBe(true);
    expect(String(report.modes.output_active.detail)).toContain('5 native swapchain frame');
    expect(checks.get('managed-output')?.ok).toBe(true);
    expect(String(checks.get('managed-output')?.detail ?? '')).toContain('5 native swapchain frame');
  });

  it('does not treat diagnostic-only native output frames as active scene output', async () => {
    const broker = createBroker({ encoderAvailable: true });
    broker.lastStatus = {
      ...broker.lastStatus,
      output_window_attached: true,
      output_swapchain_ready: true,
      output_present_healthy: true,
      swapchain_presented: 5,
      scene_layers_active: 2,
      output_last_presented_layer_count: 0,
      swapchain_last_present_result: 'ok',
    };
    broker.send = async (method: string) => {
      expect(method).toBe('get_capabilities');
      return coreCapabilities({
        managed_output_attach: true,
      });
    };

    await broker.refreshCapabilities({ requireCore: true });
    const report = broker.readinessReport();
    const checks = new Map<string, ReadinessCheck>(
      report.checks.map((check: ReadinessCheck) => [check.id, check]),
    );

    expect(report.modes.output_active.ok).toBe(false);
    expect(checks.get('managed-output')?.ok).toBe(false);
    expect(String(checks.get('managed-output')?.detail ?? '')).toContain('no scene layers');
  });

  it('keeps the last healthy backend state when a frame submit RPC times out', async () => {
    const broker = createBroker({ encoderAvailable: true });
    broker.send = async (method: string) => {
      expect(method).toBe('submit_batch');
      throw new Error('Native render core timed out handling submit_batch');
    };

    const result = await broker.invoke('native_renderer_submit_batch', { batch: { commands: [] } });

    expect(result).toBeNull();
    expect(broker.lastStatus.backend_ready).toBe(true);
    expect(broker.lastStatus.last_frame_error).toBe('');
    expect(broker.lastStatus.last_rpc_error).toContain('timed out handling submit_batch');
    expect(broker.lastStatus.last_rpc_error_method).toBe('submit_batch');
  });

  it('sends viewport interactions as acknowledgement-free notifications', () => {
    const broker = createBroker({ encoderAvailable: true });
    const writes: string[] = [];
    broker.child = {
      killed: false,
      stdin: {
        writable: true,
        write(payload: string) {
          writes.push(payload);
          return true;
        },
      },
    };

    expect(broker.notify('set_layer_interaction', {
      layer_id: 'layer-1',
      corners: {
        topLeft: { x: 0, y: 0 },
        topRight: { x: 1, y: 0 },
        bottomRight: { x: 1, y: 1 },
        bottomLeft: { x: 0, y: 1 },
      },
    })).toBe(true);
    expect(JSON.parse(writes[0])).toMatchObject({
      id: 0,
      method: 'set_layer_interaction',
      params: { layer_id: 'layer-1' },
    });
    expect(broker.pending.size).toBe(0);
  });

  it('keeps status polling timeouts from poisoning native output driver readiness', async () => {
    const broker = createBroker({ encoderAvailable: true });
    broker.lastStatus = {
      ...broker.lastStatus,
      output_window_attached: true,
      output_swapchain_ready: true,
      output_present_healthy: true,
      swapchain_presented: 4,
      scene_layers_active: 1,
      output_last_presented_layer_count: 1,
      swapchain_last_present_result: 'ok',
    };
    broker.send = async (method: string) => {
      expect(method).toBe('status');
      throw new Error('Native render core timed out handling status');
    };

    const status = await broker.invoke('native_renderer_get_status');

    expect(status.backend_ready).toBe(true);
    expect(status.last_rpc_error).toContain('timed out handling status');
    expect(status.last_rpc_error_method).toBe('status');
  });
});
