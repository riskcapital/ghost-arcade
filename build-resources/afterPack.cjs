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
 * Guarantee the native render core is in resources/native-renderer/.
 *
 * The copy itself is now done by the single `extraResources` entry in
 * electron-builder.yml. This function is the backstop: it verifies the
 * artefacts arrived and fills them in if they did not.
 *
 * It does NOT overwrite a file that is already in place. The build order is
 * extraResources -> sign -> afterPack, so on Windows the core has ALREADY
 * been signed by Azure Trusted Signing by the time this runs; re-copying the
 * unsigned binary over it would ship an unsigned nested executable and trip
 * SmartScreen at launch. (The previous comment here claimed afterPack runs
 * before signing. The v1.9.9999 Windows log disproves that: `signing with
 * Azure Trusted Signing path=...\native-renderer\ghost-render-core.exe`
 * is emitted before this function's own log line.)
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
  const destBin = path.join(destDir, binName);
  // Presence, not content: signing rewrites the file (a signature is appended,
  // so the signed binary is a different size from the source). Any size or
  // hash comparison would therefore report "changed" and clobber the very
  // signature we are trying to keep.
  if (await pathExists(destBin)) {
    console.log(`[afterPack] native core already in place (signature preserved) -> ${destBin}`);
  } else {
    await fs.copyFile(source, destBin);
    await fs.chmod(destBin, 0o755);
    console.log(`[afterPack] native core -> ${destBin}`);
  }

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
      const destDll = path.join(destDir, dll);
      if (!(await pathExists(destDll))) await fs.copyFile(from, destDll);
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
