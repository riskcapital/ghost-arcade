/**
 * Update Checker - checks GitHub releases for new versions
 * Compares current app version against latest release on the public repo.
 */

import { writable } from 'svelte/store';

const RELEASES_API = 'https://api.github.com/repos/riskcapital/ghost-arcade-releases/releases/latest';
const CURRENT_VERSION = __APP_VERSION__;
const CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string;
  releaseNotes: string;
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

    const isNewer = compareVersions(latestVersion, CURRENT_VERSION) > 0;

    // Extract download URLs from assets
    const assets = data.assets || [];
    const downloadUrls: UpdateInfo['downloadUrls'] = {};
    for (const asset of assets) {
      const name = (asset.name || '').toLowerCase();
      if (name.endsWith('.exe')) downloadUrls.windows = asset.browser_download_url;
      else if (name.includes('arm64') && name.endsWith('.dmg')) downloadUrls.macArm = asset.browser_download_url;
      else if (name.includes('x64') && name.endsWith('.dmg')) downloadUrls.macIntel = asset.browser_download_url;
      else if (name.endsWith('.dmg') && !downloadUrls.macArm) downloadUrls.macArm = asset.browser_download_url;
    }

    updateInfo.set({
      available: isNewer,
      currentVersion: CURRENT_VERSION,
      latestVersion,
      releaseUrl: data.html_url || '',
      releaseNotes: data.body || '',
      downloadUrls,
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
