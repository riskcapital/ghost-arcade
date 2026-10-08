// The iOS app's version lives in one place: the Xcode project.
// The desktop package version (2.x) is a different product line and must never leak into an iOS upload.

const MARKETING = /^\d+\.\d+(\.\d+)?$/;
const BUILD = /^\d+(\.\d+){0,2}$/;

/**
 * Reads MARKETING_VERSION and CURRENT_PROJECT_VERSION from the text of project.pbxproj.
 * Throws when a value is missing, differs between build configurations, or is not a plain
 * version number. It never falls back to another source.
 */
export function readProjectVersions(pbxproj) {
  return {
    marketingVersion: single(pbxproj, 'MARKETING_VERSION', MARKETING, 'like 1.1 or 1.1.2'),
    buildNumber: single(pbxproj, 'CURRENT_PROJECT_VERSION', BUILD, 'like 5'),
  };
}

/**
 * The version an archive will carry. The Xcode project decides; MOBILE_MARKETING_VERSION and
 * MOBILE_BUILD_NUMBER override it for one run when they are set.
 */
export function resolveVersions(pbxproj, env = {}) {
  const project = readProjectVersions(pbxproj);
  const marketingOverride = clean(env.MOBILE_MARKETING_VERSION);
  const buildOverride = clean(env.MOBILE_BUILD_NUMBER);
  if (marketingOverride && !MARKETING.test(marketingOverride)) {
    throw new Error(`MOBILE_MARKETING_VERSION is "${marketingOverride}". Use a version like 1.1 or 1.1.2.`);
  }
  if (buildOverride && !BUILD.test(buildOverride)) {
    throw new Error(`MOBILE_BUILD_NUMBER is "${buildOverride}". Use a number like 5.`);
  }
  return {
    marketingVersion: marketingOverride || project.marketingVersion,
    buildNumber: buildOverride || project.buildNumber,
    marketingSource: marketingOverride ? 'MOBILE_MARKETING_VERSION' : 'Xcode project',
    buildSource: buildOverride ? 'MOBILE_BUILD_NUMBER' : 'Xcode project',
  };
}

function single(text, key, pattern, example) {
  const values = [...String(text).matchAll(new RegExp(`\\b${key} = ([^;]+);`, 'g'))]
    .map((match) => match[1].trim().replace(/^"(.*)"$/, '$1'));
  const unique = [...new Set(values)];
  if (unique.length === 0) {
    throw new Error(`${key} is not set in the Xcode project. Set it on the App target in Xcode.`);
  }
  if (unique.length > 1) {
    throw new Error(`${key} differs between build configurations (${unique.join(', ')}). Set one value in Xcode.`);
  }
  if (!pattern.test(unique[0])) {
    throw new Error(`${key} in the Xcode project is "${unique[0]}". It must be a plain number ${example}.`);
  }
  return unique[0];
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}
