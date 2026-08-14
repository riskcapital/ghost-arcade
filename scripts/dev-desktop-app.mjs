#!/usr/bin/env node
/**
 * Launch the dev Electron through LaunchServices instead of as a child of
 * npm, so macOS treats it as its own TCC "responsible process".
 *
 * Why this exists
 * ---------------
 * `npm run desktop` spawns Electron as a grandchild of the shell, and macOS
 * attributes camera / screen-recording requests to whatever *launched* the
 * process — the terminal — not to Electron. A terminal without camera
 * permission cannot show a prompt, so the request is denied instantly, no
 * dialog appears, and no decision is recorded (System Settings stays empty).
 * Capture that runs in the main process via AVFoundation therefore fails
 * silently in dev, while the packaged app — launched from Finder, and so its
 * own responsible process — works fine.
 *
 * Launching with `open` gives Electron its own identity, so the prompt
 * appears and the grant sticks. Use this when testing webcam, screen capture
 * or MediaPipe on macOS.
 *
 * Tradeoff: the app's stdout no longer streams to this terminal, so it is
 * redirected to scratchpad/desktop-app.log instead.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');

if (process.platform !== 'darwin') {
  console.error('[dev-desktop-app] macOS only — use `npm run desktop` elsewhere.');
  process.exit(1);
}
if (!existsSync(appPath)) {
  console.error(`[dev-desktop-app] Electron not found at ${appPath} — run npm install.`);
  process.exit(1);
}

mkdirSync(path.join(root, 'scratchpad'), { recursive: true });
const logPath = path.join(root, 'scratchpad', 'desktop-app.log');

// -n: always a new instance, so this never re-focuses a stale copy.
// --stdout/--stderr keep the app's console reachable for debugging.
execFileSync('open', ['-n', '-a', appPath, '--stdout', logPath, '--stderr', logPath, '--args', root], {
  stdio: 'inherit',
});
console.log('[dev-desktop-app] launched via LaunchServices (own TCC identity)');
console.log(`[dev-desktop-app] logs: ${path.relative(root, logPath)}`);
console.log('[dev-desktop-app] make sure `npm run dev` is already serving the renderer.');
