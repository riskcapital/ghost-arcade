import { describe, it, expect } from 'vitest';
import { mobileConnectionUrl } from './mobileConnectionUrl';
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
