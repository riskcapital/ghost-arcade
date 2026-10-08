import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREFERENCES_KEY, defaultPreferences, feel, loadPreferences, normalizePreferences, savePreferences } from './preferences';
import { STORAGE_KEY } from './model';
import { resetHapticsProbe } from './nativeShare';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}
afterEach(() => { delete (globalThis as { Capacitor?: unknown }).Capacitor; resetHapticsProbe(); });

describe('device preferences', () => {
  it('a new install gets haptics on, launch on touch-down off and the coach pending', () => {
    expect(loadPreferences(memory())).toEqual({ haptics: true, launchOnTouchDown: false, coachDone: false, repairOffered: [] });
  });
  it('an install that already holds a set never sees the coach', () => {
    expect(loadPreferences(memory({ [STORAGE_KEY]: '{}' })).coachDone).toBe(true);
  });
  it('round-trips and repairs bad values', () => {
    const storage = memory();
    savePreferences({ haptics: false, launchOnTouchDown: true, coachDone: true, repairOffered: ['a', 'a', 'b'] }, storage);
    expect(loadPreferences(storage)).toEqual({ haptics: false, launchOnTouchDown: true, coachDone: true, repairOffered: ['a', 'b'] });
    expect(normalizePreferences({ haptics: 'yes', repairOffered: [1, 'x'] })).toEqual({ ...defaultPreferences(), repairOffered: ['x'] });
    storage.data.set(PREFERENCES_KEY, 'not json');
    expect(loadPreferences(storage)).toEqual(defaultPreferences());
  });
  it('sends each feel as its haptic type, and nothing when haptics are off', () => {
    const nativePromise = vi.fn(() => Promise.resolve({}));
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'ios', nativePromise, PluginHeaders: [{ name: 'StudioCapture', methods: [{ name: 'haptic' }] }] };
    feel({ haptics: true }, 'launch'); feel({ haptics: true }, 'stop'); feel({ haptics: true }, 'blackout'); feel({ haptics: true }, 'switch');
    expect(nativePromise.mock.calls.map((c) => (c as unknown[])[2])).toEqual([{ type: 'light' }, { type: 'medium' }, { type: 'medium' }, { type: 'selection' }]);
    feel({ haptics: false }, 'launch');
    expect(nativePromise).toHaveBeenCalledTimes(4);
  });
  it('stays silent where the app build has no haptic method', () => {
    const nativePromise = vi.fn(() => Promise.resolve({}));
    (globalThis as { Capacitor?: unknown }).Capacitor = { getPlatform: () => 'ios', nativePromise, PluginHeaders: [{ name: 'StudioCapture', methods: [] }] };
    feel({ haptics: true }, 'launch');
    expect(nativePromise).not.toHaveBeenCalled();
  });
});
