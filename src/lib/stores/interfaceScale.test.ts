import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue({ scale: 1 }));
vi.mock('../bridge', () => ({ isDesktopApp: true, invoke }));
import { interfaceScale, normalizeInterfaceScale, startInterfaceScale } from './interfaceScale';

describe('editor interface scaling', () => {
  beforeEach(() => { interfaceScale.set(1); invoke.mockClear(); });
  it('defaults malformed saved values and limits the UI to usable sizes', () => {
    for (const value of [null, undefined, '', 'bad', 0, -1, Infinity]) expect(normalizeInterfaceScale(value)).toBe(1);
    expect(normalizeInterfaceScale(0.1)).toBe(0.75);
    expect(normalizeInterfaceScale(3)).toBe(2);
    expect(normalizeInterfaceScale('1.25')).toBe(1.25);
  });
  it('only sends scale changes while the main editor owns the subscription', () => {
    interfaceScale.set(1.25);
    expect(invoke).not.toHaveBeenCalled();
    const stop = startInterfaceScale();
    expect(invoke).toHaveBeenLastCalledWith('set_interface_scale', { scale: 1.25 });
    interfaceScale.set(1.5);
    expect(invoke).toHaveBeenLastCalledWith('set_interface_scale', { scale: 1.5 });
    stop(); invoke.mockClear(); interfaceScale.set(2);
    expect(invoke).not.toHaveBeenCalled();
  });
});
