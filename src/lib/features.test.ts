import { afterEach, describe, expect, it, vi } from 'vitest';
import { interactiveFeatureEnabled } from './features';

describe('interactiveFeatureEnabled', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('is on by default', () => {
    vi.stubEnv('VITE_INTERACTIVE', '');
    expect(interactiveFeatureEnabled()).toBe(true);
  });
  it('turns off with VITE_INTERACTIVE=0, off or false', () => {
    for (const value of ['0', 'off', 'FALSE']) {
      vi.stubEnv('VITE_INTERACTIVE', value);
      expect(interactiveFeatureEnabled()).toBe(false);
    }
    vi.stubEnv('VITE_INTERACTIVE', '1');
    expect(interactiveFeatureEnabled()).toBe(true);
  });
});
