/**
 * Windows: which graphics adapter a camera or screen capture device is made on.
 *
 * The render core opens every captured frame's shared texture on the adapter
 * it renders with, and a shared texture only opens on the adapter that made
 * it. The capture addon used to make its device on the default adapter. On a
 * laptop with two GPUs that is usually the integrated one, while the core asks
 * for the high-performance one: cameras listed and started, and every frame
 * failed to open, so the picture stayed blank.
 *
 * The core reports its adapter's LUID (exact) and its vendor and device ids
 * (from wgpu's adapter info). The addon lists the adapters it can see; this
 * picks the one to make the capture device on.
 */

/** 16 lower-case hex digits (HighPart first, as the core prints it), or ''. */
export function normalizeAdapterLuid(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[0-9a-f]{16}$/.test(text) ? text : '';
}

function positiveId(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

/**
 * What the core says about its adapter, from its status.
 * @param {any} status normalized core status (broker lastStatus)
 * @returns {{ luid: string, vendorId: number, deviceId: number, name: string } | null}
 */
export function coreAdapterFromStatus(status) {
  if (!status || typeof status !== 'object') return null;
  const caps = status.native_caps && typeof status.native_caps === 'object' ? status.native_caps : {};
  const core = {
    luid: normalizeAdapterLuid(status.adapter_luid),
    vendorId: positiveId(caps.adapter_vendor),
    deviceId: positiveId(caps.adapter_device),
    name: String(status.adapter_name || caps.adapter_name || ''),
  };
  return core.luid || (core.vendorId && core.deviceId) ? core : null;
}

/**
 * The adapter to make the capture device on.
 *
 * Exact LUID first. Failing that, the same vendor and device ids -- only when
 * exactly one adapter has them, since two identical cards cannot be told apart
 * that way and guessing wrong is no better than the default. Otherwise none:
 * the addon keeps its default adapter and the reason is logged.
 *
 * @param {Array<{ luid?: string, name?: string, vendorId?: number, deviceId?: number, software?: boolean }>} adapters
 * @param {ReturnType<typeof coreAdapterFromStatus>} core
 * @returns {{ luid: string, match: 'luid' | 'vendor-device' | 'none', adapter: any, reason: string }}
 */
export function pickCaptureAdapter(adapters, core) {
  const list = (Array.isArray(adapters) ? adapters : []).filter((adapter) => adapter && typeof adapter === 'object');
  if (!core) return { luid: '', match: 'none', adapter: null, reason: 'the render core has not reported its adapter' };
  if (core.luid) {
    const exact = list.find((adapter) => normalizeAdapterLuid(adapter.luid) === core.luid);
    if (exact) return { luid: core.luid, match: 'luid', adapter: exact, reason: '' };
  }
  if (core.vendorId && core.deviceId) {
    const same = list.filter((adapter) => !adapter.software
      && positiveId(adapter.vendorId) === core.vendorId
      && positiveId(adapter.deviceId) === core.deviceId
      && normalizeAdapterLuid(adapter.luid));
    if (same.length === 1) {
      return { luid: normalizeAdapterLuid(same[0].luid), match: 'vendor-device', adapter: same[0], reason: '' };
    }
    if (same.length > 1) {
      return { luid: '', match: 'none', adapter: null, reason: `${same.length} adapters match the render core's vendor and device ids` };
    }
  }
  // An addon too old to list adapters still takes the LUID: it is exact, and
  // an addon that cannot find it keeps its default adapter.
  if (core.luid && !list.length) return { luid: core.luid, match: 'luid', adapter: null, reason: '' };
  return { luid: '', match: 'none', adapter: null, reason: 'no adapter matches the render core\'s' };
}

function hex4(value) {
  return `0x${positiveId(value).toString(16).padStart(4, '0')}`;
}

/** One line for the log: name, vendor and device ids, LUID. */
export function describeAdapter(adapter) {
  if (!adapter) return 'unknown adapter';
  const name = String(adapter.name || 'unnamed');
  const luid = normalizeAdapterLuid(adapter.luid);
  return `"${name}" (vendor=${hex4(adapter.vendorId)} device=${hex4(adapter.deviceId)}${luid ? ` luid=${luid}` : ''})`;
}
