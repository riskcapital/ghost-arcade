import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Latched output overrides have to announce themselves.
 *
 * A user found their output stuck in dome projection and could not work out
 * what had happened. The mode was doing exactly what it was asked to; the
 * problem is where it lives. Output settings are global — localStorage, not
 * the project — so once dome is on it stays on across every project and every
 * upgrade, and nothing in the preview said so.
 *
 * This is the second time this shape has come up: runVersionMigration already
 * force-disables blackout and testPattern on upgrade because of an earlier
 * report of them latching. Dome is not reset there, and should not be — a
 * planetarium install would lose its configuration on every update. Naming
 * what is active is the fix that works for both kinds of user.
 */

const panelSource = readFileSync(
  join(process.cwd(), 'src', 'lib', 'components', 'VJModePanel.svelte'),
  'utf8',
);
const settingsSource = readFileSync(
  join(process.cwd(), 'src', 'lib', 'stores', 'settings.ts'),
  'utf8',
);

function overrideBlock(): string {
  const start = panelSource.indexOf('$: activeOutputOverrides');
  expect(start, 'activeOutputOverrides not found').toBeGreaterThan(-1);
  return panelSource.slice(start, panelSource.indexOf('})();', start));
}

describe('output override indicator', () => {
  it('reports every override that can silently transform the output', () => {
    const block = overrideBlock();
    for (const key of [
      'blackout',
      'testPattern',
      'domeEnabled',
      'masterWarp',
      'outputRotation',
      'outputCropWidth',
    ]) {
      expect(block, `${key} can change the output but is not reported`).toContain(key);
    }
  });

  it('is rendered in the preview, not just computed', () => {
    // The value existing is no use if nothing draws it.
    expect(panelSource).toContain('output-override-badge');
    expect(panelSource).toContain('activeOutputOverrides.length > 0');
  });

  it('leaves dome enabled across upgrades rather than resetting it', () => {
    // Blackout and test pattern are transient states worth clearing on
    // upgrade. Dome is a venue configuration: silently turning it off would
    // break a real dome install every time they update.
    const migration = settingsSource.slice(
      settingsSource.indexOf('function runVersionMigration'),
    );
    const body = migration.slice(0, migration.indexOf('\n}'));
    expect(body).toContain('parsed.output.blackout = false');
    expect(
      /domeEnabled\s*=\s*false/.test(body),
      'dome must not be force-disabled on upgrade — a dome venue would lose its setup',
    ).toBe(false);
  });

  it('keeps output settings global, which is why the badge is needed', () => {
    // If this ever moves into the project, the badge's premise changes: the
    // setting would travel with the work rather than outlive it.
    const defaults = settingsSource.slice(settingsSource.indexOf('domeEnabled: false'));
    expect(defaults.slice(0, 400)).toContain('domeMode');
    expect(settingsSource).toContain("const STORAGE_KEY = 'ghost-arcade_settings'");
  });
});
