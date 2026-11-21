import { describe, it, expect } from 'vitest';
import { mobileConnectionUrl, mobileControlAppLink, MOBILE_CONTROL_PAGE, IPHONE_APP_STORE_URL } from './mobileConnectionUrl';
describe('packaged mobile pairing links', () => {
  it.each([
    'file:///Applications/Ghost-Arcade.app/Contents/Resources/app.asar/dist/index.html',
    'file:///C:/Users/Artist/AppData/Local/Programs/Ghost-Arcade/resources/app.asar/dist/index.html',
    'file:///opt/Ghost-Arcade/resources/app.asar/dist/index.html',
  ])('does not throw before LAN discovery: %s', (page) => {
    const host = new URL(page).hostname;
    expect(mobileConnectionUrl(host, 9002, 'TEST', 9001)).toBe('');
  });
  it('becomes a paired LAN link once discovery completes', () => {
    const url = new URL(mobileConnectionUrl('192.168.1.12', 9002, 'TEST', 9011));
    expect(url.origin).toBe('http://192.168.1.12:9002');
    expect(url.searchParams.get('pair')).toBe('TEST');
    expect(url.searchParams.get('ws')).toBe('9011');
    expect(url.hash).toBe('#/mobile');
  });
  it('supports development ports and IPv6 hosts', () => {
    expect(mobileConnectionUrl('192.168.1.12', '1451', '', 9001)).toBe('http://192.168.1.12:1451/#/mobile');
    expect(mobileConnectionUrl('2001:db8::1', 9002, '', 9001)).toBe('http://[2001:db8::1]:9002/#/mobile');
  });
});

describe('the Mobile Control QR link', () => {
  const lan = (host: string, ws = 9001, token = 'ABCDEFGH12345678') => mobileConnectionUrl(host, 9002, token, ws);
  it('points at the website with the desktop in the fragment only', () => {
    const link = mobileControlAppLink(lan('192.168.1.12', 9011));
    expect(link).toBe('https://ghostarcade.live/connect#host=192.168.1.12:9002&pair=ABCDEFGH12345678&ws=9011');
    const url = new URL(link);
    // Nothing a browser sends to the website names the desktop or carries the code.
    expect(url.origin + url.pathname + url.search).toBe(MOBILE_CONTROL_PAGE);
    const params = new URLSearchParams(url.hash.slice(1));
    expect(params.get('host')).toBe('192.168.1.12:9002');
    expect(params.get('pair')).toBe('ABCDEFGH12345678');
  });
  it('leaves the default socket port out and keeps IPv6 hosts readable', () => {
    expect(mobileControlAppLink(lan('192.168.1.12'))).toBe('https://ghostarcade.live/connect#host=192.168.1.12:9002&pair=ABCDEFGH12345678');
    const v6 = mobileControlAppLink(lan('fe80::1'));
    expect(new URLSearchParams(new URL(v6).hash.slice(1)).get('host')).toBe('[fe80::1]:9002');
  });
  it('is empty without a network address or a pairing code', () => {
    expect(mobileControlAppLink('')).toBe('');
    expect(mobileControlAppLink(lan('192.168.1.12', 9001, ''))).toBe('');
    expect(mobileControlAppLink('not a link')).toBe('');
  });
  it('opens the iPhone app listing', () => {
    expect(new URL(IPHONE_APP_STORE_URL).hostname).toBe('apps.apple.com');
  });
});
