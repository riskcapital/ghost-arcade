import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import * as adapterModule from '../../../electron/live-capture-adapter.js';
import {
  coreAdapterFromStatus,
  describeAdapter,
  normalizeAdapterLuid,
  pickCaptureAdapter,
} from '../../../electron/live-capture-adapter.js';

/*
 * Windows, two GPUs: the camera's capture device has to be made on the render
 * core's adapter, or the core cannot open its frames and the picture is blank
 * (reported on a laptop with integrated AMD + NVIDIA GTX 1660 Ti).
 */

const IGPU = { luid: '0000000000012345', name: 'AMD Radeon(TM) Graphics', vendorId: 0x1002, deviceId: 0x1638, software: false };
const DGPU = { luid: '000000000001abcd', name: 'NVIDIA GeForce GTX 1660 Ti', vendorId: 0x10de, deviceId: 0x2191, software: false };
const WARP = { luid: '0000000000020000', name: 'Microsoft Basic Render Driver', vendorId: 0x1414, deviceId: 0x8c, software: true };

const coreOnDgpu = {
  adapter_name: 'NVIDIA GeForce GTX 1660 Ti',
  adapter_luid: '000000000001ABCD',
  native_caps: { adapter_vendor: 0x10de, adapter_device: 0x2191 },
};

describe('normalizeAdapterLuid', () => {
  it('accepts 16 hex digits in either case and rejects anything else', () => {
    expect(normalizeAdapterLuid('000000000001ABCD')).toBe('000000000001abcd');
    expect(normalizeAdapterLuid(' ffffffffdeadbeef ')).toBe('ffffffffdeadbeef');
    expect(normalizeAdapterLuid('1abcd')).toBe('');
    expect(normalizeAdapterLuid('000000000001abcg')).toBe('');
    expect(normalizeAdapterLuid(null)).toBe('');
    expect(normalizeAdapterLuid(0x1abcd)).toBe('');
  });
});

describe('coreAdapterFromStatus', () => {
  it('reads the LUID, vendor and device ids and name the core reports', () => {
    expect(coreAdapterFromStatus(coreOnDgpu)).toEqual({
      luid: '000000000001abcd', vendorId: 0x10de, deviceId: 0x2191, name: 'NVIDIA GeForce GTX 1660 Ti',
    });
  });

  it('is null before the core has reported an adapter', () => {
    expect(coreAdapterFromStatus(null)).toBeNull();
    expect(coreAdapterFromStatus({ adapter_name: null, adapter_luid: null, native_caps: { adapter_vendor: 0, adapter_device: 0 } })).toBeNull();
  });

  it('keeps vendor and device ids when the LUID is missing (core without it)', () => {
    expect(coreAdapterFromStatus({ native_caps: { adapter_vendor: 0x10de, adapter_device: 0x2191 } }))
      .toMatchObject({ luid: '', vendorId: 0x10de, deviceId: 0x2191 });
  });
});

describe('pickCaptureAdapter', () => {
  it('picks the core adapter by LUID, not the default (first) adapter', () => {
    const pick = pickCaptureAdapter([IGPU, DGPU, WARP], coreAdapterFromStatus(coreOnDgpu));
    expect(pick).toMatchObject({ luid: DGPU.luid, match: 'luid', adapter: DGPU });
  });

  it('falls back to a unique vendor + device match when the LUID is not listed', () => {
    const pick = pickCaptureAdapter([IGPU, DGPU], { luid: '00000000000fffff', vendorId: 0x10de, deviceId: 0x2191, name: '' });
    expect(pick).toMatchObject({ luid: DGPU.luid, match: 'vendor-device' });
  });

  it('does not guess between two identical cards', () => {
    const twin = { ...DGPU, luid: '000000000002abcd' };
    const pick = pickCaptureAdapter([DGPU, twin], { luid: '', vendorId: 0x10de, deviceId: 0x2191, name: '' });
    expect(pick.match).toBe('none');
    expect(pick.luid).toBe('');
    expect(pick.reason).toMatch(/2 adapters/);
  });

  it('never matches a software adapter by vendor and device', () => {
    const pick = pickCaptureAdapter([IGPU, WARP], { luid: '', vendorId: 0x1414, deviceId: 0x8c, name: '' });
    expect(pick.match).toBe('none');
  });

  it('keeps the default adapter when nothing matches, and says why', () => {
    const pick = pickCaptureAdapter([IGPU], coreAdapterFromStatus(coreOnDgpu));
    expect(pick).toMatchObject({ luid: '', match: 'none' });
    expect(pick.reason).toBeTruthy();
    expect(pickCaptureAdapter([IGPU, DGPU], null)).toMatchObject({ luid: '', match: 'none' });
  });

  it('still passes the exact LUID to an addon that cannot list adapters', () => {
    expect(pickCaptureAdapter([], coreAdapterFromStatus(coreOnDgpu))).toMatchObject({ luid: DGPU.luid, match: 'luid' });
  });

  it('single-GPU desktop: the one adapter is the core adapter', () => {
    const only = { ...DGPU, luid: '0000000000009999' };
    const pick = pickCaptureAdapter([only, WARP], { luid: '0000000000009999', vendorId: 0x10de, deviceId: 0x2191, name: '' });
    expect(pick).toMatchObject({ luid: only.luid, match: 'luid' });
  });
});

