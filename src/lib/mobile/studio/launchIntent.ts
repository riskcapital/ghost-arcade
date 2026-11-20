// The phone app's front door: whether a launch shows the welcome screen, and where the
// studio goes when a path is picked there.
//
// The welcome screen shows on every cold launch, except when the app was opened by a pairing
// link: then it goes straight to the studio with Mobile Control pairing open, as before.

export type LaunchPath = 'vj' | 'mapping' | 'control';
/** A path picked on the welcome screen, or 'resume' when it closes without one. */
export type LaunchSignal = LaunchPath | 'resume';

const CONNECT_HOSTS = new Set(['ghostarcade.live', 'www.ghostarcade.live']);

/**
 * True for any of the forms a desktop pairing link takes: ghostarcade://pair?url=…, the
 * https://ghostarcade.live/connect Universal Link, or the desktop's own LAN link with ?pair=.
 * It only recognises the form; parseCompanionLink still checks the link before anything uses it.
 */
export function isPairingLink(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return false; }
  if (u.protocol === 'ghostarcade:') return u.hostname === 'pair';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (CONNECT_HOSTS.has(u.hostname.toLowerCase()) && /^\/connect\/?$/.test(u.pathname)) return true;
  return u.searchParams.has('pair');
}

/** What a cold launch opens on, given the link (if any) waiting in the pairing inbox. */
export function launchScreen(pendingLink: string | null | undefined): 'welcome' | 'pairing' {
  return isPairingLink(pendingLink) ? 'pairing' : 'welcome';
}

let next: LaunchPath | null = null;
let listener: ((signal: LaunchSignal) => void) | null = null;

/** Hands a signal to the running studio, or keeps a path for the studio about to start. */
export function setLaunchPath(signal: LaunchSignal): void {
  if (listener) listener(signal);
  else if (signal !== 'resume') next = signal;
}

/** The path picked before the studio started, once. */
export function takeLaunchPath(): LaunchPath | null {
  const path = next;
  next = null;
  return path;
}

/** The running studio listens here for paths picked after the home button. */
export function onLaunchPath(fn: (signal: LaunchSignal) => void): () => void {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}
