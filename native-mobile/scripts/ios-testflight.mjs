#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(mobileDir, '..');
const iosDir = path.join(mobileDir, 'ios');
const appDir = path.join(iosDir, 'App');
const workspace = path.join(appDir, 'App.xcworkspace');
const exportOptionsPath = path.join(iosDir, 'build', 'ExportOptions.testflight.plist');

const rootPackage = readJson(path.join(repoRoot, 'package.json'));
const capacitorConfigText = fs.readFileSync(path.join(mobileDir, 'capacitor.config.ts'), 'utf8');
const bundleId = env('MOBILE_IOS_BUNDLE_ID') || readCapacitorString('appId') || 'com.ghostarcade.mobile';
const marketingVersion = env('MOBILE_MARKETING_VERSION') || rootPackage.version || '1.0.0';
const buildNumber = env('MOBILE_BUILD_NUMBER') || timestampBuildNumber();
const teamId = env('APPLE_TEAM_ID') || env('DEVELOPMENT_TEAM') || '';
const archivePath = path.resolve(env('MOBILE_ARCHIVE_PATH') || path.join(iosDir, 'build', 'archives', `GhostArcade-${marketingVersion}-${buildNumber}.xcarchive`));
const exportPath = path.resolve(env('MOBILE_EXPORT_PATH') || path.join(iosDir, 'build', 'testflight', `${marketingVersion}-${buildNumber}`));
const mode = process.argv[2] || 'all';

const context = {
  bundleId,
  marketingVersion,
  buildNumber,
  teamId,
  archivePath,
  exportPath,
};

main().catch((error) => {
  console.error(`\n[TestFlight] ${error.message}`);
  process.exit(error.exitCode || 1);
});

async function main() {
  switch (mode) {
    case 'doctor':
      doctor();
      return;
    case 'archive':
      await archive();
      return;
    case 'export':
      await exportIpa();
      return;
    case 'validate':
      await validate();
      return;
    case 'upload':
      await upload();
      return;
    case 'all':
      await archive();
      await exportIpa();
      await validate();
      await upload();
      return;
    default:
      usage();
      throw new Error(`Unknown command "${mode}".`);
  }
}

async function archive() {
  printContext();
  if (!envFlag('MOBILE_SKIP_NATIVE_SYNC')) {
    run('npm', ['run', 'build'], { cwd: mobileDir });
    run('npx', ['cap', 'sync', 'ios'], { cwd: mobileDir });
  }

  const buildSettings = [
    'CODE_SIGN_STYLE=Automatic',
    `MARKETING_VERSION=${marketingVersion}`,
    `CURRENT_PROJECT_VERSION=${buildNumber}`,
  ];
  if (teamId) buildSettings.push(`DEVELOPMENT_TEAM=${teamId}`);

  const args = [
    '-workspace', workspace,
    '-scheme', 'App',
    '-configuration', 'Release',
    '-destination', 'generic/platform=iOS',
    '-archivePath', archivePath,
    '-allowProvisioningUpdates',
    ...xcodeAuthArgs(),
    ...buildSettings,
    'archive',
  ];

  run('xcodebuild', args, { cwd: repoRoot });
}

async function exportIpa() {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`Archive not found: ${archivePath}. Run npm run ios:archive first, or set MOBILE_ARCHIVE_PATH.`);
  }

  fs.mkdirSync(exportPath, { recursive: true });
  writeExportOptions();

  const args = [
    '-exportArchive',
    '-archivePath', archivePath,
    '-exportPath', exportPath,
    '-exportOptionsPlist', exportOptionsPath,
    '-allowProvisioningUpdates',
    ...xcodeAuthArgs(),
  ];

  run('xcodebuild', args, { cwd: repoRoot });
  const ipa = findIpa(exportPath);
  if (!ipa) throw new Error(`Export finished but no .ipa was found in ${exportPath}.`);
  console.log(`\n[TestFlight] IPA ready: ${ipa}`);
}

