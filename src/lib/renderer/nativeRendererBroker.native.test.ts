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
  nativeOutputActive?: boolean;
  nativeOutputWaitingForFrame?: boolean;
  nativeOutputLastPublishedFrame?: number;
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
  {
    id: 'point-cloud-fx',
    feature: 'native_point_cloud_fx_graph',
    shader_ids: [
      'point-cloud-fx/compute',
      'point-cloud-fx/sort-fill',
      'point-cloud-fx/sort-step',
      'point-cloud-fx/render',
    ],
  },
];

function coreCapabilities(features: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const sharedSourceFrameReady = features.shared_texture_source_frame_upload === true;
  return {
    schema_version: 1,
    core_version: 'test-core',
    backend: 'metal',
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
    notes: [],
    ...overrides,
  };
}

function createBroker({
  encoderAvailable = true,
  textureShareStatus = null,
}: {
  encoderAvailable?: boolean;
  textureShareStatus?: TextureShareStatus | null;
} = {}) {
  const broker = createNativeRendererBroker({
    appRoot: process.cwd(),
    resourcesPath: process.cwd(),
    isPackaged: false,
    platform: 'darwin',
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
});
