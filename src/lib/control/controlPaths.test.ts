import { describe, expect, it } from 'vitest';
import {
  CONTROL_PATH_EXAMPLES,
  isVideoScratchPath,
  normalizeControlPath,
  validateControlPath,
} from './controlPaths';

describe('control parameter paths', () => {
  it('normalizes legacy VJ layer and mapping aliases', () => {
    expect(normalizeControlPath('vj:layer:0:opacity')).toBe('vj:0:opacity');
    expect(normalizeControlPath('VJ-B:Layer:2:Trigger:4')).toBe('vj-b:2:trigger:4');
    expect(normalizeControlPath('mapping:preset:0')).toBe('map:preset:0');
  });

  it('accepts every documented example', () => {
    for (const example of CONTROL_PATH_EXAMPLES) {
      expect(validateControlPath(example.path), example.path).toEqual({
        valid: true,
        normalized: example.path,
        reason: null,
      });
    }
  });

  it('keeps scratch control distinct from external timeline position', () => {
    for (const path of ['map:media:scratch', 'vj:0:video:scratch', 'vj-b:2:video:scratch', 'VJ:Layer:3:Video:Scratch']) {
      expect(isVideoScratchPath(path), path).toBe(true);
      expect(validateControlPath(path).valid, path).toBe(true);
    }
    for (const path of ['map:media:position', 'vj:0:video:position', 'vj-b:2:video:play']) {
      expect(isVideoScratchPath(path), path).toBe(false);
      expect(validateControlPath(path).valid, path).toBe(true);
    }
  });

  it('returns useful validation errors for invalid targets', () => {
    expect(validateControlPath('vj:layer:0:nope')).toEqual({
      valid: false,
      normalized: 'vj:0:nope',
      reason: 'Unknown VJ layer property "nope".',
    });
    expect(validateControlPath('map:preset:not-a-number').reason).toContain('zero-based index');
  });
});
