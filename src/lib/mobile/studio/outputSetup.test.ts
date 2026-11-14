import { describe, expect, it } from 'vitest';
import { darkOutputReasons, displaySize, nextSetupStep, noDisplayConnected } from './outputSetup';

describe('no display connected', () => {
  it('is true in the app while nothing is connected and clears as soon as a display connects', () => {
    expect(noDisplayConnected({ native: true, connected: false })).toBe(true);
    expect(noDisplayConnected({ native: true, connected: true })).toBe(false);
  });
  it('is never true in a browser, which cannot drive a display', () => {
    expect(noDisplayConnected({ native: false, connected: false })).toBe(false);
  });
});

describe('projector setup steps', () => {
  it('moves from connect to the test pattern by itself when a display connects (a cable needs no tap)', () => {
    expect(nextSetupStep('connect', false)).toBe('connect');
    expect(nextSetupStep('connect', true)).toBe('test');
  });
  it('waits on the test pattern until the person says it is on the wall', () => {
    expect(nextSetupStep('test', true)).toBe('test');
    expect(nextSetupStep('test', true, true)).toBe('done');
    expect(nextSetupStep('done', true)).toBe('done');
  });
  it('goes back to connect from any step when the display goes away', () => {
    expect(nextSetupStep('test', false)).toBe('connect');
    expect(nextSetupStep('done', false, true)).toBe('connect');
  });
});

describe('why the projector is dark', () => {
  const live = { enabled: true, blackout: false, master: 1, state: 'live' as const };
  it('finds nothing when all is well', () => expect(darkOutputReasons(live)).toEqual([]));
  it('lists switched off, blackout, master at zero and a picture still starting', () => {
    expect(darkOutputReasons({ ...live, enabled: false })).toEqual(['off']);
    expect(darkOutputReasons({ ...live, blackout: true, master: 0 })).toEqual(['blackout', 'master']);
    expect(darkOutputReasons({ ...live, state: 'connecting' })).toEqual(['starting']);
  });
});

it('writes a display size only when it is known', () => {
  expect(displaySize({ name: 'TV', width: 1920, height: 1080 })).toBe('1920 × 1080');
  expect(displaySize({ name: 'TV', width: 0, height: 0 })).toBe('');
  expect(displaySize(undefined)).toBe('');
});
