import { describe, expect, it, vi } from 'vitest';

// @ts-ignore plain JS module shared with the Electron main process
import { createSharedFrames, paintFrame, sharedFrameCommand, submitRejectedFrame, RING_SLOTS, SHARED_TEXTURE_ENV } from '../../../electron/js-source-frames.js';

const coreFeatures = { features: { shared_texture_source_frame_upload: true, shared_texture_source_frame_errors: true } };

function fakeAddon({ available = true } = {}) {
  const rings: unknown[] = [];
  class JsFrameRing {
    options: unknown;
    constructor(options: unknown) {
      this.options = options;
      rings.push(this);
    }
  }
  return { rings, addon: { JsFrameRing, available: () => available, lastError: () => 'no Metal device' } };
}

function frames(overrides: Record<string, unknown> = {}) {
  const { addon } = fakeAddon();
  return createSharedFrames({
    env: { [SHARED_TEXTURE_ENV]: '1' },
    platform: 'darwin',
    loadAddon: () => addon,
    getCapabilities: () => coreFeatures,
    log: { warn: () => {} },
    ...overrides,
  });
}

describe('js host shared frames', () => {
  it('is used only when switched on, on macOS, with the addon and a core that reports failures', () => {
    expect(frames().unavailableReason()).toBeNull();
    expect(frames({ env: {} }).unavailableReason()).toBe('not enabled');
    expect(frames({ platform: 'win32' }).unavailableReason()).toBe('macOS only');
    expect(frames({ loadAddon: () => null }).unavailableReason()).toMatch(/not built/);
    expect(frames({ loadAddon: () => { throw new Error('dlopen failed'); } }).unavailableReason()).toBe('dlopen failed');
    expect(frames({ loadAddon: () => fakeAddon({ available: false }).addon }).unavailableReason()).toMatch(/no GPU/);
    expect(frames({ getCapabilities: () => null }).unavailableReason()).toMatch(/cannot import/);
    // An older core imports but drops a frame it cannot open without saying so.
    expect(frames({ getCapabilities: () => ({ features: { shared_texture_source_frame_upload: true } }) }).unavailableReason())
      .toMatch(/does not report/);
  });

  it('loads the addon once', () => {
    const loadAddon = vi.fn(() => fakeAddon().addon);
    const shared = frames({ loadAddon });
    shared.unavailableReason();
    shared.unavailableReason();
    expect(loadAddon).toHaveBeenCalledTimes(1);
  });

  it('stays off for the session once disabled', () => {
    const shared = frames();
    shared.disable('the render core could not open the frame');
    shared.disable('a later reason');
    expect(shared.unavailableReason()).toBe('the render core could not open the frame');
    expect(shared.status()).toMatchObject({ wanted: true, disabled: 'the render core could not open the frame' });
  });

  it('makes rings of the agreed size', () => {
    const { addon, rings } = fakeAddon();
    const shared = frames({ loadAddon: () => addon });
    expect(shared.unavailableReason()).toBeNull();
    shared.createRing();
    expect(rings).toHaveLength(1);
    expect((rings[0] as { options: unknown }).options).toEqual({ slots: RING_SLOTS });
  });

  it('copies the visible rectangle of a paint', () => {
    const handle = Buffer.alloc(8, 1);
    expect(paintFrame({
      pixelFormat: 'bgra',
      codedSize: { width: 1920, height: 1088 },
      visibleRect: { x: 0, y: 0, width: 1920, height: 1080 },
      handle: { ioSurface: handle },
    })).toEqual({ handle, x: 0, y: 0, width: 1920, height: 1080, pixelFormat: 'bgra' });
    expect(paintFrame({ codedSize: { width: 64, height: 32 }, handle: { ioSurface: handle } }))
      .toMatchObject({ width: 64, height: 32, pixelFormat: 'bgra' });
    expect(paintFrame({ codedSize: { width: 64, height: 32 }, handle: {} })).toBeNull();
    expect(paintFrame({ codedSize: { width: 64, height: 32 }, handle: { ioSurface: Buffer.alloc(4) } })).toBeNull();
    expect(paintFrame(undefined)).toBeNull();
  });

  it('sends the core a global IOSurface ID', () => {
    expect(sharedFrameCommand({ sourceId: 'js:a', seq: 7, surfaceId: 4242, width: 1920, height: 1080 })).toEqual({
      type: 'upload_source_frame',
      source_id: 'js:a',
      seq: 7,
      width: 1920,
      height: 1080,
      shared_handle: '4242',
      shared_texture_platform: 'iosurface',
      shared_texture_format: 'bgra8unorm',
      shared_texture_handle_encoding: 'integer',
    });
  });

  it('reads a rejected frame from the submit answer', () => {
    expect(submitRejectedFrame({ applied: 0, dropped: 1, errors: [{ type: 'upload_source_frame', message: 'IOSurfaceLookup(1) returned null' }] })).toBe(true);
    expect(submitRejectedFrame({ applied: 1, dropped: 0, errors: [] })).toBe(false);
    expect(submitRejectedFrame({ applied: 1, errors: [{ type: 'set_mirror_mesh', message: 'x' }] })).toBe(false);
    expect(submitRejectedFrame(null)).toBe(false);
    expect(submitRejectedFrame(true)).toBe(false);
  });
});
