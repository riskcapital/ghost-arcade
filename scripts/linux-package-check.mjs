#!/usr/bin/env node
// Checks the Linux packages electron-builder produced (used by
// .github/workflows/linux-verify.yml and the release job):
//
//   node scripts/linux-package-check.mjs <dist-electron> <report-dir>
//
// - an AppImage and a .deb exist, and the render core is inside the .deb,
//   executable, with every linked library resolvable;
// - the .deb's declared dependencies bring in what the core loads at runtime
//   without linking it (so `ldd` cannot see it): the Vulkan loader, ALSA, and
//   the X11 libraries winit opens with dlopen. A missing one is a core that
//   starts on the build machine and not on a clean install.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [distDir = 'dist-electron', reportDir = 'linux-package-out'] = process.argv.slice(2);
fs.mkdirSync(reportDir, { recursive: true });
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const tryRun = (command, args) => { try { return run(command, args); } catch (error) { return `${error.stdout || ''}${error.stderr || ''}`; } };

const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok: !!ok, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
};

// Libraries the core opens at runtime. winit's X11 backend loads the X11 set
// (native-renderer/src/main.rs, linux_x11_unavailable_reason); wgpu loads the
// Vulkan loader; cpal's ALSA backend links libasound.
const RUNTIME_LIBRARIES = [
  'libvulkan.so.1', 'libasound.so.2',
  'libX11.so.6', 'libX11-xcb.so.1', 'libxcb.so.1', 'libXcursor.so.1', 'libXrandr.so.2', 'libXi.so.6', 'libxkbcommon-x11.so.0',
];

const files = fs.existsSync(distDir) ? fs.readdirSync(distDir) : [];
const appImage = files.find((name) => name.endsWith('.AppImage'));
const deb = files.find((name) => name.endsWith('.deb'));
const megabytes = (name) => Math.round(fs.statSync(path.join(distDir, name)).size / 1048576);
check('AppImage was built', !!appImage, appImage ? `${appImage} (${megabytes(appImage)} MB)` : `files: ${files.join(', ')}`);
check('.deb was built', !!deb, deb ? `${deb} (${megabytes(deb)} MB)` : '');

const report = { appImage, deb, depends: [], recommends: [], libraries: [] };
if (deb) {
  const debPath = path.join(distDir, deb);
  const field = (name) => tryRun('dpkg-deb', ['-f', debPath, name]).trim();
  const depends = field('Depends').split(',').map((entry) => entry.trim()).filter(Boolean);
  const recommends = field('Recommends').split(',').map((entry) => entry.trim()).filter(Boolean);
  report.depends = depends;
  report.recommends = recommends;
  console.log(`Depends: ${depends.join(', ')}`);
  console.log(`Recommends: ${recommends.join(', ') || '(none)'}`);
  const names = (list) => list.flatMap((entry) => entry.split('|').map((alt) => alt.trim().replace(/\s*\(.*\)$/, '')));
  const declared = names(depends);
  check('.deb depends on the Vulkan loader', declared.includes('libvulkan1'), 'libvulkan1');
  check('.deb depends on libxkbcommon-x11-0', declared.includes('libxkbcommon-x11-0'));
  check('.deb depends on ALSA (libasound2 or libasound2t64)', declared.includes('libasound2') || declared.includes('libasound2t64'));

  // The core inside the package.
  const listing = tryRun('dpkg-deb', ['-c', debPath]);
  const coreLine = listing.split('\n').find((line) => /resources\/native-renderer\/ghost-render-core$/.test(line));
  check('render core is inside the .deb', !!coreLine, coreLine || 'resources/native-renderer/ghost-render-core not listed');
  check('render core is executable in the .deb', !!coreLine && /^-rwx/.test(coreLine), coreLine?.slice(0, 10) || '');
  const extracted = fs.mkdtempSync(path.join(os.tmpdir(), 'ga-deb-'));
  tryRun('dpkg-deb', ['-x', debPath, extracted]);
  const corePath = coreLine ? path.join(extracted, coreLine.trim().split(/\s+/).slice(5).join(' ').replace(/^\.\//, '')) : '';
  if (corePath && fs.existsSync(corePath)) {
    const ldd = tryRun('ldd', [corePath]);
    fs.writeFileSync(path.join(reportDir, 'core-ldd.txt'), ldd);
    const missing = ldd.split('\n').filter((line) => line.includes('not found'));
    check('every library the core links is installed here', missing.length === 0, missing.join('; '));
  }

  // A builder may have unrelated software with its own copies of these
  // libraries. Inspect the system loader, not the first dpkg substring hit.
  // Dependency completeness is tested by linux-clean-install.sh in a fresh
  // Ubuntu container; availability on this build host alone cannot prove it.
  const loader = tryRun('ldconfig', ['-p']);
  for (const library of RUNTIME_LIBRARIES) {
    const entry = loader.split('\n').find(line => line.trim().startsWith(`${library} `));
    report.libraries.push({ library, availableOnBuildHost: !!entry });
    check(`build host loader can find ${library}`, !!entry, entry?.trim() || 'not found');
  }
  fs.rmSync(extracted, { recursive: true, force: true });
}

const lines = ['| Check | Result | Detail |', '| --- | --- | --- |',
  ...checks.map((entry) => `| ${entry.label} | ${entry.ok ? 'PASS' : 'FAIL'} | ${entry.detail.replace(/\|/g, '/')} |`)];
fs.writeFileSync(path.join(reportDir, 'packages.md'), `${lines.join('\n')}\n`);
fs.writeFileSync(path.join(reportDir, 'packages.json'), JSON.stringify({ ...report, checks }, null, 2));
const failed = checks.filter((entry) => !entry.ok);
console.log(`${checks.length - failed.length}/${checks.length} package checks passed`);
process.exit(failed.length ? 1 : 0);
