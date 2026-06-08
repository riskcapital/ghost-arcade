const fs = require('fs/promises');
const path = require('path');

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function replaceWithSymlink(linkPath, target) {
  await fs.rm(linkPath, { recursive: true, force: true });
  await fs.symlink(target, linkPath);
}

async function findMacApp(appOutDir) {
  const entries = await fs.readdir(appOutDir, { withFileTypes: true });
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith('.app'));
  return appEntry ? path.join(appOutDir, appEntry.name) : null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appPath = await findMacApp(context.appOutDir);
  if (!appPath) return;

  const frameworkPath = path.join(appPath, 'Contents', 'Frameworks', 'Syphon.framework');
  if (!(await pathExists(frameworkPath))) return;

  const versionAPath = path.join(frameworkPath, 'Versions', 'A');
  const binaryPath = path.join(versionAPath, 'Syphon');
  const infoPlistPath = path.join(versionAPath, 'Resources', 'Info.plist');

  if (!(await pathExists(binaryPath))) {
    throw new Error(`Syphon.framework is missing its executable at ${binaryPath}`);
  }
  if (!(await pathExists(infoPlistPath))) {
    throw new Error(`Syphon.framework is missing Info.plist at ${infoPlistPath}`);
  }

  await replaceWithSymlink(path.join(frameworkPath, 'Versions', 'Current'), 'A');
  await replaceWithSymlink(path.join(frameworkPath, 'Headers'), 'Versions/Current/Headers');
  await replaceWithSymlink(path.join(frameworkPath, 'Resources'), 'Versions/Current/Resources');
  await replaceWithSymlink(path.join(frameworkPath, 'Syphon'), 'Versions/Current/Syphon');

  console.log(`[afterPack] Repaired Syphon.framework symlinks at ${frameworkPath}`);
};