async function validate() {
  const ipa = resolveIpaPath();
  runAltool('--validate-app', ipa);
}

async function upload() {
  const ipa = resolveIpaPath();
  runAltool('--upload-app', ipa, ['--wait']);
}

function runAltool(action, ipa, extraArgs = []) {
  const { keyId, issuerId, env: uploadEnv, cleanup } = appStoreConnectEnv();
  try {
    run('xcrun', [
      'altool',
      action,
      '-f', ipa,
      '--platform', 'ios',
      '--apiKey', keyId,
      '--apiIssuer', issuerId,
      '--output-format', 'normal',
      ...extraArgs,
    ], { cwd: repoRoot, env: uploadEnv });
  } finally {
    cleanup();
  }
}

function doctor() {
  printContext();
  run('xcodebuild', ['-version'], { cwd: repoRoot, allowFailure: true });
  run('xcodebuild', ['-list', '-workspace', workspace], { cwd: repoRoot, allowFailure: true });
  run('security', ['find-identity', '-v', '-p', 'codesigning'], { cwd: repoRoot, allowFailure: true });

  const hasApiKey = Boolean(env('APP_STORE_CONNECT_KEY_ID') && env('APP_STORE_CONNECT_ISSUER_ID'));
  const keyLocation = env('APP_STORE_CONNECT_API_KEY_PATH') || env('API_PRIVATE_KEYS_DIR') || '';
  console.log('\n[TestFlight] Readiness');
  console.log(`  Apple team id: ${teamId || '(not set; set APPLE_TEAM_ID)'}`);
  console.log(`  App Store Connect API: ${hasApiKey ? 'configured' : 'missing APP_STORE_CONNECT_KEY_ID / APP_STORE_CONNECT_ISSUER_ID'}`);
  console.log(`  API private key: ${keyLocation || '(not set; use APP_STORE_CONNECT_API_KEY_PATH or API_PRIVATE_KEYS_DIR)'}`);
  console.log(`  Signing identities: ${codeSigningIdentityCount()} valid`);
}

function printContext() {
  console.log('[TestFlight] Ghost Arcade iOS');
  console.log(`  Bundle:  ${context.bundleId}`);
  console.log(`  Version: ${context.marketingVersion} (${context.buildNumber})`);
  console.log(`  Team:    ${context.teamId || '(Xcode automatic)'}`);
  console.log(`  Archive: ${context.archivePath}`);
  console.log(`  Export:  ${context.exportPath}`);
}

