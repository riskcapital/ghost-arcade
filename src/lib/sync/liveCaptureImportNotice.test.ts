/**
 * A camera or screen capture whose frames the core rejects (Windows, two GPUs)
 * is explained to the user once -- not per frame, and not silently -- and the
 * explanation clears when its frames import again.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  toasts: [] as Array<{ message: string; type: string }>,
  notes: [] as Array<{ sourceId: string; message: string | null }>,
}));

vi.mock('../stores/errorToast', async (original) => ({
  ...(await original<typeof import('../stores/errorToast')>()),
  showToast: vi.fn((message: string, type: string) => { h.toasts.push({ message, type }); }),
}));

vi.mock('../renderer/cameraLiveSource', async (original) => ({
  ...(await original<typeof import('../renderer/cameraLiveSource')>()),
  noteCameraLiveSourceImport: vi.fn((sourceId: string, message: string | null) => { h.notes.push({ sourceId, message }); }),
}));

vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  invoke: vi.fn(async () => null),
}));

let mod: typeof import('./nativeRendererSync');

beforeAll(async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { style: { setProperty: () => {} } } },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    },
  });
  (globalThis as any).requestAnimationFrame = () => 1;
  (globalThis as any).cancelAnimationFrame = () => {};
  mod = await import('./nativeRendererSync');
});

afterEach(() => {
  h.toasts.length = 0;
  h.notes.length = 0;
});

const CORE_LUID = '000000000001abcd';
const IGPU_LUID = '0000000000012345';

function makeSync(): any {
  const sync = new mod.NativeRendererSync() as any;
  sync.nativeFeatureFlags = { shared_texture_source_frame_upload: true };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return sync;
}

function cameraSource(platform = 'dxgi', adapterLuid: string | null = IGPU_LUID) {
  const src = {
    id: 'camera:usb-cam', name: 'Camera', type: 'video', src: 'live://webcam/session-1',
    liveSourceType: 'webcam', liveSourceSessionId: 'session-1',
  } as any;
  const info = {
    available: true, platform, label: 'Webcam', width: 640, height: 480, format: 87, frame: 1,
    handle: '0102030405060708', handleEncoding: 'hex', handleByteLength: 8, ...(adapterLuid ? { adapterLuid } : {}),
  };
  return { src, info };
}

/** One upload of the source, then a status that accepted or rejected it. */
function uploadThen(sync: any, src: any, info: any, outcome: 'rejected' | 'imported', revision: number) {
  const key = sync.sharedTextureInfoKey(src, 'live:webcam');
  sync.sharedTextureInfoCache.set(key, { info, updatedAt: 0, revision });
  // Each call stands for a retry once the rejection backoff has passed
  // (sharedTextureLiveCadence.test.ts covers the backoff itself).
  sync.sharedTextureRejectBackoff.clear();
  const commands: any[] = [];
  expect(sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', revision * 100, false, null)).toBe(true);
  expect(commands).toHaveLength(1);
  const rejected = sync.sharedTextureLastRejectedUploads + (outcome === 'rejected' ? 1 : 0);
  const imported = sync.sharedTextureLastSuccessfulUploads + (outcome === 'imported' ? 1 : 0);
  sync.reconcileSharedTextureUploads({
    adapter_luid: CORE_LUID,
    source_frame_shared_texture_rejected_uploads: rejected,
    source_frame_shared_texture_uploads: imported,
    source_frame_last_reject_reason: 'D3D12 OpenSharedHandle failed for HANDLE=0x1234: The parameter is incorrect.',
  });
}

describe('live capture frames the core cannot open', () => {
  it('explains a camera on the other GPU once, however many frames fail', () => {
    const sync = makeSync();
    const { src, info } = cameraSource();
    for (let frame = 1; frame <= 30; frame += 1) uploadThen(sync, src, info, 'rejected', frame);
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0].type).toBe('warning');
    expect(h.toasts[0].message).toMatch(/different graphics chip/);
    expect(h.toasts[0].message).toContain('High performance');
    // The camera's own row in the instrument panel carries it too.
    expect(h.notes.at(-1)).toMatchObject({ sourceId: 'camera:usb-cam' });
    expect(h.notes.at(-1)?.message).toMatch(/different graphics chip/);
  });

  it('clears the message when the frames import again, and tells again on a new failure', () => {
    const sync = makeSync();
    const { src, info } = cameraSource();
    uploadThen(sync, src, info, 'rejected', 1);
    uploadThen(sync, src, info, 'imported', 2);
    expect(h.notes.at(-1)).toEqual({ sourceId: 'camera:usb-cam', message: null });
    uploadThen(sync, src, info, 'imported', 3);
    // Only the recovery is noted, not every good frame.
    expect(h.notes.filter((note) => note.message === null)).toHaveLength(1);
    uploadThen(sync, src, info, 'rejected', 4);
    expect(h.toasts).toHaveLength(2);
  });

  it('leaves macOS (IOSurface) sources as they were', () => {
    const sync = makeSync();
    const { src, info } = cameraSource('iosurface', null);
    uploadThen(sync, src, info, 'rejected', 1);
    expect(h.toasts).toHaveLength(0);
    expect(h.notes).toHaveLength(0);
  });

  it('does not touch other shared-texture sources', () => {
    const sync = makeSync();
    const src = { id: 'spout:1', name: 'Spout', type: 'spout', src: 'spout://Sender', spoutSource: 'Sender' } as any;
    const info = { available: true, platform: 'dxgi', label: 'Spout', width: 64, height: 64, format: 87, handle: '01', handleEncoding: 'hex', handleByteLength: 8 };
    const key = sync.sharedTextureInfoKey(src, 'spout');
    sync.sharedTextureInfoCache.set(key, { info, updatedAt: 0, revision: 1 });
    sync.appendSharedTextureSourceFrameCommand([], src, 'spout', 0, false, null);
    sync.reconcileSharedTextureUploads({ source_frame_shared_texture_rejected_uploads: 1, source_frame_shared_texture_uploads: 0 });
    expect(h.toasts).toHaveLength(0);
  });
});
