import { describe, expect, it } from 'vitest';
import { capabilitiesRequest, DEPTH_CAPTURE_LIMITS, outputAspect, readDesktopCapabilities } from './desktopCapabilities';
import { depthCaptureOffer, depthScanProgress, depthStatusText, readDepthCaptureStatus, readDepthScanRequest, stageOf } from './depthScan';
import { CLASSIC_STARTERS, classicStarterScene, phoneStarters, phoneStarterScene } from './phoneStarters';
import { INTERACTIVE_STARTERS, starterScene } from './interactiveLibrary';

describe('desktop capabilities', () => {
  it('an older desktop (no flags) turns nothing new on', () => {
    const c = readDesktopCapabilities({ type: 'studio_capabilities', version: 1, nativeInteractive: true, visualFeeds: true });
    expect(c).toEqual({ nativeInteractive: true, world: null, depthCapture: null, output: null });
    expect(outputAspect(c)).toBeCloseTo(16 / 9);
  });
  it('reads the world, its tools, the depth limits and the output', () => {
    const c = readDesktopCapabilities({
      version: 1, nativeInteractive: true, interactiveWorld: 1,
      worldTools: ['attract', 'repel', 'vortex', 'throw', 'push', 'pour', 'ignite', 'unknown'],
      depthCapture: { version: 1, maxSurfaces: 48, maxSamplesPerSurface: 4000, maxSamplesTotal: 60000, maxOutline: 64, maxBytes: 8000000 },
      output: { width: 1920, height: 1200 },
    });
    expect(c.world?.tools).toEqual(['throw', 'push', 'pour', 'ignite', 'attract', 'repel', 'vortex']);
    expect(c.depthCapture).toEqual(DEPTH_CAPTURE_LIMITS);
    expect(outputAspect(c)).toBeCloseTo(1.6);
  });
  it('a desktop may lower the limits but not raise them; malformed flags are off', () => {
    const c = readDesktopCapabilities({ interactiveWorld: 2, depthCapture: { version: 1, maxSurfaces: 8, maxSamplesTotal: 10 ** 9, maxOutline: 1 }, output: { width: -1, height: 5 } });
    expect(c.world).toBeNull();
    expect(c.depthCapture).toMatchObject({ maxSurfaces: 8, maxSamplesTotal: 60000, maxOutline: 3 });
    expect(c.output).toBeNull();
    expect(readDesktopCapabilities({ depthCapture: { version: 2 } }).depthCapture).toBeNull();
    expect(readDesktopCapabilities({ interactiveWorld: 1 }).world?.tools).toEqual(['attract', 'repel', 'vortex']);
  });
  it('the request says which app asks', () => {
    expect(capabilitiesRequest()).toEqual({ type: 'studio_capabilities_request', client: { app: 'ios', version: '1.2', build: '' } });
  });
});

describe('depth scan messages', () => {
  it('reads a request and answers with its id', () => {
    expect(readDepthScanRequest({ type: 'studio_depth_scan_request', requestId: 'r-1', layerId: 'layer-2', screenId: 's1', output: { width: 1920, height: 1080 } }))
      .toEqual({ requestId: 'r-1', layerId: 'layer-2', screenId: 's1', output: { width: 1920, height: 1080 } });
    expect(readDepthScanRequest({ type: 'studio_depth_scan_request', requestId: 'bad id!' })).toBeNull();
    expect(readDepthScanRequest({ type: 'studio_scene', requestId: 'r' })).toBeNull();
    expect(depthScanProgress('r-1', 'patterns', 0.426)).toEqual({ type: 'studio_depth_scan_progress', requestId: 'r-1', stage: 'patterns', pct: 43 });
    expect(depthCaptureOffer('r-1', { version: 1 } as never)).toEqual({ type: 'studio_depth_capture_offer', requestId: 'r-1', capture: { version: 1 } });
  });
  it('reads the desktop’s answer for this offer only', () => {
    expect(readDepthCaptureStatus({ type: 'studio_depth_capture_status', requestId: 'a', state: 'applied' }, 'a')).toEqual({ state: 'applied' });
    expect(readDepthCaptureStatus({ type: 'studio_depth_capture_status', requestId: 'b', state: 'applied' }, 'a')).toBeNull();
    expect(readDepthCaptureStatus({ type: 'studio_depth_capture_status', requestId: 'a', state: 'maybe' }, 'a')).toBeNull();
    expect(depthStatusText('error', 'Bad scan')).toBe('Bad scan');
    expect(stageOf('Screen 1: pattern 3 of 17')).toBe('patterns');
    expect(stageOf('Measuring depth')).toBe('measuring');
    expect(stageOf('Screen 1: finding surfaces')).toBe('solving');
  });
});

describe('starters on the phone', () => {
  it('alone or with an older desktop: the classic starters, no zones, no music defaults', () => {
    expect(phoneStarters(false)).toBe(CLASSIC_STARTERS);
    for (const s of CLASSIC_STARTERS) {
      const scene = phoneStarterScene(s.id, false);
      expect(scene.surfaces.some((x) => x.behavior === 'trigger')).toBe(false);
      expect(scene.surfaces.some((x) => x.look)).toBe(false);
      expect(scene.effects?.every((e) => Object.keys(e.mods).length === 0)).toBe(true);
      expect(scene.world).toBeUndefined();
    }
    expect(classicStarterScene('balls').effects?.[0].params).toMatchObject({ x: 0.28, y: 0.1, flow: 0.55, lifetime: 7, bounce: 0.8, size: 0.45, hue: 90 });
  });
  it('with a world desktop: the desktop’s own starters, world ones included', () => {
    expect(phoneStarters(true)).toBe(INTERACTIVE_STARTERS);
    const cascade = phoneStarterScene('cascade', true);
    expect(cascade.world?.enabled).toBe(true);
    expect(JSON.stringify({ ...phoneStarterScene('fire', true), effects: [] })).toBe(JSON.stringify({ ...starterScene('fire'), effects: [] }));
  });
});
