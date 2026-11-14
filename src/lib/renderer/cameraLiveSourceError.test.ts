/**
 * The GPU layer panel shows a camera's error by listening for it, not by
 * polling every 700 ms whatever the source is.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ startResult: { ok: false, error: 'Windows is blocking camera access' } as any }));

vi.mock('$lib/bridge', () => ({
  isElectron: true,
  invoke: vi.fn(async (command: string) => (command === 'native_live_capture_start_camera' ? h.startResult : null)),
}));

import {
  cameraErrorListenerCount,
  cameraLayerSource,
  noteCameraLiveSourceImport,
  pruneCameraLiveSources,
  subscribeCameraLiveSourceError,
} from './cameraLiveSource';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  pruneCameraLiveSources(new Set());
  h.startResult = { ok: false, error: 'Windows is blocking camera access' };
});

describe('camera error subscription', () => {
  it('hears the current error at once and each change, and nothing when it does not change', async () => {
    const heard: Array<string | null> = [];
    const stop = subscribeCameraLiveSourceError('usb', (error) => heard.push(error));
    expect(heard).toEqual([null]);
    cameraLayerSource('usb');
    await flush();
    expect(heard).toEqual([null, 'Windows is blocking camera access']);
    stop();
    expect(cameraErrorListenerCount()).toBe(0);
  });

  it('hears the core rejecting a live camera\'s frames, and the recovery', async () => {
    h.startResult = { ok: true };
    cameraLayerSource('usb');
    await flush();
    const heard: Array<string | null> = [];
    const stop = subscribeCameraLiveSourceError('usb', (error) => heard.push(error));
    noteCameraLiveSourceImport('camera:usb', 'This camera is on a different graphics chip');
    noteCameraLiveSourceImport('camera:usb', 'This camera is on a different graphics chip');
    noteCameraLiveSourceImport('camera:usb', null);
    expect(heard).toEqual([null, 'This camera is on a different graphics chip', null]);
    stop();
  });

  it('only hears its own camera', async () => {
    const heard: Array<string | null> = [];
    const stop = subscribeCameraLiveSourceError('other', (error) => heard.push(error));
    cameraLayerSource('usb');
    await flush();
    expect(heard).toEqual([null]);
    stop();
  });

  it('the panel subscribes only for a camera source and keeps no poll timer', () => {
    const panel = readFileSync('src/lib/components/GPULayerPanel.svelte', 'utf8');
    expect(panel).toContain('subscribeCameraLiveSourceError');
    expect(panel).not.toMatch(/cameraErrorPoll|setInterval\(/);
    expect(panel).toMatch(/watchCameraError\(cameraSourceParam\?\.type === 'camera'/);
    expect(panel).toMatch(/onDestroy\(\(\) => \{\s*watchCameraError\(null\)/);
  });
});
