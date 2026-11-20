import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const invoke = vi.fn(async (..._args: unknown[]) => null);
vi.mock('$lib/bridge', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import { NATIVE_PIPELINE_CACHE_CAP, startNativeRenderer } from './native-renderer';

// Each cached pipeline holds about a quarter of a megabyte in the render core
// (229 held 118 MB; evicting to 32 gave back 52 MB). At 512 a long session
// that kept loading new shaders grew the core by ~130 MB.
describe('render core pipeline cache cap', () => {
  it('bounds the cache near 32 MB', () => {
    expect(NATIVE_PIPELINE_CACHE_CAP).toBeLessThanOrEqual(128);
    expect(NATIVE_PIPELINE_CACHE_CAP).toBeGreaterThanOrEqual(64);
  });

  it('is what the core is started with by default', async () => {
    await startNativeRenderer();
    const [command, payload] = invoke.mock.calls[0] as [string, { config: Record<string, unknown> }];
    expect(command).toBe('native_renderer_start');
    expect(payload.config.pipeline_metadata_cache_cap).toBe(NATIVE_PIPELINE_CACHE_CAP);
  });

  it('matches the core and is the one the editor sync starts the core with', () => {
    const core = readFileSync(new URL('../../../native-renderer/src/main.rs', import.meta.url), 'utf8');
    expect(core).toContain(`const NATIVE_PIPELINE_CACHE_CAP: u32 = ${NATIVE_PIPELINE_CACHE_CAP};`);
    const sync = readFileSync(new URL('../sync/nativeRendererSync.ts', import.meta.url), 'utf8');
    expect(sync).toContain('pipeline_metadata_cache_cap: NATIVE_PIPELINE_CACHE_CAP,');
    expect(sync).not.toMatch(/pipeline_metadata_cache_cap:\s*\d/);
  });
});
