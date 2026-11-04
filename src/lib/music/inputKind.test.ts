import { describe, expect, it } from 'vitest';
import { SYSTEM_AUDIO_DEVICE, inputKind } from './liveInput';

describe('grouping audio inputs for the source picker', () => {
  it('puts a nearby iPhone under Phone', () => {
    expect(inputKind("Justin's iPhone Microphone")).toBe('phone');
  });
  it('puts the laptop or desktop mic under This computer', () => {
    expect(inputKind('MacBook Pro Microphone')).toBe('computer');
    expect(inputKind('Microphone Array (Realtek(R) Audio)')).toBe('computer');
    expect(inputKind('Built-in Microphone')).toBe('computer');
  });
  it('puts everything else (interfaces, line inputs) under Interfaces', () => {
    expect(inputKind('Scarlett 2i2 USB')).toBe('interface');
    expect(inputKind('BlackHole 2ch')).toBe('interface');
  });
  it('has a fixed id for system audio', () => {
    expect(SYSTEM_AUDIO_DEVICE).toBe('system-audio');
  });
});
