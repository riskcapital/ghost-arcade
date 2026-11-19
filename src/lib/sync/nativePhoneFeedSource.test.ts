/**
 * A paired phone's camera / depth feed on a layer or deck cell reaches the
 * render core. Before 2.1.12 the desktop put `live://phone-camera/<session>`
 * in the library and called it live, but the native sync blocked the layer
 * (`video:native-readable-uri-required`) and VJ Sources never listed it.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  invoke: vi.fn(async () => null),
}));

beforeAll(() => {
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
});

async function modules() {
  return {
    sync: await import('./nativeRendererSync'),
    feeds: await import('../mobile/phoneFeeds'),
    types: await import('../types'),
  };
}

function layerWith(types: Awaited<ReturnType<typeof modules>>['types'], id: string, src: Record<string, unknown>): any {
  const layer = types.createLayer(id, id, 'media') as any;
  layer.visible = true;
  layer.source = src;
  return layer;
}

describe('phone feeds in the native compositor', () => {
  it('a layer showing a phone feed is not blocked', async () => {
    const { sync, types, feeds } = await modules();
    const layer = layerWith(types, 'L1', { id: 'clip-1', type: 'video', name: 'Mobile Dual Camera', src: feeds.phoneFeedUri('dual'), isPlaying: true });
    expect(sync.nativeUnsupportedSourceReason(layer, false, { nativeVideoDecodePumpReady: true })).toBeNull();
    // An address saved by an older build (a session id) is not blocked either: it shows the disconnected camera.
    const legacy = layerWith(types, 'L2', { id: 'clip-2', type: 'video', name: 'Phone Camera', src: 'live://phone-camera/6ee3c361-b996-411b-95c5-66f09a75a954' });
    expect(sync.nativeUnsupportedSourceReason(legacy, false, { nativeVideoDecodePumpReady: true })).toBeNull();
  });

  it('binds the feed by name to its own core source, shared by every layer showing it', async () => {
    const { sync, feeds } = await modules();
    const a = sync.nativeLayerSourceFromMediaSource({ id: 'clip-a', type: 'video', name: 'Mobile Dual Camera', src: feeds.phoneFeedUri('dual') } as any);
    const b = sync.nativeLayerSourceFromMediaSource({ id: 'clip-b', type: 'video', name: 'Mobile Dual Camera', src: feeds.phoneFeedUri('dual') } as any);
    const depth = sync.nativeLayerSourceFromMediaSource({ id: 'clip-c', type: 'video', name: 'Mobile Depth Map', src: feeds.phoneFeedUri('depth') } as any);
    expect(a).toMatchObject({ id: 'phone-feed:dual', uri: 'native-phone-feed://dual', sourceType: 'image', shouldPrefetch: false, shouldPreview: false });
    expect(b.id).toBe(a.id);
    expect(b.uri).toBe(a.uri);
    expect(depth.id).toBe('phone-feed:depth');
  });

  it('takes the picture shape from the feed once frames arrive', async () => {
    const { sync, feeds } = await modules();
    feeds.resetPhoneFeeds();
    const src = { id: 'clip-a', type: 'video', name: 'Mobile Dual Camera', src: feeds.phoneFeedUri('dual') } as any;
    expect(sync.nativeLayerSourceFromMediaSource(src).aspect).toBeUndefined();
    feeds.setPhoneFeedAspect('dual', 1280, 480);
    expect(sync.nativeLayerSourceFromMediaSource(src).aspect).toBeCloseTo(1280 / 480);
  });

  it('leaves the other live sources as they were', async () => {
    const { sync } = await modules();
    expect(sync.nativeLayerSourceFromMediaSource({ id: 'cam', type: 'video', name: 'Camera', src: 'live://webcam/session-1' } as any))
      .toMatchObject({ id: 'cam', uri: 'native-live://webcam/session-1', sourceType: 'live:webcam' });
  });
});
