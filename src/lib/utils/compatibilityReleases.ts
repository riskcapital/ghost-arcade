/** Compatibility builds must opt in; a 1.9 tag alone says nothing about its renderer. */
export const COMPATIBILITY_MARKER = '<!-- ghost-arcade-channel: compatibility -->';
export const COMPATIBILITY_RELEASES_URL = 'https://github.com/riskcapital/ghost-arcade-releases/releases/tag/v1.9.995';
export interface CompatibilityRelease { tag_name: string; body?: string; draft?: boolean; prerelease?: boolean; html_url?: string }
export function selectCompatibilityRelease(releases: CompatibilityRelease[]): CompatibilityRelease | null {
  const eligible = releases.filter(release => !release.draft && !release.prerelease
    && /^v?\d+\.\d+\.\d+$/.test(release.tag_name)
    && (release.tag_name === 'v1.9.995' || release.body?.includes(COMPATIBILITY_MARKER)));
  eligible.sort((a, b) => {
    const av = a.tag_name.replace(/^v/, '').split('.').map(Number);
    const bv = b.tag_name.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return bv[i] - av[i];
    return 0;
  });
  return eligible[0] ?? null;
}
export function compatibilityReleaseUrl(release: CompatibilityRelease): string {
  return `https://github.com/riskcapital/ghost-arcade-releases/releases/tag/${encodeURIComponent(release.tag_name)}`;
}
export async function fetchCompatibilityRelease(): Promise<CompatibilityRelease> {
  const all: CompatibilityRelease[] = [];
  for (let page = 1; page <= 3; page++) {
    const response = await fetch(`https://api.github.com/repos/riskcapital/ghost-arcade-releases/releases?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Compatibility update check: GitHub API ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Unexpected compatibility release response.');
    all.push(...data);
    if (data.length < 100) break;
  }
  // Known original release remains safe when no compatibility update is published.
  return selectCompatibilityRelease(all) ?? { tag_name: 'v1.9.995', body: '' };
}
