import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The crash-recovery modal must not throw the autosave away on a stray
 * click. Its backdrop used to call discardAutosave, so one click outside the
 * dialog (easy while the app is still loading) deleted the only copy of the
 * unsaved project. Source-level: App.svelte needs a DOM and the whole app.
 */
describe('crash recovery modal', () => {
  const app = readFileSync(join(process.cwd(), 'src', 'App.svelte'), 'utf8');
  const start = app.indexOf('{#if showRecoveryModal}');
  const block = app.slice(start, app.indexOf('{/if}', start));

  it('only the Discard button discards the autosave', () => {
    expect(start).toBeGreaterThan(-1);
    const backdrop = block.slice(0, block.indexOf('>') + 1);
    expect(backdrop).toContain('close-modal-backdrop');
    expect(backdrop).not.toMatch(/onclick/);
    expect(block.match(/onclick=\{discardAutosave\}/g)).toHaveLength(1);
    expect(block).toMatch(/btn-discard" onclick=\{discardAutosave\}/);
  });
});
