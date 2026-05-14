/**
 * versionCheck — poll GitHub Releases for newer Ghost Arcade Community
 * versions and surface them to the user.
 *
 * Why this is here, in the OSS edition
 * ────────────────────────────────────
 * The Pro edition uses Electron's autoUpdater + a paid licensing layer to
 * deliver in-app upgrades. Community is GitHub-released and unsigned by
 * default, so we DON'T silently auto-update — that would break IT-managed
 * installs and surprise users on locked-down machines. Instead we
 * passively check the public Releases API once on startup (and on
 * demand from the Settings panel), and if a newer tag exists we show a
 * non-modal banner that links to the download page. User in control.
 *
 * The check is rate-limited locally (LAST_CHECK_KEY in localStorage) so
 * we don't hammer the GitHub API on every reload during dev. Manual
 * "Check now" from Settings bypasses the rate limit.
 */

const REPO = 'riskcapital/ghost-arcade';
const LAST_CHECK_KEY = 'ghostarcade-last-version-check';
const LAST_RESULT_KEY = 'ghostarcade-last-version-result';
/** 24 h between automatic checks. Manual check overrides this. */
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface VersionCheckResult {
  /** The currently-running app version (from package.json via Vite define). */
  current: string;
  /** The latest release tag from GitHub, e.g. "v1.1.9", or null if check failed. */
  latest: string | null;
  /** True when latest > current. False when equal/older or unknown. */
  hasUpdate: boolean;
  /** When the check completed (ms since epoch). */
  checkedAt: number;
  /** Direct download / release-notes URL for the latest tag. */
  releaseUrl: string | null;
  /** Optional human-readable error if the API call failed. */
  error?: string;
}

/** Strip a leading 'v' from a version string. Returns '' if input is falsy. */
function strip(v: string | null | undefined): string {
  return (v ?? '').replace(/^v/, '');
}

/**
 * Compare two semver-ish strings. Returns -1 if a < b, 0 if equal, +1 if a > b.
 * Handles "1.1.10" vs "1.1.9" correctly (numeric segments, not lexical).
 * Pre-release suffixes like "-alpha.1" are treated as "less than" the base.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [aMain, aPre] = strip(a).split('-');
  const [bMain, bPre] = strip(b).split('-');
  const av = aMain.split('.').map((n) => parseInt(n, 10) || 0);
  const bv = bMain.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return +1;
  }
  // Main versions equal — pre-release ranks lower than no pre-release.
  if (aPre && !bPre) return -1;
  if (!aPre && bPre) return +1;
  if (aPre && bPre) return aPre < bPre ? -1 : aPre > bPre ? +1 : 0;
  return 0;
}

function readCached(): VersionCheckResult | null {
  try {
    const raw = localStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as VersionCheckResult;
  } catch {
    return null;
  }
}

function writeCached(result: VersionCheckResult): void {
  try {
    localStorage.setItem(LAST_RESULT_KEY, JSON.stringify(result));
    localStorage.setItem(LAST_CHECK_KEY, String(result.checkedAt));
  } catch {
    /* localStorage can fail in private mode; ignore. */
  }
}

/** True if we last checked < 24 h ago. */
function recentlyChecked(): boolean {
  try {
    const last = parseInt(localStorage.getItem(LAST_CHECK_KEY) || '0', 10);
    return Date.now() - last < AUTO_CHECK_INTERVAL_MS;
  } catch {
    return false;
  }
}

/**
 * Fetch the latest release tag from GitHub. Forces a network call —
 * use `checkForUpdate({ force: false })` to honor the local rate limit.
 */
async function fetchLatestTag(): Promise<{ tag: string; url: string } | null> {
  // The unauthenticated GitHub API allows 60 req/hr/IP — plenty for a
  // once-per-day check across an install base.
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}`);
  }
  const json = await res.json();
  if (!json?.tag_name) return null;
  return {
    tag: json.tag_name as string,
    url: (json.html_url as string) || `https://github.com/${REPO}/releases/tag/${json.tag_name}`,
  };
}

/**
 * Check for an update. Returns the most recent VersionCheckResult.
 * - When called with `{ force: false }` (default) and we checked recently,
 *   returns the cached result without hitting the network.
 * - When called with `{ force: true }`, always hits the network. Use this
 *   for the manual "Check for updates" button.
 */
export async function checkForUpdate(opts: { force?: boolean } = {}): Promise<VersionCheckResult> {
  const current = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') as string;

  if (!opts.force) {
    const cached = readCached();
    if (cached && recentlyChecked() && cached.current === current) {
      return cached;
    }
  }

  let result: VersionCheckResult;
  try {
    const latest = await fetchLatestTag();
    if (!latest) {
      result = {
        current,
        latest: null,
        hasUpdate: false,
        checkedAt: Date.now(),
        releaseUrl: null,
        error: 'No releases published yet',
      };
    } else {
      const cmp = compareVersions(latest.tag, current);
      result = {
        current,
        latest: latest.tag,
        hasUpdate: cmp > 0,
        checkedAt: Date.now(),
        releaseUrl: latest.url,
      };
    }
  } catch (err) {
    result = {
      current,
      latest: null,
      hasUpdate: false,
      checkedAt: Date.now(),
      releaseUrl: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  writeCached(result);
  return result;
}

/** Synchronous accessor for the most recent check result, if any. */
export function getCachedVersionResult(): VersionCheckResult | null {
  return readCached();
}
