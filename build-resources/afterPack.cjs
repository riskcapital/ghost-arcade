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

/**
 * Ship the native render core into resources/native-renderer/.
 *
 * This is done here rather than via `extraResources` because the binary name
 * and its sidecar DLLs are platform-specific, and electron-builder REPLACES
 * (does not merge) the root `extraResources` array when a platform block
 * declares its own — so a per-platform entry would silently drop the shader
 * directories from the build.
 *
 * afterPack runs before signing, so the copied binary gets signed/notarized
 * along with everything else.
 *
 * The broker resolves this exact path (electron/native-renderer-broker.js);
 * without it a packaged app opens straight into NATIVE OFFLINE, because the
 * desktop build is native-only and has no renderer to fall back to.
 */
async function packNativeCore(context) {
  const isWin = context.electronPlatformName === 'win32';
  const isMac = context.electronPlatformName === 'darwin';
  const binName = isWin ? 'ghost-render-core.exe' : 'ghost-render-core';

  const repoRoot = path.resolve(__dirname, '..');
  const releaseDir = path.join(repoRoot, 'native-renderer', 'target', 'release');
  const source = path.join(releaseDir, binName);

  if (!(await pathExists(source))) {
    throw new Error(
      `[afterPack] native render core missing at ${source}. `
      + 'Run `npm run native:build` (or native:build:universal for a mac release) before packaging.',
    );
  }

  let resourcesDir;
  if (isMac) {
    const appPath = await findMacApp(context.appOutDir);
    if (!appPath) throw new Error('[afterPack] could not locate the .app bundle');
    resourcesDir = path.join(appPath, 'Contents', 'Resources');
  } else {
    resourcesDir = path.join(context.appOutDir, 'resources');
  }

  const destDir = path.join(resourcesDir, 'native-renderer');
  await fs.mkdir(destDir, { recursive: true });
  await fs.copyFile(source, path.join(destDir, binName));
  await fs.chmod(path.join(destDir, binName), 0o755);
  console.log(`[afterPack] native core -> ${path.join(destDir, binName)}`);

  // Windows: wgpu uses DynamicDxc and loads these from the core's OWN
  // directory. If absent it does not error — it quietly falls back to FXC and
  // cold boot goes from ~7s to ~50s.
  if (isWin) {
    for (const dll of ['dxcompiler.dll', 'dxil.dll']) {
      const from = path.join(releaseDir, dll);
      if (!(await pathExists(from))) {
        throw new Error(
          `[afterPack] ${dll} missing at ${from}. Run \`node scripts/ensure-dxc.mjs\` `
          + '(npm run native:build does this automatically).',
        );
      }
      await fs.copyFile(from, path.join(destDir, dll));
    }
    console.log('[afterPack] DXC dlls shipped beside the core');
  }
}

exports.default = async function afterPack(context) {
  await packNativeCore(context);

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
