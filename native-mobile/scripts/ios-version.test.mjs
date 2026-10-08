// Run: node --test native-mobile/scripts/ios-version.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readProjectVersions, resolveVersions } from './ios-version.mjs';

const project = (marketing, build) => `
  Debug = { buildSettings = { CURRENT_PROJECT_VERSION = ${build[0]}; MARKETING_VERSION = ${marketing[0]}; }; };
  Release = { buildSettings = { CURRENT_PROJECT_VERSION = ${build[1] ?? build[0]}; MARKETING_VERSION = ${marketing[1] ?? marketing[0]}; }; };
`;

test('reads the version and build number from the project', () => {
  assert.deepEqual(readProjectVersions(project(['1.1'], ['5'])), { marketingVersion: '1.1', buildNumber: '5' });
  assert.deepEqual(readProjectVersions(project(['"1.2.3"'], ['"12"'])), { marketingVersion: '1.2.3', buildNumber: '12' });
});

test('never falls back to another version when the project has none', () => {
  assert.throws(() => readProjectVersions('buildSettings = { CURRENT_PROJECT_VERSION = 5; };'), /MARKETING_VERSION is not set/);
  assert.throws(() => readProjectVersions('buildSettings = { MARKETING_VERSION = 1.1; };'), /CURRENT_PROJECT_VERSION is not set/);
  assert.throws(() => resolveVersions('', {}), /is not set/);
});

test('refuses configurations that disagree', () => {
  assert.throws(() => readProjectVersions(project(['1.0', '1.1'], ['5'])), /MARKETING_VERSION differs.*1\.0, 1\.1/);
  assert.throws(() => readProjectVersions(project(['1.1'], ['4', '5'])), /CURRENT_PROJECT_VERSION differs/);
});

test('refuses values that are not plain version numbers', () => {
  assert.throws(() => readProjectVersions(project(['$(APP_VERSION)'], ['5'])), /must be a plain number/);
  assert.throws(() => readProjectVersions(project(['1.1'], ['5b'])), /must be a plain number/);
});

test('environment overrides one run and is checked too', () => {
  const text = project(['1.1'], ['5']);
  assert.deepEqual(resolveVersions(text, {}), {
    marketingVersion: '1.1', buildNumber: '5', marketingSource: 'Xcode project', buildSource: 'Xcode project',
  });
  const overridden = resolveVersions(text, { MOBILE_MARKETING_VERSION: ' 1.2 ', MOBILE_BUILD_NUMBER: '9' });
  assert.equal(overridden.marketingVersion, '1.2');
  assert.equal(overridden.buildNumber, '9');
  assert.equal(overridden.marketingSource, 'MOBILE_MARKETING_VERSION');
  assert.throws(() => resolveVersions(text, { MOBILE_MARKETING_VERSION: 'latest' }), /MOBILE_MARKETING_VERSION/);
  assert.throws(() => resolveVersions(text, { MOBILE_BUILD_NUMBER: 'abc' }), /MOBILE_BUILD_NUMBER/);
});

test('the real project resolves, and not to the desktop package version', () => {
  const pbxproj = fs.readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const desktop = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  const { marketingVersion, buildNumber } = resolveVersions(pbxproj, {});
  assert.match(marketingVersion, /^\d+\.\d+(\.\d+)?$/);
  assert.match(buildNumber, /^\d+$/);
  assert.notEqual(marketingVersion, desktop);
});

test('the TestFlight script reports the project version without building anything', () => {
  const script = fileURLToPath(new URL('./ios-testflight.mjs', import.meta.url));
  const pbxproj = fs.readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const expected = readProjectVersions(pbxproj);
  const env = { ...process.env };
  delete env.MOBILE_MARKETING_VERSION;
  delete env.MOBILE_BUILD_NUMBER;
  const result = spawnSync(process.execPath, [script, 'version'], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `${expected.marketingVersion} (${expected.buildNumber})`);
  const bad = spawnSync(process.execPath, [script, 'version'], { encoding: 'utf8', env: { ...env, MOBILE_MARKETING_VERSION: 'two' } });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /MOBILE_MARKETING_VERSION/);
});