describe('describeAdapter', () => {
  it('prints name, vendor, device and LUID for the support log', () => {
    expect(describeAdapter(DGPU)).toBe('"NVIDIA GeForce GTX 1660 Ti" (vendor=0x10de device=0x2191 luid=000000000001abcd)');
    expect(describeAdapter(null)).toBe('unknown adapter');
  });
});

/*
 * The IPC handlers in electron/main.js, run against a mock addon: the start
 * calls carry the core's adapter on Windows, and nothing changes on macOS.
 */
const mainSource = readFileSync('electron/main.js', 'utf8');
const helpers = mainSource.slice(
  mainSource.indexOf('let liveCaptureAdapterLastLog'),
  mainSource.indexOf('function loadLiveCaptureAddon()'),
);
const handlers = mainSource.slice(
  mainSource.indexOf("  ipcMain.handle('native_live_capture_start_camera'"),
  mainSource.indexOf('  // --- Output fullscreen on external monitor ---'),
);

function harness(platform: 'win32' | 'darwin', status: any = coreOnDgpu, adapters: any[] = [IGPU, DGPU]) {
  const ipc: Record<string, Function> = {};
  const logs: string[] = [];
  const addon = {
    listAdapters: vi.fn(() => adapters),
    startCamera: vi.fn((_args: any) => true),
    startScreen: vi.fn((_args: any) => true),
    receiveTextureInfo: vi.fn(() => ({
      available: true, platform: 'dxgi', kind: 'webcam', width: 640, height: 480, format: 87, frame: 3,
      handle: Buffer.alloc(8, 1), adapterLuid: DGPU.luid, adapterName: DGPU.name, adapterVendorId: DGPU.vendorId, adapterDeviceId: DGPU.deviceId,
    })),
  };
  const broker = { lastStatus: status, getStatus: vi.fn(async () => status) };
  const context: Record<string, any> = {
    ...adapterModule,
    process: { platform },
    isWin: platform === 'win32',
    isMac: platform === 'darwin',
    console: { log: (line: string) => logs.push(line), warn() {}, error() {} },
    nativeRendererBroker: broker,
    loadLiveCaptureAddon: () => addon,
    liveCaptureAddonLoadError: null,
    systemPreferences: { getMediaAccessStatus: () => 'granted', askForMediaAccess: async () => true },
    screen: { getAllDisplays: () => [] },
    normalizeSharedTextureHandle: (handle: any) => handle,
    sharedTextureHandlePayload: () => ({ handle: '0101010101010101', handleEncoding: 'hex', handleByteLength: 8 }),
    ipcMain: { handle: (name: string, fn: Function) => { ipc[name] = fn; } },
  };
  vm.runInNewContext(`${helpers}\n${handlers}`, context);
  return { ipc, addon, broker, logs };
}

describe('live capture IPC handlers', () => {
  it('Windows: starts the camera on the render core adapter and logs both adapters', async () => {
    const h = harness('win32');
    const result = await h.ipc.native_live_capture_start_camera(null, { sessionId: 's1', deviceId: 'usb-cam' });
    expect(result.ok).toBe(true);
    expect(h.addon.startCamera).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's1', deviceId: 'usb-cam', adapterLuid: DGPU.luid,
    }));
    expect(h.logs.join('\n')).toMatch(/camera device on "NVIDIA GeForce GTX 1660 Ti".*render core on "NVIDIA GeForce GTX 1660 Ti".*same adapter/);
  });

  it('Windows: screen capture is started on the render core adapter too', async () => {
    const h = harness('win32');
    await h.ipc.native_live_capture_start_screen(null, { sessionId: 's2', sourceId: 'screen:0:0', kind: 'screen' });
    expect(h.addon.startScreen).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's2', adapterLuid: DGPU.luid }));
  });

  it('Windows: asks the core for its status when none has been read yet', async () => {
    const h = harness('win32');
    h.broker.lastStatus = null;
    await h.ipc.native_live_capture_start_camera(null, { sessionId: 's3' });
    expect(h.broker.getStatus).toHaveBeenCalled();
    expect(h.addon.startCamera).toHaveBeenCalledWith(expect.objectContaining({ adapterLuid: DGPU.luid }));
  });

  it('Windows: no match keeps the default adapter and logs the reason once', async () => {
    const h = harness('win32', coreOnDgpu, [IGPU]);
    await h.ipc.native_live_capture_start_camera(null, { sessionId: 'a' });
    await h.ipc.native_live_capture_start_camera(null, { sessionId: 'b' });
    expect(h.addon.startCamera.mock.calls[0][0]).not.toHaveProperty('adapterLuid');
    expect(h.logs.filter((line) => line.includes('stay on the default adapter'))).toHaveLength(1);
  });

  it('macOS: start arguments are unchanged', async () => {
    const h = harness('darwin');
    await h.ipc.native_live_capture_start_camera(null, { sessionId: 'm1', deviceId: 'facetime' });
    expect(h.addon.startCamera.mock.calls[0][0]).toEqual({ sessionId: 'm1', deviceId: 'facetime' });
    expect(h.addon.listAdapters).not.toHaveBeenCalled();
  });

  it('passes the frames\' adapter through texture info for the editor', async () => {
    const h = harness('win32');
    const info = await h.ipc.native_live_capture_texture_info(null, { sessionId: 's1' });
    expect(info).toMatchObject({ available: true, platform: 'dxgi', adapterLuid: DGPU.luid, adapterName: DGPU.name });
  });
});
