import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPairingLink, launchScreen, onLaunchPath, setLaunchPath, takeLaunchPath } from './launchIntent';

describe('launchScreen', () => {
  it('shows the welcome screen on a cold launch with nothing in the pairing inbox', () => {
    expect(launchScreen(null)).toBe('welcome');
    expect(launchScreen(undefined)).toBe('welcome');
    expect(launchScreen('')).toBe('welcome');
  });

  it.each([
    ['ghostarcade://pair', 'ghostarcade://pair?url=' + encodeURIComponent('http://192.168.1.20:9002/?pair=ABCD-1234&ws=9001')],
    ['ghostarcade.live/connect', 'https://ghostarcade.live/connect#host=192.168.1.20:9002&pair=ABCD1234&ws=9001'],
    ['www.ghostarcade.live/connect/', 'https://www.ghostarcade.live/connect/#host=192.168.1.20:9002&pair=ABCD1234'],
    ['the desktop LAN link', 'http://192.168.1.20:9002/?pair=ABCD-1234&ws=9001'],
  ])('skips straight to pairing for a %s link waiting at launch', (_form, link) => {
    expect(launchScreen(link)).toBe('pairing');
  });

  it('shows the welcome screen for links that are not pairing links', () => {
    expect(launchScreen('ghostarcade://other?url=x')).toBe('welcome');
    expect(launchScreen('https://ghostarcade.live/download')).toBe('welcome');
    expect(launchScreen('https://example.com/connect#host=1.2.3.4')).toBe('welcome');
    expect(launchScreen('not a url')).toBe('welcome');
  });

  it('recognises the form only; the parser still checks the contents', () => {
    expect(isPairingLink('ghostarcade://pair')).toBe(true);
  });
});

describe('launch paths', () => {
  let stop: (() => void) | null = null;
  afterEach(() => { stop?.(); stop = null; takeLaunchPath(); });

  it('keeps a path for the studio about to start, once', () => {
    setLaunchPath('mapping');
    expect(takeLaunchPath()).toBe('mapping');
    expect(takeLaunchPath()).toBeNull();
  });

  it('hands later paths to the running studio instead of keeping them', () => {
    const seen = vi.fn();
    stop = onLaunchPath(seen);
    setLaunchPath('control');
    setLaunchPath('resume');
    expect(seen.mock.calls).toEqual([['control'], ['resume']]);
    expect(takeLaunchPath()).toBeNull();
  });

  it('never keeps a resume for a studio that has not started', () => {
    setLaunchPath('resume');
    expect(takeLaunchPath()).toBeNull();
  });
});
