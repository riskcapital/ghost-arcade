/**
 * versionCheck — poll GitHub Releases for newer Ghost Arcade GPU
 * versions and surface them to the user.
 *
 * GPU edition mirrors the Community check shape (compatible API for the
 * footer version pill / Settings "Check for updates" button) but points
 * at the GPU release channel: `ghost-arcade-releases`.
 *
 * The check is rate-limited locally (LAST_CHECK_KEY in localStorage) so
 * we don't hammer the GitHub API on every reload during dev. Manual
 * "Check now" from Settings bypasses the rate limit.
 */

const REPO = 'riskcapital/ghost-arcade-releases';
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

/** Return the running app version (from Vite's __APP_VERSION__
 *  define). Centralized so we don't drift between call sites. */
function runtimeVersion(): string {
  return (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') as string;
}

/** Read the cached version-check result from localStorage AND
 *  re-validate it against the currently running app version.
 *
 *  Defensive against the "stale cache" bug: a user could have
 *  cached a check result while on v1.0.x (when v1.1.3 was the
 *  latest available), then upgraded the binary to v1.3.1.
 *  Without validation, both the footer pill and the Settings
 *  banner would happily read that cache and announce "v1.1.3 is
 *  available" — pointing the user at an OLDER version than the
 *  one they're already running.
 *
 *  Two layers of defense:
 *   1. If cached.current doesn't match the running app version,
 *      return null. Forces a re-check.
 *   2. Re-derive hasUpdate from compareVersions(latest, runtime)
 *      instead of trusting the stored boolean. If we ever ship a
 *      build with a buggy comparison and write `hasUpdate: true`
 *      to localStorage, later builds with the fix should still
 *      ignore that garbage. */
function readCached(): VersionCheckResult | null {
  try {
    const raw = localStorage.getItem(LAST_RESULT_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as VersionCheckResult;
    const current = runtimeVersion();
    if (cached.current !== current) {
      // Version drift — the cache is from a previous install. Don't
      // surface it; consumers will get null and either trigger a
      // fresh check or just hide the badge.
      return null;
    }
    // Re-derive hasUpdate so we don't trust a possibly-corrupt
    // stored boolean. compareVersions handles 'v'-prefix stripping
    // and numeric semver segments.
    const recomputed: VersionCheckResult = { ...cached };
    if (recomputed.latest) {
      recomputed.hasUpdate = compareVersions(recomputed.latest, current) > 0;
    } else {
      recomputed.hasUpdate = false;
    }
    return recomputed;
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
  const current = runtimeVersion();

  if (!opts.force) {
    // readCached() already validates cached.current === runtime
    // version + re-derives hasUpdate from compareVersions, so we
    // can trust whatever it returns here without re-checking those
    // invariants ourselves.
    const cached = readCached();
    if (cached && recentlyChecked()) {
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
      // Use the strict-typed compareVersions output. > 0 means latest
      // is genuinely NEWER than runtime — not equal, not older.
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
