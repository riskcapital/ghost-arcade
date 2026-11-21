import { afterEach, describe, expect, it, vi } from 'vitest';
import { interactiveFeatureEnabled } from './features';

describe('interactiveFeatureEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('is off by default', () => {
    vi.stubEnv('VITE_INTERACTIVE', '');
    expect(interactiveFeatureEnabled()).toBe(false);
  });
  it('turns on with VITE_INTERACTIVE=1, on or true', () => {
    for (const value of ['1', 'on', 'TRUE']) {
      vi.stubEnv('VITE_INTERACTIVE', value);
      expect(interactiveFeatureEnabled()).toBe(true);
    }
    vi.stubEnv('VITE_INTERACTIVE', '0');
    expect(interactiveFeatureEnabled()).toBe(false);
  });
});
