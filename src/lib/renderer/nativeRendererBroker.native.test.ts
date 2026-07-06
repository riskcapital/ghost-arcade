import { describe, expect, it } from 'vitest';
import { createNativeRendererBroker } from '../../../electron/native-renderer-broker.js';

function coreCapabilities(features: Record<string, unknown> = {}) {
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
    notes: [],
  };
}

function createBroker({ encoderAvailable = true } = {}) {
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

    const checks = new Map(broker.readinessReport().checks.map((check: any) => [check.id, check]));
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

    const checks = new Map(broker.readinessReport().checks.map((check: any) => [check.id, check]));
    expect(checks.get('native-frame-export')?.ok).toBe(true);
    expect(checks.get('native-recording')?.ok).toBe(false);
    expect(String(checks.get('native-recording')?.detail ?? '')).toContain('ffmpeg unavailable');
  });
});
