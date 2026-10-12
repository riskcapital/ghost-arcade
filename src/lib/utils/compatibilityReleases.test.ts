import { describe, expect, it } from 'vitest';
import { selectCompatibilityRelease, COMPATIBILITY_MARKER, compatibilityReleaseUrl } from './compatibilityReleases';
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
});
