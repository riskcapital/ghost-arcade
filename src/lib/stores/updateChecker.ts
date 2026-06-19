/**
 * Update Checker - checks GitHub releases for new versions
 * Compares current app version against latest release on the public repo.
 */

import { writable } from 'svelte/store';
import { CHANGELOG_PAGE_URL, DOWNLOAD_PAGE_URL, releaseNotesForVersion } from '../releaseNotes';

const RELEASES_API = 'https://api.github.com/repos/riskcapital/ghost-arcade-releases/releases/latest';
const CURRENT_VERSION = __APP_VERSION__;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
  releaseTitle: string;
  releaseHighlights: string[];
  downloadPageUrl: string;
  changelogUrl: string;
  downloadUrls: {
    windows?: string;
    macArm?: string;
    macIntel?: string;
  };
}

export const updateInfo = writable<UpdateInfo>({
  available: false,
  currentVersion: CURRENT_VERSION,
  latestVersion: CURRENT_VERSION,
  releaseUrl: '',
  releaseNotes: '',
  releaseTitle: '',
  releaseHighlights: [],
  downloadPageUrl: DOWNLOAD_PAGE_URL,
  changelogUrl: CHANGELOG_PAGE_URL,
  downloadUrls: {},
});

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export async function checkForUpdates(): Promise<void> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return;

    const data = await res.json();
    const latestTag = data.tag_name || '';
    const latestVersion = latestTag.replace(/^v/, '');

    if (!latestVersion) return;

    // Strictly newer — equal or older versions must NOT trigger
    // the update banner. The user reported "v1.1.3 is available"
    // appearing on v1.3.1, traced to cached state in the OTHER
    // checker (versionCheck.ts); this store is in-memory only so
    // it shouldn't suffer from that, but enforce the invariant
    // defensively here too in case GitHub ever returns a weird
    // latest pointer (e.g. a re-tagged older release).
    const isNewer = compareVersions(latestVersion, CURRENT_VERSION) > 0;

    const notes = releaseNotesForVersion(latestVersion, data.body || '');

    updateInfo.set({
      available: isNewer,
      currentVersion: CURRENT_VERSION,
      latestVersion,
      releaseUrl: DOWNLOAD_PAGE_URL,
      releaseNotes: notes.highlights.join('\n'),
      releaseTitle: notes.title,
      releaseHighlights: notes.highlights,
      downloadPageUrl: DOWNLOAD_PAGE_URL,
      changelogUrl: CHANGELOG_PAGE_URL,
      downloadUrls: {},
    });

    if (isNewer) {
      console.log(`[Update] New version available: v${latestVersion} (current: v${CURRENT_VERSION})`);
    }
  } catch (err) {
    // Silent fail - don't bother user if check fails
  }
}

let checkInterval: ReturnType<typeof setInterval> | null = null;

export function startUpdateChecker(): void {
  checkForUpdates();
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(checkForUpdates, CHECK_INTERVAL);
}

export function stopUpdateChecker(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
