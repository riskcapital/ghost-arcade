/**
 * First launch of Ghost Arcade Pro: bring the settings over from "ghost-arcade".
 *
 * Up to 2.1.3 this line kept its data in a folder named after the code package,
 * "ghost-arcade", the same folder the 1.9 line (now Ghost Arcade Studio) uses.
 * Pro has its own folder so the two apps can run side by side. On the first
 * launch, while Pro's folder is still empty, copy the old folder's settings,
 * Local Storage (preferences and the project autosave), shaders and file
 * permissions across.
 *
 * Left behind on purpose:
 * - project-assets: imported and generated media can be gigabytes, and
 *   projects refer to those files by their full path. main.js lets Pro read
 *   the old folder's project-assets in place instead.
 * - remote-pairing.json: Pro gets its own pairing code, so a phone paired with
 *   Studio cannot drive Pro without being paired to it.
 * - caches, logs, crash reports, downloaded installers and lock files.
 *
 * Runs before anything opens the profile, and only once: a marker file records
 * that it ran, whether or not there was anything to copy.
 */
const fs = require('fs');
const path = require('path');

const MARKER = '.ga-profile-migrated.json';

const SKIP = new Set([
  'project-assets',
  'remote-pairing.json',
  'updates',
  'logs',
  'Crashpad',
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'GraphiteDawnCache',
  'ShaderCache',
  'blob_storage',
  'Service Worker',
  'Shared Dictionary',
  'SingletonLock',
  'SingletonSocket',
  'SingletonCookie',
  'lockfile',
  'RunningChromeVersion',
  'DevToolsActivePort',
  MARKER,
]);

function shouldSkip(name) {
  return SKIP.has(name) || name.endsWith('.log') || name.startsWith('.');
}

/**
 * @param {{ from: string, to: string, log?: (msg: string) => void }} opts
 * @returns {{ migrated: boolean, reason?: string, copied?: string[], failed?: string[] }}
 */
function migrateProfile({ from, to, log = () => {} }) {
  const marker = path.join(to, MARKER);
  if (path.resolve(from) === path.resolve(to)) return { migrated: false, reason: 'same-folder' };
  if (fs.existsSync(marker)) return { migrated: false, reason: 'already-done' };

  const writeMarker = (result) => {
    try {
      fs.mkdirSync(to, { recursive: true });
      fs.writeFileSync(marker, JSON.stringify({ from, at: new Date().toISOString(), ...result }, null, 2));
    } catch (err) {
      log(`[Profile] Could not write the migration marker: ${err?.message || err}`);
    }
    return result;
  };

  // A Pro folder that already holds a profile was in use before this code
  // existed (a development run, say). Never overwrite it.
  if (fs.existsSync(path.join(to, 'Local Storage'))) {
    return writeMarker({ migrated: false, reason: 'target-in-use' });
  }
  if (!fs.existsSync(from)) return writeMarker({ migrated: false, reason: 'no-source' });

  const copied = [];
  const failed = [];
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (shouldSkip(name)) continue;
    const src = path.join(from, name);
    const dest = path.join(to, name);
    try {
      if (fs.existsSync(dest)) continue;
      fs.cpSync(src, dest, { recursive: true, errorOnExist: false, force: false, verbatimSymlinks: true });
      copied.push(name);
    } catch (err) {
      failed.push(name);
      log(`[Profile] Could not copy ${name}: ${err?.message || err}`);
    }
  }
  log(`[Profile] Copied settings from ${from}: ${copied.join(', ') || 'nothing'}`);
  return writeMarker({ migrated: true, copied, failed });
}

module.exports = { migrateProfile, MARKER };
