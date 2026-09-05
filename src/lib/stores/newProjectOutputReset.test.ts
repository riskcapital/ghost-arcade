import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A new project must not inherit the last one's screen setup.
 *
 * Output settings live in global localStorage rather than in the project, so
 * everything the previous session configured stays on. That is how a user
 * ended up with dome projection they never chose in the project they were
 * working on. Screens are the sharper case: the project DOES save
 * outputSlices and restore them on load, so a new project — having none —
 * simply kept whatever the last project installed.
 *
 * Source-level because the reset spans the settings store and App's new-project
 * flow, and what matters is that the two stay connected and that the reset
 * keeps drawing its values from the defaults factory.
 */

const settingsSource = readFileSync(
  join(process.cwd(), 'src', 'lib', 'stores', 'settings.ts'),
  'utf8',
);
const appSource = readFileSync(join(process.cwd(), 'src', 'App.svelte'), 'utf8');

function resetBody(): string {
  const start = settingsSource.indexOf('    resetOutputStageForNewProject() {');
  expect(start, 'resetOutputStageForNewProject not found').toBeGreaterThan(-1);
  return settingsSource.slice(start, settingsSource.indexOf('\n    },', start));
}

/** Every key the defaults factory sets under `output`. */
function defaultOutputKeys(): string[] {
  const start = settingsSource.indexOf('function createDefaultSettings');
  const outputStart = settingsSource.indexOf('    output: {', start);
  const outputEnd = settingsSource.indexOf('\n    },', outputStart);
  const block = settingsSource.slice(outputStart, outputEnd);

  const keys: string[] = [];
  let depth = 0;
  for (const line of block.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (depth === 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
      if (match) keys.push(match[1]);
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
  }
  return keys;
}

/**
 * Output settings that describe this machine and its wiring rather than the
 * composition. Anything NOT listed here is expected to be cleared for a new
 * project.
 *
 * The line is "would a working rig break if New Project cleared this?".
 * Clearing displayAssignments would send the output to the wrong monitor;
 * clearing the Spout name would silence whatever downstream app is listening
 * for it; closing the output window mid-show is its own kind of rude. None of
 * those are things the previous project decided — they are how this computer
 * is plugged in.
 */
const MACHINE_PREFERENCES = new Set([
  // Which physical display each screen drives.
  'displayAssignments',
  'outputWindowOpen',
  'customWidth',
  'customHeight',
  // Sender wiring: another app on this machine is listening for this name.
  'spoutEnabled',
  'spoutName',
  'spoutResolution',
  // How the output window draws a cursor. A preference, not project state.
  'outputShowCursor',
  'outputCursorStyle',
  'outputCursorSize',
  'outputCursorThickness',
  'outputCursorColor',
  'outputCursorOpacity',
]);

describe('new project output reset', () => {
  it('clears every output setting that shapes the image', () => {
    const body = resetBody();
    const missing = defaultOutputKeys()
      .filter((key) => !MACHINE_PREFERENCES.has(key))
      .filter((key) => !body.includes(key));

    expect(
      missing,
      'output settings a new project would inherit from the last one:\n  '
      + missing.join('\n  '),
    ).toEqual([]);
  });

  it('takes its values from the defaults factory', () => {
    // Restating the literals here is how the reset drifts from the defaults
    // and starts restoring values that are no longer correct.
    expect(resetBody()).toContain('createDefaultSettings().output');
  });

  it('is actually called when a new project is created', () => {
    const start = appSource.indexOf('function newProjectConfirm()');
    expect(start).toBeGreaterThan(-1);
    const body = appSource.slice(start, appSource.indexOf('\n  }', start));
    expect(body).toContain('resetOutputStageForNewProject');
  });

  it('leaves machine wiring and preferences alone', () => {
    // Clearing any of these breaks a rig that is already working: the output
    // lands on the wrong monitor, a downstream Spout receiver goes quiet, or
    // the output window shuts mid-show.
    const body = resetBody();
    for (const key of MACHINE_PREFERENCES) {
      expect(body, `${key} is machine wiring, not project state`).not.toContain(key);
    }
  });
});
