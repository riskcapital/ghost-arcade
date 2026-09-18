import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const router = vi.hoisted(() => ({ dispatchPath: vi.fn() }));
vi.mock('../midi/midiRouter', () => ({ midiRouter: router }));
vi.mock('../utils/uuid', () => ({ generateUUID: () => 'learned-binding' }));
vi.mock('../stores/synthVision', async () => {
  const { writable } = await import('svelte/store');
  return { synthVisionStore: writable({ keyboardActive: false }) };
});
import { keyboardStore, type KeyBinding } from './keyboardStore';

describe('keyboard mappings with a focused native video timeline', () => {
  let surface: EventTarget;
  const focus = (nativeTimeline: boolean) => {
    vi.stubGlobal('document', {
      activeElement: {
        tagName: 'DIV',
        isContentEditable: false,
        getAttribute: (name: string) => name === 'role' ? 'slider' : null,
        hasAttribute: (name: string) => nativeTimeline && name === 'data-native-video-timeline',
      },
    });
  };
  const bind = (code: string) => {
    const binding: KeyBinding = {
      id: code, code, ctrl: false, shift: false, alt: false, meta: false,
      path: 'vj:layer:0:opacity', mode: 'momentary', min: 0, max: 1, step: 0.05, value: 1,
    };
    keyboardStore.hydrate({ enabled: true, bindings: [binding] });
  };
  const press = (type: 'keydown' | 'keyup', code: string) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      code, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false,
    });
    surface.dispatchEvent(event);
    return event;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    surface = new EventTarget();
    vi.stubGlobal('window', surface);
    focus(true);
  });
  afterEach(() => {
    keyboardStore.reset();
    vi.unstubAllGlobals();
  });

  it.each(['ArrowLeft', 'ArrowRight'])('leaves %s available for local frame stepping on press and release', code => {
    bind(code);
    expect(press('keydown', code).defaultPrevented).toBe(false);
    expect(press('keyup', code).defaultPrevented).toBe(false);
    expect(router.dispatchPath).not.toHaveBeenCalled();
  });

  it('keeps arrow mappings active for ordinary sliders', () => {
    focus(false);
    bind('ArrowRight');
    expect(press('keydown', 'ArrowRight').defaultPrevented).toBe(true);
    expect(press('keyup', 'ArrowRight').defaultPrevented).toBe(true);
    expect(router.dispatchPath.mock.calls).toEqual([
      ['vj:layer:0:opacity', 1, {}],
      ['vj:layer:0:opacity', 0, {}],
    ]);
  });

  it('keeps other mapped keys active while the video timeline has focus', () => {
    bind('KeyA');
    expect(press('keydown', 'KeyA').defaultPrevented).toBe(true);
    expect(press('keyup', 'KeyA').defaultPrevented).toBe(true);
    expect(router.dispatchPath).toHaveBeenCalledTimes(2);
  });

  it('still learns an arrow mapping from the focused video timeline', () => {
    keyboardStore.startLearn('vj:layer:0:opacity');
    expect(press('keydown', 'ArrowLeft').defaultPrevented).toBe(true);
    expect(get(keyboardStore).learnTarget).toBeNull();
    expect(get(keyboardStore).bindings).toEqual([
      expect.objectContaining({ code: 'ArrowLeft', path: 'vj:layer:0:opacity' }),
    ]);
    expect(router.dispatchPath).not.toHaveBeenCalled();
  });
});
