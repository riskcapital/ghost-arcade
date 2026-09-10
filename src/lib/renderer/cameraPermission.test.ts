import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A blocked camera has to say so.
 *
 * Reported as cameras connecting but not being recognised in VJ mode.
 * Enumeration is not gated by the OS privacy setting on either platform, so
 * a camera lists fine and then fails to start, which reads as "it sees my
 * camera but nothing happens".
 *
 * macOS has asked through Electron and named the setting for a while.
 * Windows had no handling at all, so the same situation surfaced as
 * "camera did not start" with nothing to act on.
 */

const mainSource = readFileSync(join(process.cwd(), 'electron', 'main.js'), 'utf8');

function startCameraHandler(): string {
  const start = mainSource.indexOf("ipcMain.handle('native_live_capture_start_camera'");
  expect(start, 'start_camera handler not found').toBeGreaterThan(-1);
  return mainSource.slice(start, mainSource.indexOf("ipcMain.handle('native_live_capture_start_screen'", start));
}

describe('camera permission reporting', () => {
  it('checks the OS permission on both desktop platforms', () => {
    const handler = startCameraHandler();
    expect(handler).toContain("process.platform === 'darwin'");
    expect(handler).toContain("process.platform === 'win32'");
  });

  it('names the setting to change rather than saying it failed', () => {
    // "camera did not start" is the message this replaced, and it left the
    // user with nowhere to go.
    const handler = startCameraHandler();
    expect(handler).toMatch(/System Settings.*Camera/);
    expect(handler).toMatch(/Settings.*Privacy.*Camera/);
    expect(handler).toContain('desktop apps');
  });

  it('only refuses on an explicit denial', () => {
    // getMediaAccessStatus reports 'granted' for every media type on older
    // Windows, and can report not-determined/unknown where capture works.
    // Blocking on those would break working machines for a nicer message.
    const handler = startCameraHandler();
    const windows = handler.slice(handler.indexOf("process.platform === 'win32'"));
    expect(windows).toMatch(/status === 'denied' \|\| status === 'restricted'/);
    expect(
      /status !== 'granted'/.test(windows),
      'the Windows branch must not treat anything other than an explicit refusal as fatal',
    ).toBe(false);
  });

  it('does not try to prompt on Windows', () => {
    // askForMediaAccess is macOS-only; calling it on Windows would throw
    // where the point is to explain, not to fail differently.
    const handler = startCameraHandler();
    const windows = handler.slice(handler.indexOf("process.platform === 'win32'"));
    // Comments in that branch explain why it is not called, so check the code.
    const code = windows.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    expect(code).not.toContain('askForMediaAccess');
  });
});
