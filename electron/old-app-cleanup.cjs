/**
 * macOS: offer to move the old "Ghost-Arcade.app" to the Trash.
 *
 * Ghost Arcade Studio (the 1.9 line) and Ghost Arcade Pro (the 2.x line) used
 * to share the name Ghost Arcade. A Mac install is a drag into Applications, so
 * the new name lands beside the old app instead of replacing it. Each product
 * offers, once, to remove the old copy of its own line: Studio the 1.x builds,
 * Pro the 2.x builds. It only ever asks; Keep leaves the app where it is and
 * the question is not asked again for that version.
 *
 * Windows and Linux need nothing here: Studio's installer upgrades the old
 * install in place, and Pro's installer removes an old 2.x one.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// The bundle is named after executableName ("Ghost-Arcade"); "Ghost Arcade"
// covers a copy someone renamed in Finder.
const OLD_APP_NAMES = ['Ghost-Arcade.app', 'Ghost Arcade.app'];
const STORE = 'old-app-cleanup.json';

function oldAppCandidates(home = os.homedir()) {
  return OLD_APP_NAMES.flatMap((name) => [
    path.join('/Applications', name),
    path.join(home, 'Applications', name),
  ]);
}

function readBundleVersion(appPath, exec = execFileSync) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(plist)) return null;
  try {
    const out = exec('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const version = String(out).trim();
    return /^\d+\.\d+/.test(version) ? version : null;
  } catch {
    return null;
  }
}

/** Is `version` an old build of this product's line? */
function belongsToLine(version, line) {
  const major = Number.parseInt(String(version).split('.')[0], 10);
  if (!Number.isFinite(major)) return false;
  return line === 'pro' ? major >= 2 : major < 2;
}

function readStore(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data?.answered) ? data : { answered: [] };
  } catch {
    return { answered: [] };
  }
}

/**
 * @param {object} opts
 * @param {'studio'|'pro'} opts.line
 * @param {string} opts.productName   e.g. "Ghost Arcade Pro"
 * @param {string} opts.userDataDir
 * @param {string} opts.ownExePath    this app's executable, never offered
 * @param {(options: object) => Promise<{ response: number }>} opts.ask
 * @param {(appPath: string) => Promise<void>} opts.trash
 * @param {(options: object) => Promise<unknown>} [opts.tell]
 * @param {string} [opts.platform]
 * @param {(appPath: string) => string|null} [opts.readVersion]
 * @param {string[]} [opts.candidates]
 */
async function offerOldAppCleanup({
  line,
  productName,
  userDataDir,
  ownExePath,
  ask,
  trash,
  tell = async () => {},
  platform = process.platform,
  readVersion = readBundleVersion,
  candidates = oldAppCandidates(),
  log = () => {},
}) {
  if (platform !== 'darwin') return { offered: [] };
  const storeFile = path.join(userDataDir, STORE);
  const store = readStore(storeFile);
  const offered = [];

  for (const appPath of candidates) {
    if (ownExePath && path.resolve(ownExePath).startsWith(path.resolve(appPath) + path.sep)) continue;
    const version = readVersion(appPath);
    if (!version || !belongsToLine(version, line)) continue;
    const key = `${appPath}@${version}`;
    if (store.answered.includes(key)) continue;

    const { response } = await ask({
      type: 'question',
      buttons: ['Move to Trash', 'Keep'],
      defaultId: 0,
      cancelId: 1,
      message: `The earlier Ghost Arcade ${version} is still in Applications`,
      detail: `${productName} replaces it, and your settings and projects are already here. `
        + 'Move the old app to the Trash? You can put it back from the Trash at any time.',
    });
    store.answered.push(key);
    offered.push({ appPath, version, trashed: response === 0 });
    if (response === 0) {
      try {
        await trash(appPath);
        log(`[Cleanup] Moved ${appPath} (${version}) to the Trash`);
      } catch (err) {
        log(`[Cleanup] Could not move ${appPath} to the Trash: ${err?.message || err}`);
        await tell({
          type: 'warning',
          buttons: ['OK'],
          message: 'The old Ghost Arcade could not be moved to the Trash',
          detail: `Drag ${appPath} to the Trash in Finder instead.`,
        });
      }
    }
  }

  if (offered.length) {
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(storeFile, JSON.stringify(store, null, 2));
    } catch (err) {
      log(`[Cleanup] Could not save the answer: ${err?.message || err}`);
    }
  }
  return { offered };
}

module.exports = { offerOldAppCleanup, belongsToLine, readBundleVersion, oldAppCandidates };
