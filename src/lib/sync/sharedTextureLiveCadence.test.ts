/**
 * Live shared-texture sources (cameras, screen captures, Spout) at frame rate:
 * a camera is only handed over when it has a new frame, and a source the core
 * rejects is backed off instead of being re-sent and re-rejected every 16 ms.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: any }>,
  reply: null as any,
}));

vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  isElectron: true,
  invoke: vi.fn(async (command: string, args?: any) => {
    h.calls.push({ command, args });
    return command === 'native_live_capture_texture_info' ? h.reply : null;
  }),
}));

vi.mock('../stores/errorToast', async (original) => ({
  ...(await original<typeof import('../stores/errorToast')>()),
  showToast: vi.fn(),
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
  h.calls.length = 0;
  h.reply = null;
  vi.restoreAllMocks();
});

function makeSync(): any {
  const sync = new mod.NativeRendererSync() as any;
  sync.nativeFeatureFlags = { shared_texture_source_frame_upload: true };
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  return sync;
}

function camera(id = 'usb') {
  return {
    id: `camera:${id}`, name: 'Camera', type: 'video', src: `live://webcam/session-${id}`,
    liveSourceType: 'webcam', liveSourceSessionId: `session-${id}`,
  } as any;
}

function frameInfo(frame: number, handle = '0102030405060708', width = 640) {
  return {
    available: true, platform: 'dxgi', label: 'Webcam', width, height: 480, format: 87, frame,
    handle, handleEncoding: 'hex', handleByteLength: 8,
  };
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('camera texture polling', () => {
  it('asks main for a new frame only, and does not re-send an unchanged one', async () => {
    const sync = makeSync();
    const src = camera();
    const key = sync.sharedTextureInfoKey(src, 'live:webcam');
    h.reply = frameInfo(5);
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 0);
    await flushAsync();
    expect(h.calls[0].args).toEqual({ sessionId: 'session-usb' });
    expect(sync.sharedTextureInfoCache.get(key).revision).toBe(1);

    // Main answers "unchanged" for the frame the editor already has.
    h.reply = { available: true, unchanged: true, frame: 5 };
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 20);
    await flushAsync();
    expect(h.calls[1].args).toEqual({ sessionId: 'session-usb', sinceFrame: 5 });
    expect(sync.sharedTextureInfoCache.get(key).revision).toBe(1);

    // An older main that ignores sinceFrame: same frame and handle is still no news.
    h.reply = frameInfo(5);
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 40);
    await flushAsync();
    expect(sync.sharedTextureInfoCache.get(key).revision).toBe(1);

    h.reply = frameInfo(6);
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 60);
    await flushAsync();
    expect(sync.sharedTextureInfoCache.get(key).revision).toBe(2);
  });

  it('one upload per camera frame, not per poll', async () => {
    const sync = makeSync();
    const src = camera();
    const commands: any[] = [];
    let frame = 1;
    // A 30 fps camera polled at 60 Hz: every other poll has a new frame.
    for (let poll = 0; poll < 60; poll += 1) {
      const now = poll * 16.7;
      if (poll % 2 === 0) h.reply = frameInfo(frame++);
      else h.reply = { available: true, unchanged: true, frame: frame - 1 };
      sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', now, false, null);
      await flushAsync();
    }
    // Each poll is followed by one flush; the first flush has no info yet.
    expect(commands.length).toBeLessThanOrEqual(30);
    expect(commands.length).toBeGreaterThanOrEqual(29);
  });

  it('Spout keeps re-sending each poll (its frame counter may never move)', async () => {
    const sync = makeSync();
    const src = { id: 'spout:1', name: 'Spout', type: 'spout', src: 'spout://Sender', spoutSource: 'Sender' } as any;
    const key = sync.sharedTextureInfoKey(src, 'spout');
    const revisions: number[] = [];
    vi.spyOn(sync, 'queueSharedTextureInfoRefresh').mockImplementation(() => {
      const revision = (sync.sharedTextureInfoCache.get(key)?.revision ?? 0) + 1;
      sync.sharedTextureInfoCache.set(key, { info: { ...frameInfo(0), platform: 'dxgi' }, updatedAt: 0, revision });
      revisions.push(revision);
    });
    const commands: any[] = [];
    for (let i = 0; i < 5; i += 1) sync.appendSharedTextureSourceFrameCommand(commands, src, 'spout', i * 16, false, null);
    expect(commands).toHaveLength(5);
  });
});

describe('rejected sources back off', () => {
  function primed(sync: any, src: any, info: any, revision: number) {
    const key = sync.sharedTextureInfoKey(src, 'live:webcam');
    sync.sharedTextureInfoCache.set(key, { info, updatedAt: 0, revision });
    vi.spyOn(sync, 'queueSharedTextureInfoRefresh').mockImplementation(() => {});
    return key;
  }
  function status(sync: any, rejectedDelta: number, importedDelta: number) {
    sync.reconcileSharedTextureUploads({
      source_frame_shared_texture_rejected_uploads: sync.sharedTextureLastRejectedUploads + rejectedDelta,
      source_frame_shared_texture_uploads: sync.sharedTextureLastSuccessfulUploads + importedDelta,
      source_frame_last_reject_reason: 'D3D12 OpenSharedHandle failed',
    });
  }

  it('a rejected camera is not re-sent every frame, and is retried after the backoff', () => {
    const sync = makeSync();
    const src = camera();
    const key = primed(sync, src, frameInfo(1), 1);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const commands: any[] = [];
    sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', 1000, false, null);
    status(sync, 1, 0);
    expect(sync.sharedTextureRejectBackoff.get(key)).toMatchObject({ until: 2000, delayMs: 1000 });
    for (let t = 1016; t < 2000; t += 16) {
      sync.sharedTextureInfoCache.get(key).revision += 1; // new frames keep arriving
      sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', t, false, null);
    }
    expect(commands).toHaveLength(1);
    sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', 2000, false, null);
    expect(commands).toHaveLength(2);
    // Rejected again: the wait doubles.
    vi.spyOn(performance, 'now').mockReturnValue(2000);
    status(sync, 1, 0);
    expect(sync.sharedTextureRejectBackoff.get(key)).toMatchObject({ until: 4000, delayMs: 2000 });
  });

  it('a changed texture (new handle or size) is tried straight away', () => {
    const sync = makeSync();
    const src = camera();
    const key = primed(sync, src, frameInfo(1), 1);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const commands: any[] = [];
    sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', 0, false, null);
    status(sync, 1, 0);
    sync.sharedTextureInfoCache.set(key, { info: frameInfo(2, '0a0b0c0d0e0f0001', 1280), updatedAt: 0, revision: 2 });
    sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', 16, false, null);
    expect(commands).toHaveLength(2);
  });

  it('an import that works again ends the backoff', () => {
    const sync = makeSync();
    const src = camera();
    const key = primed(sync, src, frameInfo(1), 1);
    vi.spyOn(performance, 'now').mockReturnValue(0);
    sync.appendSharedTextureSourceFrameCommand([], src, 'live:webcam', 0, false, null);
    status(sync, 1, 0);
    expect(sync.sharedTextureRejectBackoff.has(key)).toBe(true);
    sync.sharedTextureInfoCache.get(key).revision += 1;
    sync.appendSharedTextureSourceFrameCommand([], src, 'live:webcam', 1000, false, null);
    status(sync, 0, 1);
    expect(sync.sharedTextureRejectBackoff.has(key)).toBe(false);
  });

  it('does not hold back sources when it is not known which one failed', () => {
    const sync = makeSync();
    const a = camera('a');
    const b = camera('b');
    const keyA = sync.sharedTextureInfoKey(a, 'live:webcam');
    const keyB = sync.sharedTextureInfoKey(b, 'live:webcam');
    sync.sharedTextureInfoCache.set(keyA, { info: frameInfo(1, '0000000000000001'), updatedAt: 0, revision: 1 });
    sync.sharedTextureInfoCache.set(keyB, { info: frameInfo(1, '0000000000000002'), updatedAt: 0, revision: 1 });
    vi.spyOn(sync, 'queueSharedTextureInfoRefresh').mockImplementation(() => {});
    sync.appendSharedTextureSourceFrameCommand([], a, 'live:webcam', 0, false, null);
    sync.appendSharedTextureSourceFrameCommand([], b, 'live:webcam', 0, false, null);
    status(sync, 1, 1);
    expect(sync.sharedTextureRejectBackoff.size).toBe(0);
  });

  it('a backed-off source is polled once a second, not at frame rate', () => {
    const sync = makeSync();
    const src = camera();
    const key = sync.sharedTextureInfoKey(src, 'live:webcam');
    sync.sharedTextureRejectBackoff.set(key, { until: 5000, delayMs: 4000, handle: 'x', width: 1, height: 1 });
    h.reply = null;
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 1000);
    expect(sync.sharedTextureInfoNextPollAt.get(key)).toBe(2000);
  });

  it('remembers a bounded number of backed-off sources', () => {
    const sync = makeSync();
    vi.spyOn(sync, 'queueSharedTextureInfoRefresh').mockImplementation(() => {});
    vi.spyOn(performance, 'now').mockReturnValue(0);
    for (let i = 0; i < 80; i += 1) {
      const src = camera(`c${i}`);
      sync.sharedTextureInfoCache.set(sync.sharedTextureInfoKey(src, 'live:webcam'), { info: frameInfo(1, `h${i}`), updatedAt: 0, revision: 1 });
      sync.appendSharedTextureSourceFrameCommand([], src, 'live:webcam', 0, false, null);
      status(sync, 1, 0);
    }
    expect(sync.sharedTextureRejectBackoff.size).toBe(64);
    expect(sync.sharedTextureRejectBackoff.has(sync.sharedTextureInfoKey(camera('c79'), 'live:webcam'))).toBe(true);
    expect(sync.sharedTextureRejectBackoff.has(sync.sharedTextureInfoKey(camera('c0'), 'live:webcam'))).toBe(false);
  });
});

describe('MediaTray status from the core', () => {
  it('a camera reads Starting when sent, Live once imported, No picture when rejected', async () => {
    const { liveCaptureImportStates } = await import('../renderer/liveCaptureImportState');
    const { get } = await import('svelte/store');
    const sync = makeSync();
    vi.spyOn(sync, 'queueSharedTextureInfoRefresh').mockImplementation(() => {});
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const src = camera('tray');
    const key = sync.sharedTextureInfoKey(src, 'live:webcam');
    // macOS too: the state is not tied to DXGI.
    sync.sharedTextureInfoCache.set(key, { info: { ...frameInfo(1), platform: 'iosurface' }, updatedAt: 0, revision: 1 });
    sync.appendSharedTextureSourceFrameCommand([], src, 'live:webcam', 0, false, null);
    expect(get(liveCaptureImportStates).get('session-tray')).toEqual({ state: 'sent' });
    sync.reconcileSharedTextureUploads({ source_frame_shared_texture_rejected_uploads: 0, source_frame_shared_texture_uploads: 1 });
    expect(get(liveCaptureImportStates).get('session-tray')).toEqual({ state: 'imported' });
    sync.sharedTextureInfoCache.get(key).revision += 1;
    sync.appendSharedTextureSourceFrameCommand([], src, 'live:webcam', 16, false, null);
    sync.reconcileSharedTextureUploads({ source_frame_shared_texture_rejected_uploads: 1, source_frame_shared_texture_uploads: 1, source_frame_last_reject_reason: 'bad texture' });
    expect(get(liveCaptureImportStates).get('session-tray')).toMatchObject({ state: 'rejected' });
  });
});

describe('core texture cache key', () => {
  it('a camera upload names its session texture so the core opens it once; Spout does not', () => {
    const sync = makeSync();
    vi.spyOn(sync, 'queueSharedTextureInfoRefresh').mockImplementation(() => {});
    const src = camera();
    sync.sharedTextureInfoCache.set(sync.sharedTextureInfoKey(src, 'live:webcam'), { info: frameInfo(1), updatedAt: 0, revision: 1 });
    const commands: any[] = [];
    sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', 0, false, null);
    expect(commands[0].shared_texture_cache_key).toBe('session-usb:0102030405060708');

    const spout = { id: 'spout:1', name: 'Spout', type: 'spout', src: 'spout://Sender', spoutSource: 'Sender' } as any;
    sync.sharedTextureInfoCache.set(sync.sharedTextureInfoKey(spout, 'spout'), { info: frameInfo(0), updatedAt: 0, revision: 1 });
    sync.appendSharedTextureSourceFrameCommand(commands, spout, 'spout', 0, false, null);
    expect(commands[1]).not.toHaveProperty('shared_texture_cache_key');
  });
});

describe('a capture the render core runs itself', () => {
  function coreInfo(generation: number, imports = 0) {
    return {
      available: true, platform: 'core', coreSessionId: 'session-usb', coreImports: imports, label: 'Webcam',
      width: 1280, height: 720, format: 80, frame: generation, handle: `core:session-usb:${generation}`,
      handleEncoding: 'core', handleByteLength: 0,
    };
  }

  it('binds the source once, sends no frames, and binds again after a restart', () => {
    const sync = makeSync();
    vi.spyOn(sync, 'queueSharedTextureInfoRefresh').mockImplementation(() => {});
    const src = camera();
    const key = sync.sharedTextureInfoKey(src, 'live:webcam');
    sync.sharedTextureInfoCache.set(key, { info: coreInfo(1), updatedAt: 0, revision: 1 });
    const commands: any[] = [];
    for (let frame = 0; frame < 30; frame += 1) {
      sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', frame * 16, false, null);
      // A full answer from main (before the first import) bumps the revision.
      sync.sharedTextureInfoCache.get(key).revision += 1;
    }
    expect(commands).toEqual([{ type: 'bind_live_capture_source', source_id: 'camera:usb', session_id: 'session-usb', seq: 1 }]);
    // A restarted core: the session comes back under a new generation.
    sync.sharedTextureInfoCache.set(key, { info: coreInfo(2), updatedAt: 0, revision: 99 });
    sync.appendSharedTextureSourceFrameCommand(commands, src, 'live:webcam', 1000, false, null);
    expect(commands).toHaveLength(2);
    expect(commands[1]).toMatchObject({ type: 'bind_live_capture_source', seq: 2 });
  });

  it('is polled twice a second, not at frame rate, and reads Live once the core imports', async () => {
    const { liveCaptureImportStates } = await import('../renderer/liveCaptureImportState');
    const { get } = await import('svelte/store');
    const sync = makeSync();
    const src = camera('core');
    h.reply = { ...coreInfo(1, 0), coreSessionId: 'session-core' };
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 0);
    await flushAsync();
    // Known to be the core's from here on: the next check is 500 ms away.
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 20);
    await flushAsync();
    expect(h.calls).toHaveLength(2);
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 300);
    await flushAsync();
    expect(h.calls).toHaveLength(2);
    h.reply = { ...coreInfo(1, 3), coreSessionId: 'session-core' };
    sync.queueSharedTextureInfoRefresh(src, 'live:webcam', 600);
    await flushAsync();
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2].args).toEqual({ sessionId: 'session-core', sinceFrame: 1 });
    expect(get(liveCaptureImportStates).get('session-core')).toEqual({ state: 'imported' });
  });
});

describe('backoff schedule', () => {
  it('starts at 1 s, doubles for the same texture, caps, and restarts for a new one', () => {
    const sent = { handle: 'h', width: 640, height: 480 };
    let b = mod.nextSharedTextureRejectBackoff(undefined, sent, 0, 8000);
    expect(b).toMatchObject({ delayMs: 1000, until: 1000 });
    b = mod.nextSharedTextureRejectBackoff(b, sent, 1000, 8000);
    expect(b.delayMs).toBe(2000);
    for (let i = 0; i < 10; i += 1) b = mod.nextSharedTextureRejectBackoff(b, sent, 0, 8000);
    expect(b.delayMs).toBe(8000);
    expect(mod.nextSharedTextureRejectBackoff(b, { ...sent, handle: 'new' }, 0, 8000).delayMs).toBe(1000);
    expect(mod.sharedTextureRejectBackoffActive(b, sent, 7999)).toBe(true);
    expect(mod.sharedTextureRejectBackoffActive(b, sent, 8000)).toBe(false);
    expect(mod.sharedTextureRejectBackoffActive(b, { ...sent, width: 1280 }, 10)).toBe(false);
  });
});
