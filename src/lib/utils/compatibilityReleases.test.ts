import { describe, expect, it } from 'vitest';
import { selectCompatibilityRelease, COMPATIBILITY_MARKER, compatibilityReleaseUrl, releaseVersion, releaseProductName, formatReleaseTag, isStudioRelease } from './compatibilityReleases';
import { compareVersions } from './versionCheck';
describe('compatibility release channel', () => {
  it('never assumes native or later 1.9 releases are compatible', () => {
    expect(selectCompatibilityRelease([{tag_name:'v2.0.12'}, {tag_name:'v1.9.999'}, {tag_name:'v1.9.995'}])?.tag_name).toBe('v1.9.995');
  });
  it('accepts only explicitly qualified stable releases and picks the highest version', () => {
    const release = selectCompatibilityRelease([
      {tag_name:'v1.9.996',body:COMPATIBILITY_MARKER},
      {tag_name:'v1.9.997',body:COMPATIBILITY_MARKER},
      {tag_name:'v1.9.998',body:COMPATIBILITY_MARKER,draft:true},
      {tag_name:'v1.9.999',body:COMPATIBILITY_MARKER,prerelease:true},
      {tag_name:'v2.0.1-beta',body:COMPATIBILITY_MARKER},
    ]);
    expect(release?.tag_name).toBe('v1.9.997');
    expect(compatibilityReleaseUrl(release!)).toMatch(/releases\/tag\/v1.9.997$/);
  });
  it('offers a Studio release over any 1.9 build, and never a Pro (2.x) release', () => {
    const release = selectCompatibilityRelease([
      {tag_name:'v1.9.996',body:COMPATIBILITY_MARKER},
      {tag_name:'studio-v2.0.0',body:COMPATIBILITY_MARKER},
      {tag_name:'v2.1.2'},
      {tag_name:'studio-v2.0.1',body:'no marker'},
      {tag_name:'studio-v2.1.0',body:COMPATIBILITY_MARKER,draft:true},
    ]);
    expect(release?.tag_name).toBe('studio-v2.0.0');
    expect(compatibilityReleaseUrl(release!)).toMatch(/releases\/tag\/studio-v2.0.0$/);
  });
  it('reads and names Studio tags', () => {
    expect(releaseVersion('studio-v2.0.0')).toBe('2.0.0');
    expect(releaseVersion('v1.9.996')).toBe('1.9.996');
    expect(isStudioRelease('studio-v2.0.0')).toBe(true);
    expect(releaseProductName('studio-v2.0.0')).toBe('Ghost Arcade Studio');
    expect(releaseProductName('v1.9.996')).toBe('Ghost Arcade');
    expect(formatReleaseTag('studio-v2.0.0')).toBe('Studio 2.0.0');
    expect(formatReleaseTag('v1.9.996')).toBe('v1.9.996');
  });
  it('treats a Studio tag as newer than the running 1.9 build in the status-bar check', () => {
    expect(compareVersions('studio-v2.0.0', '1.9.996')).toBe(1);
    expect(compareVersions('studio-v2.0.0', '2.0.0')).toBe(0);
  });
});
