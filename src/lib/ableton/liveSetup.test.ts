import { describe, expect, it } from 'vitest';
import { livePlatform, liveSetupWords } from './liveSetup';

describe('Live setup words', () => {
  it('Windows, Live 10 and 11: Options → Preferences', () => {
    const ten = liveSetupWords('windows', ['10.1.43']);
    expect(ten.menu).toEqual(['Options', 'Preferences…']);
    expect(ten.tab).toBe('Link / MIDI');
    expect(ten.shortcut).toEqual(['Ctrl', ',']);
    expect(liveSetupWords('windows', ['11.3.21']).tab).toBe('Link / Tempo / MIDI');
  });

  it('Windows, Live 12: Options → Settings', () => {
    const twelve = liveSetupWords('windows', ['12.1.5', '10.1.43']);
    expect(twelve.menu).toEqual(['Options', 'Settings…']);
    expect(twelve.tab).toBe('Link, Tempo & MIDI');
    expect(twelve.version).toBe('Live 12.1.5');
  });

  it('macOS: Live → Preferences before Live 12, Settings after, with the Cmd shortcut', () => {
    const mac = liveSetupWords('mac', ['10.1.43']);
    expect(mac.menu).toEqual(['Live', 'Preferences…']);
    expect(mac.shortcut).toEqual(['⌘', ',']);
    expect(mac.tab).toBe('Link / MIDI');
    expect(liveSetupWords('mac', ['12.1']).menu).toEqual(['Live', 'Settings…']);
  });

  it('no Live found: names both spellings', () => {
    const none = liveSetupWords('windows', []);
    expect(none.version).toBeNull();
    expect(none.menuAlternative).toMatch(/Settings/);
    expect(none.tabNote).toMatch(/Link, Tempo & MIDI/);
  });

  it('reads the platform', () => {
    expect(livePlatform('MacIntel')).toBe('mac');
    expect(livePlatform('Win32')).toBe('windows');
  });
});
