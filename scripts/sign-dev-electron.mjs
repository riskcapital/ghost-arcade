#!/usr/bin/env node
/**
 * Re-sign the development Electron binary with this project's entitlements.
 *
 * macOS only, dev only — the packaged app is signed by electron-builder using
 * the same plist (see `mac.entitlements` in electron-builder.yml) and is
 * unaffected by this script.
 *
 * Why this is needed
 * ------------------
 * The prebuilt Electron in node_modules ships ad-hoc / linker-signed with NO
 * entitlements. Camera and microphone capture now runs in the MAIN process via
 * AVFoundation (live_capture_addon), not through Chromium's getUserMedia, and
 * macOS refuses camera access to a binary that lacks
 * `com.apple.security.device.camera`.
 *
 * The failure is silent and easy to misread: TCC does not prompt and does not
 * record a denial — `systemPreferences.getMediaAccessStatus('camera')` stays
 * "not-determined" forever while `askForMediaAccess('camera')` returns false
 * immediately, and the capture addon reports "Camera permission is denied"
 * even though `startCamera()` returned true. Webcam, screen capture and
 * MediaPipe hand tracking all appear broken with no error anywhere.
 *
 * Signing ad-hoc but WITH the entitlements is enough to make TCC prompt.
 * Runs after every `npm install`, because installing Electron restores the
 * unsigned binary.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const entitlements = path.join(root, 'build-resources', 'entitlements.mac.plist');

if (process.platform !== 'darwin') process.exit(0);

// A fresh clone that has not installed Electron yet is not an error.
if (!existsSync(appPath) || !existsSync(entitlements)) process.exit(0);

try {
  const current = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (current.includes('com.apple.security.device.camera')) {
    process.exit(0); // already signed with what we need
  }
} catch {
  // No readable signature yet — fall through and sign.
}

try {
  execFileSync(
    'codesign',
    [
      '--force',
      '--sign',
      '-',
      '--entitlements',
      entitlements,
      // Keep Electron's own identifier and hardened-runtime flags; replacing
      // them produces a binary macOS will refuse to launch.
      '--preserve-metadata=identifier,flags,runtime',
      appPath,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  console.log('[dev-electron] signed with camera/microphone entitlements');
  console.log('[dev-electron] macOS will prompt for camera access on first capture — click OK.');
} catch (err) {
  // Never fail the install over this; the app still runs, only capture breaks.
  const detail = err?.stderr?.toString().trim() || err?.message || String(err);
  console.warn(`[dev-electron] could not sign Electron.app: ${detail}`);
  console.warn('[dev-electron] webcam, screen capture and MediaPipe will not work in dev until this succeeds.');
}