function writeExportOptions() {
  fs.mkdirSync(path.dirname(exportOptionsPath), { recursive: true });
  const teamEntry = teamId ? `\n\t<key>teamID</key>\n\t<string>${escapeXml(teamId)}</string>` : '';
  const internalOnlyEntry = envFlag('MOBILE_TESTFLIGHT_INTERNAL_ONLY')
    ? '\n\t<key>testFlightInternalTestingOnly</key>\n\t<true/>'
    : '';
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>destination</key>
\t<string>export</string>
\t<key>manageAppVersionAndBuildNumber</key>
\t<false/>
\t<key>method</key>
\t<string>app-store-connect</string>
\t<key>signingStyle</key>
\t<string>automatic</string>
\t<key>stripSwiftSymbols</key>
\t<true/>
\t<key>uploadSymbols</key>
\t<true/>${teamEntry}${internalOnlyEntry}
</dict>
</plist>
`;
  fs.writeFileSync(exportOptionsPath, plist);
}

function xcodeAuthArgs() {
  const keyPath = env('APP_STORE_CONNECT_API_KEY_PATH');
  const keyId = env('APP_STORE_CONNECT_KEY_ID');
  const issuerId = env('APP_STORE_CONNECT_ISSUER_ID');
  if (!keyPath || !keyId || !issuerId) return [];
  return [
    '-authenticationKeyPath', path.resolve(keyPath),
    '-authenticationKeyID', keyId,
    '-authenticationKeyIssuerID', issuerId,
  ];
}

function appStoreConnectEnv() {
  const keyId = env('APP_STORE_CONNECT_KEY_ID');
  const issuerId = env('APP_STORE_CONNECT_ISSUER_ID');
  if (!keyId || !issuerId) {
    throw new Error('Set APP_STORE_CONNECT_KEY_ID and APP_STORE_CONNECT_ISSUER_ID before validating or uploading.');
  }

  const uploadEnv = { ...process.env };
  let tempDir = '';
  const explicitKeyPath = env('APP_STORE_CONNECT_API_KEY_PATH');
  if (explicitKeyPath) {
    const keyPath = path.resolve(explicitKeyPath);
    if (!fs.existsSync(keyPath)) throw new Error(`App Store Connect key not found: ${keyPath}`);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghost-asc-keys-'));
    const expectedName = `AuthKey_${keyId}.p8`;
    fs.symlinkSync(keyPath, path.join(tempDir, expectedName));
    uploadEnv.API_PRIVATE_KEYS_DIR = tempDir;
  } else if (!env('API_PRIVATE_KEYS_DIR')) {
    console.warn('[TestFlight] No APP_STORE_CONNECT_API_KEY_PATH or API_PRIVATE_KEYS_DIR set. altool will search its default private_keys folders.');
  }

  return {
    keyId,
    issuerId,
    env: uploadEnv,
    cleanup: () => {
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function resolveIpaPath() {
  const explicit = env('MOBILE_IPA_PATH');
  if (explicit) {
    const ipa = path.resolve(explicit);
    if (!fs.existsSync(ipa)) throw new Error(`MOBILE_IPA_PATH does not exist: ${ipa}`);
    return ipa;
  }
  const ipa = findIpa(exportPath);
  if (!ipa) throw new Error(`No .ipa found in ${exportPath}. Run npm run ios:export first, or set MOBILE_IPA_PATH.`);
  return ipa;
}

function findIpa(searchDir) {
  if (!fs.existsSync(searchDir)) return '';
  const stack = [searchDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (entry.isFile() && entry.name.endsWith('.ipa')) return fullPath;
    }
  }
  return '';
}

function run(command, args, options = {}) {
  const pretty = [command, ...args].map((part) => part.includes(' ') ? JSON.stringify(part) : part).join(' ');
  console.log(`\n$ ${pretty}`);
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const error = new Error(`${command} exited with ${result.status}`);
    error.exitCode = result.status || 1;
    throw error;
  }
  return result;
}

function codeSigningIdentityCount() {
  const result = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const match = result.stdout?.match(/(\d+)\s+valid identities found/);
  return match ? Number(match[1]) : 0;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readCapacitorString(key) {
  const match = capacitorConfigText.match(new RegExp(`${key}:\\s*['"]([^'"]+)['"]`));
  return match?.[1] || '';
}

function timestampBuildNumber() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
  ].join('');
}

function env(name) {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function envFlag(name) {
  const value = env(name).toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function usage() {
  console.log(`Usage:
  node scripts/ios-testflight.mjs doctor
  node scripts/ios-testflight.mjs archive
  node scripts/ios-testflight.mjs export
  node scripts/ios-testflight.mjs validate
  node scripts/ios-testflight.mjs upload
  node scripts/ios-testflight.mjs all

Common environment:
  APPLE_TEAM_ID=TEAM123456
  APP_STORE_CONNECT_KEY_ID=ABC123DEFG
  APP_STORE_CONNECT_ISSUER_ID=00000000-0000-0000-0000-000000000000
  APP_STORE_CONNECT_API_KEY_PATH=/secure/path/AuthKey_ABC123DEFG.p8
  MOBILE_BUILD_NUMBER=202606220101
`);
}
