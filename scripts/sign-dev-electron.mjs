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
 * Signing ad-hoc but WITH the entitlements is enough to make TCC prompt --
 * PROVIDED the whole bundle still validates. Signing only the outer .app leaves
 * the nested helper apps sealed against their old contents, and
 * `codesign --verify --deep` then fails with "code has no resources but
 * signature indicates they must be present". TCC will not prompt for a bundle
 * whose signature does not validate: the status stays "not-determined" and the
 * request is refused instantly, which looks exactly like a missing entitlement.
 * So nested code is signed first, inner to outer, the way codesign requires.
 *
 * Runs after every `npm install`, because installing Electron restores the
 * unsigned binary.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const entitlements = path.join(root, 'build-resources', 'entitlements.mac.plist');

if (process.platform !== 'darwin') process.exit(0);

// A fresh clone that has not installed Electron yet is not an error.
if (!existsSync(appPath) || !existsSync(entitlements)) process.exit(0);

function bundleVerifies() {
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/* The entitlement alone is not enough to skip: a bundle can carry it and still
   fail to validate, and that combination is the sticky failure this script
   exists to clear -- every later run would no-op over a broken signature. */
try {
  const current = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (current.includes('com.apple.security.device.camera') && bundleVerifies()) {
    process.exit(0); // already signed with what we need, and it validates
  }
} catch {
  // No readable signature yet — fall through and sign.
}

/** Nested code, innermost first. codesign seals outward: signing the outer app
 *  over a stale inner signature produces a bundle that will not verify. */
function nestedCodePaths() {
  const frameworks = path.join(appPath, 'Contents', 'Frameworks');
  if (!existsSync(frameworks)) return [];
  const entries = readdirSync(frameworks);
  const helpers = entries.filter((name) => name.endsWith('.app'));
  const libs = entries.filter((name) => name.endsWith('.framework') || name.endsWith('.dylib'));
  // Helpers before frameworks: a helper links the frameworks beside it, so the
  // framework seal has to be the newer one.
  return [...helpers, ...libs].map((name) => path.join(frameworks, name));
}

for (const nested of nestedCodePaths()) {
  try {
    execFileSync(
      'codesign',
      [
        '--force',
        '--sign',
        '-',
        // Helpers keep whatever entitlements they shipped with; only the main
        // process asks for the camera.
        '--preserve-metadata=identifier,flags,runtime,entitlements',
        nested,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
  } catch (err) {
    const detail = err?.stderr?.toString().trim() || err?.message || String(err);
    console.warn(`[dev-electron] could not sign ${path.basename(nested)}: ${detail}`);
  }
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
  if (bundleVerifies()) {
    console.log('[dev-electron] signed with camera/microphone entitlements');
    console.log('[dev-electron] macOS will prompt for camera access on first capture — click OK.');
  } else {
    // Say so rather than reporting success: a bundle that does not verify will
    // never prompt, and the capture failure that follows looks unrelated.
    console.warn('[dev-electron] signed, but the bundle still does not verify — camera capture will not prompt.');
    console.warn('[dev-electron] try: rm -rf node_modules/electron && npm install');
  }
} catch (err) {
  // Never fail the install over this; the app still runs, only capture breaks.
  const detail = err?.stderr?.toString().trim() || err?.message || String(err);
  console.warn(`[dev-electron] could not sign Electron.app: ${detail}`);
  console.warn('[dev-electron] webcam, screen capture and MediaPipe will not work in dev until this succeeds.');
}
